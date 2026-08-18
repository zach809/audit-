import { NextRequest, NextResponse } from "next/server";
import { db, initDb } from "@/lib/db";
import { caseManagerSession, isValidSessionCookie } from "@/lib/session";
import { rejectNonProductionWrite } from "@/lib/write-guard";

function redirectBack(request: NextRequest, path: string, params: Record<string, string>) {
  const url = new URL(path, request.url);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest) {
  const blocked = rejectNonProductionWrite();
  if (blocked) return blocked;
  const form = await request.formData();
  const action = String(form.get("action") ?? "").trim();
  const matterId = String(form.get("matter_id") ?? "").trim();
  const reason = String(form.get("reason") ?? "").trim();
  const tab = String(form.get("tab") ?? "matters").trim();
  const from = String(form.get("from") ?? "").trim();
  const to = String(form.get("to") ?? "").trim();
  const attorney = String(form.get("attorney") ?? "").trim();
  const overall = String(form.get("overall") ?? "").trim();
  const wstatus = String(form.get("wstatus") ?? "").trim();
  const wfocus = String(form.get("wfocus") ?? "").trim();
  const window = String(form.get("window") ?? "").trim();
  const q = String(form.get("q") ?? "").trim();
  const cmname = String(form.get("cmname") ?? "").trim();

  if (!matterId) {
    return redirectBack(request, action === "request" ? "/case-manager" : "/", {
      tab,
      from,
      to,
      attorney,
      overall,
      wstatus,
      wfocus,
      metrics: "failed",
      notice: "Matter details were missing.",
    });
  }

  await initDb();
  const sql = db();

  if (action === "request") {
    const caseManagerName = caseManagerSession(request.cookies.get("cwca_cm_session")?.value);
    if (!caseManagerName) return NextResponse.redirect(new URL("/case-manager/login", request.url), 303);
    await sql`
      insert into audit_metric_exclusion (
        matter_id, active, requested_by, request_reason, updated_at
      ) values (
        ${matterId}, false, ${caseManagerName}, ${reason || "Case manager requested admin review."}, now()
      )
      on conflict (matter_id) do update set
        requested_by = excluded.requested_by,
        request_reason = excluded.request_reason,
        updated_at = now()
    `;
    return redirectBack(request, "/case-manager", {
      window,
      q,
      cmname,
      attorney,
      metrics: "requested",
      message: "Request sent. This item is protected while admin reviews whether it should count.",
    });
  }

  if (!isValidSessionCookie(request.cookies.get("cwca_session")?.value)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  if (action === "exclude") {
    await sql`
      insert into audit_metric_exclusion (
        matter_id, active, requested_by, request_reason, approved_by, approved_at, updated_at
      ) values (
        ${matterId}, true, ${String(form.get("requested_by") ?? "")}, ${reason || "Excluded by admin."}, 'Admin', now(), now()
      )
      on conflict (matter_id) do update set
        active = true,
        request_reason = excluded.request_reason,
        approved_by = 'Admin',
        approved_at = now(),
        updated_at = now()
    `;
    return redirectBack(request, "/", {
      tab,
      from,
      to,
      attorney,
      overall,
      wstatus,
      wfocus,
      metrics: "excluded",
      notice: "Matter excluded from Standards metrics.",
    });
  }

  if (action === "restore") {
    await sql`
      update audit_metric_exclusion
      set active = false,
          approved_by = '',
          approved_at = null,
          updated_at = now()
      where matter_id = ${matterId}
    `;
    return redirectBack(request, "/", {
      tab,
      from,
      to,
      attorney,
      overall,
      wstatus,
      wfocus,
      metrics: "restored",
      notice: "Matter restored to Standards metrics.",
    });
  }

  return redirectBack(request, action === "request" ? "/case-manager" : "/", {
    tab,
    from,
    to,
    attorney,
    overall,
    wstatus,
    wfocus,
    metrics: "failed",
    notice: "Unknown metric action.",
  });
}
