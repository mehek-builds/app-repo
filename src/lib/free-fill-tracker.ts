export type FreeFillTrackerPayload = {
  application_id: string | null;
  application_identity: {
    company: string;
    role: string;
    portal_url: string;
  };
  selected_resume_artifact_id: string | null;
  resume_attached: boolean;
  resume_source: 'artifact' | 'base_resume' | 'none';
  unanswered_questions: number;
};

export type FreeFillTrackerResult =
  | { ok: true; application_id: string }
  | { ok: false; error: string; application_id?: string };

type SendMessage = (
  message: { type: 'RECORD_FREE_FILL_RESULT'; payload: FreeFillTrackerPayload },
  callback: (response?: { ok?: boolean; error?: string; application_id?: string }) => void,
) => void;

export function recordFreeFillResult(
  payload: FreeFillTrackerPayload,
  sendMessage: SendMessage = chrome.runtime.sendMessage.bind(chrome.runtime),
): Promise<FreeFillTrackerResult> {
  return new Promise((resolve) => {
    sendMessage({ type: 'RECORD_FREE_FILL_RESULT', payload }, (response) => {
      const runtimeError = chrome.runtime.lastError?.message;
      if (runtimeError || response?.ok !== true || typeof response.application_id !== 'string') {
        resolve({
          ok: false,
          error: response?.error ?? runtimeError ?? 'Tracker could not be updated yet.',
          ...(typeof response?.application_id === 'string' ? { application_id: response.application_id } : {}),
        });
        return;
      }
      resolve({ ok: true, application_id: response.application_id });
    });
  });
}

/**
 * Retains a canonical id learned during a failed sync. A retry can then finish
 * the same Tracker row without creating another application.
 */
export function createFreeFillTrackerSync(
  initialPayload: FreeFillTrackerPayload,
  record: (payload: FreeFillTrackerPayload) => Promise<FreeFillTrackerResult> = recordFreeFillResult,
) {
  let payload = initialPayload;
  return {
    async sync(): Promise<FreeFillTrackerResult> {
      const result = await record(payload);
      if (result.application_id) payload = { ...payload, application_id: result.application_id };
      return result;
    },
    currentPayload: () => payload,
  };
}
