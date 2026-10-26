from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


def now_utc():
    # Timezone-aware current time (what SQLModel expects)
    return datetime.now(timezone.utc)


class Draft(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    text: str
    content_type: str = "social_post"
    author: str = "creator"
    status: str = "in_review"  # draft / in_review / approved / needs_revision
    version: int = 1
    created_at: datetime = Field(default_factory=now_utc)


class Finding(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    draft_id: int = Field(foreign_key="draft.id")
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
    reviewer: str
    role: str
    created_at: datetime = Field(default_factory=now_utc)