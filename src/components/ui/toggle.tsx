"use client";

import * as TogglePrimitive from "@radix-ui/react-toggle";
import { cn } from "@/lib/utils";

export function Toggle({ className, ...props }: TogglePrimitive.ToggleProps) {
  return <TogglePrimitive.Root className={cn("today-toggle", className)} {...props} />;
}
