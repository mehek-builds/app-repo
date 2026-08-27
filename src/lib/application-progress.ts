export function resumeGenerationProgress(elapsedSeconds: number): string {
  const elapsed = Math.max(0, Math.floor(elapsedSeconds));
  if (elapsed < 5) return `Reading the role · ${elapsed}s`;
  if (elapsed < 12) return `Matching your strongest experience · ${elapsed}s`;
  if (elapsed < 20) return `Tailoring the resume · ${elapsed}s`;
  return `Checking layout and accuracy · ${elapsed}s`;
}

export function resumeGenerationStatus(elapsedSeconds: number, retryMessage: string | null): string {
  return retryMessage ?? resumeGenerationProgress(elapsedSeconds);
}

export function escapeApplicationText(value: string): string {
  return value.replace(/[&<>"']/g, (character) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] as string,
  );
}

export const SUBMISSION_MONITOR_TIMEOUT_MS = 60_000;

export function submissionProgress(elapsedSeconds: number): string {
  const elapsed = Math.max(0, Math.floor(elapsedSeconds));
  if (elapsed < 15) return `Waiting for the company · ${elapsed}s`;
  if (elapsed < 45) return `Still waiting for confirmation · ${elapsed}s. Keep this tab open.`;
  return 'No confirmation yet. Do not send it again. Check the company page or your email first.';
}

export function pageShowsSubmissionConfirmation(text: string): boolean {
  return /thank you for applying|application (?:has been )?(?:submitted|received)|we(?:'|’)ve received your application|application complete/i
    .test(text.replace(/\s+/g, ' '));
}

export function pageSubmissionFailureMessage(text: string): string | null {
  const normalized = text.replace(/\s+/g, ' ');
  if (/possible spam/i.test(normalized)) {
    return 'The company turned this down as possible spam. Look over the form before trying again.';
  }
  if (/couldn['’]t submit your application|could not submit|failed to submit|not submitted|unsuccessful|unable to submit (?:your )?application|there was an error submitting|encountered a problem while submitting|did not go through|unable to process/i.test(normalized)) {
    return 'The company turned this down. Read their message before trying again.';
  }
  return null;
}

export type MeasuredWorkableReceipt = {
  confirmationText: string;
  receiptProof: WorkableReceiptProofV1;
};

export function measuredWorkableReceipt(input: {
  startedUrl: string;
  finalUrl: string;
  successfulSubmitText: string;
  formStillPresent: boolean;
}): MeasuredWorkableReceipt | null {
  const normalizedText = input.successfulSubmitText.replace(/\s+/g, ' ').trim();
  let started: URL;
  try {
    started = new URL(input.startedUrl);
  } catch {
    return null;
  }
  if (
    started.hostname !== 'apply.workable.com'
    || !/^\/[^/]+\/j\/[0-9a-f]{10}\/apply\/$/i.test(started.pathname)
    || input.formStillPresent
    || normalizedText !== WORKABLE_RECEIPT_TEXT
    || !workableReceiptBindingMatches(input.startedUrl, input.finalUrl)
  ) return null;
  return {
    confirmationText: WORKABLE_RECEIPT_TEXT,
    receiptProof: {
      version: 1,
      family: 'workable',
      state: 'application_submitted',
      evidence: 'workable_successful_submit',
      form_still_present: false,
    },
  };
}

export type MeasuredGreenhouseReceipt = {
  confirmationText: string;
  receiptProof: GreenhouseReceiptProofV1;
};

export function measuredGreenhouseReceipt(input: {
  startedUrl: string;
  finalUrl: string;
  confirmationBodyText: string;
  formStillPresent: boolean;
}): MeasuredGreenhouseReceipt | null {
  const confirmationText = input.confirmationBodyText.replace(/\s+/g, ' ').trim().slice(0, 2000);
  if (
    !confirmationText
    || input.formStillPresent
    || !greenhouseReceiptBindingMatches(input.startedUrl, input.finalUrl)
  ) return null;
  return {
    confirmationText,
    receiptProof: {
      version: 1,
      family: 'greenhouse',
      state: 'application_submitted',
      evidence: 'greenhouse_confirmation_content',
      form_still_present: false,
    },
  };
}

export type SubmissionOutcome =
  | { kind: 'failure'; message: string }
  | { kind: 'confirmed' }
  | null;

export function classifySubmissionOutcome(text: string): SubmissionOutcome {
  const failure = pageSubmissionFailureMessage(text);
  if (failure) return { kind: 'failure', message: failure };
  if (pageShowsSubmissionConfirmation(text)) return { kind: 'confirmed' };
  return null;
}
import {
  greenhouseReceiptBindingMatches,
  WORKABLE_RECEIPT_TEXT,
  workableReceiptBindingMatches,
  type GreenhouseReceiptProofV1,
  type WorkableReceiptProofV1,
} from './submission-outcome-outbox';
