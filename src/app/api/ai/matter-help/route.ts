import { NextRequest, NextResponse } from "next/server";
import { AiConfigurationError, generateAiText } from "@/lib/ai-provider";
import { isValidSessionCookie } from "@/lib/session";

export const maxDuration = 45;

type MatterHelpResponse = {
  plainExplanation: string;
  whyItMayBeFlagged: string;
  whatToCheckInClio: string;
  possibleCwcaIssue: string;
  teamMessage: string;
  caution: string;
};

function cleanText(value: unknown, maxLength = 700): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function parseHelp(text: string): MatterHelpResponse {
  const trimmed = text.trim();
  const jsonText = trimmed.startsWith("{") ? trimmed : trimmed.match(/\{[\s\S]*\}/)?.[0] ?? "";
  const parsed = JSON.parse(jsonText) as Partial<MatterHelpResponse>;
  return {
    plainExplanation: cleanText(parsed.plainExplanation, 700),
    whyItMayBeFlagged: cleanText(parsed.whyItMayBeFlagged, 700),
    whatToCheckInClio: cleanText(parsed.whatToCheckInClio, 900),
    possibleCwcaIssue: cleanText(parsed.possibleCwcaIssue, 700),
    teamMessage: cleanText(parsed.teamMessage, 900),
    caution: cleanText(parsed.caution, 500),
  };
}

export async function POST(request: NextRequest) {
  if (!isValidSessionCookie(request.cookies.get("cwca_session")?.value)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const matter = body?.matter && typeof body.matter === "object" ? (body.matter as Record<string, unknown>) : {};
  const issue = body?.issue && typeof body.issue === "object" ? (body.issue as Record<string, unknown>) : {};

  const safeContext = {
    matter: {
      id: cleanText(matter.id, 80),
      number: cleanText(matter.number, 160),
      clientName: cleanText(matter.clientName, 160),
      attorney: cleanText(matter.attorney, 160),
      clioUrl: cleanText(matter.clioUrl, 300),
    },
    issue: {
      stepCode: cleanText(issue.stepCode, 80),
      auditItemLabel: cleanText(issue.auditItemLabel, 120),
      status: cleanText(issue.status, 120),
      reason: cleanText(issue.reason, 900),
      due: cleanText(issue.due, 100),
      found: cleanText(issue.found, 100),
      proofUrl: cleanText(issue.proofUrl, 300),
    },
  };

  const prompt = [
    "You are CWCA's manual AI helper for a read-only Clio workflow audit app.",
    "Only analyze the single selected matter issue in the context JSON. Do not analyze all matters. Do not assume facts not provided.",
    "Do not give legal advice. Do not decide compliance. Do not say the team failed unless the provided audit metadata clearly supports it.",
    "This app is read-only against Clio. Do not recommend creating, updating, deleting, or changing Clio directly from the app.",
    "Help a human auditor understand what to check manually in Clio and whether this may be a CWCA matching/rule issue.",
    "Use clear, short, non-technical wording for busy law-firm staff.",
    "Return only valid JSON with these exact keys: plainExplanation, whyItMayBeFlagged, whatToCheckInClio, possibleCwcaIssue, teamMessage, caution.",
    "If proof is missing or uncertain, say it needs human confirmation in Clio.",
    "",
    `Context JSON: ${JSON.stringify(safeContext)}`,
  ].join("\n");

  try {
    const outputText = await generateAiText(prompt, { featureName: "AI helper", maxOutputTokens: 850, temperature: 0.2 });
    return NextResponse.json({ help: parseHelp(outputText) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI helper failed.";
    return NextResponse.json({ error: message }, { status: error instanceof AiConfigurationError ? error.status : 502 });
  }
}
