import { NextRequest, NextResponse } from "next/server";
import { getDashboardData } from "@/lib/dashboard-data";
import { isValidSessionCookie } from "@/lib/session";
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
  const model = process.env.AI_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const { workspaceItems } = await getDashboardData({ from, to });

  const flagged = workspaceItems
    .filter((item) => !item.metric_excluded && isFlagged(item.item_status))
    .slice(0, 80);

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

  const prompt = [
    "You are CWCA's manual AI logic-review helper for a read-only Clio workflow audit app.",
    "Use only the metadata below. Do not assume communication bodies or legal facts. Do not give legal advice.",
    "The goal is to help the auditor find app-rule bugs, false-positive patterns, timing-window problems, keyword gaps, and Clio-linkage issues.",
    "Focus on practical optimization. Keep the answer short and useful for the developer/auditor.",
    "Reason-code rules:",
    "- FOUND_AFTER_DEADLINE means proof exists, but CWCA scored it as a timing issue. Do not call it missing work.",
    "- CALL_FOUND_NEARBY_DATE means a weekly check-in call exists near the expected date. Suggest timing-window review, not a missing-call bug.",
    "- CALL_NOT_FOUND_SAME_DAY means CWCA found the weekly check-in calendar event but no same-day/nearby call communication.",
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
    return NextResponse.json({ answer });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI logic review failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
