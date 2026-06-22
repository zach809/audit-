"use client";

import { useState } from "react";

type Filters = {
  attorney?: string;
  overall?: string;
  from?: string;
  to?: string;
};

type DiagnosticsReport = {
  summary: string;
  likelyCauses: string[];
  recommendedChecks: string[];
  ruleTuningIdeas: string[];
  clioSetupChecks: string[];
  plainEnglishMessage: string;
  caution: string;
};

type DiagnosticsResponse = {
  diagnostics?: DiagnosticsReport;
  issueCount?: number;
  analyzedCount?: number;
  generatedAt?: string;
  error?: string;
};

function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return Promise.resolve();
}

function listBlock(title: string, items: string[]) {
  if (!items.length) return null;
  return (
    <div>
      <strong>{title}</strong>
      <ul>
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}

function reportText(report: DiagnosticsReport, issueCount: number, analyzedCount: number): string {
  return [
    "CWCA AI Diagnostics",
    "",
    `Issues found: ${issueCount}`,
    `Issues analyzed: ${analyzedCount}`,
    "",
    "Summary:",
    report.summary,
    "",
    "Likely Causes:",
    ...(report.likelyCauses.length ? report.likelyCauses.map((item) => `- ${item}`) : ["- None listed."]),
    "",
    "Recommended Checks:",
    ...(report.recommendedChecks.length ? report.recommendedChecks.map((item) => `- ${item}`) : ["- None listed."]),
    "",
    "Rule Tuning Ideas:",
    ...(report.ruleTuningIdeas.length ? report.ruleTuningIdeas.map((item) => `- ${item}`) : ["- None listed."]),
    "",
    "Clio Setup Checks:",
    ...(report.clioSetupChecks.length ? report.clioSetupChecks.map((item) => `- ${item}`) : ["- None listed."]),
    "",
    "Plain-English Message:",
    report.plainEnglishMessage,
    "",
    "Caution:",
    report.caution,
  ].join("\n");
}

export function AiDiagnosticsPanel({ filters }: { filters: Filters }) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<DiagnosticsResponse | null>(null);

  async function runDiagnostics() {
    setLoading(true);
    setStatus("Reviewing saved audit logic issues...");
    setResult(null);

    const response = await fetch("/api/ai/diagnostics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filters }),
    });
    const body = (await response.json().catch(() => null)) as DiagnosticsResponse | null;
    setLoading(false);

    if (!response.ok || !body?.diagnostics) {
      setStatus(body?.error || "AI diagnostics could not run.");
      return;
    }

    setResult(body);
    setStatus("AI diagnostics ready. Review before acting on it.");
  }

  const diagnostics = result?.diagnostics;
  const issueCount = result?.issueCount ?? 0;
  const analyzedCount = result?.analyzedCount ?? 0;

  return (
    <section className="ai-diagnostics-card">
      <div className="ai-diagnostics-head">
        <div>
          <span className="label">AI Diagnostics</span>
          <h3>What might not be working?</h3>
          <p>Summarizes saved audit logic issues and suggests what to check next. It does not change Clio or audit results.</p>
        </div>
        <button className="primary" type="button" onClick={runDiagnostics} disabled={loading}>
          {loading ? "Checking..." : "Explain Issues"}
        </button>
      </div>

      {status ? <p className="ai-diagnostics-status">{status}</p> : null}

      {diagnostics ? (
        <div className="ai-diagnostics-result">
          <div className="ai-diagnostics-summary">
            <strong>{issueCount} issue{issueCount === 1 ? "" : "s"} found</strong>
            <span>{analyzedCount} analyzed by AI</span>
          </div>
          <p>{diagnostics.summary}</p>
          {listBlock("Likely causes", diagnostics.likelyCauses)}
          {listBlock("Recommended checks", diagnostics.recommendedChecks)}
          {listBlock("Rule tuning ideas", diagnostics.ruleTuningIdeas)}
          {listBlock("Clio setup checks", diagnostics.clioSetupChecks)}
          {diagnostics.plainEnglishMessage ? (
            <div className="ai-diagnostics-message">
              <strong>Plain-English note</strong>
              <p>{diagnostics.plainEnglishMessage}</p>
            </div>
          ) : null}
          {diagnostics.caution ? <small>{diagnostics.caution}</small> : null}
          <button
            className="compact"
            type="button"
            onClick={() => copyText(reportText(diagnostics, issueCount, analyzedCount)).then(() => setStatus("Diagnostics copied."))}
          >
            Copy Diagnostics
          </button>
        </div>
      ) : null}
    </section>
  );
}
