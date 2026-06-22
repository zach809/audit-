"use client";

import { useState } from "react";

type MatterAiHelpResult = {
  plainExplanation: string;
  whyItMayBeFlagged: string;
  whatToCheckInClio: string;
  possibleCwcaIssue: string;
  teamMessage: string;
  caution: string;
};

type MatterAiHelpProps = {
  matterId: string;
  matterNumber: string;
  clientName: string;
  attorney: string;
  stepCode: string;
  auditItemLabel: string;
  status: string;
  reason: string;
  due?: string | null;
  found?: string | null;
  clioUrl: string;
  proofUrl?: string | null;
};

function copyText(text: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  return Promise.resolve();
}

export function MatterAiHelp(props: MatterAiHelpProps) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<MatterAiHelpResult | null>(null);

  async function askAi() {
    setLoading(true);
    setMessage("Checking this one issue only...");
    setResult(null);

    const response = await fetch("/api/ai/matter-help", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        matter: {
          id: props.matterId,
          number: props.matterNumber,
          clientName: props.clientName,
          attorney: props.attorney,
          clioUrl: props.clioUrl,
        },
        issue: {
          stepCode: props.stepCode,
          auditItemLabel: props.auditItemLabel,
          status: props.status,
          reason: props.reason,
          due: props.due,
          found: props.found,
          proofUrl: props.proofUrl,
        },
      }),
    });

    const body = (await response.json().catch(() => null)) as { help?: MatterAiHelpResult; error?: string } | null;
    setLoading(false);

    if (!response.ok || !body?.help) {
      setMessage(body?.error || "AI help could not run.");
      return;
    }

    setResult(body.help);
    setMessage("AI note ready. Please review before using it.");
  }

  const copyable = result
    ? [
        `Matter: ${props.clientName || props.matterNumber}`,
        `Audit item: ${props.auditItemLabel}`,
        "",
        "Plain explanation:",
        result.plainExplanation,
        "",
        "What to check in Clio:",
        result.whatToCheckInClio,
        "",
        "Possible CWCA issue:",
        result.possibleCwcaIssue,
        "",
        "Team message:",
        result.teamMessage,
      ].join("\n")
    : "";

  return (
    <div className="matter-ai-help">
      <div className="matter-ai-help-head">
        <div>
          <strong>AI help for this item</strong>
          <small>Manual only. This sends only this matter's audit metadata, not communication bodies.</small>
        </div>
        <button className="compact" type="button" onClick={askAi} disabled={loading}>
          {loading ? "Asking AI..." : "Ask AI About This"}
        </button>
      </div>
      {message ? <p className="matter-ai-status">{message}</p> : null}
      {result ? (
        <div className="matter-ai-result">
          <div>
            <span>Plain explanation</span>
            <p>{result.plainExplanation}</p>
          </div>
          <div>
            <span>What to check in Clio</span>
            <p>{result.whatToCheckInClio}</p>
          </div>
          <div>
            <span>Possible CWCA issue</span>
            <p>{result.possibleCwcaIssue}</p>
          </div>
          <div className="matter-ai-message">
            <span>Team message</span>
            <p>{result.teamMessage}</p>
          </div>
          {result.caution ? <small>{result.caution}</small> : null}
          <button className="compact" type="button" onClick={() => copyText(copyable).then(() => setMessage("AI note copied."))}>
            Copy AI Note
          </button>
        </div>
      ) : null}
    </div>
  );
}
