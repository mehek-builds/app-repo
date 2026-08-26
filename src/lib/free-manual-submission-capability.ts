const SUPPORTED_FREE_MANUAL_SUBMISSION_ATS = new Set([
  'ashby',
  'greenhouse',
  'lever',
  'workday',
]);

/**
 * The 0.6.2 Free lane is intentionally narrower than the general adapter registry. Each member
 * here has both a proven application-form adapter and an explicit final-control replay path.
 * Unknown, generic, and newly added adapters stay disabled until they get the same proof.
 */
export function freeManualSubmissionAtsSupported(atsName: unknown): boolean {
  return typeof atsName === 'string'
    && SUPPORTED_FREE_MANUAL_SUBMISSION_ATS.has(atsName.trim().toLowerCase());
}

export const FREE_MANUAL_SUBMISSION_UNAVAILABLE_COPY =
  'Litos 0.6.2 can safely fill and guard Free submissions only on Ashby, Greenhouse, Lever, and Workday. Nothing was filled or submitted here.';
