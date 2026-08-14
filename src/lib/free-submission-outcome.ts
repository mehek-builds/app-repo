export type FreeSubmissionOutcome = 'confirmed' | 'failed' | 'unknown';

export type FreeSubmissionOutcomePayload = {
  event_id: string;
  application_id: string;
  outcome: FreeSubmissionOutcome;
  final_url: string;
  confirmation_text?: string;
};

export type FreeSubmissionOutcomeResult =
  | { ok: true }
  | { ok: false; error: string; code?: string };

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
 * One trusted employer click owns one event id. Every transport retry reuses the same payload
 * identity, so a lost response can never turn one native submission into two Tracker transitions.
 */
export function createFreeSubmissionOutcomeSync(
  applicationId: string,
  eventId: string = crypto.randomUUID(),
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
        outcome,
        final_url: finalUrl,
        ...(normalizedConfirmation ? { confirmation_text: normalizedConfirmation } : {}),
      });
    },
  };
}
