import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import Body, FastAPI, HTTPException, Response
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import layout as L
from .engine import Engine
from .scenarios import UnknownOption

engine: Engine | None = None
DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


async def _run():
    loop = asyncio.get_running_loop()
    last = loop.time()
    while True:
        # короткий шаг ожидания: смена скорости и снятие паузы действуют сразу, а не через старый интервал
        await asyncio.sleep(0.05)
        if engine.paused or loop.time() - last < engine.tick_seconds:
            continue
        last = loop.time()
        try:
            # такт вне цикла событий: перемотка выходных не задерживает ответы API
            await asyncio.to_thread(engine.tick)
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
# чужим сайтам ответы API не отдаём: интерфейс живёт на том же адресе, а в разработке — на локальном порту Vite
app.add_middleware(CORSMiddleware, allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
                   allow_methods=["*"], allow_headers=["*"])


@app.get("/api/layout")
def get_layout():
    return dict(shops=L.SHOPS, stations=L.STATIONS, buffers=L.BUFFERS, path=L.PATH, path3d=L.PATH3D, canvas=L.CANVAS,
                nominal_per_hour=L.NOMINAL_PER_HOUR, plan_per_hour=L.PLAN_PER_HOUR)


@app.get("/api/state")
def get_state():
    return engine.state()


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


@app.get("/api/scenarios")
def get_scenarios():
    return engine.scenarios.status()


@app.post("/api/scenarios/{scenario_id}/start")
def start_scenario(scenario_id: str):
    try:
        return engine.scenarios.start(scenario_id)
    except KeyError:
        raise HTTPException(404, "Нет такого сценария") from None
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None


def _scenario_step(step, *args):
    """Шаг наряда: неизвестный вариант — 400, не тот этап или нет наряда — 409."""
    try:
        return step(*args)
    except UnknownOption as exc:
        raise HTTPException(400, str(exc)) from None
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from None


def _option_id(body):
    # тело разбираем сами: ошибка должна прийти строкой в detail, а не списком валидатора
    option_id = body.get("option_id") if isinstance(body, dict) else None
    if not isinstance(option_id, str) or not option_id:
        raise HTTPException(400, "Передайте option_id — идентификатор выбранного варианта")
    return option_id


@app.post("/api/scenarios/advance")
def advance_scenario():
    return _scenario_step(engine.scenarios.advance)


@app.post("/api/scenarios/diagnose")
def diagnose_scenario(body: Any = Body(default=None)):
    return _scenario_step(engine.scenarios.diagnose, _option_id(body))


@app.post("/api/scenarios/repair")
def repair_scenario(body: Any = Body(default=None)):
    return _scenario_step(engine.scenarios.repair, _option_id(body))


@app.post("/api/scenarios/verify")
def verify_scenario():
    return _scenario_step(engine.scenarios.verify)


@app.post("/api/scenarios/report/accept")
def accept_scenario_report():
    return _scenario_step(engine.scenarios.accept_report)


@app.post("/api/scenarios/report/return")
def return_scenario_report():
    return _scenario_step(engine.scenarios.return_report)


@app.get("/scenarios", include_in_schema=False)
@app.get("/scenarios/", include_in_schema=False)
def scenarios_page():
    index = DIST / "index.html"
    if not index.is_file():
        raise HTTPException(404, "Сначала соберите интерфейс")
    return FileResponse(index)


# --- управление демонстрацией -------------------------------------------
def _station(sid: str):
    if sid not in L.STATION_BY_ID:
        raise HTTPException(404, "Нет такого поста")
    case = engine.scenarios.active
    if case and case["stage"] != "done" and case["station"] == sid:
        raise HTTPException(409, "Пост занят сценарием ремонта; завершите наряд на странице /scenarios")
    return sid


@app.post("/api/demo/degrade/{sid}")
def demo_degrade(sid: str):
    """Сценарий: узел начинает ускоренно изнашиваться."""
    with engine.lock:
        engine.sim.degrade(_station(sid), 0.42)
    return {"ok": True}


@app.post("/api/demo/fail/{sid}")
def demo_fail(sid: str, minutes: int = 90):
    with engine.lock:
        engine.sim.fail(_station(sid), minutes)
    return {"ok": True}


@app.post("/api/demo/repair/{sid}")
def demo_repair(sid: str):
    with engine.lock:
        engine.sim.repair(_station(sid))
    return {"ok": True}


@app.post("/api/demo/speed")
def demo_speed(tick_seconds: float = 2.0, paused: bool = False):
    if tick_seconds != tick_seconds:   # NaN
        tick_seconds = 2.0
    # не длиннее 10 с на такт: один запрос не должен замораживать показ
    engine.tick_seconds = max(0.25, min(tick_seconds, 10.0))
    engine.paused = paused
    return {"ok": True, "tick_seconds": engine.tick_seconds, "paused": engine.paused,
            "speed": round(300 / engine.tick_seconds)}


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    # значка у интерфейса нет: пустой ответ вместо 404 в консоли браузера
    return Response(status_code=204)


# Интерфейс раздаётся после всех маршрутов /api. StaticFiles не выпускает за пределы
# каталога; запасной маршрут на index.html не нужен: навигация идёт через хэш.
if DIST.exists():
    app.mount("/", StaticFiles(directory=DIST, html=True), name="ui")
