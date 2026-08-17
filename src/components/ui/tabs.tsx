"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: TabsPrimitive.TabsListProps) {
  return <TabsPrimitive.List className={cn("today-tabs", className)} {...props} />;
}

export function TabsTrigger({ className, ...props }: TabsPrimitive.TabsTriggerProps) {
  return <TabsPrimitive.Trigger className={cn("today-tab", className)} {...props} />;
}

export function TabsContent({ className, ...props }: TabsPrimitive.TabsContentProps) {
  return <TabsPrimitive.Content className={className} {...props} />;
}
