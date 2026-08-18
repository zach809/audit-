import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { ClioClient, ClioRateLimitError } from "./clio";

const RATE_PER_MINUTE = 600;
const MIN_INTERVAL_MS = Math.ceil(60000 / RATE_PER_MINUTE);

type Stub = {
  arrivals: number[];
  paths: string[];
  handler: (req: IncomingMessage, res: ServerResponse) => void;
};

function json(res: ServerResponse, status: number, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify({ data: [] }));
}

async function withClient(stub: Stub, run: (client: ClioClient) => Promise<void>) {
  const server = createServer((req, res) => {
    stub.arrivals.push(Date.now());
    stub.paths.push(req.url ?? "");
    stub.handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const client = new ClioClient(RATE_PER_MINUTE, {
    apiBase: `http://127.0.0.1:${port}`,
    accessToken: async () => "stub-token",
  });
  try {
    await run(client);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

function gaps(arrivals: number[]) {
  return arrivals.slice(1).map((time, index) => time - arrivals[index]);
}

describe("ClioClient rate limit", () => {
  it("spaces 10 concurrent requests by the minimum interval", async (t) => {
    const stub: Stub = { arrivals: [], paths: [], handler: (_req, res) => json(res, 200) };
    await withClient(stub, async (client) => {
      await Promise.all(Array.from({ length: 10 }, (_, i) => client.request(`/m${i}.json`)));
    });
    const intervalGaps = gaps(stub.arrivals);
    t.diagnostic(`gaps=${intervalGaps.join(",")}`);
    const slack = 25;
    assert.equal(stub.arrivals.length, 10, `arrivals=${stub.arrivals.join(",")}`);
    assert.ok(
      intervalGaps[0] >= MIN_INTERVAL_MS,
      `first gap must be >= ${MIN_INTERVAL_MS}ms, arrivals=${stub.arrivals.join(",")} gaps=${intervalGaps.join(",")}`,
    );
    assert.ok(
      intervalGaps.every((gap) => gap >= MIN_INTERVAL_MS - slack),
      `expected >= ${MIN_INTERVAL_MS}ms, arrivals=${stub.arrivals.join(",")} gaps=${intervalGaps.join(",")}`,
    );
    assert.ok(
      stub.arrivals[9] - stub.arrivals[0] >= 9 * (MIN_INTERVAL_MS - slack),
      `span too short: arrivals=${stub.arrivals.join(",")}`,
    );
  });

  it("keeps sequential requests in order and still spaced", async () => {
    const stub: Stub = { arrivals: [], paths: [], handler: (_req, res) => json(res, 200) };
    await withClient(stub, async (client) => {
      await client.request("/a.json");
      await client.request("/b.json");
      await client.request("/c.json");
    });
    assert.deepEqual(
      stub.paths.map((path) => path.split("?")[0]),
      ["/a.json", "/b.json", "/c.json"],
    );
    assert.ok(
      gaps(stub.arrivals).every((gap) => gap >= MIN_INTERVAL_MS - 25),
      `arrivals=${stub.arrivals.join(",")}`,
    );
  });

  it("a persistent 429 stops after 5 retries with ClioRateLimitError", { timeout: 4000 }, async () => {
    const stub: Stub = {
      arrivals: [],
      paths: [],
      handler: (_req, res) => json(res, 429, { "retry-after": "0.05" }),
    };
    await withClient(stub, async (client) => {
      await assert.rejects(
        () => client.request("/limited.json"),
        (error: unknown) => {
          assert.ok(error instanceof ClioRateLimitError);
          assert.equal(error.name, "ClioRateLimitError");
          assert.equal(error.attempts, 5);
          assert.equal(error.retryAfterMs, 50);
          assert.match(error.message, /rate limit hit/i);
          assert.match(error.message, /50ms/);
          return true;
        },
      );
    });
    assert.equal(stub.arrivals.length, 6);
  });

  it("honours Retry-After between 429s instead of hot-looping", { timeout: 4000 }, async () => {
    const stub: Stub = {
      arrivals: [],
      paths: [],
      handler: (_req, res) => json(res, 429, { "retry-after": "0.12" }),
    };
    const started = Date.now();
    await withClient(stub, async (client) => {
      await assert.rejects(() => client.request("/limited.json"), ClioRateLimitError);
    });
    const elapsed = Date.now() - started;
    assert.equal(stub.arrivals.length, 6);
    assert.ok(elapsed >= 5 * 120 - 20, `elapsed=${elapsed}ms arrivals=${stub.arrivals.join(",")}`);
  });

  it("slows down when X-RateLimit-Remaining shrinks before the reset", async () => {
    let calls = 0;
    const reset = (Date.now() + 400) / 1000;
    const stub: Stub = {
      arrivals: [],
      paths: [],
      handler: (_req, res) => {
        calls += 1;
        json(res, 200, {
          "x-ratelimit-limit": "1200",
          "x-ratelimit-remaining": calls === 1 ? "1" : "0",
          "x-ratelimit-reset": String(reset),
        });
      },
    };
    await withClient(stub, async (client) => {
      await client.request("/first.json");
      await client.request("/second.json");
    });
    const gap = stub.arrivals[1] - stub.arrivals[0];
    assert.ok(gap >= 300, `expected remaining-based pause, gap=${gap} arrivals=${stub.arrivals.join(",")}`);
  });

  it("uses a more conservative X-RateLimit-Limit and will not go faster than the configured floor", async () => {
    const stub: Stub = {
      arrivals: [],
      paths: [],
      handler: (_req, res) =>
        json(res, 200, {
          "x-ratelimit-limit": "200",
          "x-ratelimit-remaining": "200",
          "x-ratelimit-reset": String((Date.now() + 5000) / 1000),
        }),
    };
    await withClient(stub, async (client) => {
      await client.request("/one.json");
      await client.request("/two.json");
    });
    const headerInterval = Math.ceil(60000 / 200);
    const gap = stub.arrivals[1] - stub.arrivals[0];
    assert.ok(gap >= headerInterval - 25, `expected header interval ${headerInterval}ms, gap=${gap}`);

    const fast: Stub = {
      arrivals: [],
      paths: [],
      handler: (_req, res) =>
        json(res, 200, {
          "x-ratelimit-limit": "1200",
          "x-ratelimit-remaining": "1200",
          "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 60),
        }),
    };
    await withClient(fast, async (client) => {
      await client.request("/one.json");
      await client.request("/two.json");
    });
    const fastGap = fast.arrivals[1] - fast.arrivals[0];
    assert.ok(fastGap >= MIN_INTERVAL_MS - 5, `floor must hold, gap=${fastGap}`);
    assert.ok(fastGap < 250, `should not stall, gap=${fastGap}`);
  });
});
