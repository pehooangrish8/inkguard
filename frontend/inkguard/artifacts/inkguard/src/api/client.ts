import type {
  AnalyzeFinding,
  AnalyzeRequest,
  AnalyzeResponse,
  PersistedDecisionAction,
  ReviewCreateResponse,
  ReviewDetail,
  ReviewFinding,
  ReviewHistoryItem,
  SaveDecisionRequest,
  SaveDecisionResponse,
} from '../types';
import { ApiError, AnalyzeError } from '../types';

const configuredBase = import.meta.env.VITE_API_BASE_URL?.trim();
export const API_BASE_URL = (configuredBase || 'http://localhost:8000').replace(/\/$/, '');
const REQUEST_TIMEOUT_MS = 60_000;
let apiToken: string | undefined;

export function setApiToken(token?: string): void {
  apiToken = token;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAnalyzeFinding(value: unknown): value is AnalyzeFinding {
  return isRecord(value)
    && typeof value.issue === 'string'
    && ['low', 'medium', 'high', 'critical'].includes(String(value.severity));
}

function isReviewFinding(value: unknown): value is ReviewFinding {
  return isRecord(value)
    && typeof value.id === 'number'
    && ['pending', 'accepted', 'edited', 'rejected'].includes(String(value.status))
    && isAnalyzeFinding(value);
}

function isAnalyzeResponse(value: unknown): value is AnalyzeResponse {
  return isRecord(value)
    && (value.status === 'success' || value.status === 'analysis_not_configured')
    && Array.isArray(value.findings)
    && value.findings.every(isAnalyzeFinding)
    && (value.message === undefined || value.message === null || typeof value.message === 'string');
}

function isReviewCreateResponse(value: unknown): value is ReviewCreateResponse {
  return isRecord(value)
    && (value.status === 'success' || value.status === 'analysis_not_configured')
    && (value.status === 'success'
      ? typeof value.draft_id === 'number'
      : value.draft_id === null)
    && Array.isArray(value.findings)
    && value.findings.every(isReviewFinding)
    && (value.content === undefined || value.content === null || typeof value.content === 'string')
    && (value.message === undefined || value.message === null || typeof value.message === 'string');
}

function isReviewDetail(value: unknown): value is ReviewDetail {
  return isRecord(value)
    && typeof value.id === 'number'
    && typeof value.status === 'string'
    && typeof value.brand_name === 'string'
    && typeof value.content === 'string'
    && Array.isArray(value.brand_guidelines)
    && value.brand_guidelines.every((item) => typeof item === 'string')
    && Array.isArray(value.approved_facts)
    && value.approved_facts.every((item) => typeof item === 'string')
    && typeof value.created_at === 'string'
    && Array.isArray(value.findings)
    && value.findings.every(isReviewFinding);
}

function isPersistedDecisionAction(value: unknown): value is PersistedDecisionAction {
  return value === 'accept' || value === 'edit' || value === 'reject' || value === 'request_revision';
}

function isReviewHistory(value: unknown): value is ReviewHistoryItem[] {
  return Array.isArray(value) && value.every((item) => isRecord(item)
    && typeof item.id === 'number'
    && typeof item.finding_id === 'number'
    && isPersistedDecisionAction(item.action)
    && (item.edited_text === undefined || item.edited_text === null || typeof item.edited_text === 'string')
    && (item.reason === undefined || item.reason === null || typeof item.reason === 'string')
    && typeof item.reviewer === 'string'
    && typeof item.role === 'string'
    && typeof item.created_at === 'string');
}

function errorMessageFromBody(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  if (typeof body.detail === 'string') return body.detail;
  return undefined;
}

async function requestJson<T>(
  path: string,
  init: RequestInit,
  validate: (body: unknown) => body is T,
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;

  try {
    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        ...init,
        headers: {
          ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
          ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
          ...init.headers,
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new ApiError('timeout', 'The API request took longer than 60 seconds. Try again.');
      }
      throw new ApiError('network', 'InkGuard could not reach the API. Check the service and CORS configuration.');
    }

    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        throw new ApiError(
          'server',
          `The API returned HTTP ${response.status}.`,
          response.status,
        );
      }
      const message = errorMessageFromBody(errorBody);
      throw new ApiError(
        'server',
        message || `The API returned HTTP ${response.status}.`,
        response.status,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new ApiError('timeout', 'The API request took longer than 60 seconds. Try again.');
      }
      throw new ApiError('invalid-json', 'The API returned an unreadable response.', response.status);
    }

    if (!validate(body)) {
      throw new ApiError('invalid-json', 'The API returned a response that does not match the expected format.', response.status);
    }

    return body;
  } finally {
    window.clearTimeout(timeout);
  }
}

function jsonPost(payload: unknown): RequestInit {
  return {
    method: 'POST',
    body: JSON.stringify(payload),
  };
}

export async function analyzeContent(payload: AnalyzeRequest): Promise<AnalyzeResponse> {
  try {
    return await requestJson('/analyze', jsonPost(payload), isAnalyzeResponse);
  } catch (error) {
    if (error instanceof ApiError) {
      throw new AnalyzeError(error.kind, error.message, error.status);
    }
    throw error;
  }
}

export function createReview(payload: AnalyzeRequest, file?: File, altText = ''): Promise<ReviewCreateResponse> {
  if (!file) return requestJson('/reviews', jsonPost(payload), isReviewCreateResponse);
  const form = new FormData();
  form.set('file', file);
  form.set('brand_name', payload.brand_name);
  form.set('draft_context', payload.content);
  form.set('brand_guidelines', JSON.stringify(payload.brand_guidelines));
  form.set('approved_facts', JSON.stringify(payload.approved_facts));
  form.set('alt_text', altText);
  return requestJson('/reviews/upload', { method: 'POST', body: form }, isReviewCreateResponse);
}

export function getReview(draftId: number): Promise<ReviewDetail> {
  return requestJson(`/reviews/${draftId}`, { method: 'GET' }, isReviewDetail);
}

export function saveDecision(
  findingId: number,
  payload: SaveDecisionRequest,
): Promise<SaveDecisionResponse> {
  return requestJson(
    `/findings/${findingId}/decision`,
    jsonPost(payload),
    (body): body is SaveDecisionResponse => isRecord(body)
      && body.ok === true
      && ['pending', 'accepted', 'edited', 'rejected'].includes(String(body.finding_status)),
  );
}

export function getReviewHistory(draftId: number): Promise<ReviewHistoryItem[]> {
  return requestJson(`/drafts/${draftId}/history`, { method: 'GET' }, isReviewHistory);
}

export interface AuthUser {
  id: number;
  email: string;
  full_name: string;
  role: 'creator' | 'reviewer' | 'admin';
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

function isAuthUser(value: unknown): value is AuthUser {
  return isRecord(value)
    && typeof value.id === 'number'
    && typeof value.email === 'string'
    && typeof value.full_name === 'string'
    && ['creator', 'reviewer', 'admin'].includes(String(value.role));
}

function isAuthResponse(value: unknown): value is AuthResponse {
  return isRecord(value) && typeof value.token === 'string' && isAuthUser(value.user);
}

export function registerAccount(payload: { email: string; full_name: string; password: string }): Promise<AuthResponse> {
  return requestJson('/auth/register', jsonPost(payload), isAuthResponse);
}

export function loginAccount(payload: { email: string; password: string }): Promise<AuthResponse> {
  return requestJson('/auth/login', jsonPost(payload), isAuthResponse);
}

export function getCurrentUser(): Promise<AuthUser> {
  return requestJson('/auth/me', { method: 'GET' }, isAuthUser);
}

export function getBrandKit(): Promise<BrandKitResponse> {
  return requestJson('/brand-kit', { method: 'GET' }, isBrandKit);
}

export interface BrandKitResponse {
  guidelines: string[];
  facts: string[];
  terminology: { preferred: string; avoided: string }[];
  assets: string[];
}

function isBrandKit(value: unknown): value is BrandKitResponse {
  return isRecord(value)
    && ['guidelines', 'facts', 'assets'].every((key) => Array.isArray(value[key]) && value[key].every((item) => typeof item === 'string'))
    && Array.isArray(value.terminology)
    && value.terminology.every((item) => isRecord(item) && typeof item.preferred === 'string' && typeof item.avoided === 'string');
}

export function saveBrandKit(value: BrandKitResponse): Promise<{ ok: boolean }> {
  return requestJson('/brand-kit', jsonPut(value), (body): body is { ok: boolean } => isRecord(body) && body.ok === true);
}

function jsonPut(payload: unknown): RequestInit {
  return { method: 'PUT', body: JSON.stringify(payload) };
}

export interface ReviewListItem {
  id: number;
  brand_name: string;
  status: string;
  content_type: string;
  created_at: string;
  owner_id: number | null;
}

export function listReviews(): Promise<ReviewListItem[]> {
  return requestJson('/reviews', { method: 'GET' }, (body): body is ReviewListItem[] => Array.isArray(body) && body.every((item) => isRecord(item) && typeof item.id === 'number'));
}

export function listTeamUsers(): Promise<AuthUser[]> {
  return requestJson('/auth/users', { method: 'GET' }, (body): body is AuthUser[] => Array.isArray(body) && body.every(isAuthUser));
}

export function createTeamUser(payload: { email: string; full_name: string; password: string; role: AuthUser['role'] }): Promise<AuthUser> {
  return requestJson('/auth/users', jsonPost(payload), isAuthUser);
}

export interface ReviewComment {
  id: number;
  body: string;
  author: string;
  created_at: string;
}

export function getComments(reviewId: number): Promise<ReviewComment[]> {
  return requestJson(`/reviews/${reviewId}/comments`, { method: 'GET' }, (body): body is ReviewComment[] => Array.isArray(body) && body.every((item) => isRecord(item) && typeof item.id === 'number' && typeof item.body === 'string' && typeof item.author === 'string' && typeof item.created_at === 'string'));
}

export function addComment(reviewId: number, body: string): Promise<ReviewComment> {
  return requestJson(`/reviews/${reviewId}/comments`, jsonPost({ body }), (value): value is ReviewComment => isRecord(value) && typeof value.id === 'number' && typeof value.body === 'string' && typeof value.author === 'string' && typeof value.created_at === 'string');
}

export interface ReviewInsights {
  review_count: number;
  finding_count: number;
  by_category: Record<string, number>;
  by_severity: Record<string, number>;
}

export function getInsights(): Promise<ReviewInsights> {
  return requestJson('/insights', { method: 'GET' }, (value): value is ReviewInsights => isRecord(value) && typeof value.review_count === 'number' && typeof value.finding_count === 'number' && isRecord(value.by_category) && isRecord(value.by_severity));
}

export function setReviewStatus(reviewId: number, status: 'approved' | 'needs_revision'): Promise<{ id: number; status: string }> {
  return requestJson(`/reviews/${reviewId}/status`, jsonPost({ status }), (value): value is { id: number; status: string } => isRecord(value) && typeof value.id === 'number' && typeof value.status === 'string');
}

// Chat is rule-based and local. No chatbot backend endpoint is currently defined.
export async function askChatbotBackend(): Promise<never> {
  throw new Error('Not implemented: no chatbot backend endpoint is defined.');
}
