import { useCallback, useEffect, useRef, useState } from "react";
import { auditText, type AuditLine } from "./audit";
import { FilePipe, type Transfer } from "./files";
import { aimNote } from "./windows-pointer";
import { DeskLink } from "./link";
import {
  type Aim,
  type ChatLine,
  type DeskInput,
  type DeskSource,
  type LinkStatus,
  type MachineSnapshot,
  type QualityPreset,
} from "./types";

export function useViewerDesk() {
  const [remoteId, setRemoteId] = useState("");
  const [pin, setPin] = useState("");
  const [status, setStatus] = useState<LinkStatus>("idle");
  const [detail, setDetail] = useState("On the other computer, share the display first. Then paste that ID and PIN.");
  const [quality, setQuality] = useState<QualityPreset>("balanced");
  const [source, setSource] = useState<DeskSource>("desk");
  const [rtt, setRtt] = useState<number | null>(null);
  const [fps, setFps] = useState<number | null>(null);
  const [hasStream, setHasStream] = useState(false);
  const [files, setFiles] = useState<Transfer[]>([]);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [clip, setClip] = useState("");
  const [metrics, setMetrics] = useState<MachineSnapshot | null>(null);
  const [aim, setAimState] = useState<Aim>("desk");
  const [audit, setAudit] = useState<AuditLine[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const linkRef = useRef<DeskLink | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pipeRef = useRef(new FilePipe());
  const statusRef = useRef<LinkStatus>("idle");
  const fileState = useRef(new Map<string, string>());
  const sendNoteRef = useRef<(text: string) => void>(() => {});
  const rememberRef = useRef<(text: string) => void>(() => {});
  statusRef.current = status;

  useEffect(() => {
    return pipeRef.current.subscribe((next) => {
      setFiles(next);
      for (const file of next) {
        const prev = fileState.current.get(file.id);
        if (file.direction === "out" && file.status === "ready" && prev !== "ready") {
          sendNoteRef.current(`Sent ${file.name}`);
        }
        fileState.current.set(file.id, file.status);
      }
    });
  }, []);

  useEffect(() => {
    return () => linkRef.current?.stop();
  }, []);

  useEffect(() => {
    if (status !== "live") return;
    stageRef.current?.focus();
    const video = videoRef.current;
    const stream = streamRef.current;
    if (video && stream) {
      video.srcObject = stream;
      void video.play().catch(() => {});
    }
  }, [status, hasStream]);

  useEffect(() => {
    const video = videoRef.current;
    if (status !== "live" || !video || !hasStream) return;
    let frames = 0;
    let last = performance.now();
    let stop = false;
    const tick = () => {
      if (stop) return;
      frames += 1;
      const now = performance.now();
      if (now - last >= 1000) {
        setFps(frames);
        frames = 0;
        last = now;
      }
      if ("requestVideoFrameCallback" in video) {
        video.requestVideoFrameCallback(() => tick());
      }
    };
    if ("requestVideoFrameCallback" in video) video.requestVideoFrameCallback(() => tick());
    return () => {
      stop = true;
    };
  }, [hasStream, status]);

  const clearVideo = useCallback(() => {
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setHasStream(false);
    setFps(null);
  }, []);

  const disconnect = useCallback(() => {
    linkRef.current?.stop();
    linkRef.current = null;
    clearVideo();
    setRtt(null);
    pipeRef.current.disarm();
    setStatus("ended");
    setDetail("Disconnected.");
    setAimState("desk");
    rememberRef.current("Disconnected");
  }, [clearVideo]);

  const connect = useCallback(() => {
    const room = remoteId.replace(/\D/g, "");
    if (!/^\d{6,9}$/.test(room) || !/^\d{4,8}$/.test(pin)) {
      setDetail("Enter a 6–9 digit ID and a 4–8 digit PIN.");
      return;
    }
    linkRef.current?.stop();
    clearVideo();
    setRtt(null);
    setChat([]);
    setMetrics(null);
    setAudit([]);
    fileState.current.clear();
    const link = new DeskLink({
      role: "viewer",
      room,
      pin,
      onFileChannel: (channel) => pipeRef.current.attach(channel),
      onEvent: (event) => {
        if (event.type === "status") {
          if (event.status === "live") pipeRef.current.arm();
          if (
            event.status === "waiting" ||
            event.status === "ended" ||
            event.status === "error" ||
            event.status === "denied"
          ) {
            pipeRef.current.disarm();
          }
          setStatus(event.status);
          setDetail(event.detail);
          if (event.status === "ended") rememberRef.current("Session ended");
          if (event.status === "denied" || event.status === "error" || event.status === "ended") {
            clearVideo();
          }
          if (event.status === "live") stageRef.current?.focus();
        } else if (event.type === "stream") {
          streamRef.current = event.stream;
          const video = videoRef.current;
          if (!event.stream) {
            if (video) video.srcObject = null;
            setHasStream(false);
            setFps(null);
            return;
          }
          if (video) {
            video.srcObject = event.stream;
            void video.play().catch(() => {});
          }
          setHasStream(true);
        } else if (event.type === "source") {
          setSource(event.kind);
        } else if (event.type === "rtt") {
          setRtt(event.ms);
        } else if (event.type === "chat") {
          setChat((prev) => [...prev, { id: crypto.randomUUID(), from: event.from, text: event.text } satisfies ChatLine].slice(-40));
        } else if (event.type === "clip") {
          setClip(event.text);
        } else if (event.type === "aim") {
          setAimState(event.kind);
        } else if (event.type === "note") {
          rememberRef.current(event.text);
        } else if (event.type === "metrics") {
          setMetrics(event.snapshot);
        }
      },
    });
    linkRef.current = link;
    link.start();
  }, [clearVideo, pin, remoteId]);

  const chooseQuality = useCallback((preset: QualityPreset) => {
    setQuality(preset);
    linkRef.current?.send({ t: "quality", preset });
  }, []);

  const sendInput = useCallback((input: DeskInput) => {
    if (linkRef.current) linkRef.current.send({ t: "input", input });
  }, []);

  const sendFile = useCallback((file: File) => {
    void pipeRef.current.sendFile(file);
  }, []);

  const cancelFile = useCallback((id: string) => {
    pipeRef.current.cancel(id);
  }, []);

  const say = useCallback((text: string) => {
    const clean = text.trim().slice(0, 400);
    if (!clean || statusRef.current !== "live") return;
    linkRef.current?.send({ t: "chat", text: clean });
    const line: ChatLine = { id: crypto.randomUUID(), from: "viewer", text: clean };
    setChat((prev) => [...prev, line].slice(-40));
  }, []);

  const sendClip = useCallback((text: string) => {
    const clean = text.slice(0, 2000);
    if (!clean.trim() || statusRef.current !== "live") return;
    linkRef.current?.send({ t: "clip", text: clean });
    setClip(clean);
    sendNoteRef.current("Clipboard sent");
  }, []);

  const remember = useCallback((text: string) => {
    const line = auditText(text);
    if (!line) return;
    setAudit((prev) => [...prev, { id: crypto.randomUUID(), text: line }].slice(-40));
  }, []);

  const sendNote = useCallback(
    (text: string) => {
      const clean = text.replace(/\s+/g, " ").trim().slice(0, 80);
      if (!clean) return;
      remember(clean);
      linkRef.current?.send({ t: "note", text: clean });
    },
    [remember],
  );
  sendNoteRef.current = sendNote;
  rememberRef.current = remember;

  const setAim = useCallback((kind: Aim) => {
    setAimState(kind);
    if (statusRef.current === "live") linkRef.current?.send({ t: "aim", kind });
    sendNoteRef.current(aimNote(kind));
  }, []);

  const endProcess = useCallback((pid: number) => {
    if (statusRef.current !== "live") return;
    linkRef.current?.send({ t: "kill", pid });
  }, []);

  return {
    remoteId,
    setRemoteId: (value: string) => setRemoteId(value.replace(/\D/g, "").slice(0, 9)),
    pin,
    setPin: (value: string) => setPin(value.replace(/\D/g, "").slice(0, 8)),
    status,
    detail,
    quality,
    chooseQuality,
    source,
    rtt,
    fps,
    hasStream,
    files,
    chat,
    clip,
    metrics,
    aim,
    audit,
    sendFile,
    cancelFile,
    say,
    sendClip,
    setAim,
    endProcess,
    videoRef,
    stageRef,
    connect,
    disconnect,
    sendInput,
    canConnect:
      /^\d{6,9}$/.test(remoteId) &&
      /^\d{4,8}$/.test(pin) &&
      (status === "idle" || status === "ended" || status === "denied" || status === "error"),
    running: status === "signaling" || status === "waiting" || status === "connecting" || status === "checking" || status === "live",
  };
}
