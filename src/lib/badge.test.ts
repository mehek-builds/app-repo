import { describe, it, expect } from 'vitest';
import { badgeState } from './badge';

describe('badgeState', () => {
  it('shows nothing when nothing is waiting', () => {
    expect(badgeState({ stalls: 0, drafts: 0, jobDetected: false })).toEqual({ text: '' });
  });

  it('shows the stall count', () => {
    expect(badgeState({ stalls: 3, drafts: 0, jobDetected: false }).text).toBe('3');
  });

  /* Priority is by what the applicant OWES. A stalled application is work already started that
   * cannot finish without them; a draft is ready and a detected job is an invitation. Before this
   * had one owner, whichever event fired last won, so a real stall could be replaced by a '!'. */
  it('puts a stalled application ahead of drafts and a detected job', () => {
    expect(badgeState({ stalls: 2, drafts: 5, jobDetected: true }).text).toBe('2');
  });

  it('puts drafts ahead of a detected job', () => {
    expect(badgeState({ stalls: 0, drafts: 5, jobDetected: true }).text).toBe('5');
  });

  it('falls back to the detected-job marker', () => {
    expect(badgeState({ stalls: 0, drafts: 0, jobDetected: true }).text).toBe('!');
  });

  it('caps a runaway count rather than rendering a number nobody can read', () => {
    expect(badgeState({ stalls: 250, drafts: 0, jobDetected: false }).text).toBe('99+');
    expect(badgeState({ stalls: 99, drafts: 0, jobDetected: false }).text).toBe('99');
  });

  it('omits the colour when there is nothing to show, so callers can skip the call', () => {
    expect(badgeState({ stalls: 0, drafts: 0, jobDetected: false }).color).toBeUndefined();
    expect(badgeState({ stalls: 1, drafts: 0, jobDetected: false }).color).toBeDefined();
  });
});
