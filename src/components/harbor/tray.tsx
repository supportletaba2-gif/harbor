import { Button } from "@/components/ui/button";
import type { useHostDesk } from "@/lib/desk/use-host";

type Host = ReturnType<typeof useHostDesk>;

export function Tray({ host }: { host: Host }) {
  const live = host.status === "live";

  return (
    <>
      {host.aim === "page" && host.cursor ? (
        <div
          className="pointer-events-none fixed z-50 text-fg"
          style={{ left: host.cursor.x, top: host.cursor.y }}
          data-agent-cursor
          data-agent-x={Math.round(host.cursor.x)}
          data-agent-y={Math.round(host.cursor.y)}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
            <path d="M2 1 L2 13 L6 10 L8 15 L10 14 L8 9 L13 9 Z" fill="currentColor" />
          </svg>
        </div>
      ) : null}
      <div className="flex flex-col gap-3 border-t border-line pt-4">
        <div>
          <p className="text-sm text-muted">Tray</p>
          <p className="text-base font-medium">Harbor agent</p>
        </div>
        <Button
          variant={host.aim === "page" ? "primary" : "quiet"}
          className="w-full"
          disabled={!live}
          onClick={() => host.setAim(host.aim === "page" ? "desk" : "page")}
        >
          {host.aim === "page" ? "Page mouse on" : "Arm page mouse"}
        </Button>
        <Button
          variant={host.aim === "windows" ? "primary" : "quiet"}
          className="w-full"
          disabled={!live}
          onClick={() => host.setAim(host.aim === "windows" ? "desk" : "windows")}
        >
          {host.aim === "windows" ? "Windows pointer on" : "Arm Windows pointer"}
        </Button>
        <p className="text-sm text-muted">
          Picture and input use a peer-to-peer link. The PIN is checked there before any video is sent. The server only sees the setup messages.
        </p>
        <p className="text-sm text-muted">
          {host.aim === "windows"
            ? host.pointerReady
              ? "The tray on this PC has the pointer. Share the entire screen so the picture matches the cursor."
              : "The tray is not answering on this PC. Install it, then allow local network access when the browser asks."
            : "The page mouse clicks this page. The Windows pointer needs the Harbor tray on this computer."}
        </p>
      </div>
    </>
  );
}
