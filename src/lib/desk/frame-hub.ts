/** Latest picture for one desk, held in this server process. */

export type LiveFrame = { seq: number; jpeg: Buffer; viewer: string };

type Slot = LiveFrame & { at: number; waiters: Array<() => void> };

const live = new Map<string, Slot>();

function sweep(now: number) {
  if (live.size < 24) return;
  for (const [room, slot] of live) {
    if (now - slot.at > 30_000) live.delete(room);
  }
}

/** Keep the newest frame and wake anyone already waiting for it. */
export function rememberFrame(room: string, seq: number, jpeg: Buffer, viewer: string): boolean {
  const now = Date.now();
  sweep(now);
  const prev = live.get(room);
  if (prev && seq <= prev.seq) return false;
  const waiters = prev ? prev.waiters.splice(0) : [];
  live.set(room, { seq, jpeg, viewer, at: now, waiters: [] });
  for (const wake of waiters) wake();
  return true;
}

export function takeLive(room: string, viewer: string, since: number): LiveFrame | null {
  const slot = live.get(room);
  if (!slot || slot.viewer !== viewer || slot.seq <= since) return null;
  if (Date.now() - slot.at > 12_000) return null;
  if (slot.jpeg.length < 32) return null;
  return { seq: slot.seq, jpeg: slot.jpeg, viewer: slot.viewer };
}

/** Resolves when a newer frame is published, or after `ms` with whatever is waiting. */
export function waitLive(
  room: string,
  viewer: string,
  since: number,
  signal: AbortSignal,
  ms: number,
): Promise<LiveFrame | null> {
  const ready = takeLive(room, viewer, since);
  if (ready) return Promise.resolve(ready);
  const slot = live.get(room) ?? { seq: 0, jpeg: Buffer.alloc(0), viewer: "", at: 0, waiters: [] };
  if (!live.has(room)) live.set(room, slot);
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: LiveFrame | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      const idx = slot.waiters.indexOf(wake);
      if (idx >= 0) slot.waiters.splice(idx, 1);
      resolve(value);
    };
    const wake = () => {
      const next = takeLive(room, viewer, since);
      if (next) finish(next);
    };
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish(takeLive(room, viewer, since)), ms);
    if (signal.aborted) {
      finish(null);
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    slot.waiters.push(wake);
  });
}
