import type { Aim, DeskInput } from "./types";

/** The Harbor tray listens here. Only the Windows PC running the tray can answer. */
export const WINDOWS_POINTER_URL = "http://127.0.0.1:47391/cursor";
export const WINDOWS_POINTER_HEALTH = "http://127.0.0.1:47391/health";

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

export function pointerBody(input: DeskInput): string | null {
  if (input.kind === "key") {
    if (!input.down) return null;
    const key = input.key.slice(0, 16);
    if (!key) return null;
    return JSON.stringify({ action: "key", key });
  }
  const point = screenPoint(input.x, input.y, 10001, 10001);
  return JSON.stringify({
    action: input.kind,
    x: point.x / 10000,
    y: point.y / 10000,
    button: "left",
  });
}

function loopback(init: RequestInit): RequestInit {
  return { ...init, targetAddressSpace: "loopback" } as RequestInit;
}

export function postWindowsPointer(input: DeskInput) {
  const body = pointerBody(input);
  if (!body) return;
  void fetch(WINDOWS_POINTER_URL, loopback({ method: "POST", mode: "cors", headers: { "content-type": "application/json" }, body })).catch(() => {});
}

export async function windowsPointerReady(): Promise<boolean> {
  try {
    const response = await fetch(WINDOWS_POINTER_HEALTH, loopback({ method: "GET", mode: "cors" }));
    return response.ok;
  } catch {
    return false;
  }
}
