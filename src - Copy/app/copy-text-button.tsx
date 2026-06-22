"use client";

import { useState } from "react";

export function CopyTextButton({ targetId, label = "Copy" }: { targetId: string; label?: string }) {
  const [message, setMessage] = useState("");

  async function copyText() {
    const target = document.getElementById(targetId);
    const text =
      target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement
        ? target.value
        : target?.textContent ?? "";

    if (!text.trim()) {
      setMessage("Nothing to copy");
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setMessage("Copied");
    } catch {
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
        target.focus();
        target.select();
        document.execCommand("copy");
        setMessage("Copied");
      } else {
        setMessage("Select and copy");
      }
    }
  }

  return (
    <span className="copy-action">
      <button className="button compact" type="button" onClick={copyText}>{message || label}</button>
    </span>
  );
}
