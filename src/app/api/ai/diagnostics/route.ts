import { NextRequest, NextResponse } from "next/server";
import {
  getLogicIssueRows,
  logicIssueExplanation,
  logicIssueNextStep,
  logicIssueType,
  type DashboardFilters,
} from "@/lib/dashboard-data";
import { isValidSessionCookie } from "@/lib/session";
import { workflowLabel } from "@/lib/workflow-rules";

export const maxDuration = 60;

type DiagnosticsReport = {
  summary: string;
  likelyCauses: string[];
  recommendedChecks: string[];
  ruleTuningIdeas: string[];
  clioSetupChecks: string[];
  plainEnglishMessage: string;
  caution: string;
};

function cleanText(value: unknown, maxLength = 700): string {
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

function cleanList(value: unknown, maxItems = 6): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanText(item, 300)).filter(Boolean).slice(0, maxItems);
}

function parseDiagnostics(text: string): DiagnosticsReport {
  const trimmed = text.trim();
  const jsonText = trimmed.startsWith("{") ? trimmed : trimmed.match(/\{[\s\S]*\}/)?.[0] ?? "";
  const parsed = JSON.parse(jsonText) as Partial<DiagnosticsReport>;
  return {
    summary: cleanText(parsed.summary, 900),
    likelyCauses: cleanList(parsed.likelyCauses),
    recommendedChecks: cleanList(parsed.recommendedChecks),
    ruleTuningIdeas: cleanList(parsed.ruleTuningIdeas),
    clioSetupChecks: cleanList(parsed.clioSetupChecks),
    plainEnglishMessage: cleanText(parsed.plainEnglishMessage, 900),
    caution: cleanText(parsed.caution, 500),
  };
}

function safeFilters(value: unknown): DashboardFilters {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  return {
    attorney: cleanText(record.attorney, 80),
    overall: cleanText(record.overall, 80),
    from: cleanText(record.from, 20),
    to: cleanText(record.to, 20),
  };
}

export async function POST(request: NextRequest) {
  if (!isValidSessionCookie(request.cookies.get("cwca_session")?.value)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "AI diagnostics are not configured yet. Add OPENAI_API_KEY in Vercel to enable AI diagnostics." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as { filters?: unknown } | null;
  const filters = safeFilters(body?.filters);
  const model = process.env.AI_MODEL || "gpt-4o-mini";
  const rows = await getLogicIssueRows(filters);
  const analyzedRows = rows.slice(0, 80);

  if (!rows.length) {
    return NextResponse.json({
      diagnostics: {
        summary: "No current audit logic issues matched these filters.",
        likelyCauses: [],
        recommendedChecks: ["Run a fresh audit batch if you expected to see current issues."],
        ruleTuningIdeas: [],
        clioSetupChecks: [],
        plainEnglishMessage: "No repeat audit logic problems are showing in this view right now.",
        caution: "This only checks saved CWCA diagnostics rows. It does not replace a manual Clio review.",
      } satisfies DiagnosticsReport,
      issueCount: 0,
      analyzedCount: 0,
      generatedAt: new Date().toISOString(),
    });
  }

  const grouped = analyzedRows.reduce<Record<string, number>>((counts, row) => {
    const key = `${logicIssueType(row)} | ${workflowLabel(row.step_code)} | ${row.reason_code || "No reason code"}`;
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});

  const safeRows = analyzedRows.map((row) => ({
    issueType: logicIssueType(row),
    workflowArea: workflowLabel(row.step_code),
    auditStatus: row.item_status,
    operationalState: row.operational_state,
    reasonCode: row.reason_code,
    whatHappened: logicIssueExplanation(row),
    suggestedDebuggingStep: logicIssueNextStep(row),
    hasEvidence: Boolean(row.evidence_source && row.evidence_ref_id),
    evidenceSource: row.evidence_source,
    deadlinePresent: Boolean(row.deadline_at),
    lastCheckedPresent: Boolean(row.last_evaluated_at),
    auditVersion: row.audit_version,
    humanReviewStatus: row.review_decision || "Not reviewed",
  }));

  const prompt = [
    "You are CWCA's internal audit diagnostics assistant.",
    "Explain what may not be working in the audit logic or Clio reads, using only the supplied metadata.",
    "Do not blame staff. Do not say an item was truly missed unless the metadata proves it.",
    "Do not give legal advice. Do not recommend Clio write actions. This is read-only diagnostic guidance.",
    "Focus on likely technical or rule causes: API/read errors, permission gaps, evidence wording mismatch, direction unclear, stale rows needing recheck, date-window issues, or rule tuning.",
    "Return only valid JSON with these exact keys: summary, likelyCauses, recommendedChecks, ruleTuningIdeas, clioSetupChecks, plainEnglishMessage, caution.",
    "Use short, plain-English bullets. Make it useful to a non-technical manager and to the person tuning CWCA.",
    "",
    `Filters: ${JSON.stringify(filters)}`,
    `Issue count total: ${rows.length}`,
    `Analyzed count: ${analyzedRows.length}`,
    `Grouped counts: ${JSON.stringify(grouped)}`,
    `Issue rows: ${JSON.stringify(safeRows)}`,
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
        max_output_tokens: 1100,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return NextResponse.json(
        { error: `AI diagnostics failed. Check OPENAI_API_KEY, AI_MODEL, and OpenAI billing. ${detail}`.slice(0, 700) },
        { status: 502 },
      );
    }

    const data = await response.json();
    const outputText = extractOutputText(data);
    if (!outputText) {
      return NextResponse.json({ error: "AI did not return diagnostics text." }, { status: 502 });
    }

    return NextResponse.json({
      diagnostics: parseDiagnostics(outputText),
      issueCount: rows.length,
      analyzedCount: analyzedRows.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI diagnostics failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
