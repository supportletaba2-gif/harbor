/**
 * Practice desk — a small machine the host actually owns, so remote clicks and
 * keys do something visible. Logical space is 1280×720; the canvas scales it.
 * A later OS injector can ignore this module and consume DeskInput directly.
 */
import { runShell } from "./shell";
import type { DeskInput } from "./types";

export const LOGICAL_W = 1280;
export const LOGICAL_H = 720;

const WALL = "#2a3644";
const BAR = "#1a222c";
const INK = "#e7eaee";
const MUTED = "#9aa8b5";
const FAINT = "#7d8b99";
const WINDOW = "#12181f";
const TITLE = "#1c2630";
const LINE = "#3a4654";
const FOCUS = "#e7eaee";
const KEY = "#24303c";
const KEY_OP = "#31404e";
const DISPLAY = "#0c1116";

export type WinId = "notes" | "calc" | "term";

export type DeskWindow = {
  id: WinId;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
};

export type DeskModel = {
  windows: DeskWindow[];
  focus: WinId | null;
  notes: string;
  calcDisplay: string;
  calcAcc: number | null;
  calcOp: "+" | "-" | "*" | "/" | null;
  calcFresh: boolean;
  termLog: string[];
  termInput: string;
  cursor: { x: number; y: number; down: boolean };
  drag: { id: WinId; ox: number; oy: number } | null;
};

type Btn = { label: string; c: number; r: number; cw: number; rh: number };

const CALC_BUTTONS: Btn[] = [
  { label: "C", c: 0, r: 0, cw: 1, rh: 1 },
  { label: "/", c: 1, r: 0, cw: 1, rh: 1 },
  { label: "*", c: 2, r: 0, cw: 1, rh: 1 },
  { label: "⌫", c: 3, r: 0, cw: 1, rh: 1 },
  { label: "7", c: 0, r: 1, cw: 1, rh: 1 },
  { label: "8", c: 1, r: 1, cw: 1, rh: 1 },
  { label: "9", c: 2, r: 1, cw: 1, rh: 1 },
  { label: "-", c: 3, r: 1, cw: 1, rh: 1 },
  { label: "4", c: 0, r: 2, cw: 1, rh: 1 },
  { label: "5", c: 1, r: 2, cw: 1, rh: 1 },
  { label: "6", c: 2, r: 2, cw: 1, rh: 1 },
  { label: "+", c: 3, r: 2, cw: 1, rh: 1 },
  { label: "1", c: 0, r: 3, cw: 1, rh: 1 },
  { label: "2", c: 1, r: 3, cw: 1, rh: 1 },
  { label: "3", c: 2, r: 3, cw: 1, rh: 1 },
  { label: "=", c: 3, r: 3, cw: 1, rh: 2 },
  { label: "0", c: 0, r: 4, cw: 2, rh: 1 },
  { label: ".", c: 2, r: 4, cw: 1, rh: 1 },
];

const TITLE_H = 36;

export function createDesk(): DeskModel {
  return {
    windows: [
      { id: "notes", title: "Notes", x: 36, y: 56, w: 500, h: 300, z: 2 },
      { id: "term", title: "Terminal", x: 36, y: 372, w: 800, h: 300, z: 1 },
      { id: "calc", title: "Calculator", x: 860, y: 56, w: 384, h: 520, z: 3 },
    ],
    focus: "notes",
    notes: "This is the practice desk.\n\nClicks and keys from the viewer change this machine.",
    calcDisplay: "0",
    calcAcc: null,
    calcOp: null,
    calcFresh: true,
    termLog: ["practice shell. not this computer.", "type help"],
    termInput: "",
    cursor: { x: -40, y: -40, down: false },
    drag: null,
  };
}

export function applyInput(model: DeskModel, input: DeskInput): string {
  if (input.kind === "key") {
    if (!input.down) return "Key";
    return applyKey(model, input.key);
  }
  const x = clamp(input.x, 0, 1) * LOGICAL_W;
  const y = clamp(input.y, 0, 1) * LOGICAL_H;
  model.cursor.x = x;
  model.cursor.y = y;
  if (input.kind === "move") {
    model.cursor.down = model.drag !== null || model.cursor.down;
    if (model.drag) moveDrag(model, x, y);
    return "Pointer";
  }
  if (input.kind === "up") {
    model.cursor.down = false;
    model.drag = null;
    return "Pointer";
  }
  model.cursor.down = true;
  return pointerDown(model, x, y);
}

export function drawDesk(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  model: DeskModel,
  w: number,
  h: number,
) {
  ctx.setTransform(w / LOGICAL_W, 0, 0, h / LOGICAL_H, 0, 0);
  ctx.fillStyle = WALL;
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

  ctx.fillStyle = BAR;
  ctx.fillRect(0, 0, LOGICAL_W, 40);
  ctx.fillStyle = LINE;
  ctx.fillRect(0, 40, LOGICAL_W, 1);
  ctx.font = "500 13px 'IBM Plex Sans', sans-serif";
  ctx.fillStyle = MUTED;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText("PRACTICE DESK", 16, 20);
  ctx.textAlign = "right";
  ctx.fillText(clockLabel(), LOGICAL_W - 16, 20);

  ctx.font = "400 14px 'IBM Plex Sans', sans-serif";
  ctx.fillStyle = FAINT;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("Shared by Harbor", 16, LOGICAL_H - 18);

  const ordered = [...model.windows].sort((a, b) => a.z - b.z);
  for (const win of ordered) drawWindow(ctx, model, win);
  drawCursor(ctx, model.cursor.x, model.cursor.y);
}

function pointerDown(model: DeskModel, x: number, y: number): string {
  const hit = topWindowAt(model, x, y);
  if (!hit) {
    model.focus = null;
    model.drag = null;
    return "Desk";
  }
  bringToFront(model, hit.id);
  model.focus = hit.id;
  if (y <= hit.y + TITLE_H) {
    model.drag = { id: hit.id, ox: x - hit.x, oy: y - hit.y };
    return `Move ${hit.title}`;
  }
  if (hit.id === "calc") {
    const btn = calcButtonAt(hit, x, y);
    if (btn) {
      pressCalc(model, btn);
      return `Calc ${btn}`;
    }
  }
  return hit.title;
}

function applyKey(model: DeskModel, key: string): string {
  if (model.focus === "term") return applyTermKey(model, key);
  if (model.focus !== "notes") return `Key ${key}`;
  if (key === "Backspace") {
    model.notes = model.notes.slice(0, -1);
    return "Backspace";
  }
  if (key === "Enter") {
    model.notes += "\n";
    return "Enter";
  }
  if (key.length === 1 && model.notes.length < 2000) {
    model.notes += key;
    return `Key ${key}`;
  }
  return `Key ${key}`;
}

function applyTermKey(model: DeskModel, key: string): string {
  if (key === "Backspace") {
    model.termInput = model.termInput.slice(0, -1);
    return "Shell";
  }
  if (key === "Enter") {
    const line = model.termInput;
    model.termLog.push(`$ ${line}`);
    const result = runShell(line);
    if (result.clear) model.termLog = [];
    else model.termLog.push(...result.lines);
    if (model.termLog.length > 80) model.termLog = model.termLog.slice(-80);
    model.termInput = "";
    return "Shell";
  }
  if (key.length === 1 && model.termInput.length < 120) {
    model.termInput += key;
    return "Shell";
  }
  return "Shell";
}

function moveDrag(model: DeskModel, x: number, y: number) {
  const drag = model.drag;
  if (!drag) return;
  const win = model.windows.find((w) => w.id === drag.id);
  if (!win) return;
  win.x = clamp(x - drag.ox, 8, LOGICAL_W - 80);
  win.y = clamp(y - drag.oy, 48, LOGICAL_H - 48);
}

function topWindowAt(model: DeskModel, x: number, y: number): DeskWindow | null {
  const ordered = [...model.windows].sort((a, b) => b.z - a.z);
  for (const win of ordered) {
    if (x >= win.x && x <= win.x + win.w && y >= win.y && y <= win.y + win.h) return win;
  }
  return null;
}

function bringToFront(model: DeskModel, id: WinId) {
  const max = model.windows.reduce((m, w) => Math.max(m, w.z), 0);
  const win = model.windows.find((w) => w.id === id);
  if (win) win.z = max + 1;
}

function pressCalc(model: DeskModel, label: string) {
  const op = label === "+" || label === "-" || label === "*" || label === "/" ? label : null;
  if (label === "C") {
    model.calcDisplay = "0";
    model.calcAcc = null;
    model.calcOp = null;
    model.calcFresh = true;
    return;
  }
  if (model.calcDisplay === "Error" && label !== "⌫") {
    model.calcDisplay = "0";
    model.calcAcc = null;
    model.calcOp = null;
    model.calcFresh = true;
  }
  if (label === "⌫") {
    if (model.calcFresh) return;
    const next = model.calcDisplay.slice(0, -1);
    model.calcDisplay = next.length ? next : "0";
    model.calcFresh = model.calcDisplay === "0";
    return;
  }
  if (op || label === "=") {
    const current = Number(model.calcDisplay);
    if (model.calcOp && model.calcAcc !== null && !model.calcFresh && Number.isFinite(current)) {
      const result = compute(model.calcAcc, model.calcOp, current);
      model.calcDisplay = formatNum(result);
      model.calcAcc = Number.isFinite(result) ? result : null;
      model.calcOp = Number.isFinite(result) ? op : null;
    } else if (Number.isFinite(current)) {
      model.calcAcc = current;
      model.calcOp = op;
    }
    model.calcFresh = true;
    return;
  }
  if (label === "." && !model.calcFresh && model.calcDisplay.includes(".")) return;
  if (model.calcFresh || model.calcDisplay === "0" && label !== ".") {
    model.calcDisplay = label === "." ? "0." : label;
    model.calcFresh = false;
    return;
  }
  if (model.calcDisplay.length >= 12) return;
  model.calcDisplay += label;
  model.calcFresh = false;
}

function compute(a: number, op: "+" | "-" | "*" | "/", b: number): number {
  if (op === "+") return a + b;
  if (op === "-") return a - b;
  if (op === "*") return a * b;
  return b === 0 ? Number.NaN : a / b;
}

function formatNum(n: number): string {
  if (!Number.isFinite(n)) return "Error";
  const rounded = Math.round(n * 1e6) / 1e6;
  const text = String(rounded);
  return text.length > 12 ? n.toExponential(4) : text;
}

function drawWindow(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  model: DeskModel,
  win: DeskWindow,
) {
  const focused = model.focus === win.id;
  ctx.save();
  rounded(ctx, win.x, win.y, win.w, win.h, 10);
  ctx.clip();
  ctx.fillStyle = WINDOW;
  ctx.fillRect(win.x, win.y, win.w, win.h);
  ctx.fillStyle = TITLE;
  ctx.fillRect(win.x, win.y, win.w, TITLE_H);
  ctx.fillStyle = LINE;
  ctx.fillRect(win.x, win.y + TITLE_H, win.w, 1);
  ctx.font = "500 14px 'IBM Plex Sans', sans-serif";
  ctx.fillStyle = focused ? INK : MUTED;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(win.title, win.x + 14, win.y + TITLE_H / 2);
  if (win.id === "notes") drawNotes(ctx, model, win);
  else if (win.id === "term") drawTerm(ctx, model, win);
  else drawCalc(ctx, model, win);
  ctx.restore();
  ctx.beginPath();
  rounded(ctx, win.x, win.y, win.w, win.h, 10);
  ctx.strokeStyle = focused ? FOCUS : LINE;
  ctx.lineWidth = focused ? 1.5 : 1;
  ctx.stroke();
}

function drawNotes(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  model: DeskModel,
  win: DeskWindow,
) {
  const x = win.x + 16;
  const y = win.y + TITLE_H + 16;
  const maxW = win.w - 32;
  const lineH = 22;
  ctx.font = "400 16px 'IBM Plex Sans', sans-serif";
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const lines = wrap(ctx, model.notes, maxW);
  const maxLines = Math.max(1, Math.floor((win.h - TITLE_H - 28) / lineH));
  const visible = lines.slice(-maxLines);
  visible.forEach((line, i) => ctx.fillText(line, x, y + i * lineH));
  if (model.focus === "notes" && Math.floor(Date.now() / 500) % 2 === 0) {
    const last = visible[visible.length - 1] ?? "";
    const caretX = x + ctx.measureText(last).width + 1;
    const caretY = y + (visible.length - 1) * lineH;
    ctx.fillRect(caretX, caretY, 1.5, 18);
  }
}

function drawTerm(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  model: DeskModel,
  win: DeskWindow,
) {
  const x = win.x + 16;
  const y = win.y + TITLE_H + 12;
  const lineH = 20;
  const maxLines = Math.max(1, Math.floor((win.h - TITLE_H - 20) / lineH));
  const prompt = `$ ${model.termInput}`;
  const visible = [...model.termLog, prompt].slice(-maxLines);
  ctx.font = "400 14px 'IBM Plex Mono', ui-monospace, monospace";
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  visible.forEach((line, i) => ctx.fillText(line, x, y + i * lineH));
  if (model.focus === "term" && Math.floor(Date.now() / 500) % 2 === 0) {
    const last = visible[visible.length - 1] ?? "";
    const caretX = x + ctx.measureText(last).width + 1;
    const caretY = y + (visible.length - 1) * lineH;
    ctx.fillRect(caretX, caretY, 8, 16);
  }
}

function drawCalc(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  model: DeskModel,
  win: DeskWindow,
) {
  const display = displayRect(win);
  ctx.fillStyle = DISPLAY;
  rounded(ctx, display.x, display.y, display.w, display.h, 6);
  ctx.fill();
  ctx.font = "500 22px 'IBM Plex Mono', ui-monospace, monospace";
  ctx.fillStyle = INK;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(model.calcDisplay, display.x + display.w - 12, display.y + display.h / 2);
  if (model.calcOp) {
    ctx.font = "400 12px 'IBM Plex Mono', ui-monospace, monospace";
    ctx.fillStyle = MUTED;
    ctx.textAlign = "left";
    ctx.fillText(model.calcOp, display.x + 12, display.y + display.h / 2);
  }
  for (const btn of buttonRects(win)) {
    const op = btn.label === "=" || btn.label === "+" || btn.label === "-" || btn.label === "*" || btn.label === "/";
    ctx.fillStyle = op ? KEY_OP : KEY;
    rounded(ctx, btn.x, btn.y, btn.w, btn.h, 6);
    ctx.fill();
    ctx.font = "500 16px 'IBM Plex Sans', sans-serif";
    ctx.fillStyle = INK;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(btn.label, btn.x + btn.w / 2, btn.y + btn.h / 2);
  }
}

function calcButtonAt(win: DeskWindow, x: number, y: number): string | null {
  for (const btn of buttonRects(win)) {
    if (x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) return btn.label;
  }
  return null;
}

function displayRect(win: DeskWindow) {
  return { x: win.x + 14, y: win.y + TITLE_H + 14, w: win.w - 28, h: 52 };
}

function buttonRects(win: DeskWindow) {
  const cols = 4;
  const rows = 5;
  const gap = 8;
  const display = displayRect(win);
  const innerX = win.x + 14;
  const innerY = display.y + display.h + 12;
  const innerW = win.w - 28;
  const innerH = win.y + win.h - 14 - innerY;
  const bw = (innerW - gap * (cols - 1)) / cols;
  const bh = (innerH - gap * (rows - 1)) / rows;
  return CALC_BUTTONS.map((btn) => ({
    label: btn.label,
    x: innerX + btn.c * (bw + gap),
    y: innerY + btn.r * (bh + gap),
    w: btn.cw * bw + (btn.cw - 1) * gap,
    h: btn.rh * bh + (btn.rh - 1) * gap,
  }));
}

function drawCursor(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 18);
  ctx.lineTo(4.5, 14);
  ctx.lineTo(8, 21);
  ctx.lineTo(11, 19.5);
  ctx.lineTo(7.5, 13);
  ctx.lineTo(14, 13);
  ctx.closePath();
  ctx.fillStyle = "#f4f7fa";
  ctx.fill();
  ctx.strokeStyle = "#101418";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function wrap(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    if (!para) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of para.split(" ")) {
      const test = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(test).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    lines.push(line);
  }
  return lines.length ? lines : [""];
}

function rounded(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function clockLabel(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}
