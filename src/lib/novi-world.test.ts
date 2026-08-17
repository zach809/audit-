import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

describe("Novi shared world", () => {
  it("keeps one token source and puts Matters on the same table as Today", () => {
    const novi = read("app/novi.css");
    const today = read("app/today.css");
    const page = read("app/page.tsx");
    const layout = read("app/layout.tsx");
    assert.match(novi, /--today-ground:\s*#050505/);
    assert.doesNotMatch(today, /--today-ground:/);
    assert.match(layout, /novi\.css/);
    assert.match(page, /className="shell novi"/);
    assert.match(page, /<Table/);
    assert.match(page, /mark-\$\{mark\.kind\}/);
    assert.match(page, /<Owner /);
    assert.match(page, /<WorkStep /);
    assert.doesNotMatch(novi, /!important/);
    assert.doesNotMatch(today, /!important/);
  });
});
