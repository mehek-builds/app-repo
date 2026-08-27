import { describe, expect, it } from 'vitest';

import {
  freeManualSubmissionAtsSupported,
  freeManualSubmissionPortalSupported,
} from './free-manual-submission-capability';

describe('Free manual submission capability', () => {
  it('allows only Greenhouse as the reviewed 0.6.2 boundary', () => {
    expect(freeManualSubmissionAtsSupported('greenhouse')).toBe(true);
  });

  it('default-denies generic and every broader adapter capability', () => {
    for (const ats of [
      'generic',
      'ashby',
      'lever',
      'workday',
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

  it('allows only exact measured Greenhouse direct and US or EU embed start routes', () => {
    for (const url of [
      'https://job-boards.greenhouse.io/acme/jobs/1234567',
      'https://job-boards.eu.greenhouse.io/acme/jobs/1234567/',
      'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=1234567',
      'https://job-boards.eu.greenhouse.io/embed/job_app?token=1234567&for=acme',
    ]) expect(freeManualSubmissionPortalSupported(url)).toBe(true);
    for (const url of [
      'https://boards.greenhouse.io/acme/jobs/1234567',
      'https://job-boards.greenhouse.io/embed/job_app?for=acme',
      'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=1234567&source=x',
      'https://job-boards.greenhouse.io/embed/job_app?for=acme&for=other&token=1234567',
      'https://apply.workable.com/acme/j/1234abcdef/apply/',
    ]) expect(freeManualSubmissionPortalSupported(url)).toBe(false);
  });
});
