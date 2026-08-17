"use client";

import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@/lib/utils";

export function Progress({
  value,
  className,
  label,
}: {
  value: number;
  className?: string;
  label: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <ProgressPrimitive.Root
      aria-label={label}
      className={cn("today-progress", className)}
      value={clamped}
    >
      <ProgressPrimitive.Indicator
        className="today-progress-fill"
        style={{ transform: `translateX(-${100 - clamped}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}
