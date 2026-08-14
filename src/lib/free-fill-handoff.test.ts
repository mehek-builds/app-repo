import { describe, expect, it } from 'vitest';
import {
  freeFillPortalMatches,
  FreeFillHandoffRequestError,
  parseFreeFillHandoffRequest,
  prepareFreeFillHandoff,
  verifyFreeFillHandoffProof,
} from './free-fill-handoff';

const APPLICATION_ID = '123e4567-e89b-42d3-a456-426614174000';
const ACCOUNT_ID = 'account-1';
const PORTAL_URL = 'https://jobs.lever.co/acme/engineer/apply?utm_source=litos';

describe('dashboard Free fill handoff', () => {
  it('matches only the same live application, including safe posting-to-form transitions', () => {
    expect(freeFillPortalMatches(
      'https://jobs.lever.co/acme/engineer',
      'https://jobs.lever.co/acme/engineer/apply?utm_source=litos',
    )).toBe(true);
    expect(freeFillPortalMatches(
      'https://careers-acme.icims.com/jobs/123/engineer/login',
      'https://careers-acme.icims.com/jobs/123/engineer/job',
    )).toBe(true);
    expect(freeFillPortalMatches(
      'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=one',
      'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=two',
    )).toBe(false);
    expect(freeFillPortalMatches(
      'https://jobs.lever.co/acme/engineer',
      'https://jobs.lever.co/acme/another-role/apply',
    )).toBe(false);
  });

  it('accepts only the exact external application id and a secure portal URL', () => {
    expect(parseFreeFillHandoffRequest({ application_id: APPLICATION_ID, portal_url: PORTAL_URL })).toMatchObject({
      applicationId: APPLICATION_ID,
      portalUrl: PORTAL_URL,
    });
    expect(parseFreeFillHandoffRequest({ application_id: 'not-an-id', portal_url: PORTAL_URL })).toMatchObject({
      ok: false,
      code: 'invalid_application',
    });
    expect(parseFreeFillHandoffRequest({ application_id: APPLICATION_ID, portal_url: 'http://jobs.lever.co/acme/engineer' })).toMatchObject({
      ok: false,
      code: 'unsafe_portal_url',
    });
    expect(parseFreeFillHandoffRequest({ application_id: APPLICATION_ID, portal_url: 'https://user:pass@jobs.lever.co/acme/engineer' })).toMatchObject({
      ok: false,
      code: 'unsafe_portal_url',
    });
  });

  it('binds the backend-owned application, account, and canonical portal', () => {
    const request = parseFreeFillHandoffRequest({ application_id: APPLICATION_ID, portal_url: PORTAL_URL });
    if ('ok' in request) throw new Error('request did not parse');
    expect(verifyFreeFillHandoffProof(request, ACCOUNT_ID, {
      application_id: APPLICATION_ID,
      account_id: ACCOUNT_ID,
      portal_url: 'https://jobs.lever.co/acme/engineer',
      application: { id: APPLICATION_ID, portal_url: 'https://jobs.lever.co/acme/engineer/apply' },
    })).toMatchObject({ applicationId: APPLICATION_ID, accountId: ACCOUNT_ID });
    expect(verifyFreeFillHandoffProof(request, ACCOUNT_ID, {
      application_id: APPLICATION_ID,
      account_id: ACCOUNT_ID,
      portal_url: 'https://jobs.lever.co/acme/another-role',
    })).toMatchObject({ ok: false, code: 'portal_mismatch' });
    expect(verifyFreeFillHandoffProof(request, ACCOUNT_ID, {
      application_id: APPLICATION_ID,
      account_id: 'account-2',
      portal_url: PORTAL_URL,
    })).toMatchObject({ ok: false, code: 'account_changed' });
  });

  it('rejects an account race after the owned fill-data request resolves', async () => {
    let epoch = 4;
    const result = await prepareFreeFillHandoff(
      { application_id: APPLICATION_ID, portal_url: PORTAL_URL },
      {
        currentAuthEpoch: () => epoch,
        authEpochIsCurrent: (expected) => expected === epoch,
        getToken: async () => 'token-a',
        readAccount: async () => ({ account_id: ACCOUNT_ID }),
        readFillData: async () => {
          epoch += 1;
          return {
            application_id: APPLICATION_ID,
            account_id: ACCOUNT_ID,
            portal_url: PORTAL_URL,
          };
        },
      },
    );
    expect(result).toMatchObject({ ok: false, code: 'account_changed' });
  });

  it('preserves typed ownership and authentication failures for the website bridge', async () => {
    const authentication = await prepareFreeFillHandoff(
      { application_id: APPLICATION_ID, portal_url: PORTAL_URL },
      {
        currentAuthEpoch: () => 1,
        authEpochIsCurrent: () => true,
        getToken: async () => null,
        readAccount: async () => ({ account_id: ACCOUNT_ID }),
        readFillData: async () => ({}),
      },
    );
    expect(authentication).toMatchObject({ ok: false, code: 'authentication_required' });

    const missing = await prepareFreeFillHandoff(
      { application_id: APPLICATION_ID, portal_url: PORTAL_URL },
      {
        currentAuthEpoch: () => 1,
        authEpochIsCurrent: () => true,
        getToken: async () => 'token-a',
        readAccount: async () => ({ account_id: ACCOUNT_ID }),
        readFillData: async () => {
          throw new FreeFillHandoffRequestError('application_not_found', 'This application was not found.');
        },
      },
    );
    expect(missing).toEqual({ ok: false, code: 'application_not_found', error: 'This application was not found.' });
  });
});
