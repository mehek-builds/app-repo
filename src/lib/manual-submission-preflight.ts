export function manualSubmissionPreflightError(input: {
  guardError: string | null;
  requiredFieldMissing: boolean;
  challengeWaiting: boolean;
}): string | null {
  if (input.guardError) return input.guardError;
  if (input.requiredFieldMissing) return 'Something required is still blank. Fill it in, then click Submit again.';
  if (input.challengeWaiting) return 'Complete the human check, then click Submit again.';
  return null;
}
