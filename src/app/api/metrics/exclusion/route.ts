import { NextRequest, NextResponse } from "next/server";
import { db, initDb } from "@/lib/db";
import { writeMetricExclusion } from "@/lib/metric-exclusion";
import { caseManagerSession, isValidSessionCookie } from "@/lib/session";
import { dashboardReturnUrl, matterFocusId } from "@/lib/dashboard-return";
import { rejectNonProductionWrite } from "@/lib/write-guard";

function redirectBack(request: NextRequest, path: string, params: Record<string, string>, matterId?: string) {
  if (path === "/") {
    return NextResponse.redirect(new URL(dashboardReturnUrl(params, matterId), request.url), 303);
  }
  const url = new URL(path, request.url);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  const focus = matterFocusId(matterId);
  if (focus) url.hash = focus;
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
  const wstep = String(form.get("wstep") ?? "").trim();
  const cm = String(form.get("cm") ?? "").trim();
  const sort = String(form.get("sort") ?? "").trim();
  const dir = String(form.get("dir") ?? "").trim();
  const page = String(form.get("page") ?? "").trim();
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
      wstep,
      cm,
      sort,
      dir,
      page,
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
    }, matterId);
  }

  if (!isValidSessionCookie(request.cookies.get("cwca_session")?.value)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  if (action === "exclude" || action === "restore") {
    try {
      await writeMetricExclusion({
        action,
        matterId,
        reason,
        requestedBy: String(form.get("requested_by") ?? ""),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Metric update failed.";
      return redirectBack(request, "/", {
        tab,
        from,
        to,
        attorney,
        overall,
        wstatus,
        wfocus,
        wstep,
        cm,
        sort,
        dir,
        page,
        metrics: "failed",
        notice: message,
      }, matterId);
    }
    return redirectBack(request, "/", {
      tab,
      from,
      to,
      attorney,
      overall,
      wstatus,
      wfocus,
      wstep,
      cm,
      sort,
      dir,
      page,
      metrics: action === "exclude" ? "excluded" : "restored",
      notice: action === "exclude" ? "Matter excluded from Standards metrics." : "Matter restored to Standards metrics.",
    }, matterId);
  }

  return redirectBack(request, action === "request" ? "/case-manager" : "/", {
    tab,
    from,
    to,
    attorney,
    overall,
    wstatus,
    wfocus,
    wstep,
    cm,
    sort,
    dir,
    page,
    metrics: "failed",
    notice: "Unknown metric action.",
  }, matterId);
}
