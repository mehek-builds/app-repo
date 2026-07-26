import type { OutreachStatus } from './types';

/* ONE vocabulary for what happened to an email.
 *
 * This existed twice. `MainScreen` printed the raw API enum with a CSS `capitalize` and coloured
 * `sent` amber; `TrackingDashboard` printed human labels and coloured `sent` blue. A student saw
 * "Drafted" in amber on one screen and "Written, not sent" in grey on the next, for the same row.
 *
 * The colour rule: a status is a fact about what happened, not a judgement about it. Only a
 * bounce is actually bad, so only a bounce is red. An email that went out exactly as intended is
 * not a warning.
 */
export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'brand';

export const OUTREACH_STATUS: Record<OutreachStatus, { tone: StatusTone; className: string; label: string }> = {
  drafted: { tone: 'neutral', className: 'text-gray-600', label: 'Written, not sent' },
  sent: { tone: 'brand', className: 'text-gray-950', label: 'Sent' },
  replied: { tone: 'success', className: 'text-success-700', label: 'They replied' },
  bounced: { tone: 'danger', className: 'text-danger-700', label: 'Did not arrive' },
};

export const UNKNOWN_OUTREACH_STATUS = {
  tone: 'neutral' as StatusTone,
  className: 'text-gray-600',
  label: 'Unknown',
};

export function outreachStatus(status: OutreachStatus | string) {
  return OUTREACH_STATUS[status as OutreachStatus] ?? UNKNOWN_OUTREACH_STATUS;
}
