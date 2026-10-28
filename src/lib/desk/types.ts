/** Shared desk-session types. Input is normalized so a later OS injector can consume it unchanged. */

export type QualityPreset = "smooth" | "balanced" | "sharp";

export type DeskSource = "desk" | "display";

export type Aim = "desk" | "page";

export type LinkStatus =
  | "idle"
  | "signaling"
  | "waiting"
  | "connecting"
  | "checking"
  | "live"
  | "denied"
  | "ended"
  | "error";

export type DeskInput =
  | { kind: "move" | "down" | "up"; x: number; y: number }
  | { kind: "key"; key: string; down: boolean };

export type ProcRow = {
  pid: number;
  name: string;
  cpu: number;
  memMb: number;
};

/** Practice-machine report. Not the real computer. */
export type MachineSnapshot = {
  cpu: number;
  ramMb: number;
  ramTotalMb: number;
  diskGb: number;
  diskTotalGb: number;
  procs: ProcRow[];
  /** Set while the practice CPU is over the high line. Null when it is steady. */
  alert: string | null;
};

export type ChatLine = {
  id: string;
  from: "host" | "viewer";
  text: string;
};

export type ControlMsg =
  | { t: "auth"; pin: string }
  | { t: "auth-result"; ok: boolean; reason?: string }
  | { t: "quality"; preset: QualityPreset }
  | { t: "input"; input: DeskInput }
  | { t: "source"; kind: DeskSource }
  | { t: "aim"; kind: Aim }
  | { t: "ping"; n: number }
  | { t: "pong"; n: number }
  | { t: "chat"; text: string }
  | { t: "clip"; text: string }
  | { t: "note"; text: string }
  | { t: "metrics"; snapshot: MachineSnapshot }
  | { t: "kill"; pid: number }
  | { t: "bye" };

export type DeskLinkEvent =
  | { type: "status"; status: LinkStatus; detail: string }
  | { type: "stream"; stream: MediaStream | null }
  | { type: "input"; input: DeskInput }
  | { type: "quality"; preset: QualityPreset }
  | { type: "source"; kind: DeskSource }
  | { type: "aim"; kind: Aim }
  | { type: "rtt"; ms: number }
  | { type: "chat"; from: "host" | "viewer"; text: string }
  | { type: "clip"; from: "host" | "viewer"; text: string }
  | { type: "note"; text: string }
  | { type: "metrics"; snapshot: MachineSnapshot }
  | { type: "kill"; pid: number };

export const PRESETS: Record<
  QualityPreset,
  { fps: number; w: number; h: number; bitrate: number; label: string }
> = {
  smooth: { fps: 12, w: 960, h: 540, bitrate: 600_000, label: "Smooth" },
  balanced: { fps: 24, w: 1280, h: 720, bitrate: 1_600_000, label: "Balanced" },
  sharp: { fps: 30, w: 1600, h: 900, bitrate: 4_000_000, label: "Sharp" },
};

export function isPreset(value: unknown): value is QualityPreset {
  return value === "smooth" || value === "balanced" || value === "sharp";
}

export function isAim(value: unknown): value is Aim {
  return value === "desk" || value === "page";
}

export function isSnapshot(value: unknown): value is MachineSnapshot {
  if (!value || typeof value !== "object") return false;
  const snap = value as MachineSnapshot;
  if (typeof snap.cpu !== "number" || typeof snap.ramMb !== "number" || typeof snap.ramTotalMb !== "number") return false;
  if (typeof snap.diskGb !== "number" || typeof snap.diskTotalGb !== "number") return false;
  if (snap.alert != null && (typeof snap.alert !== "string" || snap.alert.length > 80)) return false;
  if (!Array.isArray(snap.procs) || snap.procs.length > 24) return false;
  return snap.procs.every(
    (proc) =>
      !!proc &&
      typeof proc.pid === "number" &&
      typeof proc.name === "string" &&
      proc.name.length > 0 &&
      proc.name.length < 40 &&
      typeof proc.cpu === "number" &&
      typeof proc.memMb === "number",
  );
}

export function makeId(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 900_000_000;
  return String(100_000_000 + n);
}

export function makePin(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 10_000;
  return String(n).padStart(4, "0");
}

export function groupId(id: string): string {
  return id.replace(/(\d{3})(?=\d)/g, "$1 ");
}

/** Constant-time PIN compare. Empty never matches. */
export function pinsMatch(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(ba.length, bb.length, 1);
  let diff = ba.length ^ bb.length;
  for (let i = 0; i < len; i += 1) diff |= (ba[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0 && a.length > 0;
}

export function peerToken(prefix: "h" | "v"): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let hex = prefix;
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}
