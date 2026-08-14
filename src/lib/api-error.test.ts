import { describe, expect, it } from 'vitest';
import {
  apiErrorFromResponse,
  deserializeLitosApiError,
  isMonetizationError,
  serializeLitosApiError,
} from './api-error';

describe('typed API errors', () => {
  it('preserves a structured premium denial across extension message boundaries', async () => {
    const error = await apiErrorFromResponse(new Response(JSON.stringify({
      error: 'Automatic submission needs Litos+.',
      code: 'feature_locked',
      feature_id: 'automatic_submission',
      entitlement_revision: '12',
      retryable: false,
    }), { status: 402 }));
    expect(isMonetizationError(error)).toBe(true);
    const restored = deserializeLitosApiError(serializeLitosApiError(error));
    expect(restored?.status).toBe(402);
    expect(restored?.body.feature_id).toBe('automatic_submission');
    expect(restored?.body.entitlement_revision).toBe('12');
  });

  it('does not classify capacity or validation failures as paywalls', async () => {
    const capacity = await apiErrorFromResponse(new Response('busy', { status: 503 }));
    const invalid = await apiErrorFromResponse(new Response('bad', { status: 422 }));
    expect(capacity.body.code).toBe('model_unavailable');
    expect(invalid.body.code).toBe('validation_failed');
    expect(isMonetizationError(capacity)).toBe(false);
    expect(isMonetizationError(invalid)).toBe(false);
  });

  it('recognizes the backend entitlement denial contract as a paywall', async () => {
    const denial = await apiErrorFromResponse(new Response(JSON.stringify({
      error: 'This action is part of Litos+.',
      code: 'entitlement_required',
      feature: 'contact_discovery',
      reason: 'trial_company_contact_limit',
    }), { status: 402 }));
    expect(isMonetizationError(denial)).toBe(true);
  });
});
