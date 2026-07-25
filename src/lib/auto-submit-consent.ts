export function automaticSubmissionEnabled(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  return (value as { automatic_submission_enabled?: unknown }).automatic_submission_enabled === true;
}

export function groundedDraftAnswer(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const response = value as { answer?: unknown; grounded?: unknown };
  if (response.grounded !== true || typeof response.answer !== 'string' || !response.answer.trim()) return null;
  return response.answer;
}
