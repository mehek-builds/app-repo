export type SubmissionReceiptPresentation = {
  terminal: boolean;
  title: 'Saving receipt' | 'Receipt needs repair' | 'Checking receipt' | 'Submission needs review' | 'Sent';
  status: 'Employer confirmation found, saving receipt.'
    | 'Litos saved this receipt, but syncing needs repair. Do not submit again.'
    | 'Litos is checking for the employer receipt. Do not submit again.'
    | 'Litos could not verify the employer receipt. Do not submit again.'
    | 'The company confirmed they got it.';
};

export function submissionReceiptPresentation(
  response?: { ok?: boolean; submitted?: boolean },
  repairRequired = false,
): SubmissionReceiptPresentation {
  if (response?.ok === true && response.submitted === true) {
    return { terminal: true, title: 'Sent', status: 'The company confirmed they got it.' };
  }
  return repairRequired
    ? {
      terminal: false,
      title: 'Receipt needs repair',
      status: 'Litos saved this receipt, but syncing needs repair. Do not submit again.',
    }
    : { terminal: false, title: 'Saving receipt', status: 'Employer confirmation found, saving receipt.' };
}

export function pendingSubmissionReceiptPresentation(): SubmissionReceiptPresentation {
  return {
    terminal: false,
    title: 'Checking receipt',
    status: 'Litos is checking for the employer receipt. Do not submit again.',
  };
}

export function deadLetterSubmissionReceiptPresentation(): SubmissionReceiptPresentation {
  return {
    terminal: false,
    title: 'Submission needs review',
    status: 'Litos could not verify the employer receipt. Do not submit again.',
  };
}
