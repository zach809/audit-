import { NextRequest, NextResponse } from "next/server";
import { exchangeClioCode } from "@/lib/clio";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");
  const expected = request.cookies.get("cwca_oauth_state")?.value;
  if (error) {
    return NextResponse.redirect(new URL(`/?clio=declined&reason=${encodeURIComponent(error)}`, request.url));
  }
  if (!code) {
    return NextResponse.redirect(new URL("/?clio=failed&reason=missing_code", request.url));
  }
  if (expected && state && state !== expected) {
    return NextResponse.redirect(new URL("/?clio=failed&reason=state_mismatch", request.url));
  }
  try {
    const redirectUri = new URL("/api/auth/clio/callback", request.url).toString();
    await exchangeClioCode(code, redirectUri);
  } catch (err) {
    const message = err instanceof Error ? err.message : "token_exchange_failed";
    return NextResponse.redirect(new URL(`/?clio=failed&reason=${encodeURIComponent(message.slice(0, 120))}`, request.url));
  }
  const response = NextResponse.redirect(new URL("/?clio=connected", request.url));
  response.cookies.set("cwca_oauth_state", "", { path: "/", maxAge: 0 });
  return response;
}
