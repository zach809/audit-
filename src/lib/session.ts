import crypto from "crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { appConfig } from "./config";
import { safeEqual } from "./crypto";

const COOKIE_NAME = "cwca_session";

function sign(value: string): string {
  return crypto.createHmac("sha256", appConfig().sessionSecret).update(value).digest("hex");
}

export function createSessionCookie(): string {
  const expires = Date.now() + 1000 * 60 * 60 * 12;
  const value = String(expires);
  return `${value}.${sign(value)}`;
}

export function isValidSessionCookie(cookieValue?: string): boolean {
  if (!appConfig().dashboardPassword) return true;
  if (!cookieValue) return false;
  const [expires, signature] = cookieValue.split(".");
  if (!expires || !signature) return false;
  if (Number(expires) < Date.now()) return false;
  return safeEqual(sign(expires), signature);
}

export function hasDashboardSession(): boolean {
  return isValidSessionCookie(cookies().get(COOKIE_NAME)?.value);
}

export function requireDashboardSession(): void {
  if (!hasDashboardSession()) {
    throw new Error("Unauthorized");
  }
}

export function setSessionCookie(response: NextResponse): void {
  response.cookies.set(COOKIE_NAME, createSessionCookie(), {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 0,
  });
}

export function isAuthorizedWorkerRequest(request: NextRequest): boolean {
  const config = appConfig();
  const auth = request.headers.get("authorization") ?? "";
  if (config.cronSecret && auth === `Bearer ${config.cronSecret}`) return true;
  return isValidSessionCookie(request.cookies.get(COOKIE_NAME)?.value);
}
