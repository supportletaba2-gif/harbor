/**
 * Latest-frame bridge. Both browsers can already reach this site, so a JPEG
 * of the shared screen can cross when a direct WebRTC path cannot.
 * The frame is overwritten in place and dropped if it goes stale.
 */
import { z } from "zod";
import { rememberFrame, waitLive } from "@/lib/desk/frame-hub";
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

function emptyFrame(seq: number): Response {
  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store", "x-harbor-seq": String(seq) },
  });
}

function jpegResponse(seq: number, jpeg: string): Response {
  const bytes = Buffer.from(jpeg, "base64");
  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "no-store",
      "x-harbor-seq": String(seq),
    },
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function peekFrame(
  sql: Sql,
  room: string,
  peer: string,
  since: number,
  hostName: string,
): Promise<{ seq: number; jpeg: Buffer | null }> {
  const frames = await sql.query<{ seq: number; viewer: string; fresh: boolean | string | number }>(
    `SELECT seq, viewer,
            updated_at > now() - interval '12 seconds' AS fresh
     FROM desk_frames WHERE room = $1`,
    [room],
  );
  const frame = frames[0];
  const fresh = frame?.fresh === true || frame?.fresh === "t" || frame?.fresh === "true" || frame?.fresh === 1;
  const seq = frame ? Number(frame.seq) : 0;
  const ready = Boolean(frame && fresh && hostName !== "host" && frame.viewer === peer && seq > since);
  if (!ready) return { seq, jpeg: null };
  const bodies = await sql.query<{ seq: number; jpeg: string }>(
    `SELECT seq, jpeg FROM desk_frames WHERE room = $1`,
    [room],
  );
  const row = bodies[0];
  const jpeg = row?.jpeg ?? "";
  const next = row ? Number(row.seq) : seq;
  if (!jpeg.startsWith("/9j/") || next <= since) return { seq: next, jpeg: null };
  return { seq: next, jpeg: Buffer.from(jpeg, "base64") };
}

function packet(seq: number, jpeg: Buffer | null): Uint8Array {
  const size = jpeg?.length ?? 0;
  const bytes = new Uint8Array(8 + size);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, size);
  view.setUint32(4, seq >>> 0);
  if (jpeg && size > 0) bytes.set(jpeg, 8);
  return bytes;
}

/** One open response. New frames are written as they land, so the viewer does not reconnect per picture. */
function streamFrames(
  request: Request,
  sql: Sql,
  room: string,
  peer: string,
  since: number,
  hostName: string,
): Response {
  let cursor = since;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const until = Date.now() + 8000;
      let lastSend = Date.now();
      try {
        while (Date.now() < until && !request.signal.aborted) {
          if ((controller.desiredSize ?? 1) <= 0) {
            await sleep(20);
            continue;
          }
          if (hostName !== "host") {
            const mem = await waitLive(room, peer, cursor, request.signal, 40);
            if (request.signal.aborted) break;
            if (mem && mem.jpeg.length <= 80_000) {
              cursor = mem.seq;
              controller.enqueue(packet(mem.seq, mem.jpeg));
              lastSend = Date.now();
              continue;
            }
          }
          const hit = await peekFrame(sql, room, peer, cursor, hostName);
          if (hit.jpeg && hit.jpeg.length >= 32 && hit.jpeg.length <= 80_000) {
            cursor = hit.seq;
            controller.enqueue(packet(hit.seq, hit.jpeg));
            lastSend = Date.now();
            await sleep(5);
            continue;
          }
          if (Date.now() - lastSend > 2000) {
            controller.enqueue(packet(0, null));
            lastSend = Date.now();
          }
          await sleep(20);
        }
      } catch {
        // The viewer closed the stream. The next open starts from the last seq.
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
      "x-harbor-stream": "1",
    },
  });
}

/** GET latest frame. POST replaces it. A held GET waits briefly for the next one. */
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
          hold: z.enum(["0", "1"]).default("0"),
          stream: z.enum(["0", "1"]).default("0"),
        })
        .safeParse({
          room: url.searchParams.get("room"),
          peer: url.searchParams.get("peer"),
          since: url.searchParams.get("since") ?? 0,
          hold: url.searchParams.get("hold") ?? "0",
          stream: url.searchParams.get("stream") ?? "0",
        });
      if (!parsed.success) return json({ error: "invalid query" }, 400);
      const { room, peer, since, hold, stream } = parsed.data;
      const self = await authedPeer(sql, room, peer, key);
      if (!self) return emptyFrame(0);
      if (stream === "1") return streamFrames(request, sql, room, peer, since, self.name);
      const until = Date.now() + (hold === "1" ? 3000 : 0);
      for (;;) {
        const hit = await peekFrame(sql, room, peer, since, self.name);
        if (hit.jpeg) return jpegResponse(hit.seq, hit.jpeg.toString("base64"));
        if (hold !== "1" || Date.now() >= until || request.signal.aborted) return emptyFrame(hit.seq);
        await sleep(20);
      }
    }

    if (request.method === "POST") {
      const url = new URL(request.url);
      const type = request.headers.get("content-type") ?? "";
      let msg: { room: string; peer: string; viewer: string; seq: number; jpeg: string } | null = null;
      if (type.includes("image/jpeg")) {
        const parsed = z
          .object({
            room: ID,
            peer: ID,
            viewer: ID,
            seq: z.coerce.number().int().positive(),
          })
          .safeParse({
            room: url.searchParams.get("room"),
            peer: url.searchParams.get("peer"),
            viewer: url.searchParams.get("viewer"),
            seq: url.searchParams.get("seq"),
          });
        if (!parsed.success) return json({ error: "invalid request" }, 400);
        const bytes = new Uint8Array(await request.arrayBuffer());
        if (bytes.byteLength < 32 || bytes.byteLength > 80_000 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
          return json({ error: "invalid request" }, 400);
        }
        msg = { ...parsed.data, jpeg: Buffer.from(bytes).toString("base64") };
      } else {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ error: "invalid JSON" }, 400);
        }
        const parsed = frameSchema.safeParse(body);
        if (!parsed.success) return json({ error: "invalid request" }, 400);
        msg = parsed.data;
      }
      const self = await authedPeer(sql, msg.room, msg.peer, key);
      if (!self || self.name !== "host") return json({ error: "not the desk" }, 403);
      const raw = Buffer.from(msg.jpeg, "base64");
      rememberFrame(msg.room, msg.seq, raw, msg.viewer);
      await sql.query(
        `INSERT INTO desk_frames (room, seq, jpeg, viewer, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (room) DO UPDATE
           SET seq = EXCLUDED.seq, jpeg = EXCLUDED.jpeg, viewer = EXCLUDED.viewer, updated_at = now()
         WHERE desk_frames.seq < EXCLUDED.seq`,
        [msg.room, msg.seq, msg.jpeg, msg.viewer],
      );
      return json({ ok: true });
    }

    return json({ error: "method not allowed" }, 405);
  } catch (error) {
    console.error("[bridge]", error);
    return json({ error: "bridge failed" }, 500);
  }
}
