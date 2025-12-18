from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    backend_dir: Path = Path(__file__).resolve().parents[1]
    data_dir: Path = backend_dir / "data"
    inputs_dir: Path = data_dir / "inputs"
    outputs_dir: Path = data_dir / "outputs"

    database_url: str = f"sqlite:///{(data_dir / 'app.db').as_posix()}"

    max_upload_bytes: int = 100 * 1024 * 1024
    allowed_content_types: tuple[str, ...] = ("image/jpeg", "image/png", "image/webp")

    object_model_weights: str = "yolo11s.pt"
    pose_model_weights: str = "yolo11s-pose.pt"

    cors_allow_origins: tuple[str, ...] = ("http://localhost:3000", "http://127.0.0.1:3000")

settings = Settings()
