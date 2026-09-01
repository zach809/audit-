import { STANDARD_CASE_MANAGERS } from "./dashboard-data";

export type CaseManagerPortalIdentity = {
  isAdmin: boolean;
  owner: string;
};

export function normalizeCaseManagerIdentity(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function canonicalCaseManagerIdentity(value: string | null | undefined): string {
  const normalized = normalizeCaseManagerIdentity(value);
  return STANDARD_CASE_MANAGERS.find((name) => normalizeCaseManagerIdentity(name) === normalized) ?? "";
}

export function caseManagerPortalIdentity(login: string): CaseManagerPortalIdentity {
  const local = normalizeCaseManagerIdentity(login.includes("@") ? login.split("@")[0] : login);
  if (local === "zach" || local === "admin") {
    return { isAdmin: true, owner: STANDARD_CASE_MANAGERS[0] };
  }

  return {
    isAdmin: false,
    owner: canonicalCaseManagerIdentity(local),
  };
}

export function caseManagerPortalOwner(login: string, requestedOwner?: string | null): string {
  const identity = caseManagerPortalIdentity(login);
  if (!identity.isAdmin) return identity.owner;
  return canonicalCaseManagerIdentity(requestedOwner) || identity.owner;
}
