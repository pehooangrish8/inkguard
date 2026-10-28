from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class AnalyzeRequest(BaseModel):
    brand_name: str = Field(max_length=300)
    content: str = Field(max_length=100_000)
    brand_guidelines: list[str] = Field(max_length=100)
    approved_facts: list[str] = Field(max_length=100)


class AnalyzeFinding(BaseModel):
    issue: str
    severity: Literal["low", "medium", "high", "critical"]
    evidence: str | None = None
    brand_rule: str | None = None
    explanation: str | None = None
    suggested_correction: str | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    category: str | None = None


class AnalyzeResponse(BaseModel):
    status: Literal["success", "analysis_not_configured"]
    findings: list[AnalyzeFinding]
    message: str | None = None


class ReviewFinding(AnalyzeFinding):
    id: int
    status: Literal["pending", "accepted", "edited", "rejected"]


class ReviewCreateResponse(BaseModel):
    status: Literal["success", "analysis_not_configured"]
    draft_id: int | None = None
    content: str | None = None
    findings: list[ReviewFinding]
    message: str | None = None


class ReviewDetailResponse(BaseModel):
    id: int
    status: str
    brand_name: str
    content: str
    brand_guidelines: list[str]
    approved_facts: list[str]
    created_at: datetime
    findings: list[ReviewFinding]


class RegisterRequest(BaseModel):
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=254)
    full_name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=12, max_length=256)


class LoginRequest(BaseModel):
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=254)
    password: str


class UserResponse(BaseModel):
    id: int
    email: str
    full_name: str
    role: Literal["creator", "reviewer", "admin"]


class TeamUserRequest(RegisterRequest):
    role: Literal["creator", "reviewer", "admin"] = "creator"


class TerminologyPair(BaseModel):
    preferred: str = Field(min_length=1, max_length=200)
    avoided: str = Field(min_length=1, max_length=200)


class BrandKitRequest(BaseModel):
    guidelines: list[str] = Field(default_factory=list, max_length=100)
    facts: list[str] = Field(default_factory=list, max_length=100)
    terminology: list[TerminologyPair] = Field(default_factory=list, max_length=100)
    assets: list[str] = Field(default_factory=list, max_length=100)


class CommentRequest(BaseModel):
    body: str = Field(min_length=1, max_length=5000)


class DecisionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: Literal["accept", "edit", "reject", "request_revision"]
    edited_text: str | None = None
    reason: str | None = None


class ReviewStatusRequest(BaseModel):
    status: Literal["approved", "needs_revision"]
