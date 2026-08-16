export const FILTER_PARAM_KEYS = [
  "attorney",
  "overall",
  "from",
  "to",
  "tab",
  "wstatus",
  "wfocus",
  "wstep",
  "cm",
  "closure_status",
  "closure_stage",
  "closure_attorney",
  "closure_window",
  "sort",
  "dir",
  "page",
] as const;

export const ARRIVAL_APPLY_KEYS = [
  "attorney",
  "overall",
  "from",
  "to",
  "wstatus",
  "wfocus",
  "wstep",
  "cm",
  "closure_status",
  "closure_stage",
  "closure_attorney",
  "closure_window",
] as const;

export const PREFS_STORAGE_KEY = "cwca-dashboard-filters";

export type FilterParamKey = (typeof FILTER_PARAM_KEYS)[number];
export type FilterPrefs = Partial<Record<FilterParamKey, string>>;

function searchParams(search: string): URLSearchParams {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  return new URLSearchParams(raw);
}

export function hasExplicitFilterParam(search: string): boolean {
  const params = searchParams(search);
  return FILTER_PARAM_KEYS.some((key) => params.has(key));
}

export function prefsFromSearch(search: string): FilterPrefs {
  const params = searchParams(search);
  const prefs: FilterPrefs = {};
  for (const key of FILTER_PARAM_KEYS) {
    const value = params.get(key);
    if (value) prefs[key] = value;
  }
  return prefs;
}

export function parseRemembered(raw: string | null): FilterPrefs | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const prefs: FilterPrefs = {};
    for (const key of FILTER_PARAM_KEYS) {
      const value = record[key];
      if (typeof value === "string" && value) prefs[key] = value;
    }
    return prefs;
  } catch {
    return null;
  }
}

export function arrivalHref(search: string, remembered: FilterPrefs | null): string | null {
  if (hasExplicitFilterParam(search)) return null;
  if (!remembered) return null;
  const next = new URLSearchParams();
  for (const key of ARRIVAL_APPLY_KEYS) {
    const value = remembered[key];
    if (value) next.set(key, value);
  }
  if ([...next.keys()].length === 0) return null;
  return `/?${next.toString()}`;
}

export function clientNameMatches(haystack: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return haystack.toLowerCase().includes(needle);
}
