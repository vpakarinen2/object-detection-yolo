"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { TaskType } from "@/lib/types";
import { apiBase } from "@/lib/api";

function wsBaseFromApiBase(base: string): string {
  const u = new URL(base);
  const wsProto = u.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProto}//${u.host}`;
}

export default function LivePage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const runningRef = useRef(false);

  const [taskType, setTaskType] = useState<TaskType>("object");
  const [imgsz, setImgsz] = useState("640");
  const [conf, setConf] = useState("0.25");
  const [iou, setIou] = useState("0.7");

  const [annotatedSrc, setAnnotatedSrc] = useState<string | null>(null);
  const [inferenceMs, setInferenceMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [connected, setConnected] = useState(false);
  const [running, setRunning] = useState(false);

  const wsUrl = useMemo(() => {
    const base = wsBaseFromApiBase(apiBase());
    const qp = new URLSearchParams();
    
    qp.set("task_type", taskType);
    if (conf !== "") qp.set("conf", conf);
    if (iou !== "") qp.set("iou", iou);
    if (imgsz !== "") qp.set("imgsz", imgsz);

    return `${base}/ws/live?${qp.toString()}`;
  }, [taskType, conf, iou, imgsz]);

  useEffect(() => {
    let cancelled = false;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (cancelled) {
          for (const t of stream.getTracks()) t.stop();
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }

    void startCamera();

    return () => {
      cancelled = true;
      const v = videoRef.current;
      const stream = v?.srcObject;
      if (stream && typeof stream === "object" && "getTracks" in stream) {
        for (const t of (stream as MediaStream).getTracks()) t.stop();
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
        wsRef.current = null;
      }
    };
  }, []);

  async function captureJpegBytes(): Promise<ArrayBuffer> {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c) throw new Error("Camera not ready");

    const w = v.videoWidth || 0;
    const h = v.videoHeight || 0;
    if (w <= 0 || h <= 0) throw new Error("Camera not ready");

    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");

    ctx.drawImage(v, 0, 0, w, h);

    const blob = await new Promise<Blob>((resolve, reject) => {
      c.toBlob(
        (b) => {
          if (!b) reject(new Error("Failed to encode frame"));
          else resolve(b);
        },
        "image/jpeg",
        0.8
      );
    });

    return await blob.arrayBuffer();
  }

  function stop() {
    runningRef.current = false;
    setRunning(false);
    setConnected(false);

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
  }

  async function start() {
    setError(null);
    setResult(null);
    setAnnotatedSrc(null);
    setInferenceMs(null);

    if (runningRef.current) return;
    runningRef.current = true;

    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    setRunning(true);

    let inFlight = false;

    const sendNext = async () => {
      if (!runningRef.current) return;
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      if (inFlight) return;

      try {
        inFlight = true;
        const bytes = await captureJpegBytes();
        wsRef.current.send(bytes);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        stop();
      }
    };

    ws.onopen = () => {
      setConnected(true);
      void sendNext();
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as {
          task_type: string;
          runtime?: { inference_ms?: number };
          result: unknown;
          annotated_jpeg_base64: string;
        };

        setResult(msg.result);
        setInferenceMs(typeof msg.runtime?.inference_ms === "number" ? msg.runtime.inference_ms : null);
        setAnnotatedSrc(`data:image/jpeg;base64,${msg.annotated_jpeg_base64}`);

        inFlight = false;
        setTimeout(() => void sendNext(), 0);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        stop();
      }
    };

    ws.onerror = () => {
      setError("WebSocket error");
      stop();
    };

    ws.onclose = () => {
      setConnected(false);
      setRunning(false);
      runningRef.current = false;
    };
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-7">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-base font-semibold">Webcam</div>
            <div className="mt-1 text-sm text-white/70">Stream frames for real-time object/pose detection.</div>
          </div>

          <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm">
            Status: <span className="font-semibold">{connected ? "connected" : "disconnected"}</span>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-4">
          <div>
            <label className="block text-sm text-white/80">Task</label>
            <select
              className="mt-2 block w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm"
              value={taskType}
              onChange={(e) => setTaskType(e.target.value as TaskType)}
              disabled={running}
            >
              <option value="object">Object detection</option>
              <option value="pose">Pose detection</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-white/80">conf</label>
            <input
              className="mt-2 block w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm"
              value={conf}
              onChange={(e) => setConf(e.target.value)}
              inputMode="decimal"
              disabled={running}
            />
          </div>

          <div>
            <label className="block text-sm text-white/80">iou</label>
            <input
              className="mt-2 block w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm"
              value={iou}
              onChange={(e) => setIou(e.target.value)}
              inputMode="decimal"
              disabled={running}
            />
          </div>

          <div>
            <label className="block text-sm text-white/80">imgsz</label>
            <input
              className="mt-2 block w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm"
              value={imgsz}
              onChange={(e) => setImgsz(e.target.value)}
              inputMode="numeric"
              disabled={running}
            />
          </div>
        </div>

        <div className="mt-5 flex gap-3">
          <button
            className="inline-flex items-center justify-center rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={running}
            onClick={() => void start()}
            type="button"
          >
            Start
          </button>
          <button
            className="inline-flex items-center justify-center rounded-md bg-white/10 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={!running}
            onClick={stop}
            type="button"
          >
            Stop
          </button>

          <div className="ml-auto rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/80">
            inference: <span className="font-semibold">{inferenceMs === null ? "-" : `${inferenceMs.toFixed(1)} ms`}</span>
          </div>
        </div>

        {error ? <div className="mt-4 rounded-md border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</div> : null}
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <div className="text-base font-semibold">Camera</div>
          <div className="mt-3 overflow-hidden rounded-lg border border-white/10 bg-black/20">
            <video ref={videoRef} className="h-auto w-full" playsInline muted />
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <div className="text-base font-semibold">Annotated</div>
          <div className="mt-3 overflow-hidden rounded-lg border border-white/10 bg-black/20">
            {annotatedSrc ? <img src={annotatedSrc} alt="Annotated" className="h-auto w-full" /> : <div className="p-4 text-sm text-white/70">No frames yet.</div>}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/5 p-5">
        <div className="text-base font-semibold">Result JSON</div>
        <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3">
          {result ? <pre className="max-h-[520px] overflow-auto text-xs text-white/80">{JSON.stringify(result, null, 2)}</pre> : <div className="text-sm text-white/70">No results yet.</div>}
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />

      <div className="rounded-2xl border border-white/10 bg-white/5 p-7 text-sm text-white/70">
        WebSocket: <span className="font-mono break-all">{wsUrl}</span>
      </div>
    </div>
  );
}
