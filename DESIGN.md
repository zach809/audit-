---
name: Clio Workflow Auditor
description: Novi cyber-industrial operate surface for a PI firm's daily owed work
colors:
  ground: "#050505"
  paper: "#0a0a0a"
  ink: "#ffffff"
  muted: "#8a8a8a"
  cyan: "#00e5ff"
  cyan-soft: "#062b31"
  cyan-wash: "#0d1416"
  cyan-hover: "#6ff0ff"
  rule: "rgba(255,255,255,0.10)"
  rule-soft: "rgba(255,255,255,0.06)"
  ok: "#00e5ff"
  ok-ink: "#7fe9f5"
  ok-wash: "#04252a"
  late: "#ffb020"
  late-ink: "#ffc75a"
  late-wash: "#2a1e04"
  missing: "#ff4d5e"
  missing-ink: "#ff8a95"
  missing-wash: "#2b0910"
  waiting: "#8a8a8a"
  waiting-ink: "#a8a8a8"
  waiting-wash: "#141414"
  idle: "#3a3a3a"
  focus: "#fd0"
  hairline: "rgba(0,229,255,0.14)"
  bracket: "rgba(0,229,255,0.40)"
typography:
  ui:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.45
  display:
    fontFamily: "Bricolage Grotesque, Inter, sans-serif"
    fontSize: "2rem"
    fontWeight: 300
    lineHeight: 1.15
  display-sm:
    fontFamily: "Bricolage Grotesque, Inter, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 300
    lineHeight: 1.15
  metric:
    fontFamily: "Bricolage Grotesque, Inter, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 200
    lineHeight: 1
  label:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.3
  label-sm:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.3
  label-xs:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "10px"
    fontWeight: 500
    lineHeight: 1.3
  row:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.3
  row-sm:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.4
  monumental:
    fontFamily: "Bricolage Grotesque, Inter, sans-serif"
    fontSize: "4rem"
    fontWeight: 200
    lineHeight: 0.98
  title-sm:
    fontFamily: "Bricolage Grotesque, Inter, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 200
    lineHeight: 0.98
rounded:
  none: "0px"
spacing:
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "28px"
components:
  button-primary:
    backgroundColor: "{colors.cyan}"
    textColor: "{colors.ground}"
    rounded: "{rounded.none}"
    padding: "10px 14px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "10px 14px"
    height: "44px"
  badge:
    backgroundColor: "{colors.ok-wash}"
    textColor: "{colors.ok-ink}"
    rounded: "{rounded.none}"
    padding: "5px 11px"
---

# Design

## Overview

CWCA is an operate docket in the Novi cyber-industrial world. Obsidian ground, cyan signal, 24px corner brackets. A case manager glances, reads the owed count, finds a named person, and takes the labelled action on the row.

Direction: Novi, brief-pinned by CWCA-22/23 from the CEO reference. Tokens live in `src/app/novi.css`. Login and the case-manager portal stay on the older GOV.UK sheet.

## Colors

The room is dark. Ground is `#050505`. Surfaces are `#0a0a0a`. Type is white. Muted type is `#8a8a8a` and never lighter than `#808080` (5.16:1 on ground). Cyan `#00e5ff` is the live signal: current tab rule, primary action, owed count. Late is amber. Missing is coral. Yellow `#fd0` is reserved for keyboard focus.

## Typography

Bricolage Grotesque at weight 200-300 on titles. Inter on prose. JetBrains Mono on labels, numbers, and status words. Every number is tabular. Body is 16px. Headings use `text-wrap: balance`.

## Layout

One contained frame. Header, tabs, and the work table share 1px rules. Lists are tables: Status, Matter, Owner, What is missing, Action. Filters stay in the URL.

## Elevation and depth

The shell sits on a faint cyan glow with 24px brackets at 40% cyan. Interactive edges use a cyan hairline. No rounded corners.

## Shapes

No `border-radius` declarations. Status is a word plus a `mark-${kind}` shape, never the printed label as a class.

## Components

Buttons are 44px tall and labelled in words. Primary is a filled cyan block with black type. People get a monogram. Work types get a Lucide icon matched on the real step label.

## Do's and Don'ts

Do show On Time, Late, Missing, Not Due Yet, and No activity as written.

Do name the case manager on every row.

Do not hide an action behind hover or a closed disclosure.

Do not use color as the only difference between states.

Do not key a status style to the visible label.
