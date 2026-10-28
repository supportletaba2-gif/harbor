import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pagePoint } from "./page-agent.ts";

describe("page agent", () => {
  it("maps a normalized pointer into the viewport", () => {
    assert.deepEqual(pagePoint(0, 0, 800, 600), { x: 0, y: 0 });
    assert.deepEqual(pagePoint(0.5, 1, 800, 600), { x: 400, y: 600 });
    assert.deepEqual(pagePoint(2, -1, 100, 100), { x: 100, y: 0 });
  });
});
