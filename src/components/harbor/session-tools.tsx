import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatBytes, type Transfer } from "@/lib/desk/files";
import type { AuditLine } from "@/lib/desk/audit";
import type { ChatLine, MachineSnapshot } from "@/lib/desk/types";
import { cn } from "@/lib/utils";

type Tab = "files" | "chat" | "machine" | "clip";

export function SessionTools({
  live,
  self,
  files,
  chat,
  clip,
  metrics,
  audit,
  onSendFile,
  onCancel,
  onChat,
  onClip,
  onKill,
}: {
  live: boolean;
  self: "host" | "viewer";
  files: Transfer[];
  chat: ChatLine[];
  clip: string;
  metrics: MachineSnapshot | null;
  audit: AuditLine[];
  onSendFile: (file: File) => void;
  onCancel: (id: string) => void;
  onChat: (text: string) => void;
  onClip: (text: string) => void;
  onKill?: (pid: number) => void;
}) {
  const [tab, setTab] = useState<Tab>("files");
  const [draft, setDraft] = useState("");
  const [clipDraft, setClipDraft] = useState(clip);
  const fileRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const busy = files.some((file) => file.direction === "out" && file.status === "active");
  const open = live || files.length > 0 || chat.length > 0 || metrics !== null || clip.length > 0 || audit.length > 0;

  useEffect(() => {
    setClipDraft(clip);
  }, [clip]);

  useEffect(() => {
    const node = logRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [chat, tab]);

  if (!open) {
    return <p className="text-sm text-muted">Files, chat, clipboard, and the machine report open with the session.</p>;
  }

  const other = self === "host" ? "Viewer" : "Desk";

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      {audit.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">Log</p>
          <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto" data-audit>
            {audit.map((line) => (
              <li key={line.id} className="font-mono text-sm text-fg">
                {line.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {metrics?.alert ? (
        <p className="text-sm text-danger" data-alert>
          {metrics.alert}. Practice machine, not this computer.
        </p>
      ) : null}
      <div className="grid grid-cols-4 gap-2" role="tablist" aria-label="Session tools">
        {(
          [
            ["files", "Files"],
            ["chat", "Chat"],
            ["machine", "Machine"],
            ["clip", "Clip"],
          ] as const
        ).map(([id, label]) => (
          <Button
            key={id}
            role="tab"
            aria-selected={tab === id}
            variant={tab === id ? "quiet" : "ghost"}
            className="w-full px-2"
            onClick={() => setTab(id)}
          >
            {label}
          </Button>
        ))}
      </div>

      {tab === "files" ? (
        <div role="tabpanel" className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              className="sr-only"
              aria-label="Choose a file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) onSendFile(file);
              }}
            />
            <Button className="w-full" disabled={!live || busy} onClick={() => fileRef.current?.click()}>
              {busy ? "Sending…" : "Send a file"}
            </Button>
          </div>
          <p className="text-sm text-muted">Up to 8 MB. The file stays on the encrypted link — it is not kept on a server.</p>
          {files.length === 0 ? (
            <p className="text-sm text-faint">Nothing sent yet.</p>
          ) : (
            <ul className="flex flex-col">
              {files.map((file) => (
                <FileRow key={file.id} file={file} self={self} onCancel={onCancel} />
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {tab === "chat" ? (
        <form
          role="tabpanel"
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            onChat(draft);
            setDraft("");
          }}
        >
          <div ref={logRef} className="flex max-h-48 min-h-24 flex-col gap-2 overflow-y-auto">
            {chat.length === 0 ? (
              <p className="text-sm text-faint">No messages yet.</p>
            ) : (
              chat.map((line) => (
                <p key={line.id} className="text-sm">
                  <span className="text-faint">{line.from === self ? "You" : other}</span>
                  <span className="text-muted"> · </span>
                  <span className="text-fg">{line.text}</span>
                </p>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={400}
              placeholder={live ? "Message" : "Connect to chat"}
              aria-label="Message"
              disabled={!live}
            />
            <Button type="submit" disabled={!live || !draft.trim()}>
              Send
            </Button>
          </div>
        </form>
      ) : null}

      {tab === "machine" ? (
        <div role="tabpanel" className="flex flex-col gap-3">
          {metrics ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="CPU" value={`${metrics.cpu}%`} />
                <Stat label="Memory" value={`${metrics.ramMb}`} unit="MB" />
                <Stat label="Disk" value={`${metrics.diskGb}`} unit="GB" />
              </div>
              <p className="text-sm text-muted">
                Practice machine. Not this computer. {metrics.ramTotalMb} MB memory, {metrics.diskTotalGb} GB disk.
              </p>
              {metrics.procs.length === 0 ? (
                <p className="text-sm text-faint">No processes left.</p>
              ) : (
                <ul className="flex flex-col">
                  {metrics.procs.map((proc) => (
                    <li key={proc.pid} className="flex items-center gap-3 border-t border-line py-2">
                      <span className="w-12 shrink-0 font-mono text-sm text-faint tabular-nums">{proc.pid}</span>
                      <span className="min-w-0 flex-1 truncate text-sm">{proc.name}</span>
                      <span className="font-mono text-sm text-muted tabular-nums">{proc.cpu}%</span>
                      {onKill ? (
                        <Button variant="ghost" onClick={() => onKill(proc.pid)}>
                          End
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="text-sm text-muted">
              {live ? "Waiting for the first report…" : "The report appears once the desk is running."}
            </p>
          )}
        </div>
      ) : null}

      {tab === "clip" ? (
        <form
          role="tabpanel"
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            onClip(clipDraft);
          }}
        >
          <textarea
            value={clipDraft}
            onChange={(event) => setClipDraft(event.target.value)}
            maxLength={2000}
            rows={4}
            aria-label="Clipboard text"
            placeholder={live ? "Text to send" : "Connect to share the clipboard"}
            disabled={!live}
            className="w-full resize-none rounded-sm border border-line bg-bg px-3 py-2 font-mono text-sm text-fg outline-none placeholder:text-faint focus-visible:border-line-strong"
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={!live || !clipDraft.trim()}>
              Send
            </Button>
            <Button
              variant="quiet"
              disabled={!clip}
              onClick={() => {
                void navigator.clipboard.writeText(clip).catch(() => {});
              }}
            >
              Copy
            </Button>
          </div>
          <p className="text-sm text-muted">Text on the encrypted link. It does not paste into the other computer.</p>
        </form>
      ) : null}
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-sm bg-subtle px-3 py-2">
      <p className="text-sm text-muted">{label}</p>
      <p className="font-mono text-sm text-fg tabular-nums">
        {value}
        {unit ? <span className="text-faint"> {unit}</span> : null}
      </p>
    </div>
  );
}

function FileRow({ file, self, onCancel }: { file: Transfer; self: "host" | "viewer"; onCancel: (id: string) => void }) {
  const pct = file.size === 0 ? 100 : Math.min(100, Math.round((file.received / file.size) * 100));
  const way = file.direction === "out" ? (self === "host" ? "To the viewer" : "To the desk") : self === "host" ? "From the viewer" : "From the desk";
  return (
    <li className="flex flex-col gap-2 border-t border-line py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-sm text-fg">{file.name}</p>
        <p className="shrink-0 font-mono text-sm text-muted tabular-nums">{formatBytes(file.size)}</p>
      </div>
      <p className={cn("text-sm", file.status === "failed" ? "text-danger" : "text-muted")}>
        {way}
        {file.status === "active" ? ` · ${pct}%` : ""}
        {file.status === "ready" ? " · done" : ""}
        {file.status === "cancelled" ? " · cancelled" : ""}
        {file.error ? ` · ${file.error}` : ""}
      </p>
      {file.status === "active" ? (
        <div className="h-1 overflow-hidden rounded-xs bg-subtle" aria-hidden>
          <div className="h-full bg-fg" style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      <div className="flex gap-2">
        {file.status === "ready" && file.direction === "in" && file.url ? (
          <Button
            variant="quiet"
            onClick={() => {
              const anchor = document.createElement("a");
              anchor.href = file.url!;
              anchor.download = file.name;
              anchor.click();
            }}
          >
            Save
          </Button>
        ) : null}
        {file.status === "active" ? (
          <Button variant="ghost" onClick={() => onCancel(file.id)}>
            Cancel
          </Button>
        ) : null}
      </div>
    </li>
  );
}
