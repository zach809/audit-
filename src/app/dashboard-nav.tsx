"use client";

import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export type DashboardNavTab = {
  id: string;
  label: string;
  description: string;
  href: string;
};

const TabLink = forwardRef<HTMLAnchorElement, { tab: DashboardNavTab; active: boolean } & ComponentPropsWithoutRef<"a">>(
  ({ tab, active, ...props }, ref) => (
    <a aria-current={active ? "page" : undefined} className="today-tab-link" href={tab.href} ref={ref} {...props}>
      {tab.label}
    </a>
  ),
);
TabLink.displayName = "TabLink";

export function DashboardNav({
  activeTab,
  dailyTabs,
  recordsTabs,
  toolsTabs,
  reviewHref,
}: {
  activeTab: string;
  dailyTabs: DashboardNavTab[];
  recordsTabs: DashboardNavTab[];
  toolsTabs: DashboardNavTab[];
  reviewHref: string;
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tabs value={activeTab}>
        <TabsList aria-label="Dashboard sections">
          {dailyTabs.map((tab) => (
            <Tooltip key={tab.id}>
              <TooltipTrigger asChild>
                <TabsTrigger asChild value={tab.id}>
                  <TabLink active={activeTab === tab.id} tab={tab} />
                </TabsTrigger>
              </TooltipTrigger>
              <TooltipContent>{tab.description}</TooltipContent>
            </Tooltip>
          ))}
          <Popover>
            <PopoverTrigger className="today-pop-trigger">Records</PopoverTrigger>
            <PopoverContent>
              {recordsTabs.map((tab) => (
                <a aria-current={activeTab === tab.id ? "page" : undefined} href={tab.href} key={tab.id}>
                  {tab.label}
                </a>
              ))}
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger className="today-pop-trigger">Tools</PopoverTrigger>
            <PopoverContent>
              {toolsTabs.map((tab) => (
                <a aria-current={activeTab === tab.id ? "page" : undefined} href={tab.href} key={tab.id}>
                  {tab.label}
                </a>
              ))}
              <a href={reviewHref} rel="noreferrer" target="_blank">
                Review Site
              </a>
            </PopoverContent>
          </Popover>
        </TabsList>
      </Tabs>
    </TooltipProvider>
  );
}
