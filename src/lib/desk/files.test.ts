import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FilePipe, safeName } from "./files.ts";
import { createMachine } from "./machine.ts";

describe("file pipe", () => {
  it("keeps only the file name", () => {
    assert.equal(safeName("../notes/hello.txt"), "hello.txt");
    assert.equal(safeName("   "), "file");
  });

  it("moves a file from one pipe to the other", async () => {
    const incoming = new FilePipe();
    incoming.arm();
    const sender = new FilePipe();
    const channel = {
      readyState: "open",
      bufferedAmount: 0,
      sendText(data: string) {
        incoming.ingest(data);
      },
      sendBinary(data: ArrayBuffer) {
        incoming.ingest(data);
      },
    };
    sender.open(channel);
    sender.arm();
    const payload = new Uint8Array([104, 97, 114, 98, 111, 114]);
    await sender.sendFile(new File([payload], "C:\\drop\\harbor.txt", { type: "text/plain" }));
    const got = incoming.list().find((item) => item.status === "ready");
    assert.ok(got);
    assert.equal(got?.name, "harbor.txt");
    assert.equal(got?.received, payload.byteLength);
    assert.equal(got?.direction, "in");
    assert.equal(sender.list().some((item) => item.status === "ready" && item.direction === "out"), true);
  });

  it("rejects a file over the size cap", () => {
    const pipe = new FilePipe();
    pipe.arm();
    pipe.ingest(JSON.stringify({ t: "begin", id: "abcd1234", name: "big.bin", size: 20_000_000, mime: "application/octet-stream" }));
    const item = pipe.list()[0];
    assert.equal(item?.status, "failed");
  });

  it("marks a short file incomplete", () => {
    const pipe = new FilePipe();
    pipe.arm();
    pipe.ingest(JSON.stringify({ t: "begin", id: "abcd1234", name: "note.txt", size: 4, mime: "text/plain" }));
    pipe.ingest(new Uint8Array([1, 2]).buffer);
    pipe.ingest(JSON.stringify({ t: "end", id: "abcd1234" }));
    assert.equal(pipe.list()[0]?.status, "failed");
  });
});

describe("practice machine", () => {
  it("drops a process and keeps the rest", () => {
    const machine = createMachine();
    const first = machine.tick();
    assert.equal(first.procs.length, 5);
    assert.equal(first.ramTotalMb, 2048);
    assert.equal(machine.kill(512), true);
    const next = machine.tick();
    assert.equal(next.procs.some((proc) => proc.pid === 512), false);
    assert.equal(next.procs.length, 4);
    assert.equal(machine.kill(512), false);
  });

  it("raises a CPU alert and then clears it", () => {
    const machine = createMachine();
    const lines: string[] = [];
    for (let i = 0; i < 20; i++) {
      machine.tick();
      lines.push(...machine.drain());
    }
    assert.ok(lines.some((line) => line.startsWith("CPU high")));
    assert.ok(lines.some((line) => line.startsWith("CPU settled")));
    const quiet = machine.tick();
    assert.equal(machine.drain().length, 0);
    assert.ok(quiet.alert === "CPU high" || quiet.alert === null);
  });
});
