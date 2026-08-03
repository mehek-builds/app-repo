/**
 * The toolbar badge has one owner.
 *
 * Before this it had three independent writers - job-detected wrote '!', outreach wrote a draft
 * count, and two handlers wrote '' to clear - each assuming it was the only one. Whoever ran last
 * won, and any clear wiped the others, so a real signal could be erased by an unrelated event. The
 * badge is one pixel of shared state and it needs one decision function.
 *
 * Priority is by what the applicant OWES, not by what happened most recently:
 *
 *   1. Stalled applications. Work already started that cannot finish without them, and the only
 *      state here where an application is sitting unsent. It outranks everything.
 *   2. Outreach drafts. Ready for them, but nothing is stuck.
 *   3. A detected job. An invitation, not an obligation.
 */

export type BadgeInputs = {
  /** Applications waiting on a human-verification check. */
  stalls: number;
  /** Outreach drafts ready in the popup. */
  drafts: number;
  /** A job posting was detected on the current tab. */
  jobDetected: boolean;
};

export type BadgeState = {
  text: string;
  /** Undefined when there is nothing to show, so callers can skip the colour call entirely. */
  color?: string;
};

const BADGE_COLOR = '#6b84e8';

/**
 * Counts above 99 render as '99+'. Chrome truncates a badge to roughly four characters and the
 * exact number stops carrying information long before that; "more than you want" is the message.
 */
function count(value: number): string {
  if (value > 99) return '99+';
  return String(value);
}

export function badgeState(inputs: BadgeInputs): BadgeState {
  if (inputs.stalls > 0) return { text: count(inputs.stalls), color: BADGE_COLOR };
  if (inputs.drafts > 0) return { text: count(inputs.drafts), color: BADGE_COLOR };
  if (inputs.jobDetected) return { text: '!', color: BADGE_COLOR };
  return { text: '' };
}
