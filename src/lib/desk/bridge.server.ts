/**
 * Latest-frame bridge. Both browsers can already reach this site, so a JPEG
 * of the shared screen can cross when a direct WebRTC path cannot.
 * The frame is overwritten in place and dropped if it goes stale.
 */
import { z } from "zod";
import { dbSource, getSql, type Sql } from "@/lib/db";

const ID = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const JPEG = z.string().regex(/^\/9j\/[A-Za-z0-9+/]+={0,2}$/).max(100_000);

const frameSchema = z.object({
  op: z.literal("frame"),
  room: ID,
  peer: ID,
  viewer: ID,
  seq: z.number().int().positive(),
  jpeg: JPEG,
});

const globalRef = globalThis as typeof globalThis & {
  __bridgeSchemaPromise__?: Promise<void>;
};

function ensureSchema(sql: Sql): Promise<void> {
  globalRef.__bridgeSchemaPromise__ ??= (async () => {
    await sql.query(`ALTER TABLE webrtc_peers ADD COLUMN IF NOT EXISTS secret TEXT`);
    await sql.query(
      `CREATE TABLE IF NOT EXISTS desk_frames (
         room TEXT PRIMARY KEY,
         seq BIGINT NOT NULL,
         jpeg TEXT NOT NULL,
         viewer TEXT NOT NULL DEFAULT '',
         updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );
  })().catch((err) => {
    globalRef.__bridgeSchemaPromise__ = undefined;
    throw err;
  });
  return globalRef.__bridgeSchemaPromise__;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function keyOf(request: Request): string | null {
  const raw = request.headers.get("x-harbor-key") ?? "";
  return ID.safeParse(raw).success ? raw : null;
}

function sharedStore(): Response | null {
  if (process.env.VERCEL && dbSource !== "neon") {
    return json({ ok: false, reason: "The shared database is not attached to this publish." }, 503);
  }
  return null;
}

async function authedPeer(sql: Sql, room: string, peer: string, key: string) {
  const rows = await sql.query<{ name: string }>(
    `SELECT name FROM webrtc_peers
     WHERE room = $1 AND peer_id = $2 AND secret = $3
       AND last_seen > now() - make_interval(secs => 30)`,
    [room, peer, key],
  );
  return rows[0] ?? null;
}

/** GET latest frame. POST replaces it. */
export async function handleBridge(request: Request): Promise<Response> {
  try {
    const blocked = sharedStore();
    if (blocked) return blocked;
    const key = keyOf(request);
    if (!key) return json({ error: "missing key" }, 401);
    const sql = await getSql();
    await ensureSchema(sql);

    if (request.method === "GET") {
      const url = new URL(request.url);
      const parsed = z
        .object({
          room: ID,
          peer: ID,
          since: z.coerce.number().int().min(0).default(0),
        })
        .safeParse({
          room: url.searchParams.get("room"),
          peer: url.searchParams.get("peer"),
          since: url.searchParams.get("since") ?? 0,
        });
      if (!parsed.success) return json({ error: "invalid query" }, 400);
      const { room, peer, since } = parsed.data;
      const self = await authedPeer(sql, room, peer, key);
      if (!self) return json({ seq: 0 });
      const frames = await sql.query<{ seq: number; jpeg: string; viewer: string; fresh: boolean | string | number }>(
        `SELECT seq, jpeg, viewer,
                updated_at > now() - interval '12 seconds' AS fresh
         FROM desk_frames WHERE room = $1`,
        [room],
      );
      const frame = frames[0];
      const fresh = frame?.fresh === true || frame?.fresh === "t" || frame?.fresh === "true" || frame?.fresh === 1;
      if (!frame || !fresh) return json({ seq: 0 });
      if (self.name !== "host" && frame.viewer !== peer) return json({ seq: Number(frame.seq) });
      if (Number(frame.seq) <= since) return json({ seq: Number(frame.seq) });
      return json({ seq: Number(frame.seq), jpeg: frame.jpeg });
    }

    if (request.method === "POST") {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid JSON" }, 400);
      }
      const parsed = frameSchema.safeParse(body);
      if (!parsed.success) return json({ error: "invalid request" }, 400);
      const msg = parsed.data;
      const self = await authedPeer(sql, msg.room, msg.peer, key);
      if (!self || self.name !== "host") return json({ error: "not the desk" }, 403);
      await sql.query(
        `INSERT INTO desk_frames (room, seq, jpeg, viewer, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (room) DO UPDATE
           SET seq = EXCLUDED.seq, jpeg = EXCLUDED.jpeg, viewer = EXCLUDED.viewer, updated_at = now()
         WHERE desk_frames.updated_at < now() - interval '200 milliseconds'`,
        [msg.room, msg.seq, msg.jpeg, msg.viewer],
      );
      if (Math.random() < 0.02) {
        await sql.query(`DELETE FROM desk_frames WHERE updated_at < now() - make_interval(secs => 30)`);
      }
      return json({ ok: true });
    }

    return json({ error: "method not allowed" }, 405);
  } catch (error) {
    console.error("[bridge]", error);
    return json({ error: "bridge failed" }, 500);
  }
}
