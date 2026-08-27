import { describe, expect, it } from 'vitest';
import {
  deadLetterSubmissionReceiptPresentation,
  pendingSubmissionReceiptPresentation,
  submissionReceiptPresentation,
} from './submission-receipt-ui';

describe('submission receipt UI state', () => {
  it('never claims Sent while a local confirmation is only queued', () => {
    expect(submissionReceiptPresentation({ ok: false })).toEqual({
      terminal: false,
      title: 'Saving receipt',
      status: 'Employer confirmation found, saving receipt.',
    });
  });

  it('never claims Sent for a non-submitted backend response', () => {
    expect(submissionReceiptPresentation({ ok: true, submitted: false }).terminal).toBe(false);
    expect(submissionReceiptPresentation({ ok: true, submitted: false }).title).not.toBe('Sent');
  });

  it('claims Sent only for the exact authoritative submitted acknowledgement', () => {
    expect(submissionReceiptPresentation({ ok: true, submitted: true })).toEqual({
      terminal: true,
      title: 'Sent',
      status: 'The company confirmed they got it.',
    });
  });

  it('surfaces a retained poison receipt as repair-required without allowing a resend', () => {
    expect(submissionReceiptPresentation(undefined, true)).toEqual({
      terminal: false,
      title: 'Receipt needs repair',
      status: 'Litos saved this receipt, but syncing needs repair. Do not submit again.',
    });
  });

  it('shows a visible no-resubmit state while a recovered weak outcome is still observed', () => {
    expect(pendingSubmissionReceiptPresentation()).toEqual({
      terminal: false,
      title: 'Checking receipt',
      status: 'Litos is checking for the employer receipt. Do not submit again.',
    });
  });

  it('shows an explicit review state when late receipt observation expires', () => {
    expect(deadLetterSubmissionReceiptPresentation()).toEqual({
      terminal: false,
      title: 'Submission needs review',
      status: 'Litos could not verify the employer receipt. Do not submit again.',
    });
  });
});
