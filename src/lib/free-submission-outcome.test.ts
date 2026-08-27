import { describe, expect, it, vi } from 'vitest';
import {
  createFreeSubmissionOutcomeSync,
  isValidFreeSubmissionEventId,
  parseFreeSubmissionPreflight,
  parseFreeSubmissionReservation,
  recordFreeSubmissionOutcome,
  requestFreeSubmissionPreflight,
  runFreeSubmissionReplayGate,
  type FreeSubmissionOutcomePayload,
  type FreeSubmissionPreflightResult,
} from './free-submission-outcome';

const payload: FreeSubmissionOutcomePayload = {
  event_id: '123e4567-e89b-42d3-a456-426614174000',
  application_id: '223e4567-e89b-42d3-a456-426614174000',
  lease_id: '323e4567-e89b-42d3-a456-426614174000',
  activation_id: '423e4567-e89b-42d3-a456-426614174000',
  outcome: 'confirmed',
  final_url: 'https://jobs.example.com/application/receipt',
  confirmation_text: 'Thank you for applying.',
};

const RESUMED_EVENT_ID = '323e4567-e89b-42d3-a456-426614174000';
const WALL_NOW = Date.parse('2026-08-24T12:00:01.000Z');
const PREFLIGHT_RESPONSE = {
  application_id: payload.application_id.toUpperCase(),
  event_id: payload.event_id.toUpperCase(),
  lease_id: payload.lease_id.toUpperCase(),
  attempt_id: payload.event_id.toUpperCase(),
  activation_id: payload.activation_id.toUpperCase(),
  authorized_at: '2026-08-24T12:00:00.000Z',
  expires_at: '2026-08-24T12:03:00.000Z',
  server_now: '2026-08-24T12:00:00.100Z',
  preflight_received_at_ms: WALL_NOW,
  authorized: true,
};

const successfulPreflight = {
  ok: true as const,
  ...parseFreeSubmissionPreflight(
    PREFLIGHT_RESPONSE,
    payload.application_id,
    payload.event_id,
    payload.activation_id,
    WALL_NOW,
    10_000,
  )!,
};

describe('Free manual submission outcome sync', () => {
  it('accepts the backend-selected resumable event only for the expected canonical application', () => {
    expect(parseFreeSubmissionReservation({
      application_id: payload.application_id.toUpperCase(),
      event_id: RESUMED_EVENT_ID.toUpperCase(),
      resumed: true,
    }, payload.application_id, RESUMED_EVENT_ID)).toEqual({
      applicationId: payload.application_id,
      eventId: RESUMED_EVENT_ID,
      resumed: true,
    });
    expect(isValidFreeSubmissionEventId(RESUMED_EVENT_ID)).toBe(true);
  });

  it.each([
    null,
    {},
    { application_id: payload.application_id, event_id: 'not-a-uuid', resumed: false },
    { application_id: payload.application_id, event_id: RESUMED_EVENT_ID },
    {
      application_id: '423e4567-e89b-42d3-a456-426614174000',
      event_id: RESUMED_EVENT_ID,
      resumed: false,
    },
  ])('rejects an incomplete or mismatched reservation response %#', (response) => {
    expect(parseFreeSubmissionReservation(response, payload.application_id, payload.event_id)).toBeNull();
  });

  it('accepts only an authorized preflight for the exact application and reserved event', () => {
    expect(parseFreeSubmissionPreflight(
      { ...PREFLIGHT_RESPONSE, preflight_received_at_ms: undefined },
      payload.application_id,
      payload.event_id,
      payload.activation_id,
      WALL_NOW,
      10_000,
    )).toMatchObject({
      applicationId: payload.application_id,
      eventId: payload.event_id,
      leaseId: payload.lease_id,
      activationId: payload.activation_id,
      replayDeadlineMonotonicMs: 14_000,
    });
    expect(parseFreeSubmissionPreflight(
      { ...PREFLIGHT_RESPONSE, event_id: RESUMED_EVENT_ID },
      payload.application_id,
      payload.event_id,
      payload.activation_id,
    )).toBeNull();
    expect(parseFreeSubmissionPreflight(
      { ...PREFLIGHT_RESPONSE, authorized: false },
      payload.application_id,
      payload.event_id,
      payload.activation_id,
    )).toBeNull();
  });

  it('uses response age plus a monotonic budget, independent of the browser clock versus the server', () => {
    expect(parseFreeSubmissionPreflight(
      { ...PREFLIGHT_RESPONSE, preflight_received_at_ms: undefined },
      payload.application_id,
      payload.event_id,
      payload.activation_id,
      Date.parse('2020-01-01T00:00:00Z'),
      50,
    )).toMatchObject({ replayDeadlineMonotonicMs: 4050 });
    expect(parseFreeSubmissionPreflight(
      { ...PREFLIGHT_RESPONSE, preflight_received_at_ms: WALL_NOW },
      payload.application_id,
      payload.event_id,
      payload.activation_id,
      WALL_NOW + 4_001,
      50,
    )).toBeNull();
  });

  it('caps the local replay budget by the server lease time remaining at receipt', () => {
    const nearExpiry = {
      ...PREFLIGHT_RESPONSE,
      server_now: '2026-08-24T12:02:59.000Z',
      preflight_received_at_ms: WALL_NOW,
    };
    expect(parseFreeSubmissionPreflight(
      nearExpiry,
      payload.application_id,
      payload.event_id,
      payload.activation_id,
      WALL_NOW,
      10_000,
    )).toMatchObject({ replayDeadlineMonotonicMs: 11_000 });
    expect(parseFreeSubmissionPreflight(
      nearExpiry,
      payload.application_id,
      payload.event_id,
      payload.activation_id,
      WALL_NOW + 1_000,
      10_000,
    )).toBeNull();
    expect(parseFreeSubmissionPreflight(
      nearExpiry,
      payload.application_id,
      payload.event_id,
      payload.activation_id,
      WALL_NOW,
      11_001,
      10_000,
    )).toBeNull();
  });

  it('fails closed when a malformed background response claims preflight success', async () => {
    vi.stubGlobal('chrome', { runtime: { lastError: undefined } });
    const sendMessage = vi.fn((_message, callback) => callback({
      ok: true,
      application_id: payload.application_id,
      event_id: RESUMED_EVENT_ID,
      authorized: true,
    }));
    await expect(requestFreeSubmissionPreflight({
      application_id: payload.application_id,
      event_id: payload.event_id,
      activation_id: payload.activation_id,
      current_url: 'https://jobs.example.com/application',
    }, sendMessage)).resolves.toMatchObject({ ok: false });
    vi.unstubAllGlobals();
  });

  it('keeps paused attempt B incapable when attempt A confirms before final preflight returns', async () => {
    let releasePreflight!: (value: FreeSubmissionPreflightResult) => void;
    const preflight = new Promise<FreeSubmissionPreflightResult>((resolve) => {
      releasePreflight = resolve;
    });
    const startMonitor = vi.fn(async () => ({ ok: true as const }));
    const armOutcome = vi.fn();
    const replay = vi.fn(() => 'clicked' as const);
    const cancelBeforeReplay = vi.fn(async () => undefined);

    const result = runFreeSubmissionReplayGate({
      startMonitor,
      preflight: () => preflight,
      contextStillSafe: () => true,
      armOutcome,
      replay,
      cancelBeforeReplay,
    });
    await vi.waitFor(() => expect(startMonitor).toHaveBeenCalledOnce());
    expect(armOutcome).not.toHaveBeenCalled();
    expect(replay).not.toHaveBeenCalled();

    releasePreflight({
      ok: false,
      error: 'Another attempt for this posting was confirmed.',
      code: 'duplicate_application',
    });
    await expect(result).resolves.toEqual({
      ok: false,
      stage: 'preflight',
      error: 'Another attempt for this posting was confirmed.',
    });
    expect(cancelBeforeReplay).toHaveBeenCalledOnce();
    expect(armOutcome).not.toHaveBeenCalled();
    expect(replay).not.toHaveBeenCalled();
  });

  it('disarms page monitoring and closes an exact authorized pre-click refusal once', async () => {
    const disarmOutcome = vi.fn();
    const cancelBeforeReplay = vi.fn(async () => undefined);
    await expect(runFreeSubmissionReplayGate({
      startMonitor: async () => ({ ok: true }),
      preflight: async () => successfulPreflight,
      contextStillSafe: () => true,
      armOutcome: () => disarmOutcome,
      replay: () => 'pre_click_refusal',
      cancelBeforeReplay,
      monotonicNow: () => 10_001,
    })).resolves.toMatchObject({ ok: false, stage: 'replay' });
    expect(disarmOutcome).toHaveBeenCalledOnce();
    expect(cancelBeforeReplay).toHaveBeenCalledOnce();
  });

  it('keeps monitoring and immutable risk open when replay failure is ambiguous', async () => {
    const disarmOutcome = vi.fn();
    const cancelBeforeReplay = vi.fn(async () => undefined);
    await expect(runFreeSubmissionReplayGate({
      startMonitor: async () => ({ ok: true }),
      preflight: async () => successfulPreflight,
      contextStillSafe: () => true,
      armOutcome: () => disarmOutcome,
      replay: () => 'ambiguous',
      cancelBeforeReplay,
      monotonicNow: () => 10_001,
    })).resolves.toMatchObject({ ok: false, stage: 'replay' });
    expect(disarmOutcome).not.toHaveBeenCalled();
    expect(cancelBeforeReplay).not.toHaveBeenCalled();
  });

  it('refuses a stale local authorization without arming or replaying any employer control', async () => {
    const armOutcome = vi.fn();
    const replay = vi.fn(() => 'clicked' as const);
    const cancelBeforeReplay = vi.fn(async () => undefined);
    await expect(runFreeSubmissionReplayGate({
      startMonitor: async () => ({ ok: true }),
      preflight: async () => successfulPreflight,
      contextStillSafe: () => true,
      armOutcome,
      replay,
      cancelBeforeReplay,
      monotonicNow: () => successfulPreflight.replayDeadlineMonotonicMs,
    })).resolves.toMatchObject({ ok: false, stage: 'preflight' });
    expect(armOutcome).not.toHaveBeenCalled();
    expect(replay).not.toHaveBeenCalled();
    expect(cancelBeforeReplay).toHaveBeenCalledOnce();
  });

  it('cancels exactly once when the trusted context changes before outcome monitoring is armed', async () => {
    const armOutcome = vi.fn();
    const replay = vi.fn(() => 'clicked' as const);
    const cancelBeforeReplay = vi.fn(async () => undefined);
    await expect(runFreeSubmissionReplayGate({
      startMonitor: async () => ({ ok: true }),
      preflight: async () => successfulPreflight,
      contextStillSafe: () => false,
      armOutcome,
      replay,
      cancelBeforeReplay,
      monotonicNow: () => successfulPreflight.replayDeadlineMonotonicMs - 1,
    })).resolves.toMatchObject({ ok: false, stage: 'context_changed' });
    expect(armOutcome).not.toHaveBeenCalled();
    expect(replay).not.toHaveBeenCalled();
    expect(cancelBeforeReplay).toHaveBeenCalledOnce();
  });

  it('disarms then cancels exactly once when authorization expires after monitor arming', async () => {
    const disarmOutcome = vi.fn();
    const replay = vi.fn(() => 'clicked' as const);
    const cancelBeforeReplay = vi.fn(async () => undefined);
    let clockReads = 0;
    await expect(runFreeSubmissionReplayGate({
      startMonitor: async () => ({ ok: true }),
      preflight: async () => successfulPreflight,
      contextStillSafe: () => true,
      armOutcome: () => disarmOutcome,
      replay,
      cancelBeforeReplay,
      monotonicNow: () => {
        clockReads += 1;
        return clockReads === 1
          ? successfulPreflight.replayDeadlineMonotonicMs - 1
          : successfulPreflight.replayDeadlineMonotonicMs;
      },
    })).resolves.toMatchObject({ ok: false, stage: 'preflight' });
    expect(disarmOutcome).toHaveBeenCalledOnce();
    expect(replay).not.toHaveBeenCalled();
    expect(cancelBeforeReplay).toHaveBeenCalledOnce();
  });

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

  it('keeps terminal Sent gated when acknowledged Free session cleanup is pending', async () => {
    vi.stubGlobal('chrome', { runtime: { lastError: undefined } });
    const sendMessage = vi.fn((_message, callback) => callback({
      ok: true,
      submitted: false,
      receipt_cleanup_pending: true,
    }));
    await expect(recordFreeSubmissionOutcome(payload, sendMessage)).resolves.toEqual({
      ok: true,
      submitted: false,
      receiptCleanupPending: true,
    });
    vi.unstubAllGlobals();
  });

  it('reuses one event id for every idempotent retry', async () => {
    const attempts: FreeSubmissionOutcomePayload[] = [];
    const sync = createFreeSubmissionOutcomeSync(
      payload.application_id,
      payload.event_id,
      payload.lease_id,
      payload.activation_id,
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
    const sync = createFreeSubmissionOutcomeSync(
      payload.application_id,
      payload.event_id,
      payload.lease_id,
      payload.activation_id,
      async (attempt) => {
      attempts.push(attempt);
      return { ok: true };
      },
    );
    await sync.record('unknown', 'https://jobs.example.com/application');
    expect(attempts[0]).toMatchObject({ outcome: 'unknown' });
    expect(attempts[0]).not.toHaveProperty('confirmation_text');
  });

  it('preserves the full 2,000-character receipt evidence budget', async () => {
    const attempts: FreeSubmissionOutcomePayload[] = [];
    const sync = createFreeSubmissionOutcomeSync(
      payload.application_id,
      payload.event_id,
      payload.lease_id,
      payload.activation_id,
      async (attempt) => {
        attempts.push(attempt);
        return { ok: true };
      },
    );
    const marker = ' Your application has been submitted successfully.';
    const evidence = `${'x'.repeat(2_000 - marker.length)}${marker}`;
    await sync.record('confirmed', payload.final_url, evidence);
    expect(evidence).toHaveLength(2_000);
    expect(attempts[0]?.confirmation_text).toBe(evidence);
  });
});
