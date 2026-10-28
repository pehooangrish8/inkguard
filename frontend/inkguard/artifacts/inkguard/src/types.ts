export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface Finding {
  issue: string;
  id?: string;
  severity?: Severity;
  evidence?: string;
  brand_rule?: string;
  explanation?: string;
  suggested_correction?: string;
  confidence?: number;
  category?: string;
}

export interface AnalyzeRequest {
  brand_name: string;
  content: string;
  brand_guidelines: string[];
  approved_facts: string[];
}

export interface AnalyzeFinding extends Omit<Finding, 'evidence' | 'brand_rule' | 'explanation' | 'suggested_correction' | 'confidence' | 'category'> {
  severity: Severity;
  evidence?: string | null;
  brand_rule?: string | null;
  explanation?: string | null;
  suggested_correction?: string | null;
  confidence?: number | null;
  category?: string | null;
}

export interface AnalyzeResponse {
  status: 'success' | 'analysis_not_configured';
  findings: AnalyzeFinding[];
  message?: string | null;
}

export interface ReviewFinding extends Omit<AnalyzeFinding, 'id'> {
  id: number;
  status: 'pending' | 'accepted' | 'edited' | 'rejected';
}

export interface ReviewCreateResponse {
  status: 'success' | 'analysis_not_configured';
  draft_id: number | null;
  content?: string | null;
  findings: ReviewFinding[];
  message?: string | null;
}

export interface ReviewDetail {
  id: number;
  status: string;
  brand_name: string;
  content: string;
  brand_guidelines: string[];
  approved_facts: string[];
  created_at: string;
  findings: ReviewFinding[];
}

export type PersistedDecisionAction = 'accept' | 'edit' | 'reject' | 'request_revision';

export interface SaveDecisionRequest {
  action: PersistedDecisionAction;
  edited_text?: string;
  reason?: string;
}

export interface SaveDecisionResponse {
  ok: boolean;
  finding_status: ReviewFinding['status'];
}

export interface ReviewHistoryItem {
  id: number;
  finding_id: number;
  action: PersistedDecisionAction;
  edited_text?: string | null;
  reason?: string | null;
  reviewer: string;
  role: string;
  created_at: string;
}

export type AnalyzeErrorKind = 'network' | 'server' | 'invalid-json' | 'timeout';
export class ApiError extends Error {
  readonly kind: AnalyzeErrorKind;
  readonly status?: number;
  constructor(kind: AnalyzeErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
  }
}

export class AnalyzeError extends ApiError {
  constructor(kind: AnalyzeErrorKind, message: string, status?: number) {
    super(kind, message, status);
    this.name = 'AnalyzeError';
  }
}

export type Decision = 'accepted' | 'rejected' | 'edited';
export interface LocalDecision {
  findingId: string;
  decision: Decision;
  replacement?: string;
  reason?: string;
  at: string;
}
export interface ReviewSession {
  brand: string;
  content: string;
  reviewId?: number;
  guidelines: string[];
  facts: string[];
  findings: Finding[];
  decisions: Record<string, LocalDecision>;
  analysisStatus: 'idle' | 'loading' | 'success' | 'not-configured' | 'error' | 'demo' | 'local';
  message?: string;
  errorKind?: AnalyzeErrorKind;
  errorStatus?: number;
}
export interface BrandKit {
  guidelines: string[];
  facts: string[];
  terminology: { preferred: string; avoided: string }[];
  assets: string[];
}
