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

export interface AnalyzeResponse {
  status: string;
  findings: Finding[];
  message?: string;
}

export type AnalyzeErrorKind = 'network' | 'server' | 'invalid-json' | 'timeout';
export class AnalyzeError extends Error {
  readonly kind: AnalyzeErrorKind;
  readonly status?: number;
  constructor(kind: AnalyzeErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'AnalyzeError';
    this.kind = kind;
    this.status = status;
  }
}

export type UserRole = 'Creator' | 'Manager' | 'Reviewer';
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
  guidelines: string[];
  facts: string[];
  findings: Finding[];
  decisions: Record<string, LocalDecision>;
  analysisStatus: 'idle' | 'loading' | 'success' | 'not-configured' | 'error' | 'demo';
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
