"use client";

import { useEffect, useMemo, useState } from "react";

import { annotatedUrl, annotatedVideoUrl, getJob, getJobResult, resultUrl } from "@/lib/api";
import type { JobOut } from "@/lib/types";

export default function JobPage({ params }: { params: { id: string } }) {
  const jobId = params.id;

  const [job, setJob] = useState<JobOut | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  const status = job?.status;
  const showArtifacts = status === "succeeded";

  const isVideo = useMemo(() => {
    const name = (job?.filename || "").toLowerCase();
    if (name.endsWith(".mp4") || name.endsWith(".mov") || name.endsWith(".avi")) return true;
    const ct = job?.content_type || "";
    return ct.startsWith("video/");
  }, [job?.filename, job?.content_type]);

  const annotatedSrc = useMemo(() => {
    return `${annotatedUrl(jobId)}?t=${job?.updated_at || "0"}`;
  }, [jobId, job?.updated_at]);

  const annotatedVideoSrc = useMemo(() => {
    return `${annotatedVideoUrl(jobId)}?t=${job?.updated_at || "0"}`;
  }, [jobId, job?.updated_at]);

  useEffect(() => {
    let cancelled = false;
    let resultLoaded = false;
    let i: ReturnType<typeof setInterval> | null = null;

    async function tick() {
      try {
        const j = await getJob(jobId);
        if (cancelled) return;
        setJob(j);
        setError(j.status === "failed" ? j.error_message || "Job failed" : null);

        if (j.status === "succeeded" && !resultLoaded) {
          try {
            const r = await getJobResult(jobId);
            if (!cancelled) {
              setResult(r);
              resultLoaded = true;
              if (i) clearInterval(i);
            }
          } catch (e) {
            if (!cancelled) setError(e instanceof Error ? e.message : String(e));
          }
        }

        if (j.status === "succeeded" && resultLoaded) {
          if (i) clearInterval(i);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }

    void tick();
    i = setInterval(() => void tick(), 1000);
    return () => {
      cancelled = true;
      if (i) clearInterval(i);
    };
  }, [jobId]);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/10 bg-white/5 p-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-base font-semibold">Job</div>
            <div className="mt-1 font-mono text-xs text-white/70">{jobId}</div>
          </div>
          <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm">
            Status: <span className="font-semibold">{job?.status || "loading"}</span>
          </div>
        </div>

        {job ? (
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-white/10 bg-black/20 p-4 text-sm">
              <div className="text-white/80">Task: {job.task_type}</div>
              <div className="text-white/80">File: {job.filename}</div>
              <div className="text-white/80">Size: {job.size_bytes.toLocaleString()} bytes</div>
              <div className="text-white/80">Dims: {job.image_width}×{job.image_height}</div>
              <div className="text-white/80">Progress: {job.progress}%</div>
              <div className="text-white/80">Params: conf={job.conf ?? "-"}, iou={job.iou ?? "-"}, imgsz={job.imgsz ?? "-"}</div>
            </div>

            <div className="rounded-lg border border-white/10 bg-black/20 p-4 text-sm">
              <div className="text-white/80">Result JSON: {job.has_result_json ? "yes" : "no"}</div>
              <div className="text-white/80">Annotated {isVideo ? "video" : "image"}: {job.has_annotated_image ? "yes" : "no"}</div>
              {showArtifacts ? (
                <div className="mt-3 flex gap-3">
                  <a
                    className="rounded-md bg-indigo-500 px-3 py-2 text-sm font-medium text-white"
                    href={resultUrl(jobId)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open JSON
                  </a>
                  <a
                    className="rounded-md bg-white/10 px-3 py-2 text-sm font-medium text-white"
                    href={isVideo ? annotatedVideoUrl(jobId) : annotatedUrl(jobId)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open annotated
                  </a>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {error ? <div className="mt-4 rounded-md border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</div> : null}
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <div className="text-base font-semibold">Annotated {isVideo ? "video" : "image"}</div>
          <div className="mt-3 overflow-hidden rounded-lg border border-white/10 bg-black/20">
            {showArtifacts ? (
              isVideo ? (
                <video src={annotatedVideoSrc} controls className="h-auto w-full" />
              ) : (
                <img src={annotatedSrc} alt="Annotated" className="h-auto w-full" />
              )
            ) : (
              <div className="p-4 text-sm text-white/70">Waiting for results...</div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-5">
          <div className="text-base font-semibold">Result JSON</div>
          <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3">
            {showArtifacts && result ? (
              <pre className="max-h-[520px] overflow-auto text-xs text-white/80">{JSON.stringify(result, null, 2)}</pre>
            ) : (
              <div className="text-sm text-white/70">Waiting for results...</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
