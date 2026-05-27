import { db, initDb } from "./db";
import { decryptText, encryptText } from "./crypto";

export type StoredToken = {
  refreshToken: string;
  accessToken: string | null;
  accessTokenExpiresAt: Date | null;
};

export async function saveClioTokens(input: {
  refreshToken?: string;
  accessToken?: string;
  expiresIn?: number;
}) {
  await initDb();
  const sql = db();
  const existing = await getClioTokens().catch(() => null);
  const refreshToken = input.refreshToken ?? existing?.refreshToken;
  if (!refreshToken) throw new Error("No Clio refresh token available to save");

  const accessToken = input.accessToken ?? existing?.accessToken ?? null;
  const expiresAt = input.expiresIn
    ? new Date(Date.now() + input.expiresIn * 1000)
    : existing?.accessTokenExpiresAt ?? null;

  await sql`
    insert into oauth_tokens (
      provider,
      encrypted_refresh_token,
      encrypted_access_token,
      access_token_expires_at,
      updated_at
    )
    values (
      'clio',
      ${encryptText(refreshToken)},
      ${accessToken ? encryptText(accessToken) : null},
      ${expiresAt},
      now()
    )
    on conflict (provider) do update set
      encrypted_refresh_token = excluded.encrypted_refresh_token,
      encrypted_access_token = excluded.encrypted_access_token,
      access_token_expires_at = excluded.access_token_expires_at,
      updated_at = now()
  `;
}

export async function getClioTokens(): Promise<StoredToken | null> {
  await initDb();
  const rows = await db()`
    select encrypted_refresh_token, encrypted_access_token, access_token_expires_at
    from oauth_tokens
    where provider = 'clio'
    limit 1
  `;
  if (!rows.length) return null;
  return {
    refreshToken: decryptText(rows[0].encrypted_refresh_token),
    accessToken: rows[0].encrypted_access_token ? decryptText(rows[0].encrypted_access_token) : null,
    accessTokenExpiresAt: rows[0].access_token_expires_at,
  };
}

export async function hasClioConnection(): Promise<boolean> {
  const tokens = await getClioTokens();
  return Boolean(tokens?.refreshToken);
}
