/** Neon strings often include channel_binding, which node-postgres cannot use. */
/** @param {string} raw */
export function postgresUrl(raw) {
  const trimmed = String(raw ?? "").trim();
  const q = trimmed.indexOf("?");
  const base = q === -1 ? trimmed : trimmed.slice(0, q);
  const params = new URLSearchParams(q === -1 ? "" : trimmed.slice(q + 1));
  params.delete("channel_binding");
  if (!params.has("sslmode")) params.set("sslmode", "require");
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/** @param {string} connectionString */
export function pgSsl(connectionString) {
  if (/@(?:localhost|127\.0\.0\.1)(?::|\/|$)/.test(connectionString)) return undefined;
  return { rejectUnauthorized: false };
}
