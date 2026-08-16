import { WRITE_BLOCKED_MESSAGE, writesAllowed } from "./write-guard";

export const SIGN_IN_TO_WRITE_MESSAGE = "Sign in to change this matter.";

export function adminWriteRefusal(sessionOk: boolean): string | null {
  if (!writesAllowed()) return WRITE_BLOCKED_MESSAGE;
  if (!sessionOk) return SIGN_IN_TO_WRITE_MESSAGE;
  return null;
}
