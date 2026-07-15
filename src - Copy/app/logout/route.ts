import { NextResponse } from "next/server";
import { clearCaseManagerSessionCookie, clearSessionCookie } from "@/lib/session";

export async function GET(request: Request) {
  return NextResponse.redirect(new URL("/", request.url));
}

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/login", request.url));
  clearSessionCookie(response);
  clearCaseManagerSessionCookie(response);
  return response;
}
