from __future__ import annotations

import numpy as np
import asyncio
import base64
import time
import cv2
import os

from fastapi import WebSocket, WebSocketDisconnect
from fastapi import APIRouter
from ultralytics import YOLO

from app.settings import settings


router = APIRouter(tags=["live"])


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


_model_lock = asyncio.Lock()
_object_model: YOLO | None = None
_pose_model: YOLO | None = None

_object_infer_lock = asyncio.Lock()
_pose_infer_lock = asyncio.Lock()


async def _ensure_models_loaded() -> tuple[YOLO, YOLO]:
    global _object_model
    global _pose_model

    async with _model_lock:
        if _object_model is None:
            weights = os.getenv("OBJECT_MODEL_WEIGHTS", settings.object_model_weights)
            _object_model = await asyncio.to_thread(YOLO, weights)
        if _pose_model is None:
            weights = os.getenv("POSE_MODEL_WEIGHTS", settings.pose_model_weights)
            _pose_model = await asyncio.to_thread(YOLO, weights)

    return _object_model, _pose_model


def _jpeg_bytes_to_bgr(frame_bytes: bytes) -> np.ndarray:
    arr = np.frombuffer(frame_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Invalid JPEG frame")
    return img


def _bgr_to_jpeg_base64(bgr: np.ndarray) -> str:
    ok, buf = cv2.imencode(".jpg", bgr)
    if not ok:
        raise ValueError("Failed to encode JPEG")
    return base64.b64encode(buf.tobytes()).decode("ascii")


def _build_object_result(model: YOLO, r) -> dict:
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

    return {"detections": detections}


def _build_pose_result(model: YOLO, r) -> dict:
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

                instances.append({"confidence": conf, "bbox_xyxy": bbox_xyxy, "keypoints": keypoints})

    return {"instances": instances, "keypoint_format": "coco17"}


def _parse_float(q: str | None) -> float | None:
    if q is None or q == "":
        return None
    try:
        v = float(q)
    except ValueError:
        return None
    return v


def _parse_int(q: str | None) -> int | None:
    if q is None or q == "":
        return None
    try:
        v = int(q)
    except ValueError:
        return None
    return v


@router.websocket("/ws/live")
async def live_ws(websocket: WebSocket):
    origin = websocket.headers.get("origin")
    if origin and origin not in set(settings.cors_allow_origins):
        await websocket.close(code=1008)
        return

    await websocket.accept()

    object_model, pose_model = await _ensure_models_loaded()

    task_type = (websocket.query_params.get("task_type") or "object").lower()
    conf = _parse_float(websocket.query_params.get("conf"))
    iou = _parse_float(websocket.query_params.get("iou"))
    imgsz = _parse_int(websocket.query_params.get("imgsz"))

    try:
        while True:
            frame_bytes = await websocket.receive_bytes()
            frame_bgr = await asyncio.to_thread(_jpeg_bytes_to_bgr, frame_bytes)

            predict_kwargs: dict = {
                "source": frame_bgr,
                "verbose": False,
            }
            if conf is not None:
                predict_kwargs["conf"] = conf
            if iou is not None:
                predict_kwargs["iou"] = iou
            if imgsz is not None and imgsz >= 32:
                predict_kwargs["imgsz"] = imgsz

            t0 = time.perf_counter()
            if task_type == "pose":
                async with _pose_infer_lock:
                    results = await asyncio.to_thread(pose_model.predict, **predict_kwargs)
                r = results[0]
                payload = _build_pose_result(pose_model, r)
            else:
                async with _object_infer_lock:
                    results = await asyncio.to_thread(object_model.predict, **predict_kwargs)
                r = results[0]
                payload = _build_object_result(object_model, r)

            inference_ms = (time.perf_counter() - t0) * 1000.0

            annotated = r.plot()
            if annotated is None:
                raise RuntimeError("Failed to render annotated frame")

            annotated_b64 = await asyncio.to_thread(_bgr_to_jpeg_base64, annotated)

            msg = {
                "task_type": task_type if task_type in ("object", "pose") else "object",
                "runtime": {"inference_ms": inference_ms},
                "result": payload,
                "annotated_jpeg_base64": annotated_b64,
            }
            await websocket.send_json(msg)
    except WebSocketDisconnect:
        return
    except Exception:
        await websocket.close(code=1011)
        return
