import type { JobCreateResponse, JobOut, TaskType } from "@/lib/types";

const DEFAULT_API_BASE = "http://127.0.0.1:8000";

export function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL || DEFAULT_API_BASE;
}

export async function createJob(params: {
  file: File;
  taskType: TaskType;
  conf?: string;
  iou?: string;
  imgsz?: string;
}): Promise<JobCreateResponse> {
  const fd = new FormData();
  fd.append("file", params.file);
  fd.append("task_type", params.taskType);
  if (params.conf !== undefined && params.conf !== "") fd.append("conf", params.conf);
  if (params.iou !== undefined && params.iou !== "") fd.append("iou", params.iou);
  if (params.imgsz !== undefined && params.imgsz !== "") fd.append("imgsz", params.imgsz);

  const res = await fetch(`${apiBase()}/api/jobs`, {
    method: "POST",
    body: fd
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create job failed (${res.status}): ${text}`);
  }

  return (await res.json()) as JobCreateResponse;
}

export async function getJob(jobId: string): Promise<JobOut> {
  const res = await fetch(`${apiBase()}/api/jobs/${jobId}`, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Get job failed (${res.status}): ${text}`);
  }
  return (await res.json()) as JobOut;
}

export async function getJobResult(jobId: string): Promise<unknown> {
  const res = await fetch(`${apiBase()}/api/jobs/${jobId}/result`, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Get result failed (${res.status}): ${text}`);
  }
  return (await res.json()) as unknown;
}

export function annotatedUrl(jobId: string): string {
  return `${apiBase()}/api/jobs/${jobId}/annotated`;
}

export function resultUrl(jobId: string): string {
  return `${apiBase()}/api/jobs/${jobId}/result`;
}
