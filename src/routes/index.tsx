import { createFileRoute } from "@tanstack/react-router";
import { HostPanel } from "@/components/harbor/host-panel";
import { ViewerPanel } from "@/components/harbor/viewer-panel";
import { useHostDesk } from "@/lib/desk/use-host";
import { useViewerDesk } from "@/lib/desk/use-viewer";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const host = useHostDesk();
  const viewer = useViewerDesk();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-4 py-6 sm:px-8 sm:py-10">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-8 place-items-center rounded-sm border border-line" aria-hidden>
            <span className="size-3 rounded-xs border border-fg" />
          </span>
          <h1 className="font-display text-2xl font-medium tracking-tight">Harbor</h1>
          <span className="rounded-sm border border-line px-2 py-0.5 text-sm text-muted">Alpha</span>
        </div>
        <p className="max-w-xl text-base text-muted">
          One computer shares its display. The other opens it with that ID and PIN.
        </p>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <HostPanel host={host} />
        <ViewerPanel viewer={viewer} />
      </div>
    </main>
  );
}
