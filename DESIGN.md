---
name: Clio Workflow Auditor
description: Exhibit-docket operate surface for a PI firm's daily owed work
colors:
  paper: "oklch(0.96 0.012 250)"
  paper-strong: "oklch(0.99 0.006 250)"
  ink: "oklch(0.22 0.03 250)"
  muted-ink: "oklch(0.36 0.025 250)"
  rule: "oklch(0.78 0.02 250)"
  mark-late: "oklch(0.42 0.14 35)"
  mark-ok: "oklch(0.36 0.1 150)"
  flag: "oklch(0.93 0.03 85)"
typography:
  ui:
    fontFamily: "Outfit, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.45
  display:
    fontFamily: "Outfit, Segoe UI, sans-serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1.15
  number:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.2
rounded:
  none: "0px"
spacing:
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.none}"
    padding: "10px 14px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.paper-strong}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "10px 14px"
    height: "44px"
  badge:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "4px 10px"
  matter-card:
    backgroundColor: "{colors.paper-strong}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "16px"
---

# Design

## Overview

CWCA is an operate docket, not a SaaS command center. The page is a court exhibit sticker on a case file: official compliance words, a named owner, and a next action. The visual world is bond paper under office light, navy ink, and a mark that still reads when the color is gone.

Direction: grounded list #5, exhibit sticker system, seed `43686ca8`. Raises kept from the roll: visible ruled cells, one token seed, invert-not-tint for the current tab, a flag for the next action, and a named owner on every mark.

## Colors

Paper is a cool courthouse fluorescent, not cream. Ink is navy. Late is coral. On Time is forest. Those hues support the marks; they do not replace them. Body and muted ink both sit above 4.5:1 on paper.

## Typography

Outfit carries the UI and the client names. JetBrains Mono is for counts and dates, always tabular. Body is 16px. Headings use `text-wrap: balance`. No tiny uppercase labels.

## Layout

First viewport: the owed-work title, visible tabs, a ruled strip of counts, then matter cards. Each card is client name, attorney, case manager, official status mark, and a "Do this next" flag when work is owed. Filters stay in the URL.

## Elevation & Depth

No glass, no drop shadow, no hover lift. Separation is a 1px ink rule. The next-action flag is a manila field with a 2px ink edge.

## Shapes

`border-radius: 0` on every surface. Status marks are shapes, not pills:

- On Time: filled square
- Late: diamond
- Missing: triangle
- Not Due Yet: empty square
- No activity: dashed empty square

## Components

Buttons are 44px tall, labeled in words, and look like controls at rest. The current tab inverts to ink-on-paper. Matter cards keep an `#matter-{id}` anchor so a status save returns to the same card.

## Do's and Don'ts

Do show On Time, Late, Missing, Not Due Yet, and No activity as written.

Do name the case manager on every row.

Do not hide an action behind hover or a closed disclosure.

Do not use color as the only difference between states.

Do not add rounded cards, gradient text, or metric-hero decoration.
