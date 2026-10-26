from typing import Optional

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlmodel import Session, select

from backend.db import get_session, init_db
from backend.fake_ai import analyze
from backend.models import Decision, Draft, Finding

app = FastAPI(title="InkGuard API")

# Lets the React frontend (a different address) call this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # we will tighten this after deployment
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    init_db()


# ---------- Request shapes ----------
class DraftIn(BaseModel):
    text: str
    content_type: str = "social_post"
    author: str = "creator"


class DecisionIn(BaseModel):
    action: str  # accept / edit / reject / request_revision
    edited_text: Optional[str] = None
    reviewer: str
    role: str


# ---------- Basic ----------
@app.get("/")
def home():
    return {"message": "Welcome to InkGuard API"}


@app.get("/health")
def health_check():
    return {"status": "healthy"}


# ---------- Drafts ----------
@app.post("/drafts")
def create_draft(body: DraftIn, session: Session = Depends(get_session)):
    if not body.text.strip():
        raise HTTPException(400, "Draft text cannot be empty")
    draft = Draft(**body.model_dump())
    session.add(draft)
    session.commit()
    session.refresh(draft)
    for f in analyze(draft.text):
        session.add(Finding(draft_id=draft.id, **f))
    session.commit()
    return {"id": draft.id, "status": draft.status}


@app.get("/drafts")
def list_drafts(session: Session = Depends(get_session)):
    return session.exec(select(Draft)).all()


@app.get("/drafts/{draft_id}")
def get_draft(draft_id: int, session: Session = Depends(get_session)):
    draft = session.get(Draft, draft_id)
    if not draft:
        raise HTTPException(404, "Draft not found")
    return draft


@app.get("/drafts/{draft_id}/findings")
def get_findings(draft_id: int, session: Session = Depends(get_session)):
    return session.exec(select(Finding).where(Finding.draft_id == draft_id)).all()


# ---------- Decisions ----------
@app.post("/findings/{finding_id}/decision")
def decide(finding_id: int, body: DecisionIn, session: Session = Depends(get_session)):
    finding = session.get(Finding, finding_id)
    if not finding:
        raise HTTPException(404, "Finding not found")
    if body.role not in ("reviewer", "manager"):
        raise HTTPException(403, "Only reviewers or managers can decide")
    status_map = {
        "accept": "accepted",
        "edit": "edited",
        "reject": "rejected",
        "request_revision": "pending",
    }
    if body.action not in status_map:
        raise HTTPException(400, "Unknown action")
    finding.status = status_map[body.action]
    session.add(Decision(finding_id=finding_id, **body.model_dump()))
    session.add(finding)
    session.commit()
    return {"ok": True, "finding_status": finding.status}


@app.get("/drafts/{draft_id}/history")
def history(draft_id: int, session: Session = Depends(get_session)):
    findings = session.exec(select(Finding).where(Finding.draft_id == draft_id)).all()
    ids = [f.id for f in findings]
    if not ids:
        return []
    return session.exec(select(Decision).where(Decision.finding_id.in_(ids))).all()
