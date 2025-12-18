from __future__ import annotations

from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.storage import ensure_dirs, save_upload, validate_image
from app.schemas import JobCreateResponse, JobOut
from app.models import Job, JobStatus, TaskType
from app.settings import settings
from app.db import get_db


router = APIRouter(prefix="/api/jobs", tags=["jobs"])


def _job_to_out(job: Job) -> JobOut:
    return JobOut(
        id=job.id,
        status=job.status.value,
        task_type=job.task_type.value,
        created_at=job.created_at,
        updated_at=job.updated_at,
        progress=job.progress,
        filename=job.filename,
        content_type=job.content_type,
        size_bytes=job.size_bytes,
        image_width=job.image_width,
        image_height=job.image_height,
        conf=job.conf,
        iou=job.iou,
        imgsz=job.imgsz,
        error_message=job.error_message,
        has_result_json=bool(job.result_json_path),
        has_annotated_image=bool(job.annotated_image_path),
    )


@router.post("", response_model=JobCreateResponse)
def create_job(
    file: UploadFile = File(...),
    task_type: TaskType = Form(...),
    conf: float | None = Form(None),
    iou: float | None = Form(None),
    imgsz: int | None = Form(None),
    db: Session = Depends(get_db),
):
    ensure_dirs()

    if conf is not None and not (0.0 <= conf <= 1.0):
        raise HTTPException(status_code=422, detail="conf must be between 0 and 1")
    if iou is not None and not (0.0 <= iou <= 1.0):
        raise HTTPException(status_code=422, detail="iou must be between 0 and 1")

    if imgsz is not None and imgsz <= 0:
        imgsz = None
    if imgsz is not None and imgsz < 32:
        raise HTTPException(status_code=422, detail="imgsz must be >= 32")

    job = Job(
        status=JobStatus.uploading,
        task_type=task_type,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
        filename=file.filename or "upload",
        content_type=file.content_type or "application/octet-stream",
        size_bytes=0,
        input_path="",
        conf=conf,
        iou=iou,
        imgsz=imgsz,
        progress=0,
    )

    db.add(job)
    db.commit()
    db.refresh(job)

    tmp_path = settings.inputs_dir / f"{job.id}.upload"
    final_path = tmp_path

    try:
        size_bytes = save_upload(file, tmp_path)
        width, height, actual_mime = validate_image(tmp_path)

        suffix = _suffix_for_content_type(actual_mime)
        if not suffix:
            raise HTTPException(status_code=415, detail="Unsupported image type. Allowed: jpg, png, webp.")

        final_path = settings.inputs_dir / f"{job.id}{suffix}"
        tmp_path.replace(final_path)
    except HTTPException:
        if tmp_path.exists():
            tmp_path.unlink(missing_ok=True)
        if final_path.exists() and final_path != tmp_path:
            final_path.unlink(missing_ok=True)
        db.delete(job)
        db.commit()
        raise

    job.size_bytes = size_bytes
    job.content_type = actual_mime
    job.image_width = width
    job.image_height = height
    job.input_path = str(final_path)
    job.status = JobStatus.queued
    job.updated_at = datetime.utcnow()

    db.add(job)
    db.commit()
    db.refresh(job)

    return JobCreateResponse(job=_job_to_out(job))


def _suffix_for_content_type(content_type: str) -> str:
    if content_type == "image/jpeg":
        return ".jpg"
    if content_type == "image/png":
        return ".png"
    if content_type == "image/webp":
        return ".webp"
    return ""


@router.get("/{job_id}", response_model=JobOut)
def get_job(job_id: str, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_to_out(job)


@router.get("/{job_id}/result")
def get_job_result(job_id: str, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != JobStatus.succeeded:
        raise HTTPException(status_code=409, detail=f"Job not ready (status: {job.status.value})")
    if not job.result_json_path:
        raise HTTPException(status_code=404, detail="Result JSON not found")
    path = Path(job.result_json_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Result JSON not found")
    return FileResponse(path, media_type="application/json")


@router.get("/{job_id}/annotated")
def get_job_annotated(job_id: str, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != JobStatus.succeeded:
        raise HTTPException(status_code=409, detail=f"Job not ready (status: {job.status.value})")
    if not job.annotated_image_path:
        raise HTTPException(status_code=404, detail="Annotated image not found")
    path = Path(job.annotated_image_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Annotated image not found")
    return FileResponse(path, media_type="image/jpeg")
