---
name: Clio Workflow Auditor
description: Terminal wayfinding operate surface for a PI firm's daily owed work
colors:
  ground: "oklch(0.97 0.01 250)"
  ink: "oklch(0.2 0.014 250)"
  panel: "oklch(0.17 0.012 250)"
  panel-type: "oklch(0.99 0.004 250)"
  muted-ground: "oklch(0.38 0.02 250)"
  muted-panel: "oklch(0.84 0.012 250)"
  signal: "oklch(0.88 0.195 102)"
  coral: "oklch(0.7 0.12 35)"
  rule: "oklch(0.82 0.012 250)"
  field: "oklch(0.99 0.004 250)"
  field-disabled: "oklch(0.9 0.01 250)"
  panel-rule: "oklch(0.3 0.01 250)"
typography:
  ui:
    fontFamily: "Source Sans 3, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.45
  display:
    fontFamily: "Source Sans 3, Segoe UI, sans-serif"
    fontSize: "2rem"
    fontWeight: 800
    lineHeight: 1.15
  display-sm:
    fontFamily: "Source Sans 3, Segoe UI, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 800
    lineHeight: 1.15
  metric:
    fontFamily: "Source Sans 3, Segoe UI, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 800
    lineHeight: 1
  metric-sm:
    fontFamily: "Source Sans 3, Segoe UI, sans-serif"
    fontSize: "2rem"
    fontWeight: 800
    lineHeight: 1
  monumental:
    fontFamily: "Source Sans 3, Segoe UI, sans-serif"
    fontSize: "4.5rem"
    fontWeight: 800
    lineHeight: 0.9
  monumental-sm:
    fontFamily: "Source Sans 3, Segoe UI, sans-serif"
    fontSize: "3.25rem"
    fontWeight: 800
    lineHeight: 0.9
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
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "10px 14px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "10px 14px"
    height: "44px"
  badge:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.panel-type}"
    rounded: "{rounded.none}"
    padding: "4px 0"
  matter-card:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.panel-type}"
    rounded: "{rounded.none}"
    padding: "16px"
---

# Design

## Overview

CWCA is an operate docket read as an airport sign. The page is a concourse wall with near-black destination panels. A case manager glances, reads the owed count, finds a named person, and takes the labelled action on the row's trailing edge.

Direction: Terminal Wayfinding, brief-pinned by CWCA-19. Seed `cwca19-terminal`. Yellow is reserved for Missing, the only state that means a person must act now.

## Colors

The room is light. Ground is a cool concourse wall. Panels are near-black. Type on panels is white. Type on ground is near-black. Signal yellow is attention only. Coral is for errors, never for status.

## Typography

Source Sans 3 is the Frutiger-cut workhorse. One family for UI, names, and numbers. Every number is tabular. Body is 16px. Headings use `text-wrap: balance`. No tiny uppercase labels.

## Layout

First viewport: a full-width header sign with the owed-work title and a monumental tabular count, then a strip of destination tabs, then dark rows. Each row is client name, owner, official status mark, and a labelled action locked to the trailing edge. Filters stay in the URL. Content uses the available width.

## Elevation & Depth

No glass, no drop shadow, no hover lift. Separation is the panel sitting on the wall. The current tab is the same dark sign with an inverted pictogram and a white baseline.

## Shapes

No `border-radius` declarations. Status marks are shapes, not pills:

- On Time: filled square
- Late: diamond
- Missing: triangle, the only yellow mark
- Not Due Yet: empty square
- No activity: dashed empty square

## Components

Buttons are 44px tall, labelled in words, and look like controls at rest. Matter cards keep an `#matter-{id}` anchor so a status save returns to the same card.

## Do's and Don'ts

Do show On Time, Late, Missing, Not Due Yet, and No activity as written.

Do name the case manager on every row.

Do not hide an action behind hover or a closed disclosure.

Do not use color as the only difference between states.

Do not use yellow for headers, branding, or the current tab.
