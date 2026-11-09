import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rememberFrame, takeLive, waitLive } from "./frame-hub.ts";

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30]);

describe("frame hub", () => {
  it("keeps only the newest picture and wakes a waiter", async () => {
    const room = `room-${Date.now()}`;
    assert.equal(rememberFrame(room, 1, jpeg, "viewer"), true);
    assert.equal(rememberFrame(room, 1, jpeg, "viewer"), false);
    assert.equal(takeLive(room, "other", 0), null);
    const first = takeLive(room, "viewer", 0);
    assert.equal(first?.seq, 1);
    const pending = waitLive(room, "viewer", 1, new AbortController().signal, 500);
    rememberFrame(room, 2, jpeg, "viewer");
    const next = await pending;
    assert.equal(next?.seq, 2);
  });
});
