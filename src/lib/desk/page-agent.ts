import type { DeskInput } from "./types";

/** Map a normalized pointer into a viewport. The page agent and a future OS injector share this. */
export function pagePoint(x: number, y: number, width: number, height: number) {
  const nx = Math.min(1, Math.max(0, x));
  const ny = Math.min(1, Math.max(0, y));
  return { x: nx * width, y: ny * height };
}

export function applyPageInput(input: DeskInput): { label: string; x?: number; y?: number } {
  if (input.kind === "key") {
    if (!input.down) return { label: "Key" };
    const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
    target.dispatchEvent(new KeyboardEvent("keydown", { key: input.key, bubbles: true, cancelable: true }));
    return { label: `Key ${input.key}` };
  }
  const point = pagePoint(input.x, input.y, window.innerWidth, window.innerHeight);
  if (input.kind === "move") return { label: "Pointer", ...point };
  const target = document.elementFromPoint(point.x, point.y);
  if (input.kind === "down") {
    target?.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, pointerId: 1 }),
    );
    if (target instanceof HTMLElement) target.focus();
    return { label: "Down", ...point };
  }
  target?.dispatchEvent(
    new PointerEvent("pointerup", { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, pointerId: 1 }),
  );
  target?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y }));
  return { label: "Click", ...point };
}
