from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


def now_utc():
    # Timezone-aware current time (what SQLModel expects)
    return datetime.now(timezone.utc)


class Draft(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    owner_id: Optional[int] = Field(default=None, foreign_key="user.id", index=True)
    text: str
    brand_name: str = ""
    brand_guidelines_json: str = "[]"
    approved_facts_json: str = "[]"
    content_type: str = "social_post"
    author: str = "creator"
    status: str = "in_review"  # draft / in_review / approved / needs_revision
    version: int = 1
    created_at: datetime = Field(default_factory=now_utc)


class Finding(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    draft_id: int = Field(foreign_key="draft.id")
    issue: str = ""
    severity: str = "medium"
    confidence: Optional[float] = None
    category: Optional[str] = None
    quote: str  # the exact flagged text
    evidence_level: str  # confirmed / possible / insufficient
    explanation: str
    source_id: Optional[str] = None  # e.g. RULE-07 or FACT-03
    source_text: Optional[str] = None
    suggestion: Optional[str] = None
    status: str = "pending"  # pending / accepted / edited / rejected


class Decision(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    finding_id: int = Field(foreign_key="finding.id")
    action: str  # accept / edit / reject / request_revision
    edited_text: Optional[str] = None
    reason: Optional[str] = None
    reviewer: str
    role: str
    created_at: datetime = Field(default_factory=now_utc)


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    full_name: str
    password_hash: str
    role: str = "creator"
    created_at: datetime = Field(default_factory=now_utc)


class BrandKitRecord(SQLModel, table=True):
    id: Optional[int] = Field(default=1, primary_key=True)
    guidelines_json: str = "[]"
    facts_json: str = "[]"
    terminology_json: str = "[]"
    assets_json: str = "[]"
    updated_by: Optional[int] = Field(default=None, foreign_key="user.id")
    updated_at: datetime = Field(default_factory=now_utc)


class ReviewComment(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    draft_id: int = Field(foreign_key="draft.id", index=True)
    author_id: int = Field(foreign_key="user.id")
    body: str
    created_at: datetime = Field(default_factory=now_utc)