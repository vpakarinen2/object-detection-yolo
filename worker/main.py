from __future__ import annotations

import json
import time
import sys
import cv2
import os

from datetime import datetime
from pathlib import Path

from sqlalchemy.orm import Session
from sqlalchemy import update
from ultralytics import YOLO


ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / "backend"

sys.path.insert(0, str(BACKEND_DIR))

from app.models import Job, JobStatus, TaskType  # noqa: E402
from app.storage import ensure_dirs  # noqa: E402
from app.settings import settings  # noqa: E402
from app.db import SessionLocal  # noqa: E402


COCO17_KEYPOINT_NAMES = [
    "nose",
    "left_eye",
    "right_eye",
    "left_ear",
    "right_ear",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
    "left_hip",
    "right_hip",
    "left_knee",
    "right_knee",
    "left_ankle",
    "right_ankle",
]


def _load_models() -> tuple[YOLO, YOLO]:
    object_model = YOLO(os.getenv("OBJECT_MODEL_WEIGHTS", settings.object_model_weights))
    pose_model = YOLO(os.getenv("POSE_MODEL_WEIGHTS", settings.pose_model_weights))
    return object_model, pose_model


def _claim_next_job(db: Session) -> Job | None:
    job = (
        db.query(Job)
        .filter(Job.status == JobStatus.queued)
        .order_by(Job.created_at.asc())
        .first()
    )
    if not job:
        return None

    res = db.execute(
        update(Job)
        .where(Job.id == job.id)
        .where(Job.status == JobStatus.queued)
        .values(status=JobStatus.running, progress=0, updated_at=datetime.utcnow())
    )
    if res.rowcount != 1:
        db.rollback()
        return None

    db.commit()
    db.refresh(job)
    return job


def _write_outputs(job: Job, result_dict: dict, annotated_bgr) -> tuple[str, str]:
    out_dir = settings.outputs_dir / job.id
    out_dir.mkdir(parents=True, exist_ok=True)

    result_path = out_dir / "result.json"
    annotated_path = out_dir / "annotated.jpg"

    result_path.write_text(json.dumps(result_dict, indent=2), encoding="utf-8")
    cv2.imwrite(str(annotated_path), annotated_bgr)

    return str(result_path), str(annotated_path)


def _build_object_result(job: Job, model: YOLO, model_weights: str, r, inference_ms: float) -> dict:
    names = r.names if hasattr(r, "names") else model.names

    detections = []
    if r.boxes is not None and len(r.boxes) > 0:
        xyxy = r.boxes.xyxy.cpu().numpy()
        conf = r.boxes.conf.cpu().numpy()
        cls = r.boxes.cls.cpu().numpy().astype(int)
        for i in range(len(xyxy)):
            c = int(cls[i])
            detections.append(
                {
                    "class_id": c,
                    "class_name": names.get(c, str(c)) if isinstance(names, dict) else names[c],
                    "confidence": float(conf[i]),
                    "bbox_xyxy": [float(x) for x in xyxy[i].tolist()],
                }
            )

    return {
        "meta": {
            "job_id": job.id,
            "task_type": job.task_type.value,
            "model_weights": model_weights,
            "created_at": job.created_at.isoformat(),
            "image_width": job.image_width,
            "image_height": job.image_height,
            "params": {"conf": job.conf, "iou": job.iou, "imgsz": job.imgsz},
        },
        "runtime": {"inference_ms": inference_ms},
        "detections": detections,
    }


def _build_pose_result(job: Job, model: YOLO, model_weights: str, r, inference_ms: float) -> dict:
    instances = []

    boxes_xyxy = None
    boxes_conf = None
    if getattr(r, "boxes", None) is not None and len(r.boxes) > 0:
        boxes_xyxy = r.boxes.xyxy.cpu().numpy()
        boxes_conf = r.boxes.conf.cpu().numpy()

    if hasattr(r, "keypoints") and r.keypoints is not None:
        k_xy = r.keypoints.xy
        k_conf = getattr(r.keypoints, "conf", None)

        if k_xy is not None and len(k_xy) > 0:
            k_xy_np = k_xy.cpu().numpy()
            k_conf_np = k_conf.cpu().numpy() if k_conf is not None else None

            for person_i in range(k_xy_np.shape[0]):
                keypoints = []
                for kp_i in range(k_xy_np.shape[1]):
                    x, y = k_xy_np[person_i, kp_i].tolist()
                    score = float(k_conf_np[person_i, kp_i]) if k_conf_np is not None else None
                    keypoints.append(
                        {
                            "name": COCO17_KEYPOINT_NAMES[kp_i] if kp_i < len(COCO17_KEYPOINT_NAMES) else str(kp_i),
                            "x": float(x),
                            "y": float(y),
                            "score": score,
                        }
                    )

                bbox_xyxy = None
                conf = None
                if boxes_xyxy is not None and person_i < len(boxes_xyxy):
                    bbox_xyxy = [float(x) for x in boxes_xyxy[person_i].tolist()]
                if boxes_conf is not None and person_i < len(boxes_conf):
                    conf = float(boxes_conf[person_i])

                instances.append(
                    {
                        "confidence": conf,
                        "bbox_xyxy": bbox_xyxy,
                        "keypoints": keypoints,
                    }
                )

    return {
        "meta": {
            "job_id": job.id,
            "task_type": job.task_type.value,
            "model_weights": model_weights,
            "created_at": job.created_at.isoformat(),
            "image_width": job.image_width,
            "image_height": job.image_height,
            "params": {"conf": job.conf, "iou": job.iou, "imgsz": job.imgsz},
            "keypoint_format": "coco17",
        },
        "runtime": {"inference_ms": inference_ms},
        "instances": instances,
    }


def _process_job(db: Session, job: Job, object_model: YOLO, pose_model: YOLO) -> None:
    ensure_dirs()

    if job.task_type == TaskType.object:
        model = object_model
        model_weights = settings.object_model_weights
    else:
        model = pose_model
        model_weights = settings.pose_model_weights

    predict_kwargs = {
        "source": job.input_path,
        "verbose": False,
    }
    if job.conf is not None:
        predict_kwargs["conf"] = job.conf
    if job.iou is not None:
        predict_kwargs["iou"] = job.iou
    if job.imgsz is not None:
        predict_kwargs["imgsz"] = job.imgsz

    t0 = time.perf_counter()
    results = model.predict(**predict_kwargs)
    inference_ms = (time.perf_counter() - t0) * 1000.0
    r = results[0]

    annotated = r.plot()

    if job.task_type == TaskType.object:
        payload = _build_object_result(job, model, model_weights, r, inference_ms)
    else:
        payload = _build_pose_result(job, model, model_weights, r, inference_ms)

    result_json_path, annotated_image_path = _write_outputs(job, payload, annotated)

    job.status = JobStatus.succeeded
    job.progress = 100
    job.result_json_path = result_json_path
    job.annotated_image_path = annotated_image_path
    job.updated_at = datetime.utcnow()

    db.add(job)
    db.commit()


def main() -> None:
    ensure_dirs()
    object_model, pose_model = _load_models()

    while True:
        with SessionLocal() as db:
            job = _claim_next_job(db)
            if not job:
                time.sleep(1)
                continue

            try:
                _process_job(db, job, object_model, pose_model)
            except Exception as e:
                with SessionLocal() as db2:
                    j = db2.get(Job, job.id)
                    if j:
                        j.status = JobStatus.failed
                        j.error_message = str(e)
                        j.updated_at = datetime.utcnow()
                        db2.add(j)
                        db2.commit()

        time.sleep(0.1)


if __name__ == "__main__":
    main()
