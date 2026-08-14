import { describe, expect, it } from 'vitest';
import { needsAutomaticSubmissionEntitlement } from './submission-entitlement';

describe('extension submission entitlement boundary', () => {
  it('keeps a trusted manual final click on Free while gating automatic submission', () => {
    expect(needsAutomaticSubmissionEntitlement('user_initiated')).toBe(false);
    expect(needsAutomaticSubmissionEntitlement('standing_consent')).toBe(true);
  });
});
