"use client";

import { useEffect } from "react";

export function RestoreMatterFocus() {
  useEffect(() => {
    const id = window.location.hash.replace(/^#/, "");
    if (!id.startsWith("matter-")) return;
    const el = document.getElementById(id);
    if (!(el instanceof HTMLElement)) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "auto" });
    el.tabIndex = -1;
    el.focus({ preventScroll: true });
  }, []);
  return null;
}
