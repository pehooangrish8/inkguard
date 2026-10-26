import type { AnalyzeRequest, AnalyzeResponse } from '../types';
import { AnalyzeError } from '../types';

const configuredBase = import.meta.env.VITE_API_BASE_URL?.trim();
export const API_BASE_URL = (configuredBase || 'http://localhost:8000').replace(/\/$/, '');

export async function analyzeContent(payload: AnalyzeRequest): Promise<AnalyzeResponse> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 60_000);
  try {
    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new AnalyzeError('timeout', 'The analysis took longer than 60 seconds. Try again.');
      }
      throw new AnalyzeError('network', 'InkGuard could not reach the analysis service. Check the service and CORS configuration.');
    }
    if (!response.ok) throw new AnalyzeError('server', `The analysis service returned HTTP ${response.status}.`, response.status);
    try {
      const body: unknown = await response.json();
      if (!body || typeof body !== 'object' || !('status' in body) || !('findings' in body) || !Array.isArray(body.findings)) {
        throw new Error('Invalid response shape');
      }
      return body as AnalyzeResponse;
    } catch {
      throw new AnalyzeError('invalid-json', 'The analysis service returned an unreadable response.');
    }
  } finally {
    window.clearTimeout(timeout);
  }
}

// Decision persistence is browser-only until a decisions API contract exists.
export async function saveDecision(): Promise<void> {
  return Promise.reject(new Error('Not implemented: decisions are stored in this browser session only.'));
}
// Chat is rule-based and local. No chatbot backend endpoint is currently defined.
export async function askChatbotBackend(): Promise<never> {
  return Promise.reject(new Error('Not implemented: no chatbot backend endpoint is defined.'));
}
