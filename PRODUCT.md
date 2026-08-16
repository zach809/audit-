# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are **case managers** at a US personal-injury law firm (inferred from ticket CWCA-15). Ten named people open this every day to see what they still owe on their matters.

**Caroline** is the admin. She reviews everyone's compliance and corrects records by hand.

**Attorneys** glance at it. They are not power users and they are not young. The product owner asked, verbatim, to make it "lawyer friendly and boomer friendly."

## Product Purpose

CWCA (Clio Workflow Auditor) is a read-only coaching tool. It checks Clio matters against the firm's workflow rules and shows what is missing, who owns it, and what to do next. It does not write to Clio.

Success is a case manager answering three questions without hunting:

1. What is missing on my matters right now?
2. Who is responsible for it?
3. What do I do about it?

## Positioning

The mechanism a neighboring product could not copy is the firm's own audit vocabulary and assignment map: `On Time` / `Late` / `Missing` / `Not Due Yet` / `No activity`, plus the ten named case managers (including the Park City exception). Those words are a person's record. They are not UI synonyms.

## Operating Context

Used at a desk under office light, often with Clio open in another tab. Shared as links. Filters in the URL are load-bearing: `attorney`, `overall`, `from`, `to`, `tab`, `wstatus`, `wfocus`, `wstep`, `cm`, and the `closure_*` set.

A separate PR is landing "stay on the matter after a status change" and the Case Manager name on each card. This product record treats both as required for the job, not optional chrome.

## Capabilities and Constraints

Confirmed from the running app and ticket:

- Operate surface. Scanned and worked, not read.
- Presentation-only changes on this ticket. Queries and compliance outcomes stay as they are.
- Parallel dashboard queries already shipped. Do not reintroduce sequential awaits.
- Body text ≥ 16px. Contrast ≥ 4.5:1. No hover-only controls. No colour-only meaning. Tabular numerals on every number. `prefers-reduced-motion` honoured. `border-radius: 0` everywhere (house mandate).
- Subjects appear as names, not raw IDs or phone numbers.

Open / inferred: live data volume is large (~1.6 MB per load). Anything on screen that answers none of the three questions is a candidate for removal from the *view*, not from the data layer.

## Brand Commitments

- Product name: Clio Workflow Auditor / CWCA.
- Firm context in the repo: Hirsch Law Group (README). Illinois business time, America/Chicago.
- Voice: plain, specific, no filler. Controls name the action. Errors name the problem and the fix.
- House visual constraints (CWCA-19): sharp corners; Terminal Wayfinding (cool concourse wall, near-black sign panels, Source Sans 3); yellow only for Missing.

## Evidence on Hand

- Live dashboard: `src/app/page.tsx`, `src/app/globals.css`.
- Assignment map: `standardsCaseManagerFor()` in `src/lib/dashboard-data.ts` (ten names; Elanna Myers + Park City → Ronald).
- No `PRODUCT.md` or `DESIGN.md` existed before this file. No user interview was available on this unattended cloud run; facts above are from ticket CWCA-15 and the repository. Labeled inferred where the ticket is the only source.

## Product Principles

1. Show the owed work, the owner by name, and the next action on the same card.
2. Keep the five compliance words intact. Do not merge or pretty them.
3. If a control cannot be found without hovering or guessing an icon, it does not exist.
4. Shared links must come back to the same filtered view.
5. Decorate nothing that does not help someone clear a matter today.

## Accessibility & Inclusion

Required by the users, not as a checklist: body ≥ 16px, contrast ≥ 4.5:1, no colour-only status, no hover-only affordance, visible keyboard focus, reduced-motion fallback. Attorneys and case managers who are not young must be able to use this without discovering a gesture.
