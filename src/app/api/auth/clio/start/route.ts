import crypto from "crypto";
import { NextResponse } from "next/server";
import { buildClioAuthorizeUrl } from "@/lib/clio";
import { isValidSessionCookie } from "@/lib/session";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  if (!isValidSessionCookie(request.cookies.get("cwca_session")?.value)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const state = crypto.randomBytes(20).toString("hex");
  const response = NextResponse.redirect(buildClioAuthorizeUrl(state));
  response.cookies.set("cwca_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 600,
  });
  return response;
}
