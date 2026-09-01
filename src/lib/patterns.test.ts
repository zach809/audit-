import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isDocumentedCallAttempt, isWeeklyClientCheckIn } from "./patterns";

describe("weekly client check-in title matching", () => {
  const accepted = [
    "Weekly Client Follow-Up Call - Jordan Reyes",
    "Weekly client checkin | Jordan Reyes",
    "Client Check-In Call - Jordan Reyes",
    "Phone check in - Jordan Reyes",
    "Weekly Touchbase - Jordan Reyes",
    "Case Status Call - Jordan Reyes",
    "Client Care Call - Jordan Reyes",
    "Courtesy Check-In - Jordan Reyes",
    "Follow up with client - Jordan Reyes",
    "Llamada semanal al cliente - Jordan Reyes",
    "Seguimiento semanal con cliente - Jordan Reyes",
    "Llamada de cortesia - Jordan Reyes",
    "Llamada de actualizacion - Jordan Reyes",
    "Actualizacion del caso - Jordan Reyes",
    "Chequeo semanal - Jordan Reyes",
  ];

  for (const title of accepted) {
    it(`accepts ${title}`, () => {
      assert.equal(isWeeklyClientCheckIn(title), true);
    });
  }

  it("does not mistake a regular court hearing for a weekly check-in", () => {
    assert.equal(isWeeklyClientCheckIn("DuPage Court Hearing - Jordan Reyes"), false);
  });
});

describe("documented call-attempt matching", () => {
  it("recognizes English and Spanish call-attempt notes", () => {
    assert.equal(isDocumentedCallAttempt("Attempted to call; no answer; left voicemail"), true);
    assert.equal(isDocumentedCallAttempt("Se intento llamar; no contesto; deje mensaje"), true);
  });

  it("does not treat an inbound call or SMS as a firm call attempt", () => {
    assert.equal(isDocumentedCallAttempt("Missed inbound call - no answer"), false);
    assert.equal(isDocumentedCallAttempt("Outbound SMS: no answer yet"), false);
  });
});
