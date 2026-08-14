export type ExtensionSubmissionAuthorization = 'standing_consent' | 'user_initiated';

/** A trusted final-button click is Free. Only Litos-initiated submission uses paid automation. */
export function needsAutomaticSubmissionEntitlement(
  authorization: ExtensionSubmissionAuthorization,
): boolean {
  return authorization === 'standing_consent';
}
