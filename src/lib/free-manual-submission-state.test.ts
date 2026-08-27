import { describe, expect, it } from 'vitest';
import { FREE_SUBMISSION_MONITOR_TTL_MS } from './free-submission-monitor';
import {
  FREE_MANUAL_RESERVATION_TTL_MS,
  authorizeFreeManualSubmissionState,
  classifyFreeManualSubmissionState,
  freeManualAcceptedOutcomeDisposition,
  freeManualReservationWriteDisposition,
  freeManualSafeNotSentDisposition,
  freeManualSubmissionStartupResponse,
  freeManualSubmissionStartupState,
  freeManualMonitoringState,
  freeManualReservedState,
  freeManualSubmissionStateKey,
  parseFreeManualSubmissionState,
  reservedFreeManualSubmissionState,
  transitionFreeManualSubmissionStateToMonitoring,
  type FreeManualSubmissionBinding,
} from './free-manual-submission-state';

const NOW = 1_760_000_000_000;
const binding: FreeManualSubmissionBinding = {
  eventId: 'e9e7c7e0-d0ae-4e65-93d4-620e27eac030',
  applicationId: '327291f1-a491-48a4-aa8b-df4233e07f77',
  tabId: 7,
  frameId: 0,
  accountId: '2394efc6-d9e1-46cd-a88c-08f12ea4b809',
  authEpoch: 4,
  startUrl: 'https://apply.workable.com/max-borges-agency/j/ABC123/',
};

function reserved(startedAt: number = NOW) {
  const state = reservedFreeManualSubmissionState({ ...binding, startedAt }, NOW);
  if (!state) throw new Error('Expected a valid reserved fixture');
  return state;
}

describe('Free manual submission durable state', () => {
  it('uses one frame-scoped session key and refuses invalid key identities', () => {
    expect(freeManualSubmissionStateKey(7, 0)).toBe('litos_pending_free_manual_reservation:7:0');
    expect(() => freeManualSubmissionStateKey(-1, 0)).toThrow();
    expect(() => freeManualSubmissionStateKey(7, 0.5)).toThrow();
  });

  it('transitions the exact reserved binding and preserves its employer-boundary start time', () => {
    const current = reserved(NOW - 500);
    const monitoring = transitionFreeManualSubmissionStateToMonitoring(current, {
      ...binding,
      now: NOW,
    });
    expect(monitoring).toEqual({
      ...binding,
      phase: 'monitoring',
      startedAt: NOW - 500,
      monitoringStartedAt: NOW,
      boundaryLeaseId: null,
      boundaryActivationId: null,
      boundaryExpiresAt: null,
    });
    expect(parseFreeManualSubmissionState(monitoring, NOW)).toEqual(monitoring);
    expect(classifyFreeManualSubmissionState(monitoring, NOW)).toEqual({
      kind: 'valid',
      state: monitoring,
    });
  });

  it.each(['confirmed', 'unknown'] as const)(
    'removes the exact authorized monitor after an accepted %s outcome',
    () => {
      const monitoring = transitionFreeManualSubmissionStateToMonitoring(reserved(), {
        ...binding,
        now: NOW,
      })!;
      const leaseId = '323e4567-e89b-42d3-a456-426614174000';
      const activationId = '423e4567-e89b-42d3-a456-426614174000';
      const authorized = authorizeFreeManualSubmissionState(monitoring, {
        ...binding,
        leaseId,
        activationId,
        expiresAt: NOW + 180_000,
        now: NOW,
      })!;
      expect(freeManualAcceptedOutcomeDisposition(authorized, {
        ...binding,
        leaseId,
        activationId,
      }, NOW)).toBe('remove');
      expect(freeManualAcceptedOutcomeDisposition(undefined, {
        ...binding,
        leaseId,
        activationId,
      }, NOW)).toBe('already_removed');
      expect(freeManualAcceptedOutcomeDisposition(authorized, {
        ...binding,
        leaseId: '523e4567-e89b-42d3-a456-426614174000',
        activationId,
      }, NOW)).toBe('blocked');
    },
  );

  it('removes only the exact lease-less state after server not-sent proof', () => {
    const exactReserved = reserved();
    const exactMonitoring = transitionFreeManualSubmissionStateToMonitoring(exactReserved, {
      ...binding,
      now: NOW,
    })!;
    const authorized = authorizeFreeManualSubmissionState(exactMonitoring, {
      ...binding,
      leaseId: '323e4567-e89b-42d3-a456-426614174000',
      activationId: '423e4567-e89b-42d3-a456-426614174000',
      expiresAt: NOW + 180_000,
      now: NOW,
    })!;

    expect(freeManualSafeNotSentDisposition(exactReserved, exactReserved, NOW)).toBe('remove');
    expect(freeManualSafeNotSentDisposition(exactMonitoring, exactMonitoring, NOW)).toBe('remove');
    expect(freeManualSafeNotSentDisposition(undefined, exactMonitoring, NOW)).toBe('already_removed');
    expect(freeManualSafeNotSentDisposition(authorized, exactMonitoring, NOW)).toBe('blocked');
    expect(freeManualSafeNotSentDisposition(undefined, authorized, NOW)).toBe('blocked');
    expect(freeManualSafeNotSentDisposition({
      ...exactMonitoring,
      monitoringStartedAt: NOW + 1,
    }, exactMonitoring, NOW + 1)).toBe('blocked');
    expect(freeManualSafeNotSentDisposition({
      ...exactMonitoring,
      startedAt: NOW - 1,
    }, exactMonitoring, NOW)).toBe('blocked');
    expect(freeManualSafeNotSentDisposition({
      ...exactMonitoring,
      eventId: '99999999-9999-4999-8999-999999999999',
    }, exactMonitoring, NOW)).toBe('blocked');
  });

  it.each([
    ['eventId', 'fa2ddad0-e563-4a8d-9a5b-d469b37e1096'],
    ['applicationId', '72f4a6e3-1ea2-4f3d-a71e-ee3d928df42b'],
    ['tabId', 8],
    ['frameId', 1],
    ['accountId', '838bc722-670c-4a5c-9342-871d59b80f45'],
    ['authEpoch', 5],
    ['startUrl', 'https://apply.workable.com/max-borges-agency/j/DIFFERENT/'],
  ] as const)('refuses a monitoring transition when %s differs', (field, value) => {
    expect(transitionFreeManualSubmissionStateToMonitoring(reserved(), {
      ...binding,
      [field]: value,
      now: NOW,
    })).toBeNull();
  });

  it('refuses a second monitoring transition and an expired or invalid transition time', () => {
    const current = reserved();
    const monitoring = transitionFreeManualSubmissionStateToMonitoring(current, { ...binding, now: NOW });
    expect(monitoring).not.toBeNull();
    expect(transitionFreeManualSubmissionStateToMonitoring(monitoring!, { ...binding, now: NOW + 1 })).toBeNull();
    expect(transitionFreeManualSubmissionStateToMonitoring(current, {
      ...binding,
      now: NOW + FREE_MANUAL_RESERVATION_TTL_MS + 1,
    })).toBeNull();
    expect(transitionFreeManualSubmissionStateToMonitoring(current, { ...binding, now: -1 })).toBeNull();
  });

  it('fails closed on malformed reserved state and accepts only the exact TTL boundary', () => {
    const valid = reserved(NOW - FREE_MANUAL_RESERVATION_TTL_MS);
    expect(parseFreeManualSubmissionState(valid, NOW)).toEqual(valid);
    expect(parseFreeManualSubmissionState(valid, NOW + 1)).toBeNull();
    expect(classifyFreeManualSubmissionState(valid, NOW + 1)).toEqual({
      kind: 'expired_reserved',
      state: valid,
    });

    const malformed: unknown[] = [
      null,
      [],
      { ...valid, phase: 'pending' },
      { ...valid, extra: true },
      { ...valid, eventId: 'not-a-uuid' },
      { ...valid, applicationId: 'not-a-uuid' },
      { ...valid, accountId: 'not-a-uuid' },
      { ...valid, tabId: 1.5 },
      { ...valid, frameId: -1 },
      { ...valid, authEpoch: -1 },
      { ...valid, startUrl: 'http://apply.workable.com/max-borges-agency/j/ABC123/' },
      { ...valid, startUrl: 'https://user:secret@apply.workable.com/max-borges-agency/j/ABC123/' },
      { ...valid, startedAt: 'yesterday' },
      { ...valid, startedAt: NOW + 1 },
    ];
    for (const candidate of malformed) {
      expect(parseFreeManualSubmissionState(candidate, NOW)).toBeNull();
      expect(classifyFreeManualSubmissionState(candidate, NOW)).toEqual({ kind: 'malformed' });
    }
    expect(parseFreeManualSubmissionState(Object.assign(new Date(), valid), NOW)).toBeNull();
  });

  it('uses the shorter monitoring TTL and rejects impossible monitoring timestamps', () => {
    const current = reserved(NOW - 1000);
    const monitoring = transitionFreeManualSubmissionStateToMonitoring(current, { ...binding, now: NOW });
    expect(monitoring).not.toBeNull();
    expect(parseFreeManualSubmissionState(monitoring, NOW + FREE_SUBMISSION_MONITOR_TTL_MS)).toEqual(monitoring);
    expect(parseFreeManualSubmissionState(monitoring, NOW + FREE_SUBMISSION_MONITOR_TTL_MS + 1)).toBeNull();
    expect(classifyFreeManualSubmissionState(
      monitoring,
      NOW + FREE_SUBMISSION_MONITOR_TTL_MS + 1,
    )).toEqual({
      kind: 'expired_monitoring',
      state: monitoring,
    });
    expect(parseFreeManualSubmissionState({
      ...monitoring,
      monitoringStartedAt: current.startedAt - 1,
    }, NOW)).toBeNull();
    expect(parseFreeManualSubmissionState({
      ...monitoring,
      monitoringStartedAt: NOW + 1,
    }, NOW)).toBeNull();
    const { monitoringStartedAt: _missing, ...withoutMonitoringStart } = monitoring!;
    expect(parseFreeManualSubmissionState(withoutMonitoringStart, NOW)).toBeNull();
    expect(parseFreeManualSubmissionState({ ...monitoring, extra: true }, NOW)).toBeNull();
  });

  it('constructors and phase selectors return only validated matching phases', () => {
    const current = reserved();
    const monitoring = transitionFreeManualSubmissionStateToMonitoring(current, { ...binding, now: NOW });
    expect(freeManualReservedState(current, NOW)).toEqual(current);
    expect(freeManualReservedState(monitoring, NOW)).toBeNull();
    expect(freeManualMonitoringState(monitoring, NOW)).toEqual(monitoring);
    expect(freeManualMonitoringState(current, NOW)).toBeNull();
    expect(reservedFreeManualSubmissionState({
      ...binding,
      startUrl: 'javascript:alert(1)',
      startedAt: NOW,
    }, NOW)).toBeNull();
  });
});

describe('reserved storage write disposition', () => {
  it('never downgrades a same-attempt monitor back to reserved', () => {
    const reserved = reservedFreeManualSubmissionState({ ...binding, startedAt: NOW }, NOW)!;
    const monitoring = transitionFreeManualSubmissionStateToMonitoring(reserved, {
      ...binding,
      now: NOW + 1,
    })!;
    expect(freeManualReservationWriteDisposition([monitoring], {
      ...reserved,
      startedAt: NOW + 2,
    }, NOW + 2)).toEqual({ kind: 'blocked', reason: 'monitoring' });
  });

  it('never lets a new attempt overwrite an existing monitor', () => {
    const reserved = reservedFreeManualSubmissionState({ ...binding, startedAt: NOW }, NOW)!;
    const monitoring = transitionFreeManualSubmissionStateToMonitoring(reserved, {
      ...binding,
      now: NOW + 1,
    })!;
    const next = reservedFreeManualSubmissionState({
      ...binding,
      eventId: '99999999-9999-4999-8999-999999999999',
      startedAt: NOW + 2,
    }, NOW + 2)!;
    expect(freeManualReservationWriteDisposition([monitoring], next, NOW + 2))
      .toEqual({ kind: 'blocked', reason: 'monitoring' });
  });

  it('keeps an exact existing reservation without resetting its lifetime', () => {
    const reserved = reservedFreeManualSubmissionState({ ...binding, startedAt: NOW }, NOW)!;
    const resumed = reservedFreeManualSubmissionState({ ...binding, startedAt: NOW + 100 }, NOW + 100)!;
    expect(freeManualReservationWriteDisposition([reserved], resumed, NOW + 100))
      .toEqual({ kind: 'unchanged' });
  });

  it('fails closed on a malformed prior tab record', () => {
    const pending = reservedFreeManualSubmissionState({ ...binding, startedAt: NOW }, NOW)!;
    expect(freeManualReservationWriteDisposition([{ ...pending, extra: true }], pending, NOW))
      .toEqual({ kind: 'blocked', reason: 'malformed' });
  });
});

describe('document-start state fold', () => {
  it('blocks a new frame while an old frame is monitoring', () => {
    const reserved = reservedFreeManualSubmissionState({ ...binding, frameId: 3, startedAt: NOW }, NOW)!;
    const monitoring = transitionFreeManualSubmissionStateToMonitoring(reserved, {
      ...binding,
      frameId: 3,
      now: NOW + 1,
    })!;
    expect(freeManualSubmissionStartupState([monitoring], 9, NOW + 1))
      .toEqual({ pending: null, blocked: true });
  });

  it('blocks malformed storage instead of releasing the shield', () => {
    const reserved = reservedFreeManualSubmissionState({ ...binding, startedAt: NOW }, NOW)!;
    expect(freeManualSubmissionStartupState([{ ...reserved, extra: true }], 0, NOW))
      .toEqual({ pending: null, blocked: true });
  });

  it('blocks signed-out and URL-drift recovery for an exact reservation', () => {
    const reserved = reservedFreeManualSubmissionState({ ...binding, startedAt: NOW }, NOW)!;
    const startup = freeManualSubmissionStartupState([reserved], 0, NOW);
    expect(freeManualSubmissionStartupResponse(startup, {
      tokenPresent: false,
      navigationMatches: true,
    })).toEqual({ pending: null, blocked: true });
    expect(freeManualSubmissionStartupResponse(startup, {
      tokenPresent: true,
      navigationMatches: false,
    })).toEqual({ pending: null, blocked: true });
    expect(freeManualSubmissionStartupResponse(startup, {
      tokenPresent: true,
      navigationMatches: true,
    })).toEqual({ pending: reserved, blocked: false });
  });
});
