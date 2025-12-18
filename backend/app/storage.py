from __future__ import annotations

from pathlib import Path
from PIL import Image

from fastapi import HTTPException, UploadFile
from app.settings import settings


def ensure_dirs() -> None:
    settings.inputs_dir.mkdir(parents=True, exist_ok=True)
    settings.outputs_dir.mkdir(parents=True, exist_ok=True)


def save_upload(file: UploadFile, dest_path: Path) -> int:
    size = 0
    with dest_path.open("wb") as f:
        while True:
            chunk = file.file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > settings.max_upload_bytes:
                raise HTTPException(status_code=413, detail="File too large (max 100MB).")
            f.write(chunk)

    return size


def validate_image(dest_path: Path) -> tuple[int, int, str]:
    try:
        with Image.open(dest_path) as im:
            im.verify()

        with Image.open(dest_path) as im:
            width, height = im.size
            actual_mime = Image.MIME.get(im.format)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid image file.")

    if actual_mime not in settings.allowed_content_types:
        raise HTTPException(status_code=415, detail="Unsupported image type. Allowed: jpg, png, webp.")

    return width, height, actual_mime
