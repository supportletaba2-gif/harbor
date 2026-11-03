import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aimNote, letterboxNorm, pointerBody, screenPoint } from "./windows-pointer.ts";

describe("windows pointer", () => {
  it("maps a normalized point onto a screen", () => {
    assert.deepEqual(screenPoint(0, 0, 1920, 1080), { x: 0, y: 0 });
    assert.deepEqual(screenPoint(1, 1, 1920, 1080), { x: 1919, y: 1079 });
    assert.deepEqual(screenPoint(-1, 2, 100, 50), { x: 0, y: 49 });
  });

  it("sends a click and ignores a key release", () => {
    const body = pointerBody({ kind: "down", x: 0.5, y: 0.25 });
    assert.equal(body, JSON.stringify({ action: "down", x: 0.5, y: 0.25, button: "left" }));
    assert.equal(pointerBody({ kind: "key", key: "a", down: false }), null);
    assert.equal(pointerBody({ kind: "key", key: "Enter", down: true }), JSON.stringify({ action: "key", key: "Enter" }));
  });

  it("names the pointer mode", () => {
    assert.equal(aimNote("windows"), "Windows pointer on");
    assert.equal(aimNote("desk"), "Pointer back on the desk");
  });

  it("maps a click through letterboxing, including a reloading frame", () => {
    const wide = letterboxNorm({ left: 0, top: 0, width: 1600, height: 900 }, 16, 9, 800, 450);
    assert.ok(Math.abs(wide.x - 0.5) < 0.001);
    assert.ok(Math.abs(wide.y - 0.5) < 0.001);
    const bars = letterboxNorm({ left: 0, top: 0, width: 1600, height: 400 }, 16, 9, 10, 200);
    assert.ok(bars.x < 0);
    const remembered = letterboxNorm({ left: 0, top: 0, width: 1280, height: 720 }, 0, 0, 640, 360);
    assert.ok(Math.abs(remembered.x - 0.5) < 0.001);
    assert.ok(Math.abs(remembered.y - 0.5) < 0.001);
  });
});
