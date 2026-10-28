import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { useHostDesk } from "@/lib/desk/use-host";

type Host = ReturnType<typeof useHostDesk>;

export function Tray({ host }: { host: Host }) {
  const [marked, setMarked] = useState(false);
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
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted">Tray</p>
            <p className="text-base font-medium">Harbor agent</p>
          </div>
          <Button
            variant={host.aim === "page" ? "primary" : "quiet"}
            disabled={!live}
            onClick={() => host.setAim(host.aim === "page" ? "desk" : "page")}
          >
            {host.aim === "page" ? "Page mouse on" : "Arm page mouse"}
          </Button>
        </div>
        <p className="text-sm text-muted">
          Picture and input use a peer-to-peer link. The PIN is checked there before any video is sent. The server only sees the setup messages.
        </p>
        <button type="button" data-agent-mark className="text-left text-sm text-muted" onClick={() => setMarked(true)}>
          {marked ? "Clicked" : "Click target"}
        </button>
        <p className="text-sm text-muted">The page mouse clicks whatever is under the cursor here. It does not move the Windows pointer.</p>
      </div>
    </>
  );
}
