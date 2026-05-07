"""
WISEflow MCQ Bundler — GDPR-compliant backend

Data principles:
  • Student data processed entirely in RAM — never written to disk or database
  • Generated ZIP held in memory only until first download, then deleted
  • Run history stores ONLY: timestamp, PDF count, config — zero personal data
  • Logs contain no names, numbers, or any personal identifiers
  • JWT lives in httpOnly + Secure + SameSite=Strict cookie — JS cannot read it
  • CORS locked to exact deployment origin — no wildcard
  • Security headers on every response
  • Job results auto-expire from memory after 1 hour
"""

import os, io, uuid, json, zipfile, asyncio, logging, time, hmac
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import (FastAPI, File, UploadFile, HTTPException,
                     Depends, BackgroundTasks, Response, Cookie, Request)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import jose.jwt as jwt

from pdf_generator import generate_all_pdfs
from history import RunStore

# ── Logging — zero personal data ────────────────────────────────────────────────
class _Redact(logging.Filter):
    _STOP = ("name", "student", "institution", "centre", "number")
    def filter(self, record):
        msg = str(record.getMessage()).lower()
        if any(k in msg for k in self._STOP):
            record.msg  = "[log suppressed — potential personal data]"
            record.args = ()
        return True

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s — %(message)s")
for _h in logging.root.handlers:
    _h.addFilter(_Redact())
log = logging.getLogger("bundler")

# ── App ──────────────────────────────────────────────────────────────────────────
app = FastAPI(docs_url=None, redoc_url=None)   # No public API docs

ORIGIN = os.environ.get("ALLOWED_ORIGIN", "http://localhost:5173")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[ORIGIN],      # Exact origin — never wildcard
    allow_credentials=True,      # Needed for httpOnly cookies
    allow_methods=["GET","POST","DELETE"],
    allow_headers=["Content-Type"],
)

store = RunStore()

# Fail fast on startup if secrets are missing
APP_PASSWORD = os.environ["APP_PASSWORD"]
JWT_SECRET   = os.environ["JWT_SECRET"]
ALGORITHM    = "HS256"
SESSION_TTL  = timedelta(hours=8)
JOB_TTL_SECS = 3600   # Jobs auto-expire from memory after 1 hour

jobs: dict[str, dict] = {}   # In-memory only — never persisted


# ── Purge expired jobs from memory ──────────────────────────────────────────────
def _purge_old_jobs():
    now = time.monotonic()
    expired = [jid for jid, j in jobs.items()
               if now - j.get("created_at_mono", now) > JOB_TTL_SECS]
    for jid in expired:
        jobs.pop(jid, None)
        log.info("Job %s expired from memory", jid[:8])


# ── Auth ─────────────────────────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    password: str

@app.post("/api/auth/login")
async def login(req: LoginRequest, response: Response):
    # Constant-time compare — prevents timing attack
    if not hmac.compare_digest(req.password.encode(), APP_PASSWORD.encode()):
        raise HTTPException(401, "Incorrect password")

    token = jwt.encode(
        {"sub": "admin",
         "iat": datetime.now(timezone.utc),
         "exp": datetime.now(timezone.utc) + SESSION_TTL},
        JWT_SECRET, algorithm=ALGORITHM
    )
    response.set_cookie(
        key="wfb_session", value=token,
        httponly=True,     # Not readable by JavaScript — XSS safe
        secure=True,       # HTTPS only
        samesite="strict", # CSRF protection
        max_age=int(SESSION_TTL.total_seconds()),
        path="/api",
    )
    return {"ok": True}

@app.post("/api/auth/logout")
async def logout(response: Response):
    response.delete_cookie("wfb_session", path="/api")
    return {"ok": True}

def _auth(wfb_session: Optional[str] = Cookie(default=None)):
    if not wfb_session:
        raise HTTPException(401, "Not authenticated")
    try:
        jwt.decode(wfb_session, JWT_SECRET, algorithms=[ALGORITHM])
    except Exception:
        raise HTTPException(401, "Session expired — please log in again")


# ── Run history — anonymous metadata only ────────────────────────────────────────
@app.get("/api/runs")
async def list_runs(_=Depends(_auth)):
    return {"runs": await store.list_runs()}

@app.delete("/api/runs/{run_id}")
async def delete_run(run_id: str, _=Depends(_auth)):
    await store.delete_run(run_id)
    return {"ok": True}


# ── Generate ─────────────────────────────────────────────────────────────────────
@app.post("/api/generate")
async def start_generation(
    background_tasks: BackgroundTasks,
    zip_file:      UploadFile = File(...),
    template_file: UploadFile = File(...),
    naming:        str = "student_number",
    prefix:        str = "",
    scores_json:   str = "[]",
    _=Depends(_auth),
):
    if not zip_file.filename.endswith(".zip"):
        raise HTTPException(400, "zip_file must be .zip")
    if not template_file.filename.endswith(".pdf"):
        raise HTTPException(400, "template_file must be .pdf")

    # Read into memory — never touches disk
    zip_bytes      = await zip_file.read()
    template_bytes = await template_file.read()
    await zip_file.close()
    await template_file.close()

    try:
        scores = json.loads(scores_json)
    except Exception:
        scores = []

    _purge_old_jobs()

    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "status": "queued", "progress": 0, "total": 0,
        "created_at_mono": time.monotonic(),
        # No student names stored in job state
    }

    background_tasks.add_task(
        _run, job_id, zip_bytes, template_bytes, scores, naming, prefix
    )
    return {"job_id": job_id}


@app.get("/api/generate/{job_id}/status")
async def job_status(job_id: str, _=Depends(_auth)):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found or expired")
    # Return only progress counts — never personal data
    return {
        "status":   job["status"],
        "progress": job["progress"],
        "total":    job["total"],
        "label":    f"Processing {job['progress']} of {job['total']}",
        "ok":       job.get("ok", 0),
        "errors":   job.get("errors", 0),
        "run_id":   job.get("run_id"),
    }


@app.get("/api/generate/{job_id}/download")
async def download_result(job_id: str, _=Depends(_auth)):
    """
    Stream ZIP to browser.
    After streaming: ZIP bytes deleted from memory immediately.
    This is a one-time download — subsequent requests return 410 Gone.
    """
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found or expired")
    if job["status"] != "done":
        raise HTTPException(425, "Not ready yet")

    zip_data = job.pop("zip_data", None)   # Remove from dict — one-time access
    if not zip_data:
        raise HTTPException(410, "Already downloaded — generate again if needed")

    # Clean up the job entirely
    jobs.pop(job_id, None)

    ts = datetime.now().strftime("%Y%m%d_%H%M")
    return StreamingResponse(
        io.BytesIO(zip_data),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="MCQ_Scripts_{ts}.zip"',
                 "Cache-Control": "no-store"},
    )


async def _run(job_id, zip_bytes, template_bytes, scores, naming, prefix):
    jobs[job_id]["status"] = "running"

    def on_progress(done, total, _name_ignored):
        # _name_ignored: student name passed from generator but never stored/logged
        jobs[job_id].update({"progress": done, "total": total})

    def on_error(_name_ignored, _err):
        jobs[job_id]["errors"] = jobs[job_id].get("errors", 0) + 1

    try:
        result = await asyncio.to_thread(
            generate_all_pdfs,
            zip_bytes, template_bytes, scores, naming, prefix,
            on_progress, on_error
        )

        # Build ZIP in memory
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for fname, data in result["pdfs"].items():
                zf.writestr(fname, data)
        buf.seek(0)

        # Save anonymous-only metadata to history
        ok_count  = result["summary"]["ok"]
        err_count = result["summary"]["errors"]
        await store.save_run(job_id, {
            "run_id":      job_id,
            "created_at":  datetime.now(timezone.utc).isoformat(),
            "naming":      naming,
            "prefix":      prefix,
            "ok":          ok_count,
            "error_count": err_count,
            # No student names, numbers, institutions, or content stored
        })

        jobs[job_id].update({
            "status":  "done",
            "run_id":  job_id,
            "ok":      ok_count,
            "errors":  err_count,
            "zip_data": buf.read(),   # Held only until downloaded
        })
        log.info("Run %s: %d PDFs generated, %d errors", job_id[:8], ok_count, err_count)

    except Exception as exc:
        log.error("Run %s failed: %s", job_id[:8], type(exc).__name__)
        jobs[job_id].update({"status": "error"})

    finally:
        # Explicit release — don't wait for GC
        del zip_bytes, template_bytes


# ── Security headers on every response ───────────────────────────────────────────
@app.middleware("http")
async def _security_headers(request: Request, call_next):
    response = await call_next(request)
    h = response.headers
    h["X-Content-Type-Options"]    = "nosniff"
    h["X-Frame-Options"]           = "DENY"
    h["Referrer-Policy"]           = "no-referrer"
    h["Permissions-Policy"]        = "geolocation=(), microphone=(), camera=()"
    h["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    h["Content-Security-Policy"]   = (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' https://fonts.googleapis.com; "
        "font-src https://fonts.gstatic.com; "
        "img-src 'self' data:; "
        "connect-src 'self';"
    )
    h["Cache-Control"] = "no-store"
    return response


@app.get("/health")
async def health():
    return {"ok": True}
