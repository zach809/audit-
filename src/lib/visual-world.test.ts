import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

function appCssFiles() {
  return readdirSync(join(root, "app"))
    .filter((name) => name.endsWith(".css"))
    .map((name) => `app/${name}`);
}

// A declaration of `border-radius: 0` is the ENFORCEMENT, not a violation.
// Only a non-zero radius breaks the house mandate. Capture the value and judge
// it in code -- a negative lookahead here silently passes on "  0" because the
// whitespace matcher can consume nothing and the lookahead then sees a space.
const RADIUS_DECL = /border(?:-[\w]+)*-radius\s*:\s*([^;}]+)/g;
const isRounded = (value: string) => !/^0(?:[a-z%]*)?(?:\s+0(?:[a-z%]*)?)*$/i.test(value.trim());
const BANNED_FACE = /(?:^|[^A-Za-z])(?:Outfit|DM Sans|Space Grotesk|Plus Jakarta)(?:[^A-Za-z]|$)/;
const SIGNAL_RULE = /[^{}]*\{[^{}]*var\(--signal\)[^{}]*\}/g;

describe("terminal wayfinding visual world", () => {
  it("keeps border-radius out of dashboard CSS so the built sheet can stay at zero", () => {
    for (const file of appCssFiles()) {
      for (const [, value] of read(file).matchAll(RADIUS_DECL)) {
        assert.equal(isRounded(value), false, `${file} declares a non-zero radius: ${value.trim()}`);
      }
    }
  });

  it("loads the Novi faces and does not load the rejected dashboard fonts", () => {
    const layout = read("app/layout.tsx");
    const css = appCssFiles().map(read).join("\n");
    assert.match(layout, /Bricolage(\+| )Grotesque/);
    assert.match(layout, /JetBrains(\+| )Mono/);
    assert.doesNotMatch(layout, BANNED_FACE);
    assert.doesNotMatch(css, BANNED_FACE);
  });

  it("reserves yellow for the focus state and nowhere else", () => {
    // GOV.UK gives yellow exactly one job: the focus indicator. It is the loudest
    // colour on the page, so a second use would make focus stop meaning anything.
    const css = appCssFiles().map(read).join("\n");
    assert.match(css, /--focus:\s*#fd0/i, "the focus colour is not declared");
    const yellowRules = css.match(/[^{}]*\{[^{}]*var\(--focus\)[^{}]*\}/g) ?? [];
    assert.ok(yellowRules.length > 0, "the focus colour is declared but never used");
    for (const rule of yellowRules) {
      assert.match(rule, /:focus/, `yellow leaked outside the focus state: ${rule.slice(0, 120)}`);
    }
  });

  it("never hides a navigation label", () => {
    // The failed redesign shipped tabs whose labels were invisible. Assert the
    // guarantee (nothing hidden) rather than one implementation of showing them.
    const css = appCssFiles().map(read).join("\n");
    const tabRules = css.match(/\.dashboard-tab[^{}]*\{[^{}]*\}/g) ?? [];
    assert.ok(tabRules.length > 0, "the navigation is unstyled");
    for (const rule of tabRules) {
      assert.doesNotMatch(rule, /display:\s*none/, `a nav rule hides content: ${rule.slice(0, 120)}`);
      assert.doesNotMatch(rule, /visibility:\s*hidden/, `a nav rule hides content: ${rule.slice(0, 120)}`);
      assert.doesNotMatch(rule, /font-size:\s*0/, `a nav rule zeroes the label: ${rule.slice(0, 120)}`);
    }
  });

  it("still names the five official compliance states in the badge helper", () => {
    const page = `${read("app/page.tsx")}\n${read("app/today-tab.tsx")}`;
    assert.match(page, /complianceMark/);
    assert.match(page, /mark-\$\{mark\.kind\}/);
    const mark = read("lib/compliance-mark.ts");
    for (const label of ["On Time", "Late", "Missing", "Not Due Yet", "No activity"]) {
      assert.match(mark, new RegExp(label.replace(" ", "\\s")));
    }
  });
});
