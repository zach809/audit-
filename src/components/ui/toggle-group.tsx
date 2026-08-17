"use client";

import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cn } from "@/lib/utils";

export const ToggleGroup = ToggleGroupPrimitive.Root;

export function ToggleGroupItem({ className, ...props }: ToggleGroupPrimitive.ToggleGroupItemProps) {
  return <ToggleGroupPrimitive.Item className={cn("today-toggle", className)} {...props} />;
}
