import { NextRequest, NextResponse } from "next/server";
import { appConfig } from "@/lib/config";
import { safeEqual } from "@/lib/crypto";
import { setSessionCookie } from "@/lib/session";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  const expected = appConfig().dashboardPassword;
  if (!expected || safeEqual(password, expected)) {
    const response = NextResponse.redirect(new URL("/", request.url));
    setSessionCookie(response);
    return response;
  }
  return NextResponse.redirect(new URL("/login?error=1", request.url));
}
