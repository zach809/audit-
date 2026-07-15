import crypto from "crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { appConfig } from "./config";
import { safeEqual } from "./crypto";

const COOKIE_NAME = "cwca_session";
const CASE_MANAGER_COOKIE_NAME = "cwca_cm_session";

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

function encodeSessionText(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeSessionText(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function caseManagerAccounts(): Array<{ name: string; password: string }> {
  return appConfig()
    .caseManagerUsers.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(":");
      if (separator === -1) return { name: "", password: "" };
      return {
        name: entry.slice(0, separator).trim(),
        password: entry.slice(separator + 1).trim(),
      };
    })
    .filter((account) => account.name && account.password);
}

export function validateCaseManagerLogin(name: string, password: string): string | null {
  const normalizedName = name.trim().toLowerCase();
  const account = caseManagerAccounts().find((item) => item.name.toLowerCase() === normalizedName);
  if (!account || !safeEqual(account.password, password)) return null;
  return account.name;
}

export function createCaseManagerSessionCookie(name: string): string {
  const expires = Date.now() + 1000 * 60 * 60 * 12;
  const encodedName = encodeSessionText(name);
  const value = `${expires}.${encodedName}`;
  return `${value}.${sign(value)}`;
}

export function caseManagerSession(cookieValue?: string): string | null {
  if (!cookieValue) return null;
  const [expires, encodedName, signature] = cookieValue.split(".");
  if (!expires || !encodedName || !signature) return null;
  if (Number(expires) < Date.now()) return null;
  if (!safeEqual(sign(`${expires}.${encodedName}`), signature)) return null;
  try {
    return decodeSessionText(encodedName);
  } catch {
    return null;
  }
}

export function hasCaseManagerSession(): boolean {
  return Boolean(caseManagerSession(cookies().get(CASE_MANAGER_COOKIE_NAME)?.value));
}

export function currentCaseManagerName(): string | null {
  return caseManagerSession(cookies().get(CASE_MANAGER_COOKIE_NAME)?.value);
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

export function setCaseManagerSessionCookie(response: NextResponse, name: string): void {
  response.cookies.set(CASE_MANAGER_COOKIE_NAME, createCaseManagerSessionCookie(name), {
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

export function clearCaseManagerSessionCookie(response: NextResponse): void {
  response.cookies.set(CASE_MANAGER_COOKIE_NAME, "", {
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
