import type { HTMLAttributes } from "react";
import type { ComplianceKind } from "@/lib/compliance-mark";
import { cn } from "@/lib/utils";

export function Badge({
  kind,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { kind: ComplianceKind }) {
  return (
    <span className={cn("today-badge", `mark-${kind}`, className)} {...props}>
      <span className="today-mark" aria-hidden="true" />
      {children}
    </span>
  );
}
