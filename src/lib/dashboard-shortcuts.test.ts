import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isTypingTarget, jobShortcut, nextRowIndex, prevRowIndex } from "./dashboard-shortcuts";

class FakeInput {
  tagName = "INPUT";
  isContentEditable = false;
}

class FakeDiv {
  tagName = "DIV";
  isContentEditable = false;
}

class FakeEditable {
  tagName = "DIV";
  isContentEditable = true;
}

describe("dashboard job shortcuts", () => {
  it("moves, acts, clears, and finds from keys when focus is not in a field", () => {
    const host = new FakeDiv();
    assert.equal(jobShortcut("j", host), "next");
    assert.equal(jobShortcut("ArrowDown", host), "next");
    assert.equal(jobShortcut("k", host), "prev");
    assert.equal(jobShortcut("ArrowUp", host), "prev");
    assert.equal(jobShortcut("Enter", host), "act");
    assert.equal(jobShortcut("0", host), "clear");
    assert.equal(jobShortcut("/", host), "find");
    assert.equal(jobShortcut("L", host), null);
  });

  it("ignores a plain single key while focus is in a text input", () => {
    const field = new FakeInput();
    assert.equal(isTypingTarget(field), true);
    assert.equal(jobShortcut("j", field), null);
    assert.equal(jobShortcut("k", field), null);
    assert.equal(jobShortcut("0", field), null);
    assert.equal(jobShortcut("/", field), null);
    assert.equal(jobShortcut("Enter", field), null);
    assert.equal(jobShortcut("j", new FakeEditable()), null);
    assert.equal(jobShortcut("j", null), "next");
  });

  it("walks a bounded row list without wrapping off the ends", () => {
    assert.equal(nextRowIndex(-1, 3), 0);
    assert.equal(nextRowIndex(0, 3), 1);
    assert.equal(nextRowIndex(2, 3), 2);
    assert.equal(prevRowIndex(2, 3), 1);
    assert.equal(prevRowIndex(0, 3), 0);
    assert.equal(nextRowIndex(0, 0), -1);
  });
});
