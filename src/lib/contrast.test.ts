import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contrastRatio } from "./contrast";

describe("WCAG contrast checker", () => {
  it("fails a known-bad pair so the formula is not a rubber stamp", () => {
    const ratio = contrastRatio("#777777", "#666666");
    assert.ok(ratio < 4.5, `expected a fail, got ${ratio}`);
  });

  it("passes every Novi text pair at 4.5:1 or better", () => {
    const pairs: Array<[string, string, string]> = [
      ["white on ground", "#ffffff", "#050505"],
      ["white on paper", "#ffffff", "#0a0a0a"],
      ["muted on ground", "#8a8a8a", "#050505"],
      ["muted on paper", "#8a8a8a", "#0a0a0a"],
      ["cyan on ground", "#00e5ff", "#050505"],
      ["black on cyan", "#050505", "#00e5ff"],
      ["ok ink on ok wash", "#7fe9f5", "#04252a"],
      ["late ink on late wash", "#ffc75a", "#2a1e04"],
      ["missing ink on missing wash", "#ff8a95", "#2b0910"],
      ["waiting ink on waiting wash", "#a8a8a8", "#141414"],
    ];
    for (const [name, fg, bg] of pairs) {
      const ratio = contrastRatio(fg, bg);
      assert.ok(ratio >= 4.5, `${name} is ${ratio.toFixed(2)}:1`);
    }
  });
});
