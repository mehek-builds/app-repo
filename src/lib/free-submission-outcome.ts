export type FreeSubmissionOutcome = 'confirmed' | 'failed' | 'unknown';

export type FreeSubmissionOutcomePayload = {
  event_id: string;
  application_id: string;
  lease_id: string;
  activation_id: string;
  outcome: FreeSubmissionOutcome;
  final_url: string;
  confirmation_text?: string;
};

export type FreeSubmissionOutcomeResult =
  | { ok: true }
  | { ok: false; error: string; code?: string };

export type FreeSubmissionReservation = {
  applicationId: string;
  eventId: string;
  resumed: boolean;
};

export type FreeSubmissionPreflight = {
  applicationId: string;
  eventId: string;
  leaseId: string;
  attemptId: string;
  activationId: string;
  authorizedAt: string;
  expiresAt: string;
  serverNow: string;
  expiresAtMs: number;
  replayDeadlineMonotonicMs: number;
};

export type FreeSubmissionPreflightPayload = {
  application_id: string;
  event_id: string;
  activation_id: string;
  current_url: string;
};

export type FreeSubmissionPreflightResult =
  | ({ ok: true } & FreeSubmissionPreflight)
  | { ok: false; error: string; code?: string };

export type FreeSubmissionReplayGateResult =
  | { ok: true }
  | {
    ok: false;
    stage: 'monitor' | 'preflight' | 'context_changed' | 'replay';
    error: string;
  };

export type FreeSubmissionReplayResult = 'clicked' | 'pre_click_refusal' | 'ambiguous';

const SUBMISSION_EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const FREE_SUBMISSION_LOCAL_REPLAY_BUDGET_MS = 4_000;

function monotonicNowMs(): number {
  return globalThis.performance?.now() ?? Date.now();
}

export function isValidFreeSubmissionEventId(value: unknown): value is string {
  return typeof value === 'string' && SUBMISSION_EVENT_ID.test(value);
}

/** Accept only an owner-scoped reservation bound to the canonical application we requested. */
export function parseFreeSubmissionReservation(
  value: unknown,
  expectedApplicationId: string,
  expectedEventId: string,
): FreeSubmissionReservation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const applicationId = typeof candidate.application_id === 'string'
    ? candidate.application_id.toLowerCase()
    : '';
  if (
    !isValidFreeSubmissionEventId(applicationId)
    || applicationId !== expectedApplicationId.toLowerCase()
    || !isValidFreeSubmissionEventId(candidate.event_id)
    || candidate.event_id.toLowerCase() !== expectedEventId.toLowerCase()
    || typeof candidate.resumed !== 'boolean'
  ) return null;
  return {
    applicationId,
    eventId: candidate.event_id.toLowerCase(),
    resumed: candidate.resumed,
  };
}

/** A final-boundary acknowledgement is useful only for the exact reserved application and event. */
export function parseFreeSubmissionPreflight(
  value: unknown,
  expectedApplicationId: string,
  expectedEventId: string,
  expectedActivationId: string,
  wallNowMs: number = Date.now(),
  monotonicNow: number = monotonicNowMs(),
  requestStartedAtMonotonicMs?: number,
): FreeSubmissionPreflight | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const applicationId = typeof candidate.application_id === 'string'
    ? candidate.application_id.toLowerCase()
    : '';
  const eventId = typeof candidate.event_id === 'string'
    ? candidate.event_id.toLowerCase()
    : '';
  const leaseId = typeof candidate.lease_id === 'string'
    ? candidate.lease_id.toLowerCase()
    : '';
  const attemptId = typeof candidate.attempt_id === 'string'
    ? candidate.attempt_id.toLowerCase()
    : '';
  const activationId = typeof candidate.activation_id === 'string'
    ? candidate.activation_id.toLowerCase()
    : '';
  const authorizedAt = typeof candidate.authorized_at === 'string' ? candidate.authorized_at : '';
  const expiresAt = typeof candidate.expires_at === 'string' ? candidate.expires_at : '';
  const serverNow = typeof candidate.server_now === 'string' ? candidate.server_now : '';
  const authorizedAtMs = Date.parse(authorizedAt);
  const expiresAtMs = Date.parse(expiresAt);
  const serverNowMs = Date.parse(serverNow);
  const backgroundReceivedAtWallMs = typeof candidate.preflight_received_at_ms === 'number'
    ? candidate.preflight_received_at_ms
    : wallNowMs;
  const responseAgeMs = wallNowMs - backgroundReceivedAtWallMs;
  const requestElapsedMs = requestStartedAtMonotonicMs === undefined
    ? responseAgeMs
    : monotonicNow - requestStartedAtMonotonicMs;
  const fullRequestAgeMs = Math.max(responseAgeMs, requestElapsedMs);
  const serverLeaseRemainingMs = expiresAtMs - serverNowMs;
  const localReplayBudgetMs = Math.min(
    FREE_SUBMISSION_LOCAL_REPLAY_BUDGET_MS,
    serverLeaseRemainingMs,
  );
  if (
    candidate.authorized !== true
    || !isValidFreeSubmissionEventId(applicationId)
    || applicationId !== expectedApplicationId.toLowerCase()
    || !isValidFreeSubmissionEventId(eventId)
    || eventId !== expectedEventId.toLowerCase()
    || !isValidFreeSubmissionEventId(leaseId)
    || !isValidFreeSubmissionEventId(attemptId)
    || attemptId !== eventId
    || !isValidFreeSubmissionEventId(activationId)
    || activationId !== expectedActivationId.toLowerCase()
    || !Number.isFinite(authorizedAtMs)
    || !Number.isFinite(expiresAtMs)
    || !Number.isFinite(serverNowMs)
    || authorizedAtMs > expiresAtMs
    || serverNowMs < authorizedAtMs
    || serverNowMs >= expiresAtMs
    || expiresAtMs - authorizedAtMs > 5 * 60_000
    || !Number.isFinite(wallNowMs)
    || !Number.isFinite(monotonicNow)
    || !Number.isFinite(backgroundReceivedAtWallMs)
    || !Number.isFinite(requestElapsedMs)
    || responseAgeMs < 0
    || requestElapsedMs < 0
    || !Number.isFinite(localReplayBudgetMs)
    || localReplayBudgetMs <= 0
    || fullRequestAgeMs >= localReplayBudgetMs
  ) return null;
  return {
    applicationId,
    eventId,
    leaseId,
    attemptId,
    activationId,
    authorizedAt,
    expiresAt,
    serverNow,
    expiresAtMs,
    replayDeadlineMonotonicMs: monotonicNow
      + localReplayBudgetMs
      - fullRequestAgeMs,
  };
}

type SendPreflightMessage = (
  message: { type: 'PREFLIGHT_FREE_MANUAL_SUBMISSION'; payload: FreeSubmissionPreflightPayload },
  callback: (response?: {
    ok?: boolean;
    application_id?: unknown;
    event_id?: unknown;
    lease_id?: unknown;
    attempt_id?: unknown;
    activation_id?: unknown;
    authorized_at?: unknown;
    expires_at?: unknown;
    server_now?: unknown;
    preflight_received_at_ms?: unknown;
    authorized?: unknown;
    error?: string;
    code?: string;
  }) => void,
) => void;

export function requestFreeSubmissionPreflight(
  payload: FreeSubmissionPreflightPayload,
  sendMessage: SendPreflightMessage = chrome.runtime.sendMessage.bind(chrome.runtime),
): Promise<FreeSubmissionPreflightResult> {
  return new Promise((resolve) => {
    const requestStartedAtMonotonicMs = monotonicNowMs();
    try {
      sendMessage({ type: 'PREFLIGHT_FREE_MANUAL_SUBMISSION', payload }, (response) => {
        const callbackMonotonicNowMs = monotonicNowMs();
        const runtimeError = chrome.runtime.lastError?.message;
        const acknowledged = response?.ok === true
          ? parseFreeSubmissionPreflight(
            response,
            payload.application_id,
            payload.event_id,
            payload.activation_id,
            Date.now(),
            callbackMonotonicNowMs,
            requestStartedAtMonotonicMs,
          )
          : null;
        if (runtimeError || !acknowledged) {
          resolve({
            ok: false,
            error: response?.error ?? runtimeError ?? 'Litos could not authorize this final submission.',
            ...(typeof response?.code === 'string' ? { code: response.code } : {}),
          });
          return;
        }
        resolve({ ok: true, ...acknowledged });
      });
    } catch (error) {
      resolve({
        ok: false,
        error: error instanceof Error ? error.message : 'Litos could not authorize this final submission.',
      });
    }
  });
}

/**
 * Hold the external boundary until both durable monitoring and the last locked duplicate check
 * succeed. Every failure before replay is exact proof that this intercepted activation did not
 * reach the employer, so the caller can close only this reservation as not sent.
 */
export async function runFreeSubmissionReplayGate(input: {
  startMonitor: () => Promise<{ ok: true } | { ok: false; error: string }>;
  preflight: () => Promise<FreeSubmissionPreflightResult>;
  contextStillSafe: () => boolean;
  armOutcome: (authorization: FreeSubmissionPreflight) => void | (() => void);
  replay: (authorization: FreeSubmissionPreflight) => FreeSubmissionReplayResult;
  cancelBeforeReplay: () => Promise<void>;
  monotonicNow?: () => number;
}): Promise<FreeSubmissionReplayGateResult> {
  const monitor = await input.startMonitor();
  if (!monitor.ok) {
    await input.cancelBeforeReplay();
    return { ok: false, stage: 'monitor', error: monitor.error };
  }
  const preflight = await input.preflight();
  if (!preflight.ok) {
    await input.cancelBeforeReplay();
    return { ok: false, stage: 'preflight', error: preflight.error };
  }
  const now = input.monotonicNow ?? monotonicNowMs;
  const authorizationFresh = () =>
    preflight.replayDeadlineMonotonicMs > now();
  if (!authorizationFresh()) {
    return {
      ok: false,
      stage: 'preflight',
      error: 'The final submission authorization expired before replay. Nothing was submitted.',
    };
  }
  if (!input.contextStillSafe()) {
    return {
      ok: false,
      stage: 'context_changed',
      error: 'The application changed during the final safety check. Nothing was submitted.',
    };
  }
  const disarmOutcome = input.armOutcome(preflight);
  if (!authorizationFresh()) {
    disarmOutcome?.();
    return {
      ok: false,
      stage: 'preflight',
      error: 'The final submission authorization expired before replay. Nothing was submitted.',
    };
  }
  const replay = input.replay(preflight);
  if (replay === 'pre_click_refusal') {
    disarmOutcome?.();
    return {
      ok: false,
      stage: 'replay',
      error: 'This site refused the guarded replay before any click. Nothing was submitted.',
    };
  }
  if (replay === 'ambiguous') {
    return {
      ok: false,
      stage: 'replay',
      error: 'This site refused the guarded replay. Litos kept the submission blocked for review.',
    };
  }
  return { ok: true };
}

type SendMessage = (
  message: { type: 'RECORD_FREE_SUBMISSION_OUTCOME'; payload: FreeSubmissionOutcomePayload },
  callback: (response?: { ok?: boolean; error?: string; code?: string }) => void,
) => void;

export function recordFreeSubmissionOutcome(
  payload: FreeSubmissionOutcomePayload,
  sendMessage: SendMessage = chrome.runtime.sendMessage.bind(chrome.runtime),
): Promise<FreeSubmissionOutcomeResult> {
  return new Promise((resolve) => {
    try {
      sendMessage({ type: 'RECORD_FREE_SUBMISSION_OUTCOME', payload }, (response) => {
        const runtimeError = chrome.runtime.lastError?.message;
        if (runtimeError || response?.ok !== true) {
          resolve({
            ok: false,
            error: response?.error ?? runtimeError ?? 'Litos could not update the Tracker outcome yet.',
            ...(typeof response?.code === 'string' ? { code: response.code } : {}),
          });
          return;
        }
        resolve({ ok: true });
      });
    } catch (error) {
      resolve({
        ok: false,
        error: error instanceof Error ? error.message : 'Litos could not update the Tracker outcome yet.',
      });
    }
  });
}

/**
 * The backend-reserved event id owns one trusted employer click. Every transport retry reuses the
 * same payload identity, so a lost response cannot create a second Tracker transition.
 */
export function createFreeSubmissionOutcomeSync(
  applicationId: string,
  eventId: string,
  leaseId: string,
  activationId: string,
  record: (payload: FreeSubmissionOutcomePayload) => Promise<FreeSubmissionOutcomeResult> = recordFreeSubmissionOutcome,
) {
  return {
    eventId,
    record(
      outcome: FreeSubmissionOutcome,
      finalUrl: string,
      confirmationText?: string,
    ): Promise<FreeSubmissionOutcomeResult> {
      const normalizedConfirmation = confirmationText?.trim().slice(0, 1000) ?? '';
      return record({
        event_id: eventId,
        application_id: applicationId,
        lease_id: leaseId,
        activation_id: activationId,
        outcome,
        final_url: finalUrl,
        ...(normalizedConfirmation ? { confirmation_text: normalizedConfirmation } : {}),
      });
    },
  };
}
