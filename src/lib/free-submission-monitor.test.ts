import { describe, expect, it } from 'vitest';
import {
  bindFreeSubmissionOutcome,
  FREE_SUBMISSION_MONITOR_TTL_MS,
  freeSubmissionMonitorDisposition,
  freeSubmissionNavigationMatches,
  type PendingFreeSubmissionMonitor,
} from './free-submission-monitor';

const NOW = 1_760_000_000_000;
const pending: PendingFreeSubmissionMonitor = {
  eventId: 'event-1',
  applicationId: 'application-1',
  tabId: 7,
  frameId: 0,
  accountId: 'account-1',
  authEpoch: 4,
  startUrl: 'https://jobs.jobvite.com/acme/job/CaseId/apply',
  startedAt: NOW,
  boundaryLeaseId: '123e4567-e89b-42d3-a456-426614174000',
  boundaryActivationId: '223e4567-e89b-42d3-a456-426614174000',
  boundaryExpiresAt: NOW + 180_000,
};

describe('Free submission monitor recovery', () => {
  it('accepts only the same application identity across supported receipt navigation', () => {
    expect(freeSubmissionNavigationMatches(
      pending.startUrl,
      'https://jobs.jobvite.com/acme/job/CaseId/confirmation',
    )).toBe(true);
    expect(freeSubmissionNavigationMatches(
      pending.startUrl,
      'https://jobs.jobvite.com/acme/job/OtherId/confirmation',
    )).toBe(false);
    expect(freeSubmissionNavigationMatches(
      pending.startUrl,
      'https://evil.example/acme/job/CaseId/confirmation',
    )).toBe(false);
    expect(freeSubmissionNavigationMatches(
      'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=123',
      'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=456',
    )).toBe(false);
  });

  it('resumes only the same account, tab, frame, epoch, and URL identity', () => {
    const base = {
      pending,
      tabId: 7,
      frameId: 0,
      accountId: 'account-1',
      currentAuthEpoch: 4,
      currentUrl: 'https://jobs.jobvite.com/acme/job/CaseId/confirmation',
      now: NOW + 1000,
    };
    expect(freeSubmissionMonitorDisposition(base)).toBe('resume');
    expect(freeSubmissionMonitorDisposition({ ...base, accountId: 'account-2' })).toBe('force_unknown');
    expect(freeSubmissionMonitorDisposition({ ...base, tabId: 8 })).toBe('force_unknown');
    expect(freeSubmissionMonitorDisposition({ ...base, frameId: 1 })).toBe('force_unknown');
    expect(freeSubmissionMonitorDisposition({ ...base, currentAuthEpoch: 5 })).toBe('force_unknown');
    expect(freeSubmissionMonitorDisposition({ ...base, currentUrl: 'https://jobs.jobvite.com/acme/job/OtherId/confirmation' })).toBe('force_unknown');
  });

  it('uses account identity after a service-worker epoch reset and expires within a fixed bound', () => {
    const base = {
      pending,
      tabId: 7,
      frameId: 0,
      accountId: 'account-1',
      currentAuthEpoch: 0,
      currentUrl: pending.startUrl,
      now: NOW + 1000,
    };
    expect(freeSubmissionMonitorDisposition(base)).toBe('resume');
    expect(freeSubmissionMonitorDisposition({
      ...base,
      now: NOW + FREE_SUBMISSION_MONITOR_TTL_MS + 1,
    })).toBe('expired');
  });

  it('posts URL or frame drift only as unknown against the stored bound start URL', () => {
    expect(bindFreeSubmissionOutcome({
      pending,
      eventId: pending.eventId,
      applicationId: pending.applicationId,
      outcome: 'confirmed',
      finalUrl: 'https://jobs.jobvite.com/acme/job/OtherId/confirmation',
      confirmationText: 'Thank you for applying.',
      disposition: 'force_unknown',
    })).toEqual({
      eventId: pending.eventId,
      applicationId: pending.applicationId,
      leaseId: pending.boundaryLeaseId,
      activationId: pending.boundaryActivationId,
      outcome: 'unknown',
      finalUrl: pending.startUrl,
      confirmationText: '',
    });
  });
});
