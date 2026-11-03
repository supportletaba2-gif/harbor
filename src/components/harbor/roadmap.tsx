const STEPS = [
  { n: "1", title: "Desk", detail: "Screen, PIN, control", tone: "done" },
  { n: "2", title: "Files", detail: "Send both ways", tone: "done" },
  { n: "3", title: "Monitor", detail: "CPU, processes", tone: "done" },
  { n: "4", title: "Shell", detail: "Terminal, clip", tone: "done" },
  { n: "5", title: "Tray", detail: "Page mouse", tone: "done" },
] as const;

export function Roadmap() {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm text-muted">Build</h2>
      <ol className="grid grid-cols-5 gap-2">
        {STEPS.map((step) => (
          <li key={step.n} className="min-w-0">
            <p
              className={
                step.tone === "done" ? "text-sm font-medium text-fg" : "text-sm text-faint"
              }
            >
              {step.n} {step.title}
            </p>
            <p className="text-sm text-faint">{step.detail}</p>
          </li>
        ))}
      </ol>
      <p className="max-w-xl text-sm text-muted">
        On the shared PC, click Allow the pointer and choose Allow. The Harbor tray must be running, and the share must be the entire screen. Until then the other computer can see the screen but cannot move the mouse.
      </p>
    </section>
  );
}