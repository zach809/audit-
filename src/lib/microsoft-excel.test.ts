import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import * as excel from "./microsoft-excel";

const ENV_KEYS = [
  "MICROSOFT_TENANT_ID",
  "MICROSOFT_CLIENT_ID",
  "MICROSOFT_CLIENT_SECRET",
  "MICROSOFT_EXCEL_USER_ID",
  "MICROSOFT_EXCEL_WORKBOOK_SHARE_URL",
  "MICROSOFT_EXCEL_WORKBOOK_PATH",
  "MICROSOFT_EXCEL_WORKBOOK_ITEM_ID",
  "MICROSOFT_EXCEL_REFRESH_TOKEN",
] as const;

const savedEnv: Record<string, string | undefined> = {};
let originalFetch: typeof fetch;

before(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  originalFetch = globalThis.fetch;
});

after(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function setExcelEnv(values: Record<string, string>) {
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, {
    MICROSOFT_TENANT_ID: "tenant-1",
    MICROSOFT_CLIENT_ID: "client-1",
    MICROSOFT_EXCEL_USER_ID: "zach@hirschlawgroup.com",
    MICROSOFT_EXCEL_WORKBOOK_SHARE_URL: "https://example.com/workbook",
    ...values,
  });
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function captureTokenPosts() {
  const calls: Array<{ url: string; body: string }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = String(init?.body ?? "");
    calls.push({ url, body });
    if (url.includes("graph.microsoft.com")) return jsonResponse(200, { id: "workbook-should-not-be-touched" });
    if (body.includes("grant_type=refresh_token") && !body.includes("client_secret")) {
      return jsonResponse(200, { access_token: "delegated-access-token" });
    }
    if (body.includes("grant_type=client_credentials") && body.includes("client_secret=real-app-secret")) {
      return jsonResponse(200, { access_token: "application-access-token" });
    }
    return jsonResponse(401, { error: "invalid_client", error_description: "Secret was sent or grant was wrong." });
  }) as typeof fetch;
  return calls;
}

describe("Microsoft Excel auth", () => {
  it("uses delegated refresh when a refresh token is set, even with a wrong client secret", async () => {
    setExcelEnv({
      MICROSOFT_CLIENT_SECRET: "deliberately-wrong-secret",
      MICROSOFT_EXCEL_REFRESH_TOKEN: "refresh-token-live-value",
    });
    const calls = captureTokenPosts();
    assert.equal(excel.excelAuthDisclosure().authMode, "delegated");
    assert.equal(excel.excelAuthDisclosure().authAccount, "zach@hirschlawgroup.com");
    assert.equal(excel.microsoftExcelConfigured(), true);
    assert.equal(await excel.requestMicrosoftExcelAccessToken(), "delegated-access-token");
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /login\.microsoftonline\.com\/tenant-1\/oauth2\/v2\.0\/token/);
    assert.match(calls[0].body, /grant_type=refresh_token/);
    assert.match(calls[0].body, /Files\.ReadWrite/);
    assert.match(calls[0].body, /offline_access/);
    assert.doesNotMatch(calls[0].body, /Files\.ReadWrite\.All/);
    assert.doesNotMatch(calls[0].body, /client_secret/);
    assert.doesNotMatch(calls[0].body, /deliberately-wrong-secret/);
    assert.doesNotMatch(calls[0].body, /grant_type=client_credentials/);
  });

  it("is configured for delegated auth without a client secret, and not for application auth without one", () => {
    setExcelEnv({ MICROSOFT_EXCEL_REFRESH_TOKEN: "refresh-token-live-value" });
    assert.equal(excel.microsoftExcelConfigured(), true);
    setExcelEnv({});
    assert.equal(excel.excelAuthDisclosure().authMode, "application");
    assert.equal(excel.microsoftExcelConfigured(), false);
  });

  it("keeps the existing client-credentials grant when no refresh token is set", async () => {
    setExcelEnv({ MICROSOFT_CLIENT_SECRET: "real-app-secret" });
    const calls = captureTokenPosts();
    assert.equal(excel.excelAuthDisclosure().authMode, "application");
    assert.equal(excel.excelAuthDisclosure().authAccount, "application");
    assert.equal(excel.microsoftExcelConfigured(), true);
    assert.equal(await excel.requestMicrosoftExcelAccessToken(), "application-access-token");
    assert.equal(calls.length, 1);
    assert.match(calls[0].body, /grant_type=client_credentials/);
    assert.match(calls[0].body, /client_secret=real-app-secret/);
    assert.match(calls[0].body, /graph\.microsoft\.com%2F\.default/);
    assert.doesNotMatch(calls[0].body, /refresh_token/);
    assert.doesNotMatch(calls[0].body, /Files\.ReadWrite/);
  });

  it("fails with MicrosoftInvalidGrantError when the refresh token is rejected, without calling Graph or falling back", async () => {
    setExcelEnv({
      MICROSOFT_CLIENT_SECRET: "deliberately-wrong-secret",
      MICROSOFT_EXCEL_REFRESH_TOKEN: "refresh-token-live-value",
    });
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = String(init?.body ?? "");
      calls.push(url);
      if (body.includes("grant_type=client_credentials")) return jsonResponse(200, { access_token: "must-not-be-used" });
      if (url.includes("login.microsoftonline.com")) {
        return jsonResponse(400, {
          error: "invalid_grant",
          error_description: "AADSTS70000: The refresh token has expired or was revoked. refresh_token=should-never-leak",
        });
      }
      return jsonResponse(200, { id: "workbook-should-not-be-touched" });
    }) as typeof fetch;

    await assert.rejects(
      () => excel.requestMicrosoftExcelAccessToken(),
      (error: unknown) => {
        assert.ok(error instanceof excel.MicrosoftInvalidGrantError);
        assert.equal(error.name, "MicrosoftInvalidGrantError");
        assert.equal(error.code, "invalid_grant");
        assert.match(error.message, /invalid_grant/);
        assert.match(error.message, /re-issued|revoked|expired/i);
        assert.doesNotMatch(error.message, /should-never-leak|refresh-token-live-value|deliberately-wrong-secret/);
        return true;
      },
    );
    assert.equal(calls.length, 1);
    assert.match(calls[0], /login\.microsoftonline\.com/);
    assert.ok(!calls.some((url) => url.includes("graph.microsoft.com")));
  });

  it("redacts secrets in form/JSON text and in token error messages", async () => {
    const leaked = [
      "client_secret=super-secret-value",
      "refresh_token=refresh-token-live-value",
      "access_token=access-token-live-value",
      '{"client_secret":"json-secret","refresh_token":"json-refresh","access_token":"json-access"}',
    ].join(" ");
    const redacted = excel.redactMicrosoftSecrets(leaked);
    assert.match(redacted, /client_secret=\[REDACTED\]/);
    assert.match(redacted, /refresh_token=\[REDACTED\]/);
    assert.match(redacted, /access_token=\[REDACTED\]/);
    assert.doesNotMatch(redacted, /super-secret-value|refresh-token-live-value|access-token-live-value|json-secret|json-refresh|json-access/);

    setExcelEnv({ MICROSOFT_CLIENT_SECRET: "real-app-secret" });
    globalThis.fetch = (async () =>
      new Response("invalid_client client_secret=real-app-secret refresh_token=nope access_token=leak", { status: 401 })) as typeof fetch;
    await assert.rejects(
      () => excel.requestMicrosoftExcelAccessToken(),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, /real-app-secret|nope|leak/);
        assert.match(error.message, /\[REDACTED\]/);
        return true;
      },
    );
  });
});
