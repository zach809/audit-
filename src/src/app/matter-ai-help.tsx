"use client";

import { useState, type FormEvent } from "react";

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
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
  reasonCode?: string | null;
  operationalState?: string | null;
  due?: string | null;
  found?: string | null;
  evidenceSource?: string | null;
  evidenceRefId?: string | null;
  auditVersion?: string | null;
  lastEvaluatedAt?: string | null;
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
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  async function askAi(nextQuestion: string) {
    const trimmed = nextQuestion.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setMessage("Asking about this one flag...");
    const nextMessages: ChatMessage[] = [...messages, { role: "user", text: trimmed }];
    setMessages(nextMessages);
    setQuestion("");

    const response = await fetch("/api/ai/matter-help", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: trimmed,
        history: messages.slice(-6),
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
          reasonCode: props.reasonCode,
          operationalState: props.operationalState,
          due: props.due,
          found: props.found,
          evidenceSource: props.evidenceSource,
          evidenceRefId: props.evidenceRefId,
          auditVersion: props.auditVersion,
          lastEvaluatedAt: props.lastEvaluatedAt,
          proofUrl: props.proofUrl,
        },
      }),
    });

    const body = (await response.json().catch(() => null)) as { answer?: string; error?: string } | null;
    setLoading(false);

    if (!response.ok || !body?.answer) {
      setMessage(body?.error || "AI help could not run.");
      return;
    }

    setMessages([...nextMessages, { role: "assistant", text: body.answer }]);
    setMessage("Answer ready. Review it before acting on it.");
  }

  function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    askAi(question);
  }

  const lastAnswer = [...messages].reverse().find((item) => item.role === "assistant")?.text ?? "";
  const quickQuestions = [
    "Where did CWCA look?",
    "Could this be a false positive?",
    "What proof should I check?",
    "How can we improve this rule?",
  ];

  return (
    <div className="matter-ai-help matter-ai-compact">
      <div className="matter-ai-help-head">
        <div>
          <span className="matter-ai-kicker">Manual AI</span>
          <strong>Ask CWCA AI</strong>
          <small>Ask about this one flag only.</small>
        </div>
        <a className="button compact" href={props.clioUrl} target="_blank" rel="noreferrer">Open Clio</a>
      </div>

      <form className="matter-ai-chat-form" onSubmit={submitQuestion}>
        <div className="matter-ai-input-row">
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask where CWCA looked, why it flagged, or what rule may need tuning..."
            rows={1}
          />
          <button className="compact primary" type="submit" disabled={loading || !question.trim()}>
            {loading ? "Asking..." : "Ask"}
          </button>
        </div>
      </form>

      <details className="matter-ai-suggestions">
        <summary>Suggested questions</summary>
        <div className="matter-ai-prompts">
          {quickQuestions.map((item) => (
            <button className="compact" type="button" key={item} onClick={() => askAi(item)} disabled={loading}>
              {item}
            </button>
          ))}
        </div>
      </details>

      {message ? <p className="matter-ai-status">{message}</p> : null}

      {messages.length ? (
        <div className="matter-ai-chat-log">
          {messages.map((item, index) => (
            <div className={`matter-ai-bubble ${item.role}`} key={`${item.role}-${index}`}>
              <span>{item.role === "user" ? "You asked" : "CWCA AI"}</span>
              <p>{item.text}</p>
            </div>
          ))}
        </div>
      ) : null}

      {lastAnswer ? (
        <div className="matter-ai-footer">
          <small>Use this to debug CWCA logic. Human review still makes the final call.</small>
          <button className="compact" type="button" onClick={() => copyText(lastAnswer).then(() => setMessage("Answer copied."))}>
            Copy Answer
          </button>
        </div>
      ) : null}
    </div>
  );
}
