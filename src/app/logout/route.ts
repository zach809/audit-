import { NextRequest, NextResponse } from "next/server";
import { clearCaseManagerSessionCookie, clearSessionCookie } from "@/lib/session";

export async function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  clearSessionCookie(response);
  clearCaseManagerSessionCookie(response);
  return response;
}

export async function POST(request: NextRequest) {
  return GET(request);
}
