const MATTER_ID = /^[A-Za-z0-9_-]+$/;

export function matterFocusId(matterId: string | null | undefined): string | null {
  const id = String(matterId ?? "").trim();
  if (!MATTER_ID.test(id)) return null;
  return `matter-${id}`;
}

export function dashboardReturnUrl(params: Record<string, string>, matterId?: string | null): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  const focus = matterFocusId(matterId);
  return `${query ? `/?${query}` : "/"}${focus ? `#${focus}` : ""}`;
}
