from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from contextlib import asynccontextmanager

from app.routes.jobs import router as jobs_router
from app.storage import ensure_dirs
from app.settings import settings
from app.models import Base
from app.db import engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    ensure_dirs()
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="Object & Pose Detection API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_allow_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(jobs_router)
