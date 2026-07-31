import { describe, expect, it } from 'vitest';
import { buildCapturePayload, isExtensionAnalyticsEvent } from './analytics';

describe('extension analytics privacy contract', () => {
  it('accepts only the fixed event vocabulary', () => {
    expect(isExtensionAnalyticsEvent('application_fill_completed')).toBe(true);
    expect(isExtensionAnalyticsEvent('application_submission_outcome_recorded')).toBe(true);
    expect(isExtensionAnalyticsEvent('company_secret')).toBe(false);
    expect(isExtensionAnalyticsEvent(null)).toBe(false);
  });

  it('keeps only allowlisted, primitive properties', () => {
    const payload = buildCapturePayload('public-key', 'application_fill_completed', 'anonymous-id', {
      ats_name: 'greenhouse',
      fields_filled: 8,
      fields_skipped: 2,
      auto_submitted: false,
      company: 'Sensitive Company',
      role: 'Sensitive Role',
      url: 'https://example.com/jobs/private?email=person@example.com',
      nested: { email: 'person@example.com' },
    });

    expect(payload.properties).toMatchObject({
      distinct_id: 'anonymous-id',
      surface: 'chrome_extension',
      ats_name: 'greenhouse',
      fields_filled: 8,
      fields_skipped: 2,
      auto_submitted: false,
      $process_person_profile: false,
    });
    expect(payload.properties).not.toHaveProperty('company');
    expect(payload.properties).not.toHaveProperty('role');
    expect(payload.properties).not.toHaveProperty('url');
    expect(payload.properties).not.toHaveProperty('nested');
  });

  it('does not let properties from one event leak into another', () => {
    const payload = buildCapturePayload('public-key', 'extension_opened', 'anonymous-id', {
      authenticated: true,
      ats_name: 'workday',
      outcome: 'confirmed',
    });
    expect(payload.properties.authenticated).toBe(true);
    expect(payload.properties).not.toHaveProperty('ats_name');
    expect(payload.properties).not.toHaveProperty('outcome');
  });

  it('rejects sensitive or malformed values hidden under allowed property names', () => {
    const sensitive = buildCapturePayload('public-key', 'application_fill_completed', 'anonymous-id', {
      ats_name: 'person@example.com',
      fields_filled: -1,
      fields_skipped: Number.MAX_SAFE_INTEGER,
      auto_submitted: 'yes',
    });
    expect(sensitive.properties).not.toHaveProperty('ats_name');
    expect(sensitive.properties).not.toHaveProperty('fields_filled');
    expect(sensitive.properties).not.toHaveProperty('fields_skipped');
    expect(sensitive.properties).not.toHaveProperty('auto_submitted');

    const outcome = buildCapturePayload('public-key', 'application_submission_outcome_recorded', 'anonymous-id', {
      outcome: 'https://example.com/jobs/private?email=person@example.com',
    });
    expect(outcome.properties).not.toHaveProperty('outcome');

    const request = buildCapturePayload('public-key', 'application_submission_requested', 'anonymous-id', {
      authorization: 'Sensitive Company',
    });
    expect(request.properties).not.toHaveProperty('authorization');
  });
});
