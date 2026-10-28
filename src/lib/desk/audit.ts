/** One line in the session log. Times are local. The log is not a security audit. */

export type AuditLine = {
  id: string;
  text: string;
};

export function auditText(text: string, now = new Date()): string {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!clean) return "";
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${hh}:${mm} ${clean}`;
}
