/**
 * 1:1 remote desk.
 *
 * Signaling (offer / answer / ICE) is only the handshake, relayed at /api/rtc.
 * After that, media and input stay on the peer connection:
 *   - one video track, host → viewer
 *   - one reliable data channel, "control", for the PIN check, quality, and input
 *
 * The PIN travels only on that encrypted channel, and only after it is accepted
 * does the host add the picture. A second channel, "files", carries file bytes.
 * OS mouse injection is not this class's job — it delivers normalized events to the host.
 */
import { defaultIceServers } from "@/lib/multiplayer";
import {
  isAim,
  isPreset,
  isSnapshot,
  peerToken,
  pinsMatch,
  PRESETS,
  type ControlMsg,
  type DeskLinkEvent,
  type DeskSource,
  type QualityPreset,
} from "./types";

type Role = "host" | "viewer";

/** Headless and just-opened links otherwise encode the desk down to 320×180. */
function tuneVideoSdp(sdp: string, bitrate: number): string {
  const eol = sdp.includes("\r\n") ? "\r\n" : "\n";
  const kbps = Math.max(300, Math.round(bitrate / 1000));
  const lines = sdp.split(eol);
  const tuned: string[] = [];
  let video = false;
  for (const line of lines) {
    if (line.startsWith("m=")) video = line.startsWith("m=video");
    if (video && line.startsWith("a=fmtp:") && !line.includes("apt=") && !line.includes("x-google-start-bitrate")) {
      tuned.push(
        `${line};x-google-min-bitrate=${Math.round(kbps / 2)};x-google-start-bitrate=${kbps};x-google-max-bitrate=${kbps}`,
      );
      continue;
    }
    tuned.push(line);
    if (line.startsWith("m=video")) tuned.push(`b=AS:${kbps}`);
  }
  return tuned.join(eol);
}

export type DeskLinkOptions = {
  role: Role;
  room: string;
  pin: string;
  getStream?: () => MediaStream | null;
  getSource?: () => DeskSource;
  onFileChannel?: (channel: RTCDataChannel) => void;
  onEvent: (event: DeskLinkEvent) => void;
};

export class DeskLink {
  private readonly opts: DeskLinkOptions;
  private readonly peerId: string;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private videoSender: RTCRtpSender | null = null;
  private remoteId: string | null = null;
  private cursor = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private authed = false;
  private sawHost = false;
  private failures = 0;
  private pendingIce: RTCIceCandidateInit[] = [];
  private makingOffer = false;
  private preset: QualityPreset = "balanced";
  private quietUntil = 0;
  private connectingSince = 0;
  private readonly skipped = new Set<string>();
  private readonly startedAt = Date.now();

  constructor(opts: DeskLinkOptions) {
    this.opts = opts;
    this.peerId = peerToken(opts.role === "host" ? "h" : "v");
  }

  start() {
    this.opts.onEvent({
      type: "status",
      status: "signaling",
      detail: this.opts.role === "host" ? "Registering this desk…" : "Looking up that ID…",
    });
    void this.tick();
  }

  /** Full teardown. Sends bye when the channel is still open. */
  stop() {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.send({ t: "bye" });
    this.dropPeer();
    void fetch("/api/rtc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "leave", room: this.opts.room, peer: this.peerId }),
      keepalive: true,
    }).catch(() => {});
  }

  send(msg: ControlMsg) {
    if (this.dc?.readyState === "open") {
      try {
        this.dc.send(JSON.stringify(msg));
      } catch {
        // Channel closed between the readyState check and the write.
      }
    }
  }

  async setStream(stream: MediaStream) {
    if (this.authed) await this.publish(stream);
  }

  async setBitrate() {
    await this.applyBitrate();
  }

  private async tick() {
    if (this.closed) return;
    try {
      await this.poll();
      this.failures = 0;
    } catch {
      this.failures += 1;
      if (this.failures === 3) {
        this.opts.onEvent({
          type: "status",
          status: "signaling",
          detail: "Reaching the connection service…",
        });
      }
      if (this.failures >= 8) {
        this.opts.onEvent({
          type: "status",
          status: "error",
          detail: "The connection service isn't responding.",
        });
        this.stop();
        return;
      }
    }
    if (this.closed) return;
    this.watchTimeouts();
    this.timer = setTimeout(() => void this.tick(), this.authed ? 1600 : 400);
  }

  private watchTimeouts() {
    if (this.opts.role !== "viewer" || this.authed || this.closed) return;
    const elapsed = Date.now() - this.startedAt;
    if (!this.sawHost && elapsed > 5000) {
      this.opts.onEvent({ type: "status", status: "error", detail: "No desk is waiting on that ID." });
      this.stop();
    } else if (this.sawHost && elapsed > 12000) {
      this.opts.onEvent({
        type: "status",
        status: "error",
        detail: "The desk didn't accept this connection. It may already be in use.",
      });
      this.stop();
    }
  }

  private async poll() {
    const params = new URLSearchParams({
      room: this.opts.room,
      peer: this.peerId,
      name: this.opts.role,
      since: String(this.cursor),
    });
    const res = await fetch(`/api/rtc?${params}`);
    if (this.closed) return;
    if (!res.ok) throw new Error(`signaling ${res.status}`);
    const body = (await res.json()) as {
      peers: { id: string; name: string }[];
      signals: { id: number; from: string; kind: "offer" | "answer" | "ice"; payload: unknown }[];
    };
    if (this.closed) return;
    const peers = body.peers.filter((p) => p.id !== this.peerId);
    this.reconcile(peers);
    const alive = new Set(body.peers.map((p) => p.id));
    for (const sig of body.signals) {
      this.cursor = Math.max(this.cursor, Number(sig.id));
      if (!alive.has(sig.from)) continue;
      await this.onSignal(sig.from, sig.kind, unwrap(sig.payload));
      if (this.closed) return;
    }
  }

  private reconcile(peers: { id: string; name: string }[]) {
    if (this.opts.role === "host") {
      const viewers = peers.filter((p) => p.name === "viewer");
      if (this.remoteId && !viewers.some((v) => v.id === this.remoteId)) {
        this.dropPeer();
        this.opts.onEvent({
          type: "status",
          status: "waiting",
          detail: "Viewer disconnected. Waiting for the next one.",
        });
      }
      if (this.remoteId && this.pc && !this.authed && this.connectingSince && Date.now() - this.connectingSince > 6000) {
        this.skipped.add(this.remoteId);
        this.dropPeer();
        this.opts.onEvent({
          type: "status",
          status: "waiting",
          detail: "That viewer didn't finish connecting. Waiting for another.",
        });
      }
      const next = viewers.find((v) => !this.skipped.has(v.id));
      if (!this.remoteId && next) {
        this.remoteId = next.id;
        this.connectingSince = Date.now();
        this.ensurePc(true);
        this.opts.onEvent({ type: "status", status: "connecting", detail: "Viewer found. Opening a secure link…" });
      } else if (!this.remoteId && !this.authed && Date.now() > this.quietUntil) {
        this.opts.onEvent({ type: "status", status: "waiting", detail: "Waiting for a viewer with this ID and PIN." });
      }
      return;
    }
    const host = peers.find((p) => p.name === "host");
    this.sawHost = Boolean(host);
    if (!host && this.pc) {
      this.dropPeer();
      this.opts.onEvent({ type: "status", status: "ended", detail: "The desk went offline." });
      this.stop();
      return;
    }
    if (host && !this.pc) {
      this.remoteId = host.id;
      this.ensurePc(false);
      this.opts.onEvent({ type: "status", status: "connecting", detail: "Desk found. Connecting…" });
    } else if (!host) {
      this.opts.onEvent({ type: "status", status: "waiting", detail: "Looking for that desk…" });
    }
  }

  private ensurePc(initiator: boolean) {
    if (this.pc || this.closed) return;
    const pc = new RTCPeerConnection({ iceServers: defaultIceServers() });
    this.pc = pc;
    pc.onicecandidate = (event) => {
      if (!event.candidate || !this.remoteId) return;
      void this.signal(this.remoteId, "ice", event.candidate.toJSON()).catch(() => {});
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") {
        this.opts.onEvent({ type: "status", status: "error", detail: "The secure link failed. Try again." });
        if (this.opts.role === "viewer") this.stop();
        else {
          this.dropPeer();
          this.opts.onEvent({ type: "status", status: "waiting", detail: "Link failed. Waiting for another viewer." });
        }
      }
      if (pc.connectionState === "connected") {
        void this.applyBitrate();
        window.setTimeout(() => void this.applyBitrate(), 400);
      }
    };
    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) this.opts.onEvent({ type: "stream", stream });
    };
    pc.ondatachannel = (event) => {
      if (event.channel.label === "files") this.bindFiles(event.channel);
      else this.bindChannel(event.channel);
    };
    if (initiator) {
      this.bindChannel(pc.createDataChannel("control", { ordered: true }));
      this.bindFiles(pc.createDataChannel("files", { ordered: true }));
      pc.onnegotiationneeded = () => {
        void this.offer();
      };
    }
  }

  private bindFiles(channel: RTCDataChannel) {
    this.opts.onFileChannel?.(channel);
  }

  private bindChannel(channel: RTCDataChannel) {
    if (channel.label !== "control") return;
    this.dc = channel;
    channel.onopen = () => {
      if (this.opts.role === "viewer") {
        this.send({ t: "auth", pin: this.opts.pin });
        this.opts.onEvent({ type: "status", status: "checking", detail: "Checking the PIN…" });
      }
    };
    channel.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      const msg = parseMsg(event.data);
      if (msg) this.onControl(msg);
    };
  }

  private onControl(msg: ControlMsg) {
    if (msg.t === "auth" && this.opts.role === "host") {
      if (!pinsMatch(msg.pin, this.opts.pin)) {
        this.send({ t: "auth-result", ok: false, reason: "Wrong PIN" });
        this.opts.onEvent({
          type: "status",
          status: "waiting",
          detail: "A connection was refused — wrong PIN.",
        });
        this.quietUntil = Date.now() + 4000;
        const rejected = this.remoteId;
        setTimeout(() => {
          if (this.remoteId === rejected) this.dropPeer();
        }, 200);
        return;
      }
      this.authed = true;
      this.send({ t: "auth-result", ok: true });
      this.send({ t: "source", kind: this.opts.getSource?.() ?? "desk" });
      const stream = this.opts.getStream?.();
      if (stream) void this.publish(stream);
      this.opts.onEvent({ type: "status", status: "live", detail: "Connected. Remote input is on." });
      return;
    }
    if (msg.t === "auth-result" && this.opts.role === "viewer") {
      if (!msg.ok) {
        this.opts.onEvent({ type: "status", status: "denied", detail: msg.reason ?? "Wrong PIN." });
        this.stop();
        return;
      }
      this.authed = true;
      this.send({ t: "quality", preset: this.preset });
      this.opts.onEvent({ type: "status", status: "live", detail: "Connected. You are controlling the desk." });
      this.startPing();
      return;
    }
    if (!this.authed) return;
    if (msg.t === "input" && this.opts.role === "host") {
      this.opts.onEvent({ type: "input", input: msg.input });
      return;
    }
    if (msg.t === "quality" && this.opts.role === "host" && isPreset(msg.preset)) {
      this.preset = msg.preset;
      void this.applyBitrate();
      this.opts.onEvent({ type: "quality", preset: msg.preset });
      return;
    }
    if (msg.t === "source" && this.opts.role === "viewer") {
      this.opts.onEvent({ type: "source", kind: msg.kind });
      return;
    }
    if (msg.t === "aim" && isAim(msg.kind)) {
      this.opts.onEvent({ type: "aim", kind: msg.kind });
      return;
    }
    if (msg.t === "chat") {
      const text = typeof msg.text === "string" ? msg.text.trim().slice(0, 400) : "";
      if (!text) return;
      this.opts.onEvent({
        type: "chat",
        from: this.opts.role === "host" ? "viewer" : "host",
        text,
      });
      return;
    }
    if (msg.t === "clip") {
      const text = typeof msg.text === "string" ? msg.text.slice(0, 2000) : "";
      if (!text.trim()) return;
      this.opts.onEvent({
        type: "clip",
        from: this.opts.role === "host" ? "viewer" : "host",
        text,
      });
      return;
    }
    if (msg.t === "note") {
      const text = typeof msg.text === "string" ? msg.text.replace(/\s+/g, " ").trim().slice(0, 80) : "";
      if (!text) return;
      this.opts.onEvent({ type: "note", text });
      return;
    }
    if (msg.t === "metrics" && this.opts.role === "viewer" && isSnapshot(msg.snapshot)) {
      this.opts.onEvent({ type: "metrics", snapshot: msg.snapshot });
      return;
    }
    if (msg.t === "kill" && this.opts.role === "host" && typeof msg.pid === "number") {
      this.opts.onEvent({ type: "kill", pid: msg.pid });
      return;
    }
    if (msg.t === "ping" && this.opts.role === "host") {
      this.send({ t: "pong", n: msg.n });
      return;
    }
    if (msg.t === "pong" && this.opts.role === "viewer") {
      this.opts.onEvent({ type: "rtt", ms: Math.max(0, Math.round(performance.now() - msg.n)) });
      return;
    }
    if (msg.t === "bye") {
      const viewerLeft = this.opts.role === "host";
      this.dropPeer();
      if (viewerLeft) {
        this.opts.onEvent({
          type: "status",
          status: "waiting",
          detail: "Viewer disconnected. Waiting for the next one.",
        });
      } else {
        this.opts.onEvent({ type: "status", status: "ended", detail: "The desk ended the session." });
        this.stop();
      }
    }
  }

  private startPing() {
    const beat = () => {
      if (this.closed || !this.authed) return;
      this.send({ t: "ping", n: performance.now() });
      setTimeout(beat, 2000);
    };
    setTimeout(beat, 2000);
  }

  private async offer() {
    const pc = this.pc;
    const remote = this.remoteId;
    if (!pc || !remote || this.closed) return;
    try {
      this.makingOffer = true;
      const offer = await pc.createOffer();
      if (this.opts.role === "host" && offer.sdp) {
        offer.sdp = tuneVideoSdp(offer.sdp, PRESETS[this.preset].bitrate);
      }
      await pc.setLocalDescription(offer);
      if (pc.localDescription) await this.signal(remote, "offer", pc.localDescription.toJSON());
    } catch {
      // The next negotiationneeded retries a lost offer.
    } finally {
      this.makingOffer = false;
    }
  }

  private async onSignal(from: string, kind: "offer" | "answer" | "ice", payload: unknown) {
    if (this.opts.role === "host" && this.remoteId && from !== this.remoteId) return;
    if (!this.pc) {
      this.remoteId = from;
      this.ensurePc(false);
    }
    const pc = this.pc;
    if (!pc) return;
    if (kind === "offer") {
      if (this.opts.role === "host") return;
      if (this.makingOffer || pc.signalingState !== "stable") {
        await pc.setLocalDescription({ type: "rollback" }).catch(() => {});
      }
      await pc.setRemoteDescription(payload as RTCSessionDescriptionInit);
      await this.flushIce();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await this.signal(from, "answer", pc.localDescription?.toJSON());
      return;
    }
    if (kind === "answer") {
      if (pc.signalingState !== "have-local-offer") return;
      await pc.setRemoteDescription(payload as RTCSessionDescriptionInit);
      await this.flushIce();
      return;
    }
    const candidate = payload as RTCIceCandidateInit;
    if (!pc.remoteDescription) this.pendingIce.push(candidate);
    else await pc.addIceCandidate(candidate).catch(() => {});
  }

  private async flushIce() {
    const pc = this.pc;
    if (!pc) return;
    while (this.pendingIce.length) {
      const candidate = this.pendingIce.shift();
      if (candidate) await pc.addIceCandidate(candidate).catch(() => {});
    }
  }

  private async publish(stream: MediaStream) {
    const pc = this.pc;
    const track = stream.getVideoTracks()[0];
    if (!pc || !track) return;
    track.contentHint = "detail";
    if (this.videoSender) await this.videoSender.replaceTrack(track);
    else this.videoSender = pc.addTrack(track, stream);
    await this.applyBitrate();
  }

  private async applyBitrate() {
    const sender = this.videoSender;
    if (!sender) return;
    const preset = PRESETS[this.preset];
    try {
      const params = sender.getParameters();
      if (!params.encodings?.length) params.encodings = [{}];
      params.degradationPreference = "maintain-resolution";
      const encoding = params.encodings[0];
      encoding.maxBitrate = preset.bitrate;
      encoding.maxFramerate = preset.fps;
      encoding.scaleResolutionDownBy = 1;
      await sender.setParameters(params);
    } catch {
      // Browsers reject this until the sender has negotiated once.
    }
  }

  private async signal(to: string, kind: "offer" | "answer" | "ice", payload: unknown) {
    await fetch("/api/rtc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        op: "signal",
        room: this.opts.room,
        from: this.peerId,
        to,
        kind,
        payload,
      }),
    });
  }

  private dropPeer() {
    this.dc = null;
    this.videoSender = null;
    this.authed = false;
    this.pendingIce = [];
    this.pc?.close();
    this.pc = null;
    this.remoteId = null;
    this.opts.onEvent({ type: "stream", stream: null });
  }
}

function unwrap(payload: unknown): unknown {
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload) as unknown;
    } catch {
      return payload;
    }
  }
  return payload;
}

function parseMsg(raw: string): ControlMsg | null {
  try {
    const value = JSON.parse(raw) as Partial<ControlMsg>;
    if (!value || typeof value.t !== "string") return null;
    return value as ControlMsg;
  } catch {
    return null;
  }
}
