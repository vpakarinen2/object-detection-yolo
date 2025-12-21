"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { createJob, createVideoJob } from "@/lib/api";
import type { TaskType } from "@/lib/types";

const MAX_BYTES = 100 * 1024 * 1024;

export default function HomePage() {
  const router = useRouter();

  const [taskType, setTaskType] = useState<TaskType>("object");
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const [imgsz, setImgsz] = useState("640");
  const [conf, setConf] = useState("0.25");
  const [iou, setIou] = useState("0.7");

  const canSubmit = useMemo(() => {
    if (!file) return false;
    if (file.size > MAX_BYTES) return false;
    return true;
  }, [file]);

  const isVideo = useMemo(() => {
    if (!file) return false;
    if (file.type && file.type.startsWith("video/")) return true;
    const name = file.name.toLowerCase();
    return name.endsWith(".mp4") || name.endsWith(".mov") || name.endsWith(".avi");
  }, [file]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) return;

    setBusy(true);
    try {
      const resp = isVideo
        ? await createVideoJob({
            file,
            taskType,
            conf,
            iou,
            imgsz
          })
        : await createJob({
            file,
            taskType,
            conf,
            iou,
            imgsz
          });
      router.push(`/jobs/${resp.job.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8 pt-2">
      <div className="rounded-2xl border border-white/10 bg-white/5 p-7">
        <div className="text-base font-semibold">New job</div>

        <form className="mt-5 space-y-4" onSubmit={onSubmit}>
          <div>
            <label className="block text-sm text-white/80">Image or video (max. 100mb)</label>
            <input
              className="mt-2 block w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm"
              type="file"
              accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/x-msvideo,.mp4,.mov,.avi"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            {file && file.size > MAX_BYTES ? (
              <div className="mt-2 text-sm text-red-300">File too large (max 100MB).</div>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div>
              <label className="block text-sm text-white/80">Task</label>
              <select
                className="mt-2 block w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm"
                value={taskType}
                onChange={(e) => setTaskType(e.target.value as TaskType)}
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
              />
            </div>

            <div>
              <label className="block text-sm text-white/80">iou</label>
              <input
                className="mt-2 block w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm"
                value={iou}
                onChange={(e) => setIou(e.target.value)}
                inputMode="decimal"
              />
            </div>

            <div>
              <label className="block text-sm text-white/80">imgsz</label>
              <input
                className="mt-2 block w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm"
                value={imgsz}
                onChange={(e) => setImgsz(e.target.value)}
                inputMode="numeric"
              />
            </div>
          </div>

          {error ? <div className="rounded-md border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</div> : null}

          <button
            className="inline-flex items-center justify-center rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={!canSubmit || busy}
            type="submit"
          >
            {busy ? "Submitting..." : "Create job"}
          </button>
        </form>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-7 text-sm text-white/70">
        API assumed at <span className="font-mono">{process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000"}</span>.
      </div>
    </div>
  );
}

