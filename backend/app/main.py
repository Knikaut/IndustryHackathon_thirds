import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import layout as L
from .engine import Engine

engine: Engine | None = None
DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


async def _run():
    while True:
        await asyncio.sleep(engine.tick_seconds)
        if not engine.paused:
            try:
                engine.tick()
            except Exception:  # один сбойный такт не должен останавливать двойник
                logging.exception("сбой такта %s", engine.clock)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global engine
    engine = await asyncio.to_thread(Engine)
    task = asyncio.create_task(_run())
    yield
    task.cancel()


app = FastAPI(title="Цифровой двойник автозавода", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/api/layout")
def get_layout():
    return dict(shops=L.SHOPS, stations=L.STATIONS, buffers=L.BUFFERS, path=L.PATH, path3d=L.PATH3D, canvas=L.CANVAS,
                nominal_per_hour=L.NOMINAL_PER_HOUR, plan_per_hour=L.PLAN_PER_HOUR)


@app.get("/api/state")
def get_state():
    return engine.snapshot


@app.get("/api/stations/{sid}")
def get_station(sid: str):
    if sid not in L.STATION_BY_ID:
        raise HTTPException(404, "Нет такого поста")
    return engine.station_detail(sid)


@app.get("/api/executive")
def get_executive(days: int = 30):
    return engine.executive(max(1, min(days, 75)))


@app.get("/api/orgdata")
def get_orgdata():
    """Тестовые данные организаторов и их сверка с нормативами."""
    return engine.org or {}


# --- управление демонстрацией -------------------------------------------
def _station(sid: str):
    if sid not in L.STATION_BY_ID:
        raise HTTPException(404, "Нет такого поста")
    return sid


@app.post("/api/demo/degrade/{sid}")
def demo_degrade(sid: str):
    """Сценарий: узел начинает ускоренно изнашиваться."""
    engine.sim.degrade(_station(sid), 0.42)
    return {"ok": True}


@app.post("/api/demo/fail/{sid}")
def demo_fail(sid: str, minutes: int = 90):
    engine.sim.fail(_station(sid), minutes)
    return {"ok": True}


@app.post("/api/demo/repair/{sid}")
def demo_repair(sid: str):
    engine.sim.repair(_station(sid))
    return {"ok": True}


@app.post("/api/demo/speed")
def demo_speed(tick_seconds: float = 2.0, paused: bool = False):
    engine.tick_seconds = max(0.25, min(tick_seconds, 300))
    engine.paused = paused
    return {"ok": True}


if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        f = DIST / path
        return FileResponse(f if path and f.is_file() else DIST / "index.html")
