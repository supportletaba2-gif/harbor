import { useRef, type KeyboardEvent as ReactKey, type PointerEvent as ReactPointer } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PRESETS, groupId, type QualityPreset } from "@/lib/desk/types";
import type { useViewerDesk } from "@/lib/desk/use-viewer";
import { cn } from "@/lib/utils";
import { SessionTools } from "./session-tools";

type Viewer = ReturnType<typeof useViewerDesk>;

function contentNorm(video: HTMLVideoElement, clientX: number, clientY: number) {
  const rect = video.getBoundingClientRect();
  const frameW = video.videoWidth || 16;
  const frameH = video.videoHeight || 9;
  const elementRatio = rect.width / rect.height;
  const frameRatio = frameW / frameH;
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
    x: (clientX - left) / width,
    y: (clientY - top) / height,
  };
}

export function ViewerPanel({
  viewer,
  onUseLocal,
  localReady,
}: {
  viewer: Viewer;
  onUseLocal: () => void;
  localReady: boolean;
}) {
  const moveRaf = useRef(0);
  const pending = useRef<{ x: number; y: number } | null>(null);
  const live = viewer.status === "live";

  function sendPointer(kind: "move" | "down" | "up", event: ReactPointer<HTMLDivElement>) {
    const video = viewer.videoRef.current;
    if (!video) return;
    const point = contentNorm(video, event.clientX, event.clientY);
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
    viewer.sendInput({ kind, ...point });
  }

  function onKey(event: ReactKey<HTMLDivElement>) {
    if (!live) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    viewer.sendInput({ kind: "key", key: event.key, down: event.type === "keydown" });
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
            className="relative aspect-video overflow-hidden rounded-sm bg-bg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg"
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
            onKeyDown={onKey}
            onKeyUp={onKey}
          >
            <video ref={viewer.videoRef} autoPlay muted playsInline className="h-full w-full cursor-none object-contain" />
            {!viewer.hasStream ? (
              <p className="absolute inset-0 grid place-items-center text-sm text-muted">Waiting for the picture…</p>
            ) : null}
          </div>
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
            {viewer.rtt !== null ? `${viewer.rtt} ms` : "Link up"}
            {viewer.fps !== null ? ` · ${viewer.fps} fps` : ""}
            {viewer.source === "display" ? " · live display" : " · practice desk"}
          </p>
          <p className="text-sm text-muted">
            {viewer.aim === "page"
              ? "This pointer moves a cursor on the host page and clicks what is under it."
              : "Click a window, then type. Notes and the terminal take keys. Drag a window by its title."}
          </p>
          <Button variant="quiet" className="w-full" onClick={() => viewer.setAim(viewer.aim === "page" ? "desk" : "page")}>
            {viewer.aim === "page" ? "Control the desk" : "Control this page"}
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
          <Button variant="quiet" className="w-full" disabled={!localReady || viewer.running} onClick={onUseLocal}>
            Use the desk on this page
          </Button>
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
        metrics={viewer.metrics}
        audit={viewer.audit}
        onSendFile={viewer.sendFile}
        onCancel={viewer.cancelFile}
        onChat={viewer.say}
        onClip={viewer.sendClip}
        onKill={viewer.endProcess}
      />
    </section>
  );
}
