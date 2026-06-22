import { NextRequest, NextResponse } from "next/server";
import { AiConfigurationError, generateAiText } from "@/lib/ai-provider";
import { NEXT_STEPS } from "@/lib/review-shared";
import { isValidSessionCookie } from "@/lib/session";

export const maxDuration = 60;

type DraftRequest = {
  matter?: {
    clientName?: string;
    matterNumber?: string;
    attorney?: string;
    caseManager?: string;
    auditItem?: string;
    status?: string;
    why?: string;
    due?: string | null;
    found?: string | null;
  };
  review?: {
    decision?: string;
    resultsDetails?: string;
    nextStep?: string;
    reportSummary?: string;
    proofType?: string;
  };
};

type DraftResponse = {
  resultsDetails: string;
  reportSummary: string;
  teamsMessage: string;
  suggestedNextStep: string;
  caution: string;
};

function cleanText(value: unknown, maxLength = 700): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function parseDraft(text: string): DraftResponse {
  const trimmed = text.trim();
  const jsonText = trimmed.startsWith("{") ? trimmed : trimmed.match(/\{[\s\S]*\}/)?.[0] ?? "";
  const parsed = JSON.parse(jsonText) as Partial<DraftResponse>;
  return {
    resultsDetails: cleanText(parsed.resultsDetails, 900),
    reportSummary: cleanText(parsed.reportSummary, 700),
    teamsMessage: cleanText(parsed.teamsMessage, 900),
    suggestedNextStep: NEXT_STEPS.includes(parsed.suggestedNextStep as (typeof NEXT_STEPS)[number])
      ? String(parsed.suggestedNextStep)
      : "Auditor needs to manually check Clio",
    caution: cleanText(parsed.caution, 500),
  };
}

export async function POST(request: NextRequest) {
  if (!isValidSessionCookie(request.cookies.get("cwca_session")?.value)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as DraftRequest | null;
  const matter = body?.matter ?? {};
  const review = body?.review ?? {};

  const safeContext = {
    matter: {
      clientName: cleanText(matter.clientName, 160),
      matterNumber: cleanText(matter.matterNumber, 160),
      attorney: cleanText(matter.attorney, 160),
      caseManager: cleanText(matter.caseManager, 160),
      auditItem: cleanText(matter.auditItem, 120),
      currentStatus: cleanText(matter.status, 120),
      whyFlagged: cleanText(matter.why, 700),
      due: cleanText(matter.due, 80),
      found: cleanText(matter.found, 80),
    },
    auditorDraft: {
      decision: cleanText(review.decision, 120),
      resultsDetails: cleanText(review.resultsDetails, 700),
      nextStep: cleanText(review.nextStep, 160),
      reportSummary: cleanText(review.reportSummary, 700),
      proofType: cleanText(review.proofType, 120),
    },
    allowedNextSteps: NEXT_STEPS,
  };

  const prompt = [
    "You are CWCA's internal audit writing assistant for a law-firm workflow auditor.",
    "Use only the supplied metadata and auditor notes. Do not invent proof, completion, client contact, or attorney action.",
    "Do not give legal advice. Do not decide compliance. Draft wording only for a human auditor to review.",
    "Write in plain English for busy non-technical staff.",
    "Return only valid JSON with these exact keys: resultsDetails, reportSummary, teamsMessage, suggestedNextStep, caution.",
    "suggestedNextStep must be exactly one of the allowedNextSteps values.",
    "If the auditor has not provided proof, say it still needs to be checked or confirmed in Clio.",
    "",
    `Context JSON: ${JSON.stringify(safeContext)}`,
  ].join("\n");

  try {
    const outputText = await generateAiText(prompt, { featureName: "AI draft", maxOutputTokens: 900, temperature: 0.2 });
    return NextResponse.json({ draft: parseDraft(outputText) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI draft failed.";
    return NextResponse.json({ error: message }, { status: error instanceof AiConfigurationError ? error.status : 502 });
  }
}
