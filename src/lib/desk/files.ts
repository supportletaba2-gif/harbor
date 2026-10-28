/**
 * File pipe beside the control channel.
 * Text frames are JSON (begin / end / cancel). Binary frames are raw chunks
 * for the transfer announced by the latest begin. Nothing is stored on the relay.
 */

export const MAX_FILE_BYTES = 8 * 1024 * 1024;
const CHUNK = 16 * 1024;

export type TransferStatus = "active" | "ready" | "failed" | "cancelled";

export type Transfer = {
  id: string;
  name: string;
  size: number;
  mime: string;
  direction: "in" | "out";
  received: number;
  status: TransferStatus;
  url?: string;
  error?: string;
};

type FileFrame =
  | { t: "begin"; id: string; name: string; size: number; mime: string }
  | { t: "end"; id: string }
  | { t: "cancel"; id: string };

type Incoming = {
  id: string;
  name: string;
  size: number;
  mime: string;
  chunks: Uint8Array[];
  received: number;
};

type Port = {
  readyState: string;
  bufferedAmount: number;
  sendText: (data: string) => void;
  sendBinary: (data: ArrayBuffer) => void;
};

export function safeName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "file";
  const cleaned = base.replace(/[^\w.\- ()]+/g, "").trim().slice(0, 80);
  return cleaned || "file";
}

export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return "0 B";
  if (size < 1024) return `${Math.round(size)} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export class FilePipe {
  private port: Port | null = null;
  private generation = 0;
  private armed = false;
  private outgoingId: string | null = null;
  private incoming: Incoming | null = null;
  private transfers: Transfer[] = [];
  private readonly cancelled = new Set<string>();
  private readonly listeners = new Set<(transfers: Transfer[]) => void>();
  private emitTimer: ReturnType<typeof setTimeout> | null = null;

  subscribe(listener: (transfers: Transfer[]) => void) {
    this.listeners.add(listener);
    listener(this.transfers);
    return () => {
      this.listeners.delete(listener);
    };
  }

  list() {
    return this.transfers;
  }

  attach(channel: RTCDataChannel) {
    const generation = ++this.generation;
    channel.binaryType = "arraybuffer";
    this.port = {
      get readyState() {
        return channel.readyState;
      },
      get bufferedAmount() {
        return channel.bufferedAmount;
      },
      sendText: (data) => channel.send(data),
      sendBinary: (data) => channel.send(data),
    };
    this.incoming = null;
    channel.onmessage = (event) => {
      if (generation === this.generation) this.ingest(event.data);
    };
    channel.onclose = () => {
      if (generation === this.generation) this.failActive("The link closed before the file finished.");
    };
  }

  /** Test seam. The real link uses attach(). */
  open(port: Port) {
    this.generation += 1;
    this.port = port;
    this.incoming = null;
  }

  arm() {
    this.armed = true;
  }

  disarm() {
    this.armed = false;
    this.failActive("The session is not connected.");
  }

  cancel(id: string) {
    const item = this.transfers.find((transfer) => transfer.id === id);
    if (!item || item.status !== "active") return;
    this.cancelled.add(id);
    if (this.incoming?.id === id) this.incoming = null;
    if (this.outgoingId === id) this.outgoingId = null;
    this.patch(id, { status: "cancelled", error: undefined });
    this.post({ t: "cancel", id });
  }

  async sendFile(file: File) {
    const name = safeName(file.name);
    const id = fileId();
    const mime = file.type || "application/octet-stream";
    if (!this.armed || this.port?.readyState !== "open") {
      this.add({
        id,
        name,
        size: file.size,
        mime,
        direction: "out",
        received: 0,
        status: "failed",
        error: "Connect first, then send the file.",
      });
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      this.add({
        id,
        name,
        size: file.size,
        mime,
        direction: "out",
        received: 0,
        status: "failed",
        error: "Files must be 8 MB or smaller.",
      });
      return;
    }
    if (this.outgoingId) return;
    this.outgoingId = id;
    this.cancelled.delete(id);
    this.add({ id, name, size: file.size, mime, direction: "out", received: 0, status: "active" });
    this.post({ t: "begin", id, name, size: file.size, mime });
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      this.outgoingId = null;
      this.patch(id, { status: "failed", error: "That file could not be read." });
      this.post({ t: "cancel", id });
      return;
    }
    if (this.cancelled.has(id) || this.port?.readyState !== "open") {
      this.outgoingId = null;
      return;
    }
    for (let offset = 0; offset < bytes.length; offset += CHUNK) {
      if (this.cancelled.has(id) || this.port?.readyState !== "open") {
        this.outgoingId = null;
        return;
      }
      const port = this.port;
      if (!port || port.readyState !== "open") {
        this.outgoingId = null;
        return;
      }
      await drain(port);
      if (this.cancelled.has(id) || this.port?.readyState !== "open") {
        this.outgoingId = null;
        return;
      }
      const slice = bytes.subarray(offset, Math.min(bytes.length, offset + CHUNK));
      const copy = new ArrayBuffer(slice.byteLength);
      new Uint8Array(copy).set(slice);
      port.sendBinary(copy);
      this.patch(id, { received: Math.min(bytes.length, offset + CHUNK) }, true);
    }
    if (this.cancelled.has(id) || this.port?.readyState !== "open") {
      this.outgoingId = null;
      return;
    }
    this.post({ t: "end", id });
    this.outgoingId = null;
    this.patch(id, { received: file.size, status: "ready" });
  }

  ingest(data: unknown) {
    if (typeof data === "string") {
      const frame = parseFrame(data);
      if (frame) this.onFrame(frame);
      return;
    }
    if (data instanceof ArrayBuffer) {
      this.onChunk(new Uint8Array(data));
      return;
    }
    if (ArrayBuffer.isView(data)) {
      const view = data as ArrayBufferView;
      this.onChunk(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    }
  }

  private onFrame(frame: FileFrame) {
    if (!this.armed && frame.t === "begin") return;
    if (frame.t === "cancel") {
      this.cancelled.add(frame.id);
      if (this.incoming?.id === frame.id) this.incoming = null;
      if (this.outgoingId === frame.id) this.outgoingId = null;
      this.patch(frame.id, { status: "cancelled" });
      return;
    }
    if (frame.t === "begin") {
      if (!isId(frame.id) || !Number.isFinite(frame.size) || frame.size < 0) return;
      const name = safeName(String(frame.name || "file"));
      if (frame.size > MAX_FILE_BYTES) {
        this.add({
          id: frame.id,
          name,
          size: frame.size,
          mime: frame.mime || "application/octet-stream",
          direction: "in",
          received: 0,
          status: "failed",
          error: "That file is over 8 MB.",
        });
        this.post({ t: "cancel", id: frame.id });
        return;
      }
      if (this.incoming) {
        this.post({ t: "cancel", id: frame.id });
        return;
      }
      this.incoming = {
        id: frame.id,
        name,
        size: frame.size,
        mime: typeof frame.mime === "string" ? frame.mime.slice(0, 80) : "application/octet-stream",
        chunks: [],
        received: 0,
      };
      this.add({
        id: frame.id,
        name,
        size: frame.size,
        mime: this.incoming.mime,
        direction: "in",
        received: 0,
        status: "active",
      });
      return;
    }
    const current = this.incoming;
    if (!current || frame.id !== current.id) return;
    if (current.received !== current.size) {
      this.incoming = null;
      this.patch(current.id, { status: "failed", error: "The file arrived incomplete." });
      return;
    }
    const blob = new Blob([concatBytes(current.chunks)], { type: current.mime });
    const url = typeof URL !== "undefined" && typeof URL.createObjectURL === "function" ? URL.createObjectURL(blob) : undefined;
    this.incoming = null;
    this.patch(current.id, { status: "ready", received: current.size, url });
  }

  private onChunk(bytes: Uint8Array) {
    const current = this.incoming;
    if (!current || this.cancelled.has(current.id)) return;
    if (current.received + bytes.byteLength > current.size || current.received + bytes.byteLength > MAX_FILE_BYTES) {
      this.incoming = null;
      this.cancelled.add(current.id);
      this.patch(current.id, { status: "failed", error: "The file was larger than promised." });
      this.post({ t: "cancel", id: current.id });
      return;
    }
    current.chunks.push(bytes);
    current.received += bytes.byteLength;
    this.patch(current.id, { received: current.received }, true);
  }

  private post(frame: FileFrame) {
    if (this.port?.readyState !== "open") return;
    try {
      this.port.sendText(JSON.stringify(frame));
    } catch {
      // The close handler marks anything still moving.
    }
  }

  private add(transfer: Transfer) {
    this.transfers = [...this.transfers, transfer].slice(-12);
    this.emit();
  }

  private patch(id: string, partial: Partial<Transfer>, quiet = false) {
    let found = false;
    this.transfers = this.transfers.map((transfer) => {
      if (transfer.id !== id) return transfer;
      found = true;
      if (transfer.url && partial.url && transfer.url !== partial.url) URL.revokeObjectURL(transfer.url);
      return { ...transfer, ...partial };
    });
    if (!found) return;
    if (quiet) this.emitSoon();
    else this.emit();
  }

  private failActive(error: string) {
    let changed = false;
    this.transfers = this.transfers.map((transfer) => {
      if (transfer.status !== "active") return transfer;
      changed = true;
      return { ...transfer, status: "failed", error };
    });
    this.incoming = null;
    this.outgoingId = null;
    if (changed) this.emit();
  }

  private emitSoon() {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.emit();
    }, 80);
  }

  private emit() {
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    const snapshot = this.transfers;
    for (const listener of this.listeners) listener(snapshot);
  }
}

function parseFrame(raw: string): FileFrame | null {
  try {
    const value = JSON.parse(raw) as Partial<FileFrame>;
    if (!value || typeof value.t !== "string" || typeof value.id !== "string") return null;
    if (value.t === "begin") return value as FileFrame;
    if (value.t === "end" || value.t === "cancel") return { t: value.t, id: value.id };
    return null;
  } catch {
    return null;
  }
}

function isId(id: string) {
  return /^[a-z0-9]{6,16}$/.test(id);
}

function concatBytes(chunks: Uint8Array[]): ArrayBuffer {
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const buffer = new ArrayBuffer(size);
  const out = new Uint8Array(buffer);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer;
}

function fileId() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

function drain(port: Port) {
  if (port.bufferedAmount < 256 * 1024) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const check = () => {
      if (port.readyState !== "open" || port.bufferedAmount < 256 * 1024) resolve();
      else setTimeout(check, 30);
    };
    check();
  });
}
