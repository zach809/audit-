"use client";

import { useRef, useState } from "react";
import { updateMatterExclusion } from "./matter-actions";

type MatterExclusionControlProps = {
  matterId: string;
  excluded: boolean;
  requestedBy?: string | null;
  reason?: string | null;
  excludeLabel: string;
  restoreLabel: string;
  buttonClassName?: string;
  showBadges?: boolean;
};

export function MatterExclusionControl({
  matterId,
  excluded,
  requestedBy,
  reason,
  excludeLabel,
  restoreLabel,
  buttonClassName = "metric-exclusion-button",
  showBadges = false,
}: MatterExclusionControlProps) {
  const [isExcluded, setIsExcluded] = useState(excluded);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [writes, setWrites] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);

  async function onSubmit() {
    if (pending) return;
    const previous = isExcluded;
    setPending(true);
    setError("");
    const result = await updateMatterExclusion({
      action: previous ? "restore" : "exclude",
      matterId,
      reason: reason || "Admin removed this matter from Standards scoring.",
      requestedBy: requestedBy || "",
    });
    setPending(false);
    setWrites((count) => count + 1);
    if (!result.ok) {
      setIsExcluded(previous);
      setError(result.error);
      buttonRef.current?.focus({ preventScroll: true });
      return;
    }
    setIsExcluded(result.excluded);
    buttonRef.current?.focus({ preventScroll: true });
  }

  return (
    <div className="row-write" data-pending={pending ? "true" : "false"} data-row-writes={String(writes)}>
      {showBadges ? (
        <>
          {isExcluded ? <span className="badge Pending">Excluded from Standards</span> : null}
          {!isExcluded && requestedBy ? <span className="badge Late">CM requested exclusion</span> : null}
        </>
      ) : null}
      <button
        ref={buttonRef}
        className={buttonClassName}
        type="button"
        aria-busy={pending}
        onClick={() => {
          void onSubmit();
        }}
      >
        {pending ? "Saving…" : isExcluded ? restoreLabel : excludeLabel}
      </button>
      {error ? <p className="row-write-error" role="alert">{error}</p> : null}
    </div>
  );
}
