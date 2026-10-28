import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { auditText } from "./audit.ts";

describe("session log", () => {
  it("stamps a short line and drops blanks", () => {
    const now = new Date(2026, 9, 28, 8, 5);
    assert.equal(auditText("  Viewer   connected ", now), "08:05 Viewer connected");
    assert.equal(auditText("   ", now), "");
    assert.equal(auditText("x".repeat(200), now).length, 6 + 80);
  });
});
