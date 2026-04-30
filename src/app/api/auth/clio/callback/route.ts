import { NextRequest, NextResponse } from "next/server";
import { exchangeClioCode } from "@/lib/clio";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = request.cookies.get("cwca_oauth_state")?.value;
  if (!code || !state || !expected || state !== expected) {
    return NextResponse.redirect(new URL("/?clio=failed", request.url));
  }
  await exchangeClioCode(code);
  const response = NextResponse.redirect(new URL("/?clio=connected", request.url));
  response.cookies.set("cwca_oauth_state", "", { path: "/", maxAge: 0 });
  return response;
}
