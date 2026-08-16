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

const RADIUS = /border(?:-[\w]+)*-radius\s*:/;
const BANNED_FACE = /(?:^|[^A-Za-z])(?:Outfit|Inter|DM Sans|Space Grotesk|Plus Jakarta)(?:[^A-Za-z]|$)/;
const SIGNAL_RULE = /[^{}]*\{[^{}]*var\(--signal\)[^{}]*\}/g;

describe("terminal wayfinding visual world", () => {
  it("keeps border-radius out of dashboard CSS so the built sheet can stay at zero", () => {
    for (const file of appCssFiles()) {
      assert.equal(RADIUS.test(read(file)), false, `${file} still declares border-radius`);
    }
  });

  it("uses a Frutiger-cut face and does not load the rejected dashboard fonts", () => {
    const layout = read("app/layout.tsx");
    const css = appCssFiles().map(read).join("\n");
    assert.match(layout, /Source\+Sans\+3|Source Sans 3/);
    assert.doesNotMatch(layout, BANNED_FACE);
    assert.doesNotMatch(css, BANNED_FACE);
  });

  it("reserves signal yellow for Missing / act-here and nowhere else", () => {
    const css = appCssFiles().map(read).join("\n");
    assert.match(css, /--signal:/);
    const rules = css.match(SIGNAL_RULE) ?? [];
    assert.ok(rules.length > 0, "signal yellow is never used");
    for (const rule of rules) {
      assert.match(rule, /mark-missing|act-here/, `yellow leaked into: ${rule.slice(0, 120)}`);
    }
  });

  it("keeps tab labels visible on the wayfinding strip", () => {
    const css = appCssFiles().map(read).join("\n");
    assert.match(css, /\.dashboard-tab span\s*\{[^}]*display:\s*block/);
    assert.doesNotMatch(css, /\.dashboard-tab span\s*\{[^}]*display:\s*none/);
  });

  it("still names the five official compliance states in the badge helper", () => {
    const page = read("app/page.tsx");
    assert.match(page, /complianceMark/);
    assert.match(page, /mark-\$\{mark\.kind\}/);
    const mark = read("lib/compliance-mark.ts");
    for (const label of ["On Time", "Late", "Missing", "Not Due Yet", "No activity"]) {
      assert.match(mark, new RegExp(label.replace(" ", "\\s")));
    }
  });
});
