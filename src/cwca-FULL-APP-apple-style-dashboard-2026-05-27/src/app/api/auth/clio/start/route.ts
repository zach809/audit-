import crypto from "crypto";
import { NextResponse } from "next/server";
import { buildClioAuthorizeUrl } from "@/lib/clio";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const state = crypto.randomBytes(20).toString("hex");
  const redirectUri = new URL("/api/auth/clio/callback", request.url).toString();
  const response = NextResponse.redirect(buildClioAuthorizeUrl(state, redirectUri));
  response.cookies.set("cwca_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 600,
  });
  return response;
}
