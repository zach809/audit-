import { NextRequest, NextResponse } from "next/server";
import { setCaseManagerSessionCookie, validateCaseManagerLogin } from "@/lib/session";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const name = String(form.get("name") ?? "");
  const password = String(form.get("password") ?? "");
  const validName = validateCaseManagerLogin(name, password);

  if (!validName) {
    return NextResponse.redirect(new URL("/case-manager/login?error=1", request.url), 303);
  }

  const response = NextResponse.redirect(new URL("/case-manager", request.url), 303);
  setCaseManagerSessionCookie(response, validName);
  return response;
}
