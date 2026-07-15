import { NextRequest, NextResponse } from "next/server";
import { isValidSessionCookie } from "@/lib/session";
import { WORKFLOW_RULES, workflowLabel } from "@/lib/workflow-rules";

export const maxDuration = 45;

type MatterHelpResponse = {
  plainExplanation: string;
  whyItMayBeFlagged: string;
  expectedProof: string;
  whatToCheckInClio: string;
  recommendedAuditorAction: string;
  possibleCwcaIssue: string;
  teamMessage: string;
  caution: string;
};

type ChatMessage = {
  role?: string;
  text?: string;
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

function parseHelp(text: string): MatterHelpResponse {
  const trimmed = text.trim();
  const jsonText = trimmed.startsWith("{") ? trimmed : trimmed.match(/\{[\s\S]*\}/)?.[0] ?? "";
  const parsed = JSON.parse(jsonText) as Partial<MatterHelpResponse>;
  return {
    plainExplanation: cleanText(parsed.plainExplanation, 700),
    whyItMayBeFlagged: cleanText(parsed.whyItMayBeFlagged, 700),
    expectedProof: cleanText(parsed.expectedProof, 700),
    whatToCheckInClio: cleanText(parsed.whatToCheckInClio, 900),
    recommendedAuditorAction: cleanText(parsed.recommendedAuditorAction, 800),
    possibleCwcaIssue: cleanText(parsed.possibleCwcaIssue, 700),
    teamMessage: cleanText(parsed.teamMessage, 900),
    caution: cleanText(parsed.caution, 500),
  };
}

function guidanceForStep(stepCode: string) {
  const fallback = {
    clioArea: "Matter details",
    expectedProof: "A matching Clio record that proves the workflow item was completed.",
    searchTips: "Open the matter in Clio and check the relevant Communications or Calendar area for matching proof.",
    ifProofExists: "If proof exists, mark the item Resolved and briefly note what was found.",
    ifProofMissing: "If proof is still missing, keep it as Still Needs Follow-Up and tell the team what proof is needed.",
    possibleFalsePositive: "If proof is visible in Clio but CWCA missed it, note the exact wording so the rule can be tuned.",
  };

  const map: Record<string, typeof fallback> = {
    SETUP_WELCOME: {
      clioArea: "Communications tab",
      expectedProof: "An outgoing email/template sent after matter creation with a subject like Welcome Letter, Carta de bienvenida, or Welcome to Hirsch Law Group.",
      searchTips: "Open Communications, filter to Email if needed, and look around the matter-created date/time for the welcome template subject.",
      ifProofExists: "If the welcome email/template is there, mark Resolved and note the subject/date found.",
      ifProofMissing: "If no welcome email/template is there, keep Still Needs Follow-Up and ask the team to send or confirm the welcome letter.",
      possibleFalsePositive: "If the email exists but CWCA missed it, the template subject may use new wording that should be added to matching rules.",
    },
    SETUP_ATTY_CALL: {
      clioArea: "Calendar tab",
      expectedProof: "A matter-linked attorney/client phone call calendar event, including naming styles like Phone Call, Client Call, DC-PhoneCall, EM - Spanish Phone Call, or similar.",
      searchTips: "Open Calendar and look near the matter-created date for a phone/client call event linked to this matter.",
      ifProofExists: "If the call event exists, mark Resolved and note the event title/date.",
      ifProofMissing: "If no call event exists, keep Still Needs Follow-Up and ask the team to schedule or link the call event.",
      possibleFalsePositive: "If the event exists but CWCA missed it, the event title may use a naming style that should be added to matching rules.",
    },
    SETUP_COURT_DATE: {
      clioArea: "Calendar tab",
      expectedProof: "A matter-linked court/hearing/status/plea/continuance calendar event.",
      searchTips: "Open Calendar and look for court-date wording, hearing/status/plea wording, or an event title that includes the client/case number and court purpose.",
      ifProofExists: "If the court event exists, mark Resolved and note the event title/date.",
      ifProofMissing: "If no court event exists and the date is known, keep Still Needs Follow-Up and ask the team to add or link it.",
      possibleFalsePositive: "If the event exists but CWCA missed it, the calendar title may be too vague or use a new court-status wording.",
    },
    CLIENT_CONTACT: {
      clioArea: "Communications tab",
      expectedProof: "An outgoing client email, phone call log, or communication note showing the client was contacted by the deadline.",
      searchTips: "Open Communications and check Email, Phone, and logs/notes around the due date for outgoing contact or a firm response.",
      ifProofExists: "If client contact proof exists, mark Resolved and note the type/date found.",
      ifProofMissing: "If no contact proof exists, keep Still Needs Follow-Up and ask the team to contact the client or record the proof.",
      possibleFalsePositive: "If proof exists but CWCA missed it, the communication type or direction may be unclear from Clio metadata.",
    },
    APPEARANCE_FILING: {
      clioArea: "Communications tab",
      expectedProof: "An outgoing appearance filing notification/template, such as Court Appearance Has Been Filed Notification or Notificacion/Notificación de Presentación en la Corte.",
      searchTips: "Open Communications, filter to Email if needed, and look for the appearance filing notification subject after matter creation.",
      ifProofExists: "If the appearance filing notification is there, mark Resolved and note the subject/date found.",
      ifProofMissing: "If the 48-hour business window has passed and no proof exists, keep Still Needs Follow-Up and ask the team to confirm or send the appearance notification.",
      possibleFalsePositive: "If the template exists but CWCA missed it, the subject may use a new appearance-notification wording.",
    },
    COURT_RESULTS: {
      clioArea: "Communications tab",
      expectedProof: "An outgoing court result email/template after court, such as Court Result and Next Court Date, Resultado del juicio, or final court result wording.",
      searchTips: "Open Communications and look after the last court event for an outgoing court-result template or result message.",
      ifProofExists: "If the court result communication is there, mark Resolved and note the subject/date found.",
      ifProofMissing: "If the 48-hour results window has passed and no proof exists, keep Still Needs Follow-Up and ask the team to send or record the result.",
      possibleFalsePositive: "If the result exists but CWCA missed it, the subject/body snippet may use new wording that needs tuning.",
    },
    POST_COURT_CALL: {
      clioArea: "Calendar tab",
      expectedProof: "A post-court attorney/client call calendar event after court results are received, when the case continues.",
      searchTips: "Open Calendar and look after the court-result communication for a post-court call, follow-up call, or attorney/client phone call event.",
      ifProofExists: "If the post-court call event exists, mark Resolved and note the event title/date.",
      ifProofMissing: "If the case continues and no post-court call event exists, keep Still Needs Follow-Up.",
      possibleFalsePositive: "If this was first court, final court, or no results were received yet, it may not be due yet or may need rule tuning.",
    },
    CLIENT_FOLLOWUP: {
      clioArea: "Communications tab",
      expectedProof: "A current firm response after the latest inbound client messages, so the client does not have an unresolved follow-up buildup.",
      searchTips: "Open Communications and review the most recent thread order. If the firm responded or called after the client messages, this should not remain a current follow-up risk.",
      ifProofExists: "If the firm responded, mark Resolved and note the response date/type.",
      ifProofMissing: "If the latest client messages still have no firm response after them, keep Still Needs Follow-Up and ask the team to respond.",
      possibleFalsePositive: "If the client was contacted after the inbound messages, or if CWCA counted non-client/duplicate messages, note the exact response date/type so the rule can be tuned.",
    },
    WEEKLY_CLIENT_CHECKIN: {
      clioArea: "Calendar and Communications tabs",
      expectedProof: "A weekly check-in/courtesy/follow-up call calendar event and a same-day real phone call communication for the client.",
      searchTips: "Open Calendar for the weekly check-in event, then open Communications and confirm a real phone call occurred on that same Illinois-local date.",
      ifProofExists: "If both the event and same-day call exist, mark Resolved and note both proof points.",
      ifProofMissing: "If either the calendar event or same-day call proof is missing, keep Still Needs Follow-Up.",
      possibleFalsePositive: "If the event exists but the call is on a nearby date, the same-day rule may need review.",
    },
  };

  return map[stepCode] ?? fallback;
}

function whereCwcaLooked(stepCode: string): string {
  if (["SETUP_WELCOME", "CLIENT_CONTACT", "APPEARANCE_FILING", "COURT_RESULTS", "CLIENT_FOLLOWUP"].includes(stepCode)) {
    return "CWCA looked at matter-linked Clio Communications returned by the read-only API, including available metadata like subject, type, date/time, direction, sender/receiver, firm user, and stored evidence references. CWCA does not store communication bodies.";
  }
  if (["SETUP_ATTY_CALL", "SETUP_COURT_DATE", "POST_COURT_CALL"].includes(stepCode)) {
    return "CWCA looked at matter-linked Clio Calendar entries returned by the read-only API, including title, description, event type, date/time, calendar owner, and stored evidence references.";
  }
  if (stepCode === "WEEKLY_CLIENT_CHECKIN") {
    return "CWCA looked for both a matter-linked weekly check-in Calendar entry and a same-day real phone-call Communication returned by the read-only API.";
  }
  return "CWCA looked at matter-linked Clio evidence returned by the read-only API and the saved CWCA audit metadata for this item.";
}

function safeHistory(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const role = cleanText(record.role, 20);
      const text = cleanText(record.text, 700);
      if (!text || !["user", "assistant"].includes(role)) return null;
      return { role, text };
    })
    .filter(Boolean)
    .slice(-6) as ChatMessage[];
}

export async function POST(request: NextRequest) {
  if (!isValidSessionCookie(request.cookies.get("cwca_session")?.value)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "AI is not configured yet. Add OPENAI_API_KEY in Vercel to enable this manual helper." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const matter = body?.matter && typeof body.matter === "object" ? (body.matter as Record<string, unknown>) : {};
  const issue = body?.issue && typeof body.issue === "object" ? (body.issue as Record<string, unknown>) : {};
  const question = cleanText(body?.question, 700);
  const history = safeHistory(body?.history);
  const model = process.env.AI_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
  const stepCode = cleanText(issue.stepCode, 80);

  const safeContext = {
    matter: {
      id: cleanText(matter.id, 80),
      number: cleanText(matter.number, 160),
      clientName: cleanText(matter.clientName, 160),
      attorney: cleanText(matter.attorney, 160),
      clioUrl: cleanText(matter.clioUrl, 300),
    },
    issue: {
      stepCode,
      auditItemLabel: cleanText(issue.auditItemLabel, 120) || workflowLabel(stepCode),
      status: cleanText(issue.status, 120),
      reason: cleanText(issue.reason, 900),
      reasonCode: cleanText(issue.reasonCode, 180),
      operationalState: cleanText(issue.operationalState, 180),
      due: cleanText(issue.due, 100),
      found: cleanText(issue.found, 100),
      evidenceSource: cleanText(issue.evidenceSource, 80),
      evidenceRefId: cleanText(issue.evidenceRefId, 80),
      savedProof: cleanText(issue.evidenceSource, 80) && cleanText(issue.evidenceRefId, 80)
        ? `${cleanText(issue.evidenceSource, 80)} #${cleanText(issue.evidenceRefId, 80)}`
        : "No saved proof reference for this flagged item.",
      auditVersion: cleanText(issue.auditVersion, 160),
      lastEvaluatedAt: cleanText(issue.lastEvaluatedAt, 120),
      proofUrl: cleanText(issue.proofUrl, 300),
    },
    workflowRule: {
      label: WORKFLOW_RULES[stepCode]?.label ?? workflowLabel(stepCode),
      goal: WORKFLOW_RULES[stepCode]?.goal ?? "",
      expectedMissingText: WORKFLOW_RULES[stepCode]?.missing ?? "",
      defaultAction: WORKFLOW_RULES[stepCode]?.action ?? "",
      whereCwcaLooked: whereCwcaLooked(stepCode),
      guidance: guidanceForStep(stepCode),
    },
  };

  const structuredPrompt = [
    "You are CWCA's manual AI helper for a read-only Clio workflow audit app.",
    "Only analyze the single selected matter issue in the context JSON. Do not analyze all matters. Do not assume facts not provided.",
    "Do not give legal advice. Do not decide compliance. Do not say the team failed unless the provided audit metadata clearly supports it.",
    "This app is read-only against Clio. Do not recommend creating, updating, deleting, or changing Clio directly from the app.",
    "Help a human auditor understand the practical next check. Use the workflowRule guidance. Be specific to the audit item, not generic.",
    "Explain what CWCA expected to find, what appears missing/late/uncertain, and what the auditor should do next.",
    "Important: if status is Late and savedProof or found time exists, say CWCA found proof. Explain it as a timing review, not missing work.",
    "Use clear, short, non-technical wording for busy law-firm staff. Avoid vague phrases like 'look for any documentation' unless you name the exact proof type.",
    "Return only valid JSON with these exact keys: plainExplanation, whyItMayBeFlagged, expectedProof, whatToCheckInClio, recommendedAuditorAction, possibleCwcaIssue, teamMessage, caution.",
    "recommendedAuditorAction should tell the auditor which CWCA review choice to consider: Resolved, Still Needs Follow-Up, In Progress, Unable to Confirm, or Needs Attorney Review.",
    "If proof is missing or uncertain, say it needs human confirmation in Clio. If proof exists but CWCA missed it, suggest noting exact wording so the rule can be tuned.",
    "",
    `Context JSON: ${JSON.stringify(safeContext)}`,
  ].join("\n");

  const chatPrompt = [
    "You are CWCA's manual AI debugging chat for one selected audit issue.",
    "Answer the auditor's question directly. Keep it practical, short, and specific to this selected issue.",
    "Focus on: where CWCA looked, why it flagged, whether this could be a false positive, what exact proof to verify in Clio, and what app rule/date-window/linkage may need improvement.",
    "Important: if the selected issue status is Late, do not say CWCA missed the item. Say proof was found but after the goal, and the likely improvement is clearer Timing Review wording or date-window tuning.",
    "Use the saved issue fields. Mention reasonCode, operationalState, due/found times, savedProof, auditVersion, and lastEvaluatedAt when they help explain the bug.",
    "If the question asks how to improve the rule, answer with: 1) what CWCA knows from the saved row, 2) likely false-positive causes, 3) exact Clio proof to capture, 4) concrete matcher/date/linkage improvement.",
    "For Client Follow-Up, explain that CWCA should care about the current unresolved inbound streak, not old inbound messages that were later answered. A later firm email/call should clear the risk.",
    "If the context does not include candidate communication/calendar rows, say CWCA only has the saved audit row in this chat and the auditor should capture the exact subject/title/date/link from Clio.",
    "Use only the provided context. Do not invent evidence. If the auditor says they can see proof in Clio, explain what exact wording/date/link/type they should capture so CWCA can be tuned.",
    "Do not give legal advice. Do not write to Clio. Do not mark anything resolved.",
    "Use plain English. Prefer 3 to 6 short bullets. Avoid long disclaimers.",
    "",
    `Auditor question: ${question}`,
    `Recent chat JSON: ${JSON.stringify(history)}`,
    `Selected issue context JSON: ${JSON.stringify(safeContext)}`,
  ].join("\n");

  const prompt = question ? chatPrompt : structuredPrompt;

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
        max_output_tokens: 850,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return NextResponse.json(
        { error: `AI helper failed. Check OPENAI_API_KEY, AI_MODEL, and OpenAI billing. ${detail}`.slice(0, 700) },
        { status: 502 },
      );
    }

    const outputText = extractOutputText(await response.json());
    if (!outputText) return NextResponse.json({ error: "AI did not return help text." }, { status: 502 });
    if (question) return NextResponse.json({ answer: cleanText(outputText, 1800) });
    return NextResponse.json({ help: parseHelp(outputText) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI helper failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
