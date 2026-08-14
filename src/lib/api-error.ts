import type { LitosFeatureId } from './entitlements';

export type LitosErrorCode =
  | 'authentication_required'
  | 'feature_locked'
  | 'entitlement_required'
  | 'trial_expired'
  | 'quota_exceeded'
  | 'subscription_past_due'
  | 'linkedin_consent_required'
  | 'action_context_changed'
  | 'rate_limited'
  | 'model_unavailable'
  | 'llm_overloaded'
  | 'validation_failed'
  | 'plan_retired'
  | 'server_error';

export interface LitosApiErrorBody {
  error: string;
  code: LitosErrorCode;
  request_id?: string;
  feature_id?: LitosFeatureId;
  entitlement_revision?: string;
  quota?: {
    dimension: string;
    scope_id: string | null;
    used: number;
    limit: number;
    remaining: number;
    resets_at: string | null;
  };
  upgrade_url?: string;
  retryable?: boolean;
}

export type SerializedLitosApiError = {
  name: 'LitosApiError';
  message: string;
  status: number;
  body: LitosApiErrorBody;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function fallbackCode(status: number): LitosErrorCode {
  if (status === 401) return 'authentication_required';
  if (status === 402) return 'feature_locked';
  if (status === 429) return 'rate_limited';
  if (status === 400 || status === 422) return 'validation_failed';
  if (status === 503) return 'model_unavailable';
  return 'server_error';
}

export class LitosApiError extends Error {
  readonly status: number;
  readonly body: LitosApiErrorBody;

  constructor(status: number, body: LitosApiErrorBody) {
    super(body.error);
    this.name = 'LitosApiError';
    this.status = status;
    this.body = body;
  }
}

export async function apiErrorFromResponse(response: Response): Promise<LitosApiError> {
  const raw = await response.text().catch(() => response.statusText);
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const record = isRecord(parsed) ? parsed : {};
  const error = typeof record.error === 'string' && record.error.trim()
    ? record.error.trim()
    : `API error ${response.status}: ${raw || response.statusText}`;
  const code = typeof record.code === 'string' ? record.code as LitosErrorCode : fallbackCode(response.status);
  return new LitosApiError(response.status, {
    ...(record as unknown as LitosApiErrorBody),
    error,
    code,
  });
}

export function isLitosApiError(value: unknown): value is LitosApiError {
  return value instanceof LitosApiError;
}

export function isMonetizationError(value: unknown): value is LitosApiError {
  return isLitosApiError(value)
    && value.status === 402
    && ['feature_locked', 'entitlement_required', 'trial_expired', 'quota_exceeded', 'subscription_past_due'].includes(value.body.code);
}

export function serializeLitosApiError(error: LitosApiError): SerializedLitosApiError {
  return { name: 'LitosApiError', message: error.message, status: error.status, body: error.body };
}

export function deserializeLitosApiError(value: unknown): LitosApiError | null {
  if (!isRecord(value) || value.name !== 'LitosApiError' || typeof value.status !== 'number' || !isRecord(value.body)) {
    return null;
  }
  const body = value.body as unknown as LitosApiErrorBody;
  if (typeof body.error !== 'string' || typeof body.code !== 'string') return null;
  return new LitosApiError(value.status, body);
}
