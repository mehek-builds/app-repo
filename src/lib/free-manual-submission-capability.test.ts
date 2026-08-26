import { describe, expect, it } from 'vitest';

import { freeManualSubmissionAtsSupported } from './free-manual-submission-capability';

describe('Free manual submission capability', () => {
  it('allows only the four reviewed 0.6.2 boundaries', () => {
    for (const ats of ['ashby', 'greenhouse', 'lever', 'workday']) {
      expect(freeManualSubmissionAtsSupported(ats)).toBe(true);
    }
  });

  it('default-denies generic and every broader adapter capability', () => {
    for (const ats of [
      'generic',
      'linkedin',
      'recruitee',
      'rippling',
      'breezy',
      'workable',
      'jazzhr',
      'unknown',
      '',
      null,
    ]) {
      expect(freeManualSubmissionAtsSupported(ats)).toBe(false);
    }
  });
});
