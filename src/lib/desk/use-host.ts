import { useCallback, useEffect, useRef, useState } from "react";
import { auditText, type AuditLine } from "./audit";
import { applyInput, createDesk, drawDesk, type DeskModel } from "./desktop";
import { FilePipe, type Transfer } from "./files";
import { DeskLink } from "./link";
import { createMachine } from "./machine";
import { applyPageInput } from "./page-agent";
import { aimNote, postWindowsPointer, windowsPointerReady } from "./windows-pointer";
import {
  makeId,
  makePin,
  PRESETS,
  type Aim,
  type ChatLine,
  type DeskInput,
  type DeskSource,
  type LinkStatus,
  type MachineSnapshot,
  type QualityPreset,
} from "./types";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Chromium locks canvas.captureStream at about 320×180 if the bitmap is not
 * composited yet, and that track never grows. Wait until the canvas is on
 * screen, then keep the first capture that is actually full size.
 */
async function captureFull(canvas: HTMLCanvasElement, fps: number): Promise<MediaStream> {
  for (let frame = 0; frame < 40; frame += 1) {
    const box = canvas.getBoundingClientRect();
    if (box.width > 40 && box.height > 40) break;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  await sleep(500);
  let best: MediaStream | null = null;
  let bestWidth = 0;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const stream = canvas.captureStream(fps);
    await sleep(80);
    const width = stream.getVideoTracks()[0]?.getSettings().width ?? 0;
    if (width >= 640) {
      best?.getTracks().forEach((track) => track.stop());
      return stream;
    }
    if (width > bestWidth) {
      best?.getTracks().forEach((track) => track.stop());
      best = stream;
      bestWidth = width;
    } else {
      stream.getTracks().forEach((track) => track.stop());
    }
    await sleep(400);
  }
  return best ?? canvas.captureStream(fps);
}

export function useHostDesk() {
  const [id, setId] = useState("");
  const [pin, setPin] = useState("");
  const [status, setStatus] = useState<LinkStatus>("idle");
  const [detail, setDetail] = useState("Set a PIN, then start the desk.");
  const [source, setSource] = useState<DeskSource | null>(null);
  const [activity, setActivity] = useState("No remote input yet");
  const [notes, setNotes] = useState("");
  const [shell, setShell] = useState("");
  const [rtt, setRtt] = useState<number | null>(null);
  const [armed, setArmed] = useState(false);
  const [files, setFiles] = useState<Transfer[]>([]);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [clip, setClip] = useState("");
  const [metrics, setMetrics] = useState<MachineSnapshot | null>(null);
  const [aim, setAimState] = useState<Aim>("desk");
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [audit, setAudit] = useState<AuditLine[]>([]);
  const [pointerReady, setPointerReady] = useState(false);
  const previewRef = useRef<HTMLVideoElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const linkRef = useRef<DeskLink | null>(null);
  const modelRef = useRef<DeskModel>(createDesk());
  const streamRef = useRef<MediaStream | null>(null);
  const surfaceRef = useRef<HTMLCanvasElement | null>(null);
  const presetRef = useRef<QualityPreset>("balanced");
  const sourceRef = useRef<DeskSource>("desk");
  const aimRef = useRef<Aim>("desk");
  const captureGen = useRef(0);
  const hudAt = useRef(0);
  const raf = useRef(0);
  const pipeRef = useRef(new FilePipe());
  const machineRef = useRef(createMachine());
  const statusRef = useRef<LinkStatus>("idle");
  const fileState = useRef(new Map<string, string>());
  const sendNoteRef = useRef<(text: string) => void>(() => {});
  const relayRef = useRef<(text: string) => void>(() => {});
  const rememberRef = useRef<(text: string) => void>(() => {});
  statusRef.current = status;

  const mountCanvas = useCallback(() => {
    const slot = slotRef.current;
    if (!slot) throw new Error("Desk slot is not mounted");
    let canvas = surfaceRef.current;
    if (!canvas || !canvas.isConnected) {
      canvas = document.createElement("canvas");
      canvas.width = PRESETS.balanced.w;
      canvas.height = PRESETS.balanced.h;
      canvas.style.cssText = "display:block;width:100%;height:100%;";
      slot.replaceChildren(canvas);
      surfaceRef.current = canvas;
    }
    return canvas;
  }, []);

  const surface = useCallback(() => mountCanvas(), [mountCanvas]);

  const paint = useCallback(() => {
    const canvas = surface();
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawDesk(ctx, modelRef.current, canvas.width, canvas.height);
  }, [surface]);

  const requestPaint = useCallback(() => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      paint();
    });
  }, [paint]);

  useEffect(() => {
    const saved = sessionStorage.getItem("harbor-id");
    const next = saved && /^\d{9}$/.test(saved) ? saved : makeId();
    sessionStorage.setItem("harbor-id", next);
    setId(next);
    setPin(makePin());
    setNotes(modelRef.current.notes);
  }, []);

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
    return () => {
      linkRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (status !== "waiting" && status !== "live" && status !== "connecting" && status !== "checking" && status !== "signaling") {
      return;
    }
    const beat = () => {
      const snapshot = machineRef.current.tick();
      setMetrics(snapshot);
      for (const line of machineRef.current.drain()) sendNoteRef.current(line);
      if (statusRef.current === "live") linkRef.current?.send({ t: "metrics", snapshot });
    };
    beat();
    const timer = window.setInterval(beat, 2000);
    return () => window.clearInterval(timer);
  }, [status]);

  useEffect(() => {
    if (aim !== "windows") return;
    let stop = false;
    const probe = () => {
      void windowsPointerReady().then((ok) => {
        if (!stop) setPointerReady(ok);
      });
    };
    probe();
    const timer = window.setInterval(probe, 3000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [aim]);

  const noteActivity = useCallback((input: DeskInput, label: string) => {
    if (input.kind === "move") {
      const now = performance.now();
      if (now - hudAt.current < 200) return;
      hudAt.current = now;
      setActivity(`Pointer ${Math.round(input.x * 100)}, ${Math.round(input.y * 100)}`);
      return;
    }
    setActivity(label);
  }, []);

  const apply = useCallback(
    (input: DeskInput) => {
      if (aimRef.current === "page") {
        const result = applyPageInput(input);
        noteActivity(input, result.label);
        if (result.x !== undefined && result.y !== undefined) setCursor({ x: result.x, y: result.y });
        return;
      }
      if (aimRef.current === "windows") {
        if (sourceRef.current === "display") postWindowsPointer(input);
        noteActivity(input, input.kind === "key" ? `Key ${input.key}` : "Windows pointer");
        return;
      }
      if (sourceRef.current !== "desk") {
        noteActivity(input, input.kind === "key" ? `Key ${input.key}` : "Click");
        return;
      }
      const label = applyInput(modelRef.current, input);
      noteActivity(input, label);
      if (input.kind === "key") setNotes(modelRef.current.notes);
      if (label.startsWith("Calc")) setNotes(modelRef.current.calcDisplay);
      if (label === "Shell") setShell(modelRef.current.termLog.at(-1) ?? "");
      requestPaint();
    },
    [noteActivity, requestPaint],
  );

  const publishStream = useCallback(async (stream: MediaStream, gen: number) => {
    if (gen !== captureGen.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    const previous = streamRef.current;
    streamRef.current = stream;
    if (linkRef.current) await linkRef.current.setStream(stream);
    if (gen !== captureGen.current) return;
    if (previous && previous !== stream) previous.getVideoTracks().forEach((track) => track.stop());
  }, []);

  const captureDesk = useCallback(async () => {
    const gen = ++captureGen.current;
    const canvas = surface();
    const preset = PRESETS[presetRef.current];
    if (canvas.width !== preset.w || canvas.height !== preset.h) {
      canvas.width = preset.w;
      canvas.height = preset.h;
    }
    paint();
    const stream = await captureFull(canvas, preset.fps);
    if (gen !== captureGen.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    await publishStream(stream, gen);
    if ((stream.getVideoTracks()[0]?.getSettings().width ?? 0) >= 640) return;
    await sleep(800);
    if (gen !== captureGen.current || !canvas.isConnected) return;
    const again = canvas.captureStream(preset.fps);
    await sleep(80);
    const width = again.getVideoTracks()[0]?.getSettings().width ?? 0;
    if (width >= 640) await publishStream(again, gen);
    else again.getTracks().forEach((track) => track.stop());
  }, [paint, publishStream, surface]);

  useEffect(() => {
    if (!armed) {
      captureGen.current += 1;
      slotRef.current?.replaceChildren();
      surfaceRef.current = null;
      return;
    }
    const timer = window.setInterval(() => paint(), 500);
    void captureDesk();
    return () => {
      captureGen.current += 1;
      window.clearInterval(timer);
    };
  }, [armed, captureDesk, paint]);

  const applyQuality = useCallback(
    async (preset: QualityPreset) => {
      presetRef.current = preset;
      const link = linkRef.current;
      if (!link) return;
      if (sourceRef.current === "desk") {
        const wanted = PRESETS[preset];
        const canvas = surfaceRef.current;
        const same =
          canvas &&
          canvas.width === wanted.w &&
          canvas.height === wanted.h;
        if (same) {
          await link.setBitrate();
          return;
        }
        await captureDesk();
      } else {
        const track = streamRef.current?.getVideoTracks()[0];
        const presetDef = PRESETS[preset];
        try {
          await track?.applyConstraints({
            width: { ideal: presetDef.w },
            height: { ideal: presetDef.h },
            frameRate: { ideal: presetDef.fps, max: presetDef.fps },
          });
        } catch {
          // Display tracks often refuse a new size. Bitrate still follows.
        }
        await link.setBitrate();
      }
    },
    [captureDesk],
  );

  const end = useCallback(() => {
    linkRef.current?.stop();
    linkRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    sourceRef.current = "desk";
    aimRef.current = "desk";
    setAimState("desk");
    setCursor(null);
    setPointerReady(false);
    rememberRef.current("Session ended");
    setSource(null);
    setStatus("ended");
    setDetail("Session ended. Start again when you are ready.");
    setRtt(null);
    setArmed(false);
    setMetrics(null);
    pipeRef.current.disarm();
  }, []);

  const start = useCallback(
    async (kind: DeskSource) => {
      if (!/^\d{9}$/.test(id) || !/^\d{4,8}$/.test(pin)) {
        setDetail("PIN must be 4–8 digits.");
        return;
      }
      if (linkRef.current) end();
      machineRef.current = createMachine();
      setChat([]);
      setAudit([]);
      fileState.current.clear();
      sourceRef.current = kind;
      setSource(kind);
      if (kind === "display") {
        setArmed(false);
        try {
          const stream = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: { ideal: 24, max: 30 } },
            audio: false,
          });
          const previous = streamRef.current;
          streamRef.current = stream;
          if (previous && previous !== stream) previous.getVideoTracks().forEach((track) => track.stop());
          if (previewRef.current) {
            previewRef.current.srcObject = stream;
            await previewRef.current.play().catch(() => {});
          }
          const track = stream.getVideoTracks()[0];
          if (track) track.onended = () => end();
        } catch {
          sourceRef.current = "desk";
          setSource(null);
          setDetail("Display sharing was blocked. Start the practice desk instead.");
          return;
        }
      } else {
        setArmed(true);
        await new Promise<void>((resolve) => {
          const started = performance.now();
          const check = () => {
            if (streamRef.current || performance.now() - started > 7000) resolve();
            else requestAnimationFrame(check);
          };
          requestAnimationFrame(check);
        });
      }

      const link = new DeskLink({
        role: "host",
        room: id,
        pin,
        getStream: () => streamRef.current,
        getSource: () => sourceRef.current,
        onFileChannel: (channel) => pipeRef.current.attach(channel),
        onEvent: (event) => {
          if (event.type === "status") {
            if (event.status === "live" && statusRef.current !== "live") sendNoteRef.current("Viewer connected");
            if (event.status === "waiting" && statusRef.current === "live") sendNoteRef.current("Viewer left");
            if (event.status === "live") {
              pipeRef.current.arm();
              const snapshot = machineRef.current.tick();
              setMetrics(snapshot);
              if (statusRef.current !== "live") {
                const fresh = machineRef.current.drain();
                if (fresh.length) fresh.forEach((line) => sendNoteRef.current(line));
                else {
                  const current = machineRef.current.alertLine();
                  if (current) relayRef.current(current);
                }
              }
              window.setTimeout(() => {
                if (statusRef.current === "live") linkRef.current?.send({ t: "metrics", snapshot: machineRef.current.tick() });
              }, 250);
            }
            if (event.status === "waiting" || event.status === "ended" || event.status === "error") {
              pipeRef.current.disarm();
            }
            setStatus(event.status);
            setDetail(event.detail);
          } else if (event.type === "input") {
            apply(event.input);
          } else if (event.type === "quality") {
            void applyQuality(event.preset);
          } else if (event.type === "rtt") {
            setRtt(event.ms);
          } else if (event.type === "chat") {
            setChat((prev) => [...prev, { id: crypto.randomUUID(), from: event.from, text: event.text } satisfies ChatLine].slice(-40));
          } else if (event.type === "clip") {
            setClip(event.text);
          } else if (event.type === "aim") {
            aimRef.current = event.kind;
            setAimState(event.kind);
            if (event.kind === "desk") setCursor(null);
          } else if (event.type === "note") {
            rememberRef.current(event.text);
          } else if (event.type === "kill") {
            if (!machineRef.current.kill(event.pid)) return;
            sendNoteRef.current(`Ended process ${event.pid}`);
            const snapshot = machineRef.current.tick();
            setMetrics(snapshot);
            linkRef.current?.send({ t: "metrics", snapshot });
          }
        },
      });
      linkRef.current = link;
      link.start();
    },
    [apply, applyQuality, end, id, pin],
  );

  const newId = useCallback(() => {
    if (status !== "idle" && status !== "ended" && status !== "error") return;
    const next = makeId();
    sessionStorage.setItem("harbor-id", next);
    setId(next);
  }, [status]);

  const newPin = useCallback(() => {
    if (status !== "idle" && status !== "ended" && status !== "error") return;
    setPin(makePin());
  }, [status]);

  const localInput = useCallback(
    (input: DeskInput) => {
      if (sourceRef.current !== "desk") return;
      if (status !== "waiting" && status !== "live" && status !== "connecting" && status !== "checking") return;
      apply(input);
    },
    [apply, status],
  );

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
    const line: ChatLine = { id: crypto.randomUUID(), from: "host", text: clean };
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
  const relay = useCallback((text: string) => {
    const clean = text.replace(/\s+/g, " ").trim().slice(0, 80);
    if (!clean) return;
    linkRef.current?.send({ t: "note", text: clean });
  }, []);
  sendNoteRef.current = sendNote;
  relayRef.current = relay;
  rememberRef.current = remember;

  const setAim = useCallback((kind: Aim) => {
    aimRef.current = kind;
    setAimState(kind);
    if (kind === "desk") setCursor(null);
    if (kind !== "windows") setPointerReady(false);
    if (statusRef.current === "live") linkRef.current?.send({ t: "aim", kind });
    sendNoteRef.current(aimNote(kind));
  }, []);

  return {
    id,
    pin,
    setPin: (value: string) => setPin(value.replace(/\D/g, "").slice(0, 8)),
    status,
    detail,
    source,
    activity,
    notes,
    shell,
    rtt,
    files,
    chat,
    clip,
    metrics,
    aim,
    cursor,
    pointerReady,
    audit,
    sendFile,
    cancelFile,
    say,
    sendClip,
    setAim,
    previewRef,
    slotRef,
    armed,
    start,
    end,
    newId,
    newPin,
    localInput,
    canStart: /^\d{9}$/.test(id) && /^\d{4,8}$/.test(pin) && (status === "idle" || status === "ended" || status === "error"),
    running: status !== "idle" && status !== "ended" && status !== "error",
  };
}
