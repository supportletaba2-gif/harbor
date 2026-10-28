import type { PointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { useHostDesk } from "@/lib/desk/use-host";
import { groupId } from "@/lib/desk/types";
import { cn } from "@/lib/utils";
import { SessionTools } from "./session-tools";
import { Tray } from "./tray";

type Host = ReturnType<typeof useHostDesk>;

const DOT: Record<string, string> = {
  live: "bg-ok",
  error: "bg-danger",
  denied: "bg-danger",
  idle: "bg-faint",
  ended: "bg-faint",
};

export function HostPanel({ host }: { host: Host }) {
  const dot = DOT[host.status] ?? "bg-fg";
  const label =
    host.status === "live"
      ? "Live"
      : host.status === "waiting"
        ? "Waiting"
        : host.status === "ended"
          ? "Ended"
          : host.status === "error"
            ? "Error"
            : host.status === "idle"
              ? "Not live"
              : "Connecting";

  function point(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    };
  }

  return (
    <section className="flex min-w-0 flex-col gap-5 rounded-xl bg-elev p-5" data-status={host.status} data-notes={host.notes} data-shell={host.shell} data-aim={host.aim}>
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">Share</p>
          <h2 className="text-lg font-medium tracking-tight">This desk</h2>
        </div>
        <p className="flex items-center gap-2 text-sm text-muted">
          <span className={cn("size-2 rounded-full", dot)} aria-hidden />
          <span>{label}</span>
        </p>
      </header>

      <div className="relative aspect-video overflow-hidden rounded-sm bg-desk">
        <div
          ref={host.slotRef}
          className={cn("absolute inset-0 touch-none", host.source === "display" && "hidden")}
          onPointerDown={(event) => {
            if (!host.armed) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            const p = point(event);
            host.localInput({ kind: "down", ...p });
          }}
          onPointerMove={(event) => {
            if (!host.armed || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
            const p = point(event);
            host.localInput({ kind: "move", ...p });
          }}
          onPointerUp={(event) => {
            if (!host.armed) return;
            const p = point(event);
            host.localInput({ kind: "up", ...p });
          }}
        />
        <video
          ref={host.previewRef}
          autoPlay
          muted
          playsInline
          className={cn(
            "pointer-events-none absolute inset-0 h-full w-full object-contain",
            host.source === "display" ? "block" : "hidden",
          )}
        />
        {!host.armed ? (
          <div className="absolute inset-0 grid place-items-center bg-desk px-6 text-center">
            <p className="text-sm text-muted">Not shared. Share this display, then use the ID and PIN on the other computer.</p>
          </div>
        ) : null}
      </div>

      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted">Your ID</p>
          <p className="font-mono text-xl tracking-tight text-fg tabular-nums sm:text-2xl">
            {host.id ? groupId(host.id) : "··· ··· ···"}
          </p>
        </div>
        <Button
          variant="ghost"
          size="md"
          disabled={!host.id}
          onClick={() => void navigator.clipboard.writeText(groupId(host.id))}
        >
          Copy ID
        </Button>
      </div>
      {!host.running ? (
        <p className="text-sm text-muted">Not live until you share. The other computer cannot connect while this says Not live.</p>
      ) : null}

      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void host.start("display");
        }}
      >
        <label className="flex flex-col gap-2 text-sm text-muted">
          PIN
          <Input
            value={host.pin}
            onChange={(event) => host.setPin(event.target.value)}
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            aria-label="Desk PIN"
            disabled={host.running}
          />
        </label>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={host.newPin} disabled={host.running}>
            New PIN
          </Button>
          <Button variant="ghost" disabled={!host.pin} onClick={() => void navigator.clipboard.writeText(host.pin)}>
            Copy PIN
          </Button>
        </div>
        {host.running ? (
          <Button variant="danger" size="lg" className="w-full" onClick={host.end}>
            End session
          </Button>
        ) : (
          <Button type="button" size="lg" className="w-full" disabled={!host.canStart} onClick={() => void host.start("display")}>
            Share this display
          </Button>
        )}
      </form>

      <p className="text-sm text-muted" aria-live="polite">
        {host.detail}
      </p>

      <p className="font-mono text-sm text-muted tabular-nums">
        {host.activity}
        {host.rtt !== null ? ` · ${host.rtt} ms` : ""}
      </p>
      {host.source === "display" ? (
        <p className="text-sm text-muted">
          Share the entire screen, then arm the Windows pointer. The browser asks once to reach the tray on this PC.
        </p>
      ) : null}
      <Tray host={host} />
      <SessionTools
        live={host.status === "live"}
        self="host"
        files={host.files}
        chat={host.chat}
        clip={host.clip}
        audit={host.audit}
        onSendFile={host.sendFile}
        onCancel={host.cancelFile}
        onChat={host.say}
        onClip={host.sendClip}
      />
    </section>
  );
}
