"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  PREFS_STORAGE_KEY,
  arrivalHref,
  clientNameMatches,
  parseRemembered,
  prefsFromSearch,
} from "@/lib/dashboard-prefs";
import { jobShortcut, nextRowIndex, prevRowIndex } from "@/lib/dashboard-shortcuts";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type DashboardJobChromeProps = {
  caseManagers: readonly string[];
  currentCm: string;
  firmCount: number;
  shownCount: number;
  cmHrefs: Record<string, string>;
  wholeFirmHref: string;
  clearHref: string;
  skin?: "legacy" | "today";
};

function jobRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-job-row]")).filter(
    (row) => row.offsetParent !== null,
  );
}

function persistSearch() {
  window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefsFromSearch(window.location.search)));
}

export function DashboardJobChrome({
  caseManagers,
  currentCm,
  firmCount,
  shownCount,
  cmHrefs,
  wholeFirmHref,
  clearHref,
  skin = "legacy",
}: DashboardJobChromeProps) {
  const findRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [focusIndex, setFocusIndex] = useState(-1);

  useLayoutEffect(() => {
    const remembered = parseRemembered(window.localStorage.getItem(PREFS_STORAGE_KEY));
    const href = arrivalHref(window.location.search, remembered);
    if (href && href !== `${window.location.pathname}${window.location.search}`) {
      window.location.replace(href);
      return;
    }
    persistSearch();
  }, []);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest("[data-clear-filters]")) return;
      window.localStorage.setItem(PREFS_STORAGE_KEY, "{}");
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    for (const row of Array.from(document.querySelectorAll<HTMLElement>("[data-job-row]"))) {
      const name = row.dataset.clientName ?? "";
      row.hidden = !clientNameMatches(name, query);
    }
  }, [query]);

  useEffect(() => {
    const rows = jobRows();
    rows.forEach((row, index) => {
      row.classList.toggle("job-row-focus", index === focusIndex);
    });
    if (focusIndex >= 0) rows[focusIndex]?.scrollIntoView({ block: "nearest" });
  }, [focusIndex, query]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const action = jobShortcut(event.key, event.target);
      if (!action) return;
      if (action === "find") {
        event.preventDefault();
        findRef.current?.focus();
        return;
      }
      if (action === "clear") {
        event.preventDefault();
        window.localStorage.setItem(PREFS_STORAGE_KEY, "{}");
        window.location.assign(clearHref);
        return;
      }
      const rows = jobRows();
      if (action === "next") {
        event.preventDefault();
        setFocusIndex((current) => nextRowIndex(current, rows.length));
        return;
      }
      if (action === "prev") {
        event.preventDefault();
        setFocusIndex((current) => prevRowIndex(current, rows.length));
        return;
      }
      if (action === "act") {
        const row = rows[focusIndex] ?? rows[0];
        const link = row?.querySelector<HTMLAnchorElement>("[data-job-primary]");
        if (!link) return;
        event.preventDefault();
        link.click();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearHref, focusIndex]);

  const filtered = Boolean(currentCm);
  const findActive = query.trim().length > 0;

  const banner = filtered ? (
    <p className={skin === "today" ? "today-banner" : "job-filter-banner"} role="status">
      Showing <strong>{currentCm}</strong> only. {shownCount} items need work, of {firmCount} for the whole firm.
      <a href={wholeFirmHref}>Show the whole firm</a>
    </p>
  ) : (
    <p className={skin === "today" ? "today-note" : "job-firm-note"}>
      Whole firm. {firmCount} items need work. Pick your name to keep that list next time.
    </p>
  );
  const findBanner = findActive ? (
    <p className={skin === "today" ? "today-banner" : "job-filter-banner"} role="status">
      Showing clients matching <strong>{query.trim()}</strong>. Hidden rows are still in the firm list.
    </p>
  ) : null;

  if (skin === "today") {
    return (
      <section aria-label="Your work" className="today-chrome">
        <ToggleGroup className="today-cm" type="single" value={currentCm || "firm"}>
          <ToggleGroupItem asChild value="firm">
            <a href={wholeFirmHref}>Whole firm</a>
          </ToggleGroupItem>
          {caseManagers.map((name) => (
            <ToggleGroupItem asChild key={name} value={name}>
              <a href={cmHrefs[name]}>{name}</a>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="today-find">
          <label>
            Find a client
            <Input
              autoComplete="off"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Type a client name"
              ref={findRef}
              type="search"
              value={query}
            />
          </label>
          <p className="today-keys">
            <kbd>j</kbd> <kbd>k</kbd> move
            <span aria-hidden="true"> · </span>
            <kbd>Enter</kbd> open the Clio tab
            <span aria-hidden="true"> · </span>
            <kbd>/</kbd> find
            <span aria-hidden="true"> · </span>
            <kbd>0</kbd> clear filters
          </p>
        </div>
        {banner}
        {findBanner}
      </section>
    );
  }

  return (
    <section className="job-chrome" aria-label="Your work">
      <div className="job-cm-row">
        <a className={currentCm ? "button compact" : "button compact primary"} href={wholeFirmHref}>
          Whole firm
        </a>
        {caseManagers.map((name) => (
          <a
            className={currentCm === name ? "button compact primary" : "button compact"}
            href={cmHrefs[name]}
            key={name}
          >
            {name}
          </a>
        ))}
      </div>
      <div className="job-find-row">
        <label>
          Find a client
          <input
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Type a client name"
            ref={findRef}
            type="search"
            value={query}
          />
        </label>
        <p className="job-keys">
          <kbd>j</kbd> <kbd>k</kbd> move
          <span aria-hidden="true"> · </span>
          <kbd>Enter</kbd> open the Clio tab
          <span aria-hidden="true"> · </span>
          <kbd>/</kbd> find
          <span aria-hidden="true"> · </span>
          <kbd>0</kbd> clear filters
        </p>
      </div>
      {banner}
      {findBanner}
    </section>
  );
}
