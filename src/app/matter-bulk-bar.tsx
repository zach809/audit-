"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type BulkMatter = { id: string; name: string; excluded: boolean };

type BulkContextValue = {
  selected: Set<string>;
  toggle: (id: string) => void;
};

const BulkContext = createContext<BulkContextValue>({
  selected: new Set(),
  toggle: () => undefined,
});

function postExisting(path: string, fields: Record<string, string>) {
  const body = new URLSearchParams(fields);
  return fetch(path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

export function MatterSelect({ matterId, name }: { matterId: string; name: string }) {
  const { selected, toggle } = useContext(BulkContext);
  return (
    <label className="matter-select">
      <input type="checkbox" checked={selected.has(matterId)} onChange={() => toggle(matterId)} />
      <span className="sr-only">Select {name}</span>
    </label>
  );
}

export function MatterBulkBar({
  matters,
  filters,
  children,
}: {
  matters: BulkMatter[];
  filters: Record<string, string>;
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const value = useMemo<BulkContextValue>(() => ({
    selected,
    toggle: (id) => {
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
  }), [selected]);

  async function runBulk(kind: "recheck" | "exclude" | "restore") {
    const ids = matters
      .filter((matter) => selected.has(matter.id))
      .filter((matter) => kind === "recheck" || (kind === "exclude" ? !matter.excluded : matter.excluded))
      .map((matter) => matter.id);
    if (!ids.length) {
      setMessage("Select at least one matter.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      for (const matterId of ids) {
        const path = kind === "recheck" ? "/api/audit/run" : "/api/metrics/exclusion";
        const fields = kind === "recheck"
          ? { matter_id: matterId, ...filters }
          : { action: kind, matter_id: matterId, reason: "Admin bulk Standards update.", ...filters };
        const response = await postExisting(path, fields);
        if (response.status === 403) {
          const body = await response.json().catch(() => ({}));
          throw new Error(typeof body.error === "string" ? body.error : "Write blocked.");
        }
        if (!response.ok && response.status !== 303) {
          throw new Error(`Could not update ${matterId}.`);
        }
      }
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Bulk update failed.");
      setBusy(false);
    }
  }

  return (
    <BulkContext.Provider value={value}>
      <div className="inline-action-group matter-bulk-bar">
        <span className="muted small">{selected.size} selected</span>
        <button className="button compact" type="button" disabled={busy} onClick={() => runBulk("recheck")}>Recheck selected</button>
        <button className="button compact" type="button" disabled={busy} onClick={() => runBulk("exclude")}>Remove selected from Standards</button>
        <button className="button compact" type="button" disabled={busy} onClick={() => runBulk("restore")}>Restore selected to Standards</button>
        {message ? <span className="filter-alert">{message}</span> : null}
      </div>
      {children}
    </BulkContext.Provider>
  );
}
