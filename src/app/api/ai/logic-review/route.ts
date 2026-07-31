import { NextRequest, NextResponse } from "next/server";
import { getDashboardData } from "@/lib/dashboard-data";
import { isValidSessionCookie } from "@/lib/session";
import { APP_VERSION } from "@/lib/version";
import { workflowLabel } from "@/lib/workflow-rules";

export const maxDuration = 45;

function cleanText(value: unknown, maxLength = 900): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function extractOutputText(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const record = data as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text;

  const output = Array.isArray(record.output) ? record.output : [];
  const pieces: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as Record<string, unknown>).content) ? ((item as Record<string, unknown>).content as unknown[]) : [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const text = (part as Record<string, unknown>).text;
      if (typeof text === "string") pieces.push(text);
    }
  }
  return pieces.join("\n").trim();
}

function isFlagged(status: string | null | undefined): boolean {
  return ["Missing", "Unknown", "Late"].includes(String(status ?? ""));
}

function countBy<T>(items: T[], getKey: (item: T) => string): Array<{ key: string; count: number }> {
  const grouped = items.reduce((map, item) => {
    const key = getKey(item);
    map.set(key, (map.get(key) ?? 0) + 1);
    return map;
  }, new Map<string, number>());
  return Array.from(grouped.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ key, count }));
}

export async function POST(request: NextRequest) {
  if (!isValidSessionCookie(request.cookies.get("cwca_session")?.value)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "AI is not configured yet. Add OPENAI_API_KEY in Vercel to enable manual logic review." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const from = cleanText(body?.from, 20);
  const to = cleanText(body?.to, 20);
  const focus = cleanText(body?.focus, 40);
  const model = process.env.AI_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const { workspaceItems } = await getDashboardData({ from, to });
  const focusSteps =
    focus === "ongoing"
      ? new Set(["CLIENT_CONTACT", "WEEKLY_CLIENT_CHECKIN", "COURT_REMINDER_CALL"])
      : focus === "onboarding"
        ? new Set(["SETUP_WELCOME", "SETUP_ATTY_CALL", "SETUP_COURT_DATE"])
        : null;

  const flagged = workspaceItems
    .filter((item) => !item.metric_excluded && isFlagged(item.item_status))
    .filter((item) => !focusSteps || focusSteps.has(item.step_code))
    .slice(0, 80);
  const staleRows = flagged.filter((item) => item.audit_version !== APP_VERSION);
  const staleSummary = countBy(staleRows, (item) => `${workflowLabel(item.step_code)} / ${item.reason_code || "NO_REASON"}`).slice(0, 10);
  const staleRatio = flagged.length ? staleRows.length / flagged.length : 0;

  const grouped = flagged.reduce((map, item) => {
    const key = `${item.step_code}__${item.item_status}__${item.reason_code || "NO_REASON"}`;
    map.set(key, (map.get(key) ?? 0) + 1);
    return map;
  }, new Map<string, number>());

  const summary = Array.from(grouped.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([key, count]) => {
      const [stepCode, status, reason] = key.split("__");
      return { workflow: workflowLabel(stepCode), stepCode, status, reason, count };
    });

  const examples = flagged.slice(0, 25).map((item) => ({
    matterNumber: item.matter_number,
    client: `${item.client_first_name ?? ""} ${item.client_last_name ?? ""}`.trim(),
    attorney: item.responsible_attorney_name || "Unassigned",
    caseManager: item.case_manager_name || "",
    workflow: workflowLabel(item.step_code),
    stepCode: item.step_code,
    status: item.item_status,
    reasonCode: item.reason_code,
    due: item.deadline_at,
    found: item.evidence_at,
    proof: item.evidence_source && item.evidence_ref_id ? `${item.evidence_source} #${item.evidence_ref_id}` : "",
    auditVersion: item.audit_version,
  }));

  if (staleRatio >= 0.5) {
    const topPatterns = staleSummary.length
      ? staleSummary.map((item) => `- ${item.key}: ${item.count}`).join("\n")
      : "- No stale patterns found.";
    const sampleRows = examples
      .filter((item) => item.auditVersion !== APP_VERSION)
      .slice(0, 8)
      .map((item) => `- ${item.client || item.matterNumber} (${item.matterNumber}) - ${item.workflow}: ${item.status} / ${item.reasonCode || "NO_REASON"} / ${item.auditVersion || "no version"}`)
      .join("\n");

    return NextResponse.json({
      answer: [
        "Stop here: this report is mostly old audit data.",
        "",
        `${staleRows.length} of ${flagged.length} selected flagged rows were saved by an older CWCA version, so this is not reliable enough for rule tuning yet.`,
        "",
        "What this means:",
        "- Generic NOT_FOUND rows may be from old logic.",
        "- These rows may not know whether the issue was a missing calendar event, missing phone-call proof, missing template email, or timing-window issue.",
        "- Do not treat these counts as current bugs until the matters are rechecked.",
        "",
        "Old-row patterns found:",
        topPatterns,
        "",
        "Examples to rerun first:",
        sampleRows || "- No examples available.",
        "",
        "Next step:",
        "Run Audit Batch for this date range, or use Recheck Matter on the examples above. After the rows save under the current CWCA version, run AI Debug again.",
      ].join("\n"),
    });
  }

  const prompt = [
    "You are CWCA's manual AI logic-review helper for a read-only Clio workflow audit app.",
    "Use only the metadata below. Do not assume communication bodies or legal facts. Do not give legal advice.",
    "The goal is to help the auditor find app-rule bugs, false-positive patterns, timing-window problems, keyword gaps, and Clio-linkage issues.",
    "Focus on practical optimization. Keep the answer short and useful for the developer/auditor.",
    "Do not merely say 'review the rule' or 'check configuration.' Name the exact workflow, reasonCode, due/found timing, and sample clients/matter numbers from the examples when available.",
    "For the matters focus, analyze the whole selected Matters date range. Prioritize repeated patterns across clients, attorneys, and workflow steps over one-off explanations.",
    "For ongoing cases, separate true missing proof from likely false positives. Tell the auditor what Clio proof to capture: communication subject/title, calendar title, date/time, and direct Clio tab.",
    `Stale row count: ${staleRows.length} of ${flagged.length}.`,
    `Stale row patterns JSON: ${JSON.stringify(staleSummary)}`,
    "If stale row count is high, lead with this: the selected data must be rerun/rechecked before drawing conclusions because old saved rows do not reflect the current proof-specific matcher.",
    "Reason-code rules:",
    `- Current CWCA version is ${APP_VERSION}.`,
    "- If many examples have an auditVersion different from the current CWCA version, say the saved audit rows are stale and should be rerun before tuning the rule.",
    "- Generic NOT_FOUND rows from older versions may not distinguish missing calendar event, missing call proof, missing email/template proof, or timing-window issues. Treat those as stale unless they were created by the current version.",
    "- FOUND_AFTER_DEADLINE means proof exists, but CWCA scored it as a timing issue. Do not call it missing work.",
    "- CALL_FOUND_NEARBY_DATE means a weekly check-in call exists near the expected court-based due date. Suggest timing-window review, not a missing-call bug.",
    "- CALL_NOT_FOUND_SAME_DAY means CWCA found the weekly check-in calendar event but no phone-call communication by the court-based due date or nearby date.",
    "- WEEKLY_CALENDAR_EVENT_NOT_FOUND means no matter-linked weekly check-in calendar event was found after the rule waited for the correct court-based deadline.",
    "- WEEKLY_CALL_FOUND_EVENT_NOT_FOUND means a phone call exists, but the weekly check-in calendar event is missing.",
    "- WEEKLY_EVENT_FOUND_CALL_NOT_FOUND means the weekly calendar event exists, but call proof is missing.",
    "- REMINDER_TEMPLATE_FOUND_AFTER_GOAL means court reminder email/template proof exists, but it was sent after the 5 PM prior-business-day goal.",
    "- REMINDER_TEMPLATE_NOT_FOUND_PRE_COURT means no court reminder email/template proof was found before the upcoming court date.",
    "- NOT_FOUND means no matching proof was saved for that workflow in the audited Clio evidence.",
    "- CURRENT_UNANSWERED_CLIENT_MESSAGES means only the latest unresolved inbound streak should matter; later firm responses should clear it.",
    "Use this structure:",
    "1. Biggest patterns",
    "2. Likely false-positive causes",
    "3. Rules or matchers to tune",
    "4. What proof examples the team should capture from Clio",
    "5. What to check next",
    "Do not recommend write actions in Clio from CWCA. Keep it read-only.",
    "",
    `Focus: ${focus || "all"}`,
    `Date filters: ${from || "all"} to ${to || "all"}`,
    `Grouped issue summary JSON: ${JSON.stringify(summary)}`,
    `Example flagged rows JSON: ${JSON.stringify(examples)}`,
  ].join("\n");

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: prompt,
        temperature: 0.2,
        max_output_tokens: 900,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return NextResponse.json(
        { error: `AI logic review failed. Check OPENAI_API_KEY, AI_MODEL, and billing. ${detail}`.slice(0, 700) },
        { status: 502 },
      );
    }

    const answer = cleanText(extractOutputText(await response.json()), 2200);
    if (!answer) return NextResponse.json({ error: "AI did not return a logic review." }, { status: 502 });
    const staleWarning =
      staleRows.length > 0
        ? [
            `Important: ${staleRows.length} of ${flagged.length} selected flagged rows were created by an older CWCA version.`,
            "Run Audit Batch or Recheck Matter before treating these as real rule problems. Older saved rows may still show generic NOT_FOUND or CALL_NOT_FOUND_SAME_DAY and do not prove the current matcher is failing.",
            "",
          ].join("\n")
        : "";
    return NextResponse.json({ answer: `${staleWarning}${answer}`.trim() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI logic review failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
