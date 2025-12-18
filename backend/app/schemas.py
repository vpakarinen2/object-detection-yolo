from datetime import datetime
from pydantic import BaseModel


class JobOut(BaseModel):
    id: str
    status: str
    task_type: str
    created_at: datetime
    updated_at: datetime
    progress: int

    filename: str
    content_type: str
    size_bytes: int

    image_width: int | None = None
    image_height: int | None = None

    conf: float | None = None
    iou: float | None = None
    imgsz: int | None = None

    error_message: str | None = None

    has_result_json: bool
    has_annotated_image: bool


class JobCreateResponse(BaseModel):
    job: JobOut
