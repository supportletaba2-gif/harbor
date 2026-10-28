import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runShell } from "./shell.ts";

describe("practice shell", () => {
  it("echoes text and rejects unknown commands", () => {
    assert.deepEqual(runShell("echo hello there"), { clear: false, lines: ["hello there"] });
    assert.deepEqual(runShell("whoami"), { clear: false, lines: ["harbor"] });
    assert.deepEqual(runShell("rm -rf"), { clear: false, lines: ["rm: not found"] });
    assert.deepEqual(runShell("clear"), { clear: true, lines: [] });
    assert.deepEqual(runShell("   "), { clear: false, lines: [] });
  });
});
