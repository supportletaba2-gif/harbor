import { useEffect, useRef, useState, type KeyboardEvent as ReactKey, type PointerEvent as ReactPointer } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PRESETS, groupId, type QualityPreset } from "@/lib/desk/types";
import { accumulateWheel, letterboxNorm } from "@/lib/desk/windows-pointer";
import type { useViewerDesk } from "@/lib/desk/use-viewer";
import { cn } from "@/lib/utils";
import { SessionTools } from "./session-tools";

type Viewer = ReturnType<typeof useViewerDesk>;

function requestStageFullscreen(stage: HTMLElement) {
  const legacy = stage as HTMLElement & { webkitRequestFullscreen?: () => void };
  if (typeof stage.requestFullscreen === "function") return stage.requestFullscreen();
  legacy.webkitRequestFullscreen?.();
}

export function ViewerPanel({ viewer }: { viewer: Viewer }) {
  const moveRaf = useRef(0);
  const pending = useRef<{ x: number; y: number } | null>(null);
  const aspect = useRef({ w: 16, h: 9 });
  const held = useRef<"left" | "right">("left");
  const wheelPending = useRef(0);
  const live = viewer.status === "live";
  const [full, setFull] = useState(false);

  useEffect(() => {
    const sync = () => {
      const stage = viewer.stageRef.current;
      setFull(Boolean(stage && document.fullscreenElement === stage));
    };
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, [viewer.stageRef]);

  useEffect(() => {
    if (live || !document.fullscreenElement) return;
    void document.exitFullscreen().catch(() => {});
  }, [live]);

  async function toggleFull() {
    const stage = viewer.stageRef.current;
    if (!stage) return;
    try {
      if (document.fullscreenElement === stage) await document.exitFullscreen();
      else {
        await requestStageFullscreen(stage);
        stage.focus();
      }
    } catch {
      // The browser refused fullscreen. The picture stays in the card.
    }
  }

  function sendPointer(kind: "move" | "down" | "up", event: ReactPointer<HTMLDivElement>) {
    const stage = viewer.stageRef.current;
    if (!stage) return;
    const media = viewer.hasStream ? viewer.videoRef.current : viewer.frameRef.current;
    const frameW = media instanceof HTMLVideoElement ? media.videoWidth : (media?.naturalWidth ?? 0);
    const frameH = media instanceof HTMLVideoElement ? media.videoHeight : (media?.naturalHeight ?? 0);
    if (frameW > 8 && frameH > 8) aspect.current = { w: frameW, h: frameH };
    const point = letterboxNorm(stage.getBoundingClientRect(), aspect.current.w, aspect.current.h, event.clientX, event.clientY);
    if (point.x < 0 || point.y < 0 || point.x > 1 || point.y > 1) return;
    if (kind === "move") {
      pending.current = point;
      if (moveRaf.current) return;
      moveRaf.current = requestAnimationFrame(() => {
        moveRaf.current = 0;
        const next = pending.current;
        if (next) viewer.sendInput({ kind: "move", ...next });
      });
      return;
    }
    if (moveRaf.current) cancelAnimationFrame(moveRaf.current);
    moveRaf.current = 0;
    const queued = pending.current;
    pending.current = null;
    if (queued) viewer.sendInput({ kind: "move", ...queued });
    if (kind === "down") {
      held.current = event.button === 2 ? "right" : "left";
      if (held.current === "right") event.preventDefault();
    }
    viewer.sendInput({ kind, ...point, button: held.current });
  }

  useEffect(() => {
    const stage = viewer.stageRef.current;
    if (!live || !stage) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const point = letterboxNorm(stage.getBoundingClientRect(), aspect.current.w, aspect.current.h, event.clientX, event.clientY);
      if (point.x < 0 || point.y < 0 || point.x > 1 || point.y > 1) return;
      const next = accumulateWheel(wheelPending.current, event.deltaY, event.deltaMode);
      wheelPending.current = next.pending;
      if (!next.delta) return;
      viewer.sendInput({ kind: "wheel", ...point, delta: next.delta });
    };
    stage.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => stage.removeEventListener("wheel", onWheel, { capture: true });
  }, [live, viewer.sendInput, viewer.stageRef]);

  function onKey(event: ReactKey<HTMLDivElement>) {
    if (!live) return;
    if (event.key === "Escape" && document.fullscreenElement) return;
    if (event.key === "Control" || event.key === "Alt" || event.key === "Shift" || event.key === "Meta" || event.metaKey) return;
    event.preventDefault();
    const named = event.key.length > 1;
    viewer.sendInput({
      kind: "key",
      key: event.key,
      down: event.type === "keydown",
      ctrl: event.ctrlKey || undefined,
      alt: event.altKey || undefined,
      shift: named && event.shiftKey ? true : undefined,
    });
  }

  return (
    <section className="flex min-w-0 flex-col gap-5 rounded-xl bg-elev p-5" data-status={viewer.status}>
      <header>
        <p className="text-sm text-muted">Control</p>
        <h2 className="text-lg font-medium tracking-tight">Open a desk</h2>
      </header>

      {live ? (
        <>
          <div
            ref={viewer.stageRef}
            tabIndex={0}
            className="desk-stage relative aspect-video cursor-none overflow-hidden rounded-sm bg-bg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg fullscreen:aspect-auto fullscreen:h-full fullscreen:w-full fullscreen:rounded-none fullscreen:bg-black"
            onPointerDown={(event) => {
              viewer.stageRef.current?.focus();
              event.currentTarget.setPointerCapture(event.pointerId);
              sendPointer("down", event);
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId) && event.pointerType === "mouse") {
                sendPointer("move", event);
              } else if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                sendPointer("move", event);
              }
            }}
            onPointerUp={(event) => sendPointer("up", event)}
            onPointerCancel={(event) => sendPointer("up", event)}
            onContextMenu={(event) => event.preventDefault()}
            onAuxClick={(event) => event.preventDefault()}
            onKeyDown={onKey}
            onKeyUp={onKey}
          >
            <video
              ref={viewer.videoRef}
              autoPlay
              muted
              playsInline
              className={cn("h-full w-full cursor-none object-contain", viewer.hasStream ? "block" : "hidden")}
            />
            {viewer.frameUrl && !viewer.hasStream ? (
              <img ref={viewer.frameRef} src={viewer.frameUrl} alt="" decoding="async" draggable={false} className="h-full w-full cursor-none object-contain" />
            ) : null}
            {!viewer.hasStream && !viewer.frameUrl ? (
              <p className="absolute inset-0 grid place-items-center text-sm text-muted">Waiting for the picture…</p>
            ) : null}
            {full ? (
              <Button
                className="absolute top-3 right-3 z-10"
                onPointerDown={(event) => event.stopPropagation()}
                onPointerUp={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  void toggleFull();
                }}
              >
                Exit full screen
              </Button>
            ) : null}
          </div>
          <Button size="lg" className="w-full" onClick={() => void toggleFull()}>
            Full screen
          </Button>
          <div className="grid grid-cols-3 gap-2" role="group" aria-label="Picture quality">
            {(Object.keys(PRESETS) as QualityPreset[]).map((preset) => (
              <Button
                key={preset}
                variant={viewer.quality === preset ? "primary" : "quiet"}
                onClick={() => viewer.chooseQuality(preset)}
                aria-pressed={viewer.quality === preset}
              >
                {PRESETS[preset].label}
              </Button>
            ))}
          </div>
          <p className="font-mono text-sm text-muted tabular-nums">
            {viewer.hasStream ? "Direct link" : viewer.frameUrl ? "Relay" : "Link"}
            {viewer.rtt !== null ? ` · ${viewer.rtt} ms` : ""}
            {viewer.fps !== null ? ` · ${viewer.fps} fps` : viewer.frameUrl && !viewer.hasStream ? " · about 15 fps" : ""}
            {viewer.source === "display" ? " · live display" : ""}
          </p>
          {viewer.frameUrl && !viewer.hasStream ? (
            <p className="text-sm text-muted">
              About 15 frames a second through Harbor, which is enough to work but not a video call. A direct link is full video, about 24 frames a second, and it takes over on its own when the two networks can see each other. Files move only on that direct link. Right-click and the scroll wheel go to the shared PC.
            </p>
          ) : viewer.hasStream ? (
            <p className="text-sm text-muted">Direct link, about 24 frames a second. Right-click and the scroll wheel go to the shared PC.</p>
          ) : null}
          <p className="text-sm text-muted" data-pointer={viewer.pointerOk === null ? "unknown" : viewer.pointerOk ? "ready" : "waiting"}>
            {viewer.aim === "page"
              ? "This pointer moves a cursor on the host page and clicks what is under it."
              : viewer.aim === "windows" && viewer.pointerOk === false
                ? "The mouse is waiting. On the shared PC, click Allow the pointer and choose Allow. The Harbor tray must be running."
                : viewer.aim === "windows" && viewer.pointerOk === true
                  ? "The Windows pointer is live. Move, click, right-click, and scroll on the picture. Type while it is selected."
                  : viewer.aim === "windows"
                    ? "This pointer moves the Windows cursor on the host PC. The host must be sharing the entire screen, with the Harbor tray running."
                    : "The Windows pointer moves the mouse on the shared PC. Share the entire screen, with the Harbor tray running."}
          </p>
          <Button variant={viewer.aim === "page" ? "primary" : "quiet"} className="w-full" onClick={() => viewer.setAim(viewer.aim === "page" ? "desk" : "page")}>
            {viewer.aim === "page" ? "Page mouse on" : "Control this page"}
          </Button>
          <Button variant={viewer.aim === "windows" ? "primary" : "quiet"} className="w-full" onClick={() => viewer.setAim(viewer.aim === "windows" ? "desk" : "windows")}>
            {viewer.aim === "windows" ? "Windows pointer on" : "Windows pointer"}
          </Button>
          <Button variant="danger" size="lg" className="w-full" onClick={viewer.disconnect}>
            Disconnect
          </Button>
        </>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            viewer.connect();
          }}
        >
          <label className="flex flex-col gap-2 text-sm text-muted">
            Desk ID
            <Input
              value={groupId(viewer.remoteId)}
              onChange={(event) => viewer.setRemoteId(event.target.value)}
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              placeholder="000 000 000"
              aria-label="Desk ID"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm text-muted">
            PIN
            <Input
              value={viewer.pin}
              onChange={(event) => viewer.setPin(event.target.value)}
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              type="password"
              invalid={viewer.status === "denied"}
              aria-label="Desk PIN"
            />
          </label>
          <p className="text-sm text-muted">On the other computer, choose Share this display and wait until it says Waiting. Then paste that ID and PIN.</p>
          {viewer.running ? (
            <Button variant="danger" size="lg" className="w-full" onClick={viewer.disconnect}>
              Cancel
            </Button>
          ) : (
            <Button type="submit" size="lg" className="w-full" disabled={!viewer.canConnect}>
              Connect
            </Button>
          )}
          <p className={cn("text-sm", viewer.status === "denied" || viewer.status === "error" ? "text-danger" : "text-muted")} aria-live="polite">
            {viewer.detail}
          </p>
        </form>
      )}
      <SessionTools
        live={live}
        self="viewer"
        files={viewer.files}
        chat={viewer.chat}
        clip={viewer.clip}
        audit={viewer.audit}
        onSendFile={viewer.sendFile}
        onCancel={viewer.cancelFile}
        onChat={viewer.say}
        onClip={viewer.sendClip}
      />
    </section>
  );
}
