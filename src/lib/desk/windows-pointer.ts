import type { Aim, DeskInput } from "./types";

/** The Harbor tray listens here. Only the Windows PC running the tray can answer. */
export const WINDOWS_POINTER_URL = "http://127.0.0.1:47391/cursor";
export const WINDOWS_POINTER_HEALTH = "http://127.0.0.1:47391/health";

export type PointerArm = "ready" | "down" | "blocked";

export function aimNote(kind: Aim): string {
  if (kind === "page") return "Page mouse on";
  if (kind === "windows") return "Windows pointer on";
  return "Pointer back on the desk";
}

/** Same mapping the tray uses: a 0–1 point onto a screen of the given size. */
export function screenPoint(x: number, y: number, width: number, height: number) {
  const nx = Math.min(1, Math.max(0, x));
  const ny = Math.min(1, Math.max(0, y));
  return {
    x: Math.round(nx * Math.max(0, width - 1)),
    y: Math.round(ny * Math.max(0, height - 1)),
  };
}

/**
 * Map a click onto the picture inside an object-contain box.
 * frameW/frameH may be the last known size when a JPEG is mid-reload.
 */
export function letterboxNorm(
  rect: { left: number; top: number; width: number; height: number },
  frameW: number,
  frameH: number,
  clientX: number,
  clientY: number,
) {
  const safeW = frameW > 0 ? frameW : 16;
  const safeH = frameH > 0 ? frameH : 9;
  const elementRatio = rect.width / Math.max(1, rect.height);
  const frameRatio = safeW / safeH;
  let width = rect.width;
  let height = rect.height;
  let left = rect.left;
  let top = rect.top;
  if (elementRatio > frameRatio) {
    width = rect.height * frameRatio;
    left = rect.left + (rect.width - width) / 2;
  } else {
    height = rect.width / frameRatio;
    top = rect.top + (rect.height - height) / 2;
  }
  return {
    x: width > 0 ? (clientX - left) / width : 0,
    y: height > 0 ? (clientY - top) / height : 0,
  };
}

/**
 * Turn a burst of wheel events into notches of 100px.
 * deltaMode 1 is lines (Firefox), 2 is pages. Tiny trackpad steps add up
 * instead of being thrown away.
 */
export function accumulateWheel(pending: number, deltaY: number, mode = 0): { pending: number; delta: number } {
  let px = deltaY;
  if (mode === 1) px = deltaY * 100;
  else if (mode === 2) px = deltaY * 800;
  if (!Number.isFinite(px) || px === 0) return { pending, delta: 0 };
  const sum = pending + px;
  let steps = Math.trunc(sum / 100);
  if (steps === 0) return { pending: sum, delta: 0 };
  steps = Math.max(-6, Math.min(6, steps));
  return { pending: sum - steps * 100, delta: steps * 100 };
}

export function pointerBody(input: DeskInput): string | null {
  if (input.kind === "key") {
    if (!input.down) return null;
    const key = input.key.slice(0, 16);
    if (!key) return null;
    const body: Record<string, unknown> = { action: "key", key };
    if (input.ctrl) body.ctrl = true;
    if (input.alt) body.alt = true;
    if (input.shift) body.shift = true;
    return JSON.stringify(body);
  }
  if (input.kind === "wheel") {
    const point = screenPoint(input.x, input.y, 10001, 10001);
    let notches = Math.round(-input.delta / 100);
    if (notches === 0 && Math.abs(input.delta) >= 40) notches = input.delta > 0 ? -1 : 1;
    notches = Math.max(-6, Math.min(6, notches));
    if (!notches) return null;
    return JSON.stringify({
      action: "wheel",
      x: point.x / 10000,
      y: point.y / 10000,
      delta: notches,
    });
  }
  const point = screenPoint(input.x, input.y, 10001, 10001);
  return JSON.stringify({
    action: input.kind,
    x: point.x / 10000,
    y: point.y / 10000,
    button: input.button === "right" ? "right" : "left",
  });
}

function loopback(init: RequestInit): RequestInit {
  return { ...init, targetAddressSpace: "loopback" } as RequestInit;
}

/** True when the tray accepted the event. Null when this event is not sent (a key release). */
export function postWindowsPointer(input: DeskInput): Promise<boolean | null> {
  const body = pointerBody(input);
  if (!body) return Promise.resolve(null);
  return fetch(
    WINDOWS_POINTER_URL,
    loopback({ method: "POST", mode: "cors", headers: { "content-type": "application/json" }, body }),
  )
    .then((response) => response.ok || response.status === 204)
    .catch(() => false);
}

export function postWindowsClip(text: string): Promise<boolean> {
  const clean = text.slice(0, 2000);
  if (!clean.trim()) return Promise.resolve(false);
  return fetch(
    WINDOWS_POINTER_URL,
    loopback({
      method: "POST",
      mode: "cors",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "clip", key: clean }),
    }),
  )
    .then((response) => response.ok || response.status === 204)
    .catch(() => false);
}

export async function windowsPointerReady(): Promise<boolean> {
  try {
    const response = await fetch(WINDOWS_POINTER_HEALTH, loopback({ method: "GET", mode: "cors", cache: "no-store" }));
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Ask Chrome for loopback access and see if the tray is up.
 * Call this from a click handler with no await before it. A probe from
 * useEffect never shows the Allow prompt, and the cursor fetch then fails quietly.
 */
export function armWindowsPointer(): Promise<PointerArm> {
  return fetch(WINDOWS_POINTER_HEALTH, loopback({ method: "GET", mode: "cors", cache: "no-store" }))
    .then((response) => (response.ok ? "ready" : "down") as PointerArm)
    .catch(() => classifyArmFailure());
}

async function classifyArmFailure(): Promise<PointerArm> {
  try {
    const status = await navigator.permissions.query({ name: "loopback-network" as PermissionName });
    if (status.state === "granted") return "down";
    return "blocked";
  } catch {
    return "blocked";
  }
}
