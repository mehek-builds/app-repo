import { describe, expect, it, vi } from 'vitest';
import {
  createFreeSubmissionOutcomeSync,
  recordFreeSubmissionOutcome,
  type FreeSubmissionOutcomePayload,
} from './free-submission-outcome';

const payload: FreeSubmissionOutcomePayload = {
  event_id: '123e4567-e89b-42d3-a456-426614174000',
  application_id: '223e4567-e89b-42d3-a456-426614174000',
  outcome: 'confirmed',
  final_url: 'https://jobs.example.com/application/receipt',
  confirmation_text: 'Thank you for applying.',
};

describe('Free manual submission outcome sync', () => {
  it('reports a transport failure without throwing into the native employer click', async () => {
    vi.stubGlobal('chrome', { runtime: { lastError: undefined } });
    const sendMessage = vi.fn((_message, callback) => callback({ ok: false, error: 'Tracker unavailable.' }));
    await expect(recordFreeSubmissionOutcome(payload, sendMessage)).resolves.toEqual({
      ok: false,
      error: 'Tracker unavailable.',
    });
    expect(sendMessage).toHaveBeenCalledWith(
      { type: 'RECORD_FREE_SUBMISSION_OUTCOME', payload },
      expect.any(Function),
    );
    vi.unstubAllGlobals();
  });

  it('reuses one event id for every idempotent retry', async () => {
    const attempts: FreeSubmissionOutcomePayload[] = [];
    const sync = createFreeSubmissionOutcomeSync(
      payload.application_id,
      payload.event_id,
      async (attempt) => {
        attempts.push(attempt);
        return attempts.length === 1
          ? { ok: false, error: 'Response was lost.' }
          : { ok: true };
      },
    );

    await expect(sync.record('confirmed', payload.final_url, payload.confirmation_text)).resolves.toMatchObject({ ok: false });
    await expect(sync.record('confirmed', payload.final_url, payload.confirmation_text)).resolves.toEqual({ ok: true });
    expect(attempts).toHaveLength(2);
    expect(new Set(attempts.map((attempt) => attempt.event_id))).toEqual(new Set([payload.event_id]));
    expect(attempts[0]).toEqual(attempts[1]);
  });

  it('keeps unknown distinct from confirmed and failed', async () => {
    const attempts: FreeSubmissionOutcomePayload[] = [];
    const sync = createFreeSubmissionOutcomeSync(payload.application_id, payload.event_id, async (attempt) => {
      attempts.push(attempt);
      return { ok: true };
    });
    await sync.record('unknown', 'https://jobs.example.com/application');
    expect(attempts[0]).toMatchObject({ outcome: 'unknown' });
    expect(attempts[0]).not.toHaveProperty('confirmation_text');
  });
});
