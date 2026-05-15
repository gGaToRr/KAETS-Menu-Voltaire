from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pathlib import Path
import json
import logging
import os

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("kaets")

app = FastAPI(title="KAETS Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

DUMP_FILE = Path(os.environ.get("KAETS_DUMP_FILE", "/data/kaets_full_dump.json"))

_dump_cache = None
_dump_mtime = 0.0


def load_dump():
    global _dump_cache, _dump_mtime
    if not DUMP_FILE.exists():
        return None
    mtime = DUMP_FILE.stat().st_mtime
    if _dump_cache is None or mtime != _dump_mtime:
        _dump_cache = json.loads(DUMP_FILE.read_text(encoding="utf-8"))
        _dump_mtime = mtime
        log.info(f"[Dump] charge {len(_dump_cache.get('exercises', []))} exercices")
    return _dump_cache


load_dump()


@app.get("/dump")
def dump():
    d = load_dump()
    if d is None:
        raise HTTPException(status_code=404, detail="Dump introuvable")
    return JSONResponse(d)


@app.get("/health")
def health():
    d = load_dump()
    return {
        "status": "ok",
        "dump_present": d is not None,
        "dump_exercises": len(d.get("exercises", [])) if d else 0,
    }
