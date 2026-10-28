/**
 * Practice machine the viewer can inspect and trim.
 * Numbers move on their own. They are not this computer's CPU, memory, or disk.
 */
import type { MachineSnapshot, ProcRow } from "./types";

const SEED: ProcRow[] = [
  { pid: 188, name: "link", cpu: 2, memMb: 18 },
  { pid: 410, name: "harbor", cpu: 4, memMb: 86 },
  { pid: 512, name: "notes", cpu: 1, memMb: 42 },
  { pid: 640, name: "calculator", cpu: 0, memMb: 28 },
  { pid: 902, name: "desktop", cpu: 6, memMb: 120 },
];

export function createMachine() {
  let procs = SEED.map((proc) => ({ ...proc }));
  let cpu = 36;
  let step = 0;
  let high = false;
  let pending: string[] = [];
  let lastAlert = "";

  return {
    tick(): MachineSnapshot {
      step += 1;
      cpu = clamp(Math.round(36 + Math.sin(step / 2) * 22), 8, 74);
      if (!high && cpu >= 50) {
        high = true;
        lastAlert = `CPU high at ${cpu}%`;
        pending.push(lastAlert);
      } else if (high && cpu <= 40) {
        high = false;
        pending.push(`CPU settled at ${cpu}%`);
      }
      const weights = procs.map((_, index) => 1 + ((index * 3 + step) % 5));
      const sum = weights.reduce((total, weight) => total + weight, 0) || 1;
      procs = procs.map((proc, index) => ({
        ...proc,
        cpu: Math.max(0, Math.round((cpu * weights[index]) / sum)),
      }));
      const ramMb = clamp(520 + procs.reduce((total, proc) => total + proc.memMb, 0), 400, 1800);
      return {
        cpu,
        ramMb,
        ramTotalMb: 2048,
        diskGb: 48,
        diskTotalGb: 128,
        procs: procs.map((proc) => ({ ...proc })),
        alert: high ? "CPU high" : null,
      };
    },
    drain(): string[] {
      const events = pending;
      pending = [];
      return events;
    },
    alertLine(): string | null {
      return high ? lastAlert : null;
    },
    kill(pid: number): boolean {
      if (!procs.some((proc) => proc.pid === pid)) return false;
      procs = procs.filter((proc) => proc.pid !== pid);
      return true;
    },
  };
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}
