export type TaskType = "object" | "pose";

export type JobStatus = "uploading" | "queued" | "running" | "succeeded" | "failed";

export interface JobOut {
  id: string;
  status: JobStatus;
  task_type: TaskType;
  created_at: string;
  updated_at: string;
  progress: number;

  filename: string;
  content_type: string;
  size_bytes: number;

  image_width?: number | null;
  image_height?: number | null;

  conf?: number | null;
  iou?: number | null;
  imgsz?: number | null;

  error_message?: string | null;

  has_result_json: boolean;
  has_annotated_image: boolean;
}

export interface JobCreateResponse {
  job: JobOut;
}
