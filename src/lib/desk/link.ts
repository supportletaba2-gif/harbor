/**
 * 1:1 remote desk.
 *
 * Signaling (offer / answer / ICE / control) is relayed at /api/rtc.
 * A direct peer connection carries full-rate video when a path exists.
 * When it does not, the same control messages and a JPEG of the screen
 * cross through Harbor, which both computers can already reach.
 * The PIN is checked only on the host. OS mouse injection is not this class's job.
 */
import { defaultIceServers } from "@/lib/multiplayer";
import {
  isAim,
  isPreset,
  isSnapshot,
  groupId,
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
  private outboundIce: RTCIceCandidateInit[] = [];
  private flushingIce = false;
  private makingOffer = false;
  private preset: QualityPreset = "balanced";
  private quietUntil = 0;
  private connectingSince = 0;
  private iceRestarts = 0;
  private recovering = false;
  private recoverTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly key: string;
  private direct = false;
  private authedAt = 0;
  private frameWaitFrom = 0;
  private gotFrame = false;
  private frameSince = 0;
  private frameSeq = 0;
  private frameBusy = false;
  private lastAuth = 0;
  private pendingMove: ControlMsg | null = null;
  private moveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly skipped = new Set<string>();
  private readonly startedAt = Date.now();

  constructor(opts: DeskLinkOptions) {
    this.opts = opts;
    this.peerId = peerToken(opts.role === "host" ? "h" : "v");
    this.key = makeKey();
  }

  start() {
    this.opts.onEvent({
      type: "status",
      status: "signaling",
      detail: this.opts.role === "host" ? "Registering this desk…" : "Looking up that ID…",
    });
    void this.tick();
  }

  /** Full teardown. Sends bye when a peer is still known. */
  stop() {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.send({ t: "bye" });
    const peer = this.peerId;
    const room = this.opts.room;
    const key = this.key;
    this.dropPeer();
    void fetch("/api/rtc", {
      method: "POST",
      headers: { "content-type": "application/json", "x-harbor-key": key },
      body: JSON.stringify({ op: "leave", room, peer }),
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
      return;
    }
    if (!this.remoteId || (this.closed && msg.t !== "bye")) return;
    if (msg.t === "input" && msg.input.kind === "move") {
      this.pendingMove = msg;
      if (this.moveTimer) return;
      this.moveTimer = setTimeout(() => {
        this.moveTimer = null;
        const next = this.pendingMove;
        this.pendingMove = null;
        if (next) this.relay(next);
      }, 80);
      return;
    }
    this.relay(msg);
  }

  /** Latest JPEG, raw base64 starting with /9j/. Ignored once a direct link is up. */
  postFrame(jpeg: string) {
    if (this.closed || !this.authed || !this.remoteId || this.direct || this.frameBusy) return;
    if (!jpeg.startsWith("/9j/") || jpeg.length > 100_000) return;
    const seq = ++this.frameSeq;
    const viewer = this.remoteId;
    this.frameBusy = true;
    void fetch("/api/bridge", {
      method: "POST",
      headers: this.headers(true),
      body: JSON.stringify({
        op: "frame",
        room: this.opts.room,
        peer: this.peerId,
        viewer,
        seq,
        jpeg,
      }),
    })
      .catch(() => {})
      .finally(() => {
        this.frameBusy = false;
      });
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
      void this.flushOutboundIce();
    } catch (error) {
      this.failures += 1;
      const reason = error instanceof Error ? error.message : "signaling";
      if (this.failures >= 3) {
        this.opts.onEvent({
          type: "status",
          status: "error",
          detail: `The connection service failed. ${reason}`.slice(0, 180),
        });
        this.stop();
        return;
      }
    }
    if (this.closed) return;
    if (this.opts.role === "viewer" && this.remoteId && !this.authed && Date.now() - this.lastAuth >= 1200) {
      this.lastAuth = Date.now();
      this.send({ t: "auth", pin: this.opts.pin });
    }
    if (this.opts.role === "viewer" && this.authed && !this.direct) await this.pullFrame();
    if (this.closed) return;
    if (this.failures === 0) this.watchTimeouts();
    const wait = this.authed && !this.direct ? 250 : this.authed ? 1200 : 400;
    this.timer = setTimeout(() => void this.tick(), wait);
  }

  private watchTimeouts() {
    if (this.closed) return;
    if (this.opts.role === "viewer" && this.authed && !this.direct && !this.gotFrame) {
      const since = this.frameWaitFrom || this.authedAt;
      if (since && Date.now() - since > 20000) {
        this.opts.onEvent({
          type: "status",
          status: "error",
          detail: "The picture could not be delivered. Try Connect again.",
        });
        this.stop();
        return;
      }
    }
    if (this.opts.role !== "viewer" || this.authed) return;
    const elapsed = Date.now() - this.startedAt;
    if (!this.sawHost && elapsed > 8000 && elapsed < 45000) {
      this.opts.onEvent({
        type: "status",
        status: "waiting",
        detail: `Still looking for ${groupId(this.opts.room)}. On the other computer, choose Share this display and wait until it says Waiting.`,
      });
    } else if (!this.sawHost && elapsed > 45000) {
      this.opts.onEvent({
        type: "status",
        status: "error",
        detail: `No desk is waiting on ${groupId(this.opts.room)}. On that computer, choose Share this display and copy the ID only after it says Waiting.`,
      });
      this.stop();
    } else if (this.sawHost && !this.authed && elapsed > 50000) {
      this.opts.onEvent({
        type: "status",
        status: "error",
        detail: "The secure link could not cross these two networks. On the sharing computer, wait until it says Waiting, then try Connect again.",
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
    const res = await fetch(`/api/rtc?${params}`, { headers: this.headers() });
    if (this.closed) return;
    if (!res.ok) {
      let reason = `signaling ${res.status}`;
      try {
        const body = (await res.json()) as { reason?: unknown };
        if (typeof body.reason === "string" && body.reason) reason = body.reason;
      } catch {
        // The status is enough when the body is not JSON.
      }
      throw new Error(reason);
    }
    const body = (await res.json()) as {
      peers: { id: string; name: string }[];
      signals: { id: number; from: string; kind: "offer" | "answer" | "ice" | "ctrl"; payload: unknown }[];
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
      if (this.remoteId && this.pc && !this.authed && this.connectingSince) {
        const age = Date.now() - this.connectingSince;
        const state = this.pc.connectionState;
        const stillOpening = state === "new" || state === "connecting";
        if (
          !this.recovering &&
          !stillOpening &&
          state !== "connected" &&
          this.iceRestarts >= 1 &&
          age > 20000
        ) {
          this.skipped.add(this.remoteId);
          this.dropPeer();
          this.opts.onEvent({
            type: "status",
            status: "waiting",
            detail: "That viewer could not open a link. Waiting for another.",
          });
        } else if (age > 45000) {
          this.skipped.add(this.remoteId);
          this.dropPeer();
          this.opts.onEvent({
            type: "status",
            status: "waiting",
            detail: "That viewer didn't finish connecting. Waiting for another.",
          });
        }
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
      if (!this.authed) {
        this.lastAuth = Date.now();
        this.send({ t: "auth", pin: this.opts.pin });
      }
    } else if (!host) {
      this.opts.onEvent({ type: "status", status: "waiting", detail: "Looking for that desk…" });
    }
  }

  private ensurePc(initiator: boolean) {
    if (this.pc || this.closed) return;
    const pc = new RTCPeerConnection({ iceServers: defaultIceServers() });
    this.pc = pc;
    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      this.outboundIce.push(event.candidate.toJSON());
      void this.flushOutboundIce();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") {
        this.onLinkFailed(pc);
        return;
      }
      if (pc.connectionState === "connected") {
        this.recovering = false;
        this.iceRestarts = 0;
        if (this.recoverTimer) {
          clearTimeout(this.recoverTimer);
          this.recoverTimer = null;
        }
        const becameDirect = !this.direct;
        this.direct = true;
        void this.applyBitrate();
        window.setTimeout(() => void this.applyBitrate(), 400);
        if (this.authed && becameDirect) {
          this.opts.onEvent({ type: "bridge", on: false });
          this.opts.onEvent({
            type: "status",
            status: "live",
            detail:
              this.opts.role === "host"
                ? "Connected. Remote input is on."
                : "Connected. You are controlling the desk.",
          });
        }
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
      if (this.opts.role !== "viewer" || this.authed) return;
      this.send({ t: "auth", pin: this.opts.pin });
      this.opts.onEvent({ type: "status", status: "checking", detail: "Checking the PIN…" });
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
      if (this.authed) {
        this.send({ t: "auth-result", ok: true });
        return;
      }
      this.authed = true;
      this.authedAt = Date.now();
      this.send({ t: "auth-result", ok: true });
      this.send({ t: "source", kind: this.opts.getSource?.() ?? "desk" });
      const stream = this.opts.getStream?.();
      if (stream) void this.publish(stream);
      const directNow = this.pc?.connectionState === "connected";
      this.direct = Boolean(directNow);
      if (!directNow) this.frameWaitFrom = this.authedAt;
      this.opts.onEvent({ type: "bridge", on: !directNow });
      this.opts.onEvent({
        type: "status",
        status: "live",
        detail: directNow ? "Connected. Remote input is on." : "Connected. The screen is coming through Harbor.",
      });
      return;
    }
    if (msg.t === "auth-result" && this.opts.role === "viewer") {
      if (!msg.ok) {
        this.opts.onEvent({ type: "status", status: "denied", detail: msg.reason ?? "Wrong PIN." });
        this.stop();
        return;
      }
      if (this.authed) return;
      this.authed = true;
      this.authedAt = Date.now();
      this.send({ t: "quality", preset: this.preset });
      const directNow = this.pc?.connectionState === "connected";
      this.direct = Boolean(directNow);
      if (!directNow) this.frameWaitFrom = this.authedAt;
      this.opts.onEvent({ type: "bridge", on: !directNow });
      this.opts.onEvent({
        type: "status",
        status: "live",
        detail: directNow ? "Connected. You are controlling the desk." : "Connected. You are controlling the desk.",
      });
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
    if (msg.t === "pointer" && this.opts.role === "viewer" && typeof msg.ok === "boolean") {
      this.opts.onEvent({ type: "pointer", ok: msg.ok });
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
      await this.waitForCandidates(pc);
      if (this.closed || this.pc !== pc || this.remoteId !== remote) return;
      if (pc.localDescription) await this.signal(remote, "offer", pc.localDescription.toJSON());
    } catch {
      // The next negotiationneeded retries a lost offer.
    } finally {
      this.makingOffer = false;
    }
  }

  private async onSignal(from: string, kind: "offer" | "answer" | "ice" | "ctrl", payload: unknown) {
    if (kind === "ctrl") {
      if (this.opts.role === "host" && this.remoteId && from !== this.remoteId) return;
      if (!this.remoteId) this.remoteId = from;
      const msg = asControl(payload);
      if (msg) this.onControl(msg);
      return;
    }
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
      await this.waitForCandidates(pc);
      if (this.closed || this.pc !== pc) return;
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

  private onLinkFailed(pc: RTCPeerConnection) {
    if (this.closed || this.pc !== pc) return;
    const wasDirect = this.direct;
    this.direct = false;
    if (this.authed) {
      this.frameWaitFrom = Date.now();
      this.gotFrame = this.gotFrame && !wasDirect;
      this.opts.onEvent({ type: "bridge", on: true });
      if (wasDirect) {
        this.opts.onEvent({
          type: "status",
          status: "live",
          detail: "Direct path dropped. The screen is coming through Harbor.",
        });
      }
    } else if (!this.recovering) {
      this.opts.onEvent({
        type: "status",
        status: "connecting",
        detail: "Direct path failed. Trying another route…",
      });
    }
    if (this.iceRestarts >= 1 || this.recovering) return;
    this.iceRestarts += 1;
    this.recovering = true;
    this.pendingIce = [];
    this.outboundIce = [];
    if (this.opts.role === "host") void this.restartOffer(pc);
    this.recoverTimer = setTimeout(() => {
      this.recoverTimer = null;
      this.recovering = false;
    }, 15000);
  }

  private async restartOffer(pc: RTCPeerConnection) {
    try {
      if (pc.signalingState === "have-local-offer") {
        await pc.setLocalDescription({ type: "rollback" }).catch(() => {});
      }
      if (this.closed || this.pc !== pc) return;
      pc.restartIce();
    } catch {
      // The explicit offer below covers a restart the browser ignored.
    }
    window.setTimeout(() => {
      if (this.closed || this.pc !== pc || this.makingOffer || pc.signalingState !== "stable") return;
      void this.offer();
    }, 400);
  }

  private async waitForCandidates(pc: RTCPeerConnection) {
    if (pc.iceGatheringState === "complete") return;
    await new Promise<void>((resolve) => {
      const finish = () => {
        pc.removeEventListener("icegatheringstatechange", onState);
        window.clearTimeout(timer);
        resolve();
      };
      const onState = () => {
        if (pc.iceGatheringState === "complete") finish();
      };
      pc.addEventListener("icegatheringstatechange", onState);
      const timer = window.setTimeout(finish, 2500);
    });
  }

  private async flushOutboundIce() {
    if (this.flushingIce || !this.remoteId || this.closed) return;
    this.flushingIce = true;
    try {
      while (this.outboundIce.length && this.remoteId && !this.closed) {
        const candidate = this.outboundIce[0];
        try {
          await this.signal(this.remoteId, "ice", candidate);
          this.outboundIce.shift();
        } catch {
          break;
        }
      }
    } finally {
      this.flushingIce = false;
    }
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

  private async signal(to: string, kind: "offer" | "answer" | "ice" | "ctrl", payload: unknown) {
    let last = "signal failed";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0 && this.closed) return;
      try {
        const res = await fetch("/api/rtc", {
          method: "POST",
          headers: this.headers(true),
          body: JSON.stringify({
            op: "signal",
            room: this.opts.room,
            from: this.peerId,
            to,
            kind,
            payload,
          }),
        });
        if (res.ok) return;
        last = `signal ${res.status}`;
      } catch (error) {
        last = error instanceof Error ? error.message : "signal failed";
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
    throw new Error(last);
  }

  private dropPeer() {
    const bridging = this.authed && !this.direct;
    if (this.recoverTimer) clearTimeout(this.recoverTimer);
    this.recoverTimer = null;
    this.recovering = false;
    this.iceRestarts = 0;
    this.dc = null;
    this.videoSender = null;
    this.authed = false;
    this.direct = false;
    this.authedAt = 0;
    this.frameWaitFrom = 0;
    this.gotFrame = false;
    this.frameSince = 0;
    this.frameBusy = false;
    this.pendingMove = null;
    if (this.moveTimer) clearTimeout(this.moveTimer);
    this.moveTimer = null;
    this.pendingIce = [];
    this.outboundIce = [];
    this.pc?.close();
    this.pc = null;
    this.remoteId = null;
    if (bridging) this.opts.onEvent({ type: "bridge", on: false });
    this.opts.onEvent({ type: "stream", stream: null });
  }

  private headers(json = false): HeadersInit {
    const headers: Record<string, string> = { "x-harbor-key": this.key };
    if (json) headers["content-type"] = "application/json";
    return headers;
  }

  private relay(msg: ControlMsg) {
    if (!this.remoteId) return;
    if (this.closed && msg.t !== "bye") return;
    const allowed = msg.t === "auth" || msg.t === "auth-result" || msg.t === "bye" || this.authed;
    if (!allowed) return;
    void this.signal(this.remoteId, "ctrl", msg).catch(() => {});
  }

  private async pullFrame() {
    if (this.frameBusy || this.closed || !this.authed || this.direct) return;
    this.frameBusy = true;
    try {
      const params = new URLSearchParams({
        room: this.opts.room,
        peer: this.peerId,
        since: String(this.frameSince),
      });
      const res = await fetch(`/api/bridge?${params}`, { headers: this.headers() });
      if (!res.ok || this.closed || this.direct) return;
      const body = (await res.json()) as { seq?: unknown; jpeg?: unknown };
      const seq = typeof body.seq === "number" ? body.seq : Number(body.seq);
      if (!Number.isFinite(seq)) return;
      if (typeof body.jpeg === "string" && body.jpeg.startsWith("/9j/")) {
        this.frameSince = seq;
        this.gotFrame = true;
        this.opts.onEvent({ type: "frame", jpeg: `data:image/jpeg;base64,${body.jpeg}` });
      }
    } catch {
      // The next tick asks again.
    } finally {
      this.frameBusy = false;
    }
  }
}

function asControl(payload: unknown): ControlMsg | null {
  const value = unwrap(payload);
  if (!value || typeof value !== "object") return null;
  if (typeof (value as { t?: unknown }).t !== "string") return null;
  return value as ControlMsg;
}

function makeKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
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
