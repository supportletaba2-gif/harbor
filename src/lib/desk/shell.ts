/** Practice shell. It does not run commands on this computer. */

export function runShell(line: string): { clear: boolean; lines: string[] } {
  const trimmed = line.trim();
  if (!trimmed) return { clear: false, lines: [] };
  const space = trimmed.indexOf(" ");
  const cmd = (space === -1 ? trimmed : trimmed.slice(0, space)).toLowerCase();
  const arg = space === -1 ? "" : trimmed.slice(space + 1);
  switch (cmd) {
    case "help":
      return { clear: false, lines: ["echo  date  whoami  hostname  pwd  ls  clear"] };
    case "echo":
      return { clear: false, lines: [arg] };
    case "date":
      return { clear: false, lines: [clock()] };
    case "whoami":
      return { clear: false, lines: ["harbor"] };
    case "hostname":
      return { clear: false, lines: ["practice-desk"] };
    case "pwd":
      return { clear: false, lines: ["/home/harbor"] };
    case "ls":
      return { clear: false, lines: ["notes", "bin"] };
    case "clear":
      return { clear: true, lines: [] };
    default:
      return { clear: false, lines: [`${cmd}: not found`] };
  }
}

function clock(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
