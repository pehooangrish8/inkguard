import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
import time
import zipfile
from io import BytesIO
from xml.etree import ElementTree

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pypdf import PdfReader
from pypdf.errors import FileNotDecryptedError, PdfReadError
from sqlmodel import Session, select

from backend.ai_engine import (
    AnalysisNotConfiguredError,
    AnalysisProviderError,
    analyze_content,
)
from backend.api_schemas import (
    AnalyzeRequest,
    AnalyzeFinding,
    AnalyzeResponse,
    BrandKitRequest,
    CommentRequest,
    DecisionIn,
    LoginRequest,
    RegisterRequest,
    ReviewCreateResponse,
    ReviewDetailResponse,
    ReviewFinding,
    ReviewStatusRequest,
    TeamUserRequest,
    UserResponse,
)
from backend.db import get_session, init_db
from backend.models import (
    BrandKitRecord,
    Decision,
    Draft,
    Finding,
    ReviewComment,
    User,
)
from backend.models import now_utc
from backend.rules_engine import analyze_rules

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
app = FastAPI(title="InkGuard API")
allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        "INKGUARD_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["Authorization", "Content-Type"],
)

TOKEN_TTL_SECONDS = 60 * 60 * 12
PASSWORD_ITERATIONS = 310_000
MAX_UPLOAD_BYTES = 10 * 1024 * 1024


@app.on_event("startup")
def on_startup():
    init_db()


def _secret_key() -> bytes:
    value = os.getenv("INKGUARD_SECRET_KEY", "")
    if len(value) < 32:
        raise HTTPException(
            503,
            "Set INKGUARD_SECRET_KEY to a random value of at least 32 characters.",
        )
    return value.encode("utf-8")


def _password_hash(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    derived = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS
    )
    return f"{base64.urlsafe_b64encode(salt).decode()}:{base64.urlsafe_b64encode(derived).decode()}"


def _password_matches(password: str, saved: str) -> bool:
    try:
        salt_text, expected = saved.split(":", 1)
        salt = base64.urlsafe_b64decode(salt_text)
        candidate = _password_hash(password, salt).split(":", 1)[1]
        return hmac.compare_digest(candidate, expected)
    except (ValueError, TypeError):
        return False


def _token_for(user: User) -> str:
    payload = base64.urlsafe_b64encode(
        json.dumps(
            {
                "sub": user.id,
                "exp": int(time.time()) + TOKEN_TTL_SECONDS,
            },
            separators=(",", ":"),
        ).encode()
    ).rstrip(b"=")
    signature = hmac.new(_secret_key(), payload, hashlib.sha256).digest()
    return f"{payload.decode()}.{base64.urlsafe_b64encode(signature).decode().rstrip('=')}"


def require_user(request: Request, session: Session = Depends(get_session)) -> User:
    authorization = request.headers.get("authorization", "")
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Sign in to continue.")
    token = authorization.removeprefix("Bearer ").strip()
    try:
        payload_part, signature_part = token.split(".", 1)
        expected = hmac.new(
            _secret_key(), payload_part.encode(), hashlib.sha256
        ).digest()
        signature = base64.urlsafe_b64decode(signature_part + "=" * (-len(signature_part) % 4))
        if not hmac.compare_digest(signature, expected):
            raise ValueError("Invalid signature")
        payload = base64.urlsafe_b64decode(
            payload_part + "=" * (-len(payload_part) % 4)
        )
        claims = json.loads(payload)
        if int(claims["exp"]) < int(time.time()):
            raise ValueError("Expired token")
        user = session.get(User, int(claims["sub"]))
        if not user:
            raise ValueError("Unknown user")
        return user
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise HTTPException(401, "Your session is invalid or expired. Sign in again.") from exc


def require_role(*roles: str):
    def check(user: User = Depends(require_user)) -> User:
        if user.role not in roles:
            raise HTTPException(403, "Your account role cannot perform this action.")
        return user

    return check


def user_response(user: User) -> UserResponse:
    return UserResponse(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
    )


@app.get("/")
def home():
    return {"message": "Welcome to InkGuard API"}


@app.get("/health")
def health_check():
    return {"status": "healthy"}


@app.post("/auth/register")
def register(body: RegisterRequest, session: Session = Depends(get_session)):
    _secret_key()
    if session.exec(select(User)).first():
        raise HTTPException(
            403, "The workspace is already initialized. Ask its admin to create your account."
        )
    email = body.email.strip().lower()
    if session.exec(select(User).where(User.email == email)).first():
        raise HTTPException(409, "An account with that email already exists.")
    user = User(
        email=email,
        full_name=body.full_name.strip(),
        password_hash=_password_hash(body.password),
        role="admin",
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return {"token": _token_for(user), "user": user_response(user)}


@app.post("/auth/login")
def login(body: LoginRequest, session: Session = Depends(get_session)):
    _secret_key()
    user = session.exec(
        select(User).where(User.email == body.email.strip().lower())
    ).first()
    if not user or not _password_matches(body.password, user.password_hash):
        raise HTTPException(401, "Email or password is incorrect.")
    return {"token": _token_for(user), "user": user_response(user)}


@app.get("/auth/me", response_model=UserResponse)
def current_user(user: User = Depends(require_user)):
    return user_response(user)


@app.get("/auth/users", response_model=list[UserResponse])
def list_users(
    session: Session = Depends(get_session),
    _: User = Depends(require_role("admin")),
):
    return [user_response(user) for user in session.exec(select(User)).all()]


@app.post("/auth/users", response_model=UserResponse)
def create_team_user(
    body: TeamUserRequest,
    session: Session = Depends(get_session),
    _: User = Depends(require_role("admin")),
):
    email = body.email.strip().lower()
    if session.exec(select(User).where(User.email == email)).first():
        raise HTTPException(409, "An account with that email already exists.")
    user = User(
        email=email,
        full_name=body.full_name.strip(),
        password_hash=_password_hash(body.password),
        role=body.role,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user_response(user)


@app.get("/brand-kit")
def get_brand_kit(
    session: Session = Depends(get_session),
    _: User = Depends(require_user),
):
    record = session.get(BrandKitRecord, 1)
    if not record:
        return {"guidelines": [], "facts": [], "terminology": [], "assets": []}
    return {
        "guidelines": json.loads(record.guidelines_json),
        "facts": json.loads(record.facts_json),
        "terminology": json.loads(record.terminology_json),
        "assets": json.loads(record.assets_json),
    }


@app.put("/brand-kit")
def put_brand_kit(
    body: BrandKitRequest,
    session: Session = Depends(get_session),
    user: User = Depends(require_role("reviewer", "admin")),
):
    record = session.get(BrandKitRecord, 1) or BrandKitRecord()
    record.guidelines_json = json.dumps(body.guidelines)
    record.facts_json = json.dumps(body.facts)
    record.terminology_json = json.dumps(
        [item.model_dump() for item in body.terminology]
    )
    record.assets_json = json.dumps(body.assets)
    record.updated_by = user.id
    record.updated_at = now_utc()
    session.add(record)
    session.commit()
    return {"ok": True, "updated_at": record.updated_at}


def _analyze(
    body: AnalyzeRequest,
    image: bytes | None = None,
    image_mime: str | None = None,
    alt_text: str = "",
) -> AnalyzeResponse:
    if not body.content.strip() and image is None:
        raise HTTPException(400, "Draft content or an image is required.")
    mode = os.getenv("INKGUARD_AI_MODE", "rules").strip().lower()
    if mode == "rules":
        result = analyze_rules(
            content=body.content,
            brand_guidelines=body.brand_guidelines,
            approved_facts=body.approved_facts,
            has_image=image is not None,
        )
        return AnalyzeResponse(
            status="success",
            findings=result["findings"],
            message=result["message"],
        )
    if mode != "openrouter":
        raise HTTPException(
            500,
            "INKGUARD_AI_MODE must be either 'rules' or 'openrouter'.",
        )
    try:
        result = analyze_content(
            content=body.content,
            brand_name=body.brand_name,
            brand_guidelines="\n".join(body.brand_guidelines),
            approved_facts=body.approved_facts,
            image=image,
            image_mime=image_mime,
            alt_text=alt_text,
        )
    except AnalysisNotConfiguredError as exc:
        return AnalyzeResponse(
            status="analysis_not_configured", findings=[], message=str(exc)
        )
    except AnalysisProviderError as exc:
        logger.warning("AI provider request failed: %s", exc)
        raise HTTPException(502, str(exc)) from exc
    return AnalyzeResponse(
        status="success",
        findings=result["findings"],
        message=result["message"],
    )


@app.post("/analyze", response_model=AnalyzeResponse)
def analyze_draft(
    body: AnalyzeRequest,
    _: User = Depends(require_user),
):
    return _analyze(body)


def _persist_review(
    body: AnalyzeRequest,
    analysis: AnalyzeResponse,
    user: User,
    session: Session,
    content_type: str = "text",
    alt_text: str = "",
) -> ReviewCreateResponse:
    if analysis.status == "analysis_not_configured":
        return ReviewCreateResponse(
            status=analysis.status, findings=[], message=analysis.message
        )
    draft = Draft(
        owner_id=user.id,
        text=body.content or "[Image review]",
        brand_name=body.brand_name,
        brand_guidelines_json=json.dumps(body.brand_guidelines),
        approved_facts_json=json.dumps(body.approved_facts),
        content_type=content_type,
    )
    session.add(draft)
    session.flush()
    records = []
    for item in analysis.findings:
        finding = Finding(
            draft_id=draft.id,
            issue=item.issue,
            severity=item.severity,
            confidence=item.confidence,
            category=item.category,
            quote=item.evidence or item.issue,
            evidence_level=item.severity,
            explanation=item.explanation or "",
            source_text=item.brand_rule,
            suggestion=item.suggested_correction,
        )
        session.add(finding)
        records.append(finding)
    session.commit()
    session.refresh(draft)
    for item in records:
        session.refresh(item)
    return ReviewCreateResponse(
        status="success",
        draft_id=draft.id,
        content=draft.text,
        findings=[_review_finding(item) for item in records],
        message=analysis.message,
    )


@app.post("/reviews", response_model=ReviewCreateResponse)
def create_review(
    body: AnalyzeRequest,
    session: Session = Depends(get_session),
    user: User = Depends(require_user),
):
    analysis = _analyze(body)
    return _persist_review(body, analysis, user, session)


def _extract_upload(file_name: str, content_type: str, data: bytes) -> tuple[str, bytes | None, str | None]:
    suffix = file_name.lower().rsplit(".", 1)[-1] if "." in file_name else ""
    if suffix in {"txt", "md"}:
        try:
            return data.decode("utf-8-sig"), None, None
        except UnicodeDecodeError as exc:
            raise HTTPException(422, "Text files must use UTF-8 encoding.") from exc
    if suffix == "pdf" and content_type == "application/pdf":
        try:
            text = "\n".join(
                page.extract_text() or "" for page in PdfReader(BytesIO(data)).pages
            )
        except (PdfReadError, FileNotDecryptedError, ValueError, EOFError) as exc:
            raise HTTPException(422, "The PDF could not be read or is password protected.") from exc
        if not text.strip():
            raise HTTPException(422, "No readable text was extracted from this PDF.")
        return text, None, None
    if suffix == "docx" and content_type in {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/zip",
    }:
        try:
            with zipfile.ZipFile(BytesIO(data)) as archive:
                document = archive.getinfo("word/document.xml")
                if document.file_size > 20 * 1024 * 1024:
                    raise HTTPException(413, "The extracted DOCX document is too large.")
                root = ElementTree.fromstring(archive.read("word/document.xml"))
            text = "\n".join(
                "".join(node.itertext())
                for node in root.iter()
                if node.tag.endswith("}p")
            )
        except (KeyError, zipfile.BadZipFile, ElementTree.ParseError) as exc:
            raise HTTPException(422, "The DOCX file could not be read.") from exc
        if not text.strip():
            raise HTTPException(422, "No readable text was extracted from this DOCX.")
        return text, None, None
    if suffix in {"png", "jpg", "jpeg"} and content_type in {"image/png", "image/jpeg"}:
        if content_type == "image/png" and not data.startswith(b"\x89PNG\r\n\x1a\n"):
            raise HTTPException(422, "The uploaded file is not a valid PNG image.")
        if content_type == "image/jpeg" and not data.startswith(b"\xff\xd8\xff"):
            raise HTTPException(422, "The uploaded file is not a valid JPEG image.")
        return "", data, content_type
    raise HTTPException(415, "Upload a text, Markdown, PDF, DOCX, PNG, or JPEG file.")


@app.post("/reviews/upload", response_model=ReviewCreateResponse)
async def upload_review(
    file: UploadFile = File(...),
    brand_name: str = Form(...),
    draft_context: str = Form(""),
    brand_guidelines: str = Form("[]"),
    approved_facts: str = Form("[]"),
    alt_text: str = Form(""),
    session: Session = Depends(get_session),
    user: User = Depends(require_user),
):
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Files must be 10 MB or smaller.")
    if len(brand_name) > 300 or len(alt_text) > 2000 or len(draft_context) > 100_000:
        raise HTTPException(422, "An upload review field exceeds its allowed length.")
    try:
        guidelines = json.loads(brand_guidelines)
        facts = json.loads(approved_facts)
    except json.JSONDecodeError as exc:
        raise HTTPException(400, "Brand guidelines and facts must be JSON arrays.") from exc
    if not isinstance(guidelines, list) or not all(isinstance(item, str) for item in guidelines):
        raise HTTPException(400, "Brand guidelines must be an array of strings.")
    if not isinstance(facts, list) or not all(isinstance(item, str) for item in facts):
        raise HTTPException(400, "Approved facts must be an array of strings.")
    extracted_text, image, image_mime = _extract_upload(
        file.filename or "", file.content_type or "", data
    )
    text = "\n\n".join(part for part in (draft_context.strip(), extracted_text.strip()) if part)
    request_body = AnalyzeRequest(
        brand_name=brand_name,
        content=text or "Review the supplied image for visual brand consistency.",
        brand_guidelines=guidelines,
        approved_facts=facts,
    )
    analysis = _analyze(request_body, image=image, image_mime=image_mime, alt_text=alt_text)
    if image is not None and not alt_text.strip() and analysis.status == "success":
        analysis.findings.append(
            AnalyzeFinding(
                issue="Image alternative text was not supplied",
                severity="medium",
                evidence=file.filename or "Uploaded image",
                brand_rule="Images need a useful text alternative when they convey information.",
                explanation="No alternative text was provided for accessibility review.",
                suggested_correction="Add concise alt text describing the image's relevant content or purpose.",
                confidence=1.0,
                category="Accessibility",
            )
        )
    return _persist_review(
        request_body, analysis, user, session, content_type=file.content_type or "file", alt_text=alt_text
    )


@app.get("/reviews")
def list_reviews(
    session: Session = Depends(get_session),
    _: User = Depends(require_user),
):
    reviews = session.exec(select(Draft).order_by(Draft.created_at.desc())).all()
    return [
        {
            "id": item.id,
            "brand_name": item.brand_name,
            "status": item.status,
            "content_type": item.content_type,
            "created_at": item.created_at,
            "owner_id": item.owner_id,
        }
        for item in reviews
    ]


@app.get("/reviews/{draft_id}", response_model=ReviewDetailResponse)
def get_review(
    draft_id: int,
    session: Session = Depends(get_session),
    _: User = Depends(require_user),
):
    draft = session.get(Draft, draft_id)
    if not draft:
        raise HTTPException(404, "Review not found")
    findings = session.exec(select(Finding).where(Finding.draft_id == draft_id)).all()
    return ReviewDetailResponse(
        id=draft.id,
        status=draft.status,
        brand_name=draft.brand_name,
        content=draft.text,
        brand_guidelines=json.loads(draft.brand_guidelines_json),
        approved_facts=json.loads(draft.approved_facts_json),
        created_at=draft.created_at,
        findings=[_review_finding(record) for record in findings],
    )


def _review_finding(record: Finding) -> ReviewFinding:
    return ReviewFinding(
        id=record.id,
        status=record.status,
        issue=record.issue or record.quote,
        severity=record.severity,
        evidence=record.quote,
        brand_rule=record.source_text,
        explanation=record.explanation,
        suggested_correction=record.suggestion,
        confidence=record.confidence,
        category=record.category,
    )


@app.post("/findings/{finding_id}/decision")
def decide(
    finding_id: int,
    body: DecisionIn,
    session: Session = Depends(get_session),
    user: User = Depends(require_role("reviewer", "admin")),
):
    finding = session.get(Finding, finding_id)
    if not finding:
        raise HTTPException(404, "Finding not found")
    action = body.action
    status_map = {
        "accept": "accepted",
        "edit": "edited",
        "reject": "rejected",
        "request_revision": "pending",
    }
    if action not in status_map:
        raise HTTPException(400, "Unknown decision action.")
    finding.status = status_map[action]
    session.add(
        Decision(
            finding_id=finding_id,
            action=action,
            edited_text=body.edited_text,
            reason=body.reason,
            reviewer=user.full_name,
            role=user.role,
        )
    )
    session.add(finding)
    session.commit()
    return {"ok": True, "finding_status": finding.status}


@app.get("/drafts/{draft_id}/history")
def history(
    draft_id: int,
    session: Session = Depends(get_session),
    _: User = Depends(require_user),
):
    if not session.get(Draft, draft_id):
        raise HTTPException(404, "Review not found")
    findings = session.exec(select(Finding).where(Finding.draft_id == draft_id)).all()
    ids = [item.id for item in findings]
    if not ids:
        return []
    return session.exec(
        select(Decision).where(Decision.finding_id.in_(ids)).order_by(Decision.created_at)
    ).all()


@app.get("/reviews/{draft_id}/comments")
def list_comments(
    draft_id: int,
    session: Session = Depends(get_session),
    _: User = Depends(require_user),
):
    if not session.get(Draft, draft_id):
        raise HTTPException(404, "Review not found")
    comments = session.exec(
        select(ReviewComment).where(ReviewComment.draft_id == draft_id).order_by(ReviewComment.created_at)
    ).all()
    return [
        {
            "id": item.id,
            "body": item.body,
            "author": session.get(User, item.author_id).full_name,
            "created_at": item.created_at,
        }
        for item in comments
    ]


@app.post("/reviews/{draft_id}/comments")
def add_comment(
    draft_id: int,
    body: CommentRequest,
    session: Session = Depends(get_session),
    user: User = Depends(require_user),
):
    if not session.get(Draft, draft_id):
        raise HTTPException(404, "Review not found")
    comment = ReviewComment(draft_id=draft_id, author_id=user.id, body=body.body.strip())
    session.add(comment)
    session.commit()
    session.refresh(comment)
    return {
        "id": comment.id,
        "body": comment.body,
        "author": user.full_name,
        "created_at": comment.created_at,
    }


@app.post("/reviews/{draft_id}/status")
def update_review_status(
    draft_id: int,
    body: ReviewStatusRequest,
    session: Session = Depends(get_session),
    user: User = Depends(require_role("reviewer", "admin")),
):
    draft = session.get(Draft, draft_id)
    if not draft:
        raise HTTPException(404, "Review not found")
    if body.status == "approved":
        pending = session.exec(
            select(Finding).where(
                Finding.draft_id == draft_id, Finding.status == "pending"
            )
        ).first()
        if pending:
            raise HTTPException(409, "Resolve all findings before approving this review.")
    draft.status = body.status
    session.add(draft)
    session.add(
        ReviewComment(
            draft_id=draft_id,
            author_id=user.id,
            body=f"Review status changed to {body.status.replace('_', ' ')}.",
        )
    )
    session.commit()
    return {"id": draft.id, "status": draft.status}


@app.get("/insights")
def insights(
    session: Session = Depends(get_session),
    _: User = Depends(require_role("reviewer", "admin")),
):
    findings = session.exec(select(Finding)).all()
    by_category: dict[str, int] = {}
    by_severity: dict[str, int] = {}
    for item in findings:
        category = item.category or "Uncategorized"
        by_category[category] = by_category.get(category, 0) + 1
        by_severity[item.severity] = by_severity.get(item.severity, 0) + 1
    return {
        "review_count": len(session.exec(select(Draft)).all()),
        "finding_count": len(findings),
        "by_category": by_category,
        "by_severity": by_severity,
    }
