import { describe, expect, it, vi } from 'vitest';
import {
  createFreeFillTrackerSync,
  recordFreeFillResult,
  type FreeFillTrackerPayload,
} from './free-fill-tracker';

const payload: FreeFillTrackerPayload = {
  application_id: 'application-1',
  application_identity: {
    company: 'Acme',
    role: 'Engineer',
    portal_url: 'https://jobs.acme.test/engineer',
  },
  selected_resume_artifact_id: null,
  resume_attached: true,
  resume_source: 'base_resume',
  unanswered_questions: 2,
};

describe('Free fill Tracker sync', () => {
  it('returns a retryable failure without undoing the completed fill, then succeeds on retry', async () => {
    vi.stubGlobal('chrome', { runtime: { lastError: undefined } });
    let calls = 0;
    const sendMessage = vi.fn((_message, callback) => {
      calls += 1;
      callback(calls === 1
        ? { ok: false, error: 'Tracker is unavailable.', application_id: 'application-1' }
        : { ok: true, application_id: 'application-1' });
    });

    await expect(recordFreeFillResult(payload, sendMessage)).resolves.toEqual({
      ok: false,
      error: 'Tracker is unavailable.',
      application_id: 'application-1',
    });
    await expect(recordFreeFillResult(payload, sendMessage)).resolves.toEqual({ ok: true, application_id: 'application-1' });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenLastCalledWith(
      { type: 'RECORD_FREE_FILL_RESULT', payload },
      expect.any(Function),
    );
    vi.unstubAllGlobals();
  });

  it('retries a failed bootstrap against the same canonical application identity', async () => {
    const attempted: FreeFillTrackerPayload[] = [];
    const sync = createFreeFillTrackerSync({ ...payload, application_id: null }, async (next) => {
      attempted.push(next);
      if (attempted.length === 1) {
        return { ok: false, error: 'Tracker write failed.', application_id: 'canonical-application' };
      }
      return { ok: true, application_id: 'canonical-application' };
    });

    await expect(sync.sync()).resolves.toMatchObject({ ok: false, application_id: 'canonical-application' });
    await expect(sync.sync()).resolves.toEqual({ ok: true, application_id: 'canonical-application' });
    expect(attempted[0].application_identity).toEqual(attempted[1].application_identity);
    expect(attempted[0].application_id).toBeNull();
    expect(attempted[1].application_id).toBe('canonical-application');
  });
});
