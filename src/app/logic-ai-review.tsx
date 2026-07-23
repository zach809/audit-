"use client";

import { useState } from "react";

type LogicAiReviewProps = {
  from?: string;
  to?: string;
  focus?: string;
  title?: string;
  description?: string;
};

export function LogicAiReview({
  from = "",
  to = "",
  focus = "",
  title = "Find likely CWCA rule issues",
  description = "Runs only when clicked. Uses audit metadata to suggest false-positive patterns, matcher gaps, and timing-window fixes.",
}: LogicAiReviewProps) {
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");

  async function runReview() {
    if (loading) return;
    setLoading(true);
    setAnswer("");
    setError("");

    const response = await fetch("/api/ai/logic-review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from, to, focus }),
    });
    const body = (await response.json().catch(() => null)) as { answer?: string; error?: string } | null;
    setLoading(false);

    if (!response.ok || !body?.answer) {
      setError(body?.error || "AI logic review could not run.");
      return;
    }
    setAnswer(body.answer);
  }

  return (
    <div className="logic-ai-review">
      <div>
        <span className="label">Manual AI</span>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <button className="compact primary" type="button" onClick={runReview} disabled={loading}>
        {loading ? "Reviewing..." : "Review Logic"}
      </button>
      {error ? <p className="logic-ai-error">{error}</p> : null}
      {answer ? <pre>{answer}</pre> : null}
    </div>
  );
}
