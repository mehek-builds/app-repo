// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ATS_SPECS, atsCanAutoSubmit, clickDashboardSubmitIfAllowed, fillAtsApplication, isAtsApplicationPage, specForCurrentPage } from './ats-2026-07';
import { providerPolicyForbidsControl, type GenericProviderPolicy } from './generic';
import { skippedReasonsNeedReview } from '../autosubmit-gate';
import { contentInitRoute } from '../content-init-routing';
import type { ApplicationProfile, Profile } from '../types';

function at(raw: string): void {
  const url = new URL(raw);
  Object.defineProperty(window, 'location', {
    value: { hostname: url.hostname, pathname: url.pathname, href: url.href, search: url.search },
    configurable: true,
  });
}

const profile: Profile = {
  full_name: 'Taylor Example',
  email: 'taylor@example.com',
  experience: [],
  skills: [],
  school: 'Example University',
  grad_year: 2028,
};
const applicationProfile = {
  phone: '+971500000000',
} as ApplicationProfile;

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 120, height: 24, top: 0, left: 0, right: 120, bottom: 24, x: 0, y: 0, toJSON: () => ({}) }),
  });
  if (typeof globalThis.CSS === 'undefined' || !globalThis.CSS?.escape) {
    (globalThis as Record<string, unknown>).CSS = { escape: (value: string) => value };
  }
});

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('Recruitee adapter captured from rebuy and Optiweb', () => {
  it.each([
    'https://rebuy.recruitee.com/o/acquisition-manager-paid-search-pla-focused-mfx/c/new',
    'https://optiweb.recruitee.com/o/apply-for-our-talent-pool-or-internship/c/new',
  ])('detects the live application route %s', (url) => {
    at(url);
    expect(specForCurrentPage()?.id).toBe('recruitee');
    expect(isAtsApplicationPage()).toBe(true);
  });

  it('keeps the WhiteCoat detail route inactive and pins its exact form as manual-submit', () => {
    const detail = 'https://whitecoatglobal1.recruitee.com/o/software-engineer-intern';
    at(detail);
    expect(isAtsApplicationPage()).toBe(false);
    expect(contentInitRoute(new URL(detail))).toBe('ignore');
    expect(atsCanAutoSubmit('recruitee')).toBe(false);
    const form = `${detail}/c/new`;
    at(form);
    expect(isAtsApplicationPage()).toBe(true);
    expect(contentInitRoute(new URL(form))).toBe('ats');
    expect(atsCanAutoSubmit('recruitee')).toBe(false);
  });

  it.each([
    'https://other.recruitee.com/o/software-engineer-intern/c/new',
    'https://whitecoatglobal1.recruitee.com/o/other-role/c/new',
    'https://whitecoatglobal1.recruitee.com/o/software-engineer-intern/apply',
    'https://whitecoatglobal1.recruitee.com/o/software-engineer-intern%2Fc%2Fnew',
    'https://whitecoatglobal1.recruitee.com/o/software-engineer-intern/c/new?source=test',
    'https://whitecoatglobal1.recruitee.com/o/software_engineer_intern',
    'https://api.eu.recruitee.com/o/software-engineer-intern',
    'https://www.recruitee.com/o/software-engineer-intern',
  ])('rejects a Recruitee lookalike route %s', (url) => {
    at(url);
    expect(isAtsApplicationPage()).toBe(false);
  });

  it('fills only captured identity fields and leaves agreement controls untouched', async () => {
    at('https://rebuy.recruitee.com/o/role/c/new');
    document.body.innerHTML = `<form>
      <input name="candidate.name" />
      <input name="candidate.email" />
      <input name="candidate.phone" />
      <input type="checkbox" name="candidate.agreements.1533" required />
      <input type="text" name="hp_4abc" />
    </form>`;
    const result = await fillAtsApplication({
      fullName: 'Taylor Example', email: 'taylor@example.com', profile, applicationProfile,
    });
    expect(document.querySelector<HTMLInputElement>('input[name="candidate.name"]')?.value).toBe('Taylor Example');
    expect(document.querySelector<HTMLInputElement>('input[name="candidate.email"]')?.value).toBe('taylor@example.com');
    expect(document.querySelector<HTMLInputElement>('input[name="candidate.agreements.1533"]')?.checked).toBe(false);
    expect(document.querySelector<HTMLInputElement>('input[name="hp_4abc"]')?.value).toBe('');
    expect(result.ats_name).toBe('recruitee');
  });

  it('never answers Optiweb future-position retention consent', async () => {
    at('https://optiweb.recruitee.com/o/apply-for-our-talent-pool-or-internship/c/new');
    document.body.innerHTML = `<fieldset>
      <legend>I want you to keep my information for all future positions I might be fit for. If something interesting pops up, send me an e-mail. The data will be kept for five years.</legend>
      <input type="radio" id="retain-yes" name="candidate.openQuestionAnswers.42" value="yes" />
      <label for="retain-yes">Yes</label>
      <input type="radio" id="retain-no" name="candidate.openQuestionAnswers.42" value="no" />
      <label for="retain-no">No</label>
    </fieldset>`;
    const result = await fillAtsApplication({
      fullName: 'Taylor Example', email: 'taylor@example.com', profile, applicationProfile,
    });
    expect(document.querySelector<HTMLInputElement>('#retain-yes')?.checked).toBe(false);
    expect(document.querySelector<HTMLInputElement>('#retain-no')?.checked).toBe(false);
    expect(skippedReasonsNeedReview(result.skipped_reasons)).toBe(true);
  });

  it('never checks Framestore application privacy consent', async () => {
    at('https://framestore.recruitee.com/o/unpaid-work-experience/c/new');
    document.body.innerHTML = `<label>
      <input type="checkbox" name="candidate.agreements.991" />
      I hereby confirm that I have read and understood Framestore's Privacy Policy and accept the use of my data for the purposes of this job application.
    </label>`;
    const result = await fillAtsApplication({
      fullName: 'Taylor Example', email: 'taylor@example.com', profile, applicationProfile,
    });
    expect(document.querySelector<HTMLInputElement>('input')?.checked).toBe(false);
    expect(skippedReasonsNeedReview(result.skipped_reasons)).toBe(true);
  });

  it('holds Recruitee auto-submit when a privacy control arrives prechecked', async () => {
    at('https://framestore.recruitee.com/o/unpaid-work-experience/c/new');
    document.body.innerHTML = `<label>
      <input type="checkbox" name="candidate.agreements.991" checked />
      I hereby confirm that I have read and understood Framestore's Privacy Policy and accept the use of my data for the purposes of this job application.
    </label>`;
    const result = await fillAtsApplication({
      fullName: 'Taylor Example', email: 'taylor@example.com', profile, applicationProfile,
    });
    expect(document.querySelector<HTMLInputElement>('input')?.checked).toBe(true);
    expect(skippedReasonsNeedReview(result.skipped_reasons)).toBe(true);
  });

  it('structurally blocks a hidden Recruitee agreement select without a label', async () => {
    at('https://rebuy.recruitee.com/o/role/c/new');
    document.body.innerHTML = `<select name="candidate.agreements.1533" style="display:none">
      <option value="">Choose</option><option value="yes">Yes</option>
    </select>`;
    const result = await fillAtsApplication({
      fullName: 'Taylor Example', email: 'taylor@example.com', profile, applicationProfile,
    });
    expect(document.querySelector<HTMLSelectElement>('select')?.value).toBe('');
    expect(skippedReasonsNeedReview(result.skipped_reasons)).toBe(true);
  });

  it('rejects product and nested non-tenant hosts', () => {
    for (const host of ['www.recruitee.com', 'api.eu.recruitee.com']) {
      at(`https://${host}/o/role/c/new`);
      expect(specForCurrentPage()).toBeNull();
    }
  });
});

describe('Teamtailor adapter captured from Teamtailor and AICOM', () => {
  it.each([
    'https://career.teamtailor.com/jobs/8124573-group-financial-controller/applications/new',
    'https://aicomspa-1736851116.teamtailor.com/jobs/7931279-techincal-tender-specialist/applications/new',
  ])('detects the live application route %s', (url) => {
    at(url);
    expect(specForCurrentPage()?.id).toBe('teamtailor');
    expect(isAtsApplicationPage()).toBe(true);
  });

  it('routes only the verified application child of the live Flanks detail page', () => {
    const detail = 'https://flanks.teamtailor.com/jobs/7847431-software-engineering-intern-web-scraping-data-acquisition';
    at(detail);
    expect(specForCurrentPage()?.id).toBe('teamtailor');
    expect(isAtsApplicationPage()).toBe(false);
    expect(contentInitRoute(new URL(detail))).toBe('ignore');
    at(`${detail}/applications/new`);
    expect(isAtsApplicationPage()).toBe(true);
    expect(contentInitRoute(new URL(`${detail}/applications/new`))).toBe('ats');
  });

  it.each([
    'https://other.teamtailor.com/jobs/7847431-software-engineering-intern-web-scraping-data-acquisition/applications/new',
    'https://flanks.teamtailor.com/jobs/7847432-software-engineering-intern-web-scraping-data-acquisition/applications/new',
    'https://flanks.teamtailor.com/jobs/7847431-other-role/applications/new',
    'https://flanks.teamtailor.com/jobs/software-engineering-intern/applications/new',
    'https://flanks.teamtailor.com/jobs/7847431-software-engineering-intern/apply',
    'https://flanks.teamtailor.com/jobs/7847431-software-engineering-intern-web-scraping-data-acquisition%2Fapplications%2Fnew',
    'https://app.teamtailor.com/jobs/7847431-software-engineering-intern/applications/new',
  ])('rejects a Teamtailor lookalike route %s', (url) => {
    at(url);
    expect(isAtsApplicationPage()).toBe(false);
  });

  it('fills identity but never checks applicant or future-job consent', async () => {
    at('https://career.teamtailor.com/jobs/8124573-role/applications/new');
    document.body.innerHTML = `<form>
      <input name="candidate[first_name]" />
      <input name="candidate[last_name]" />
      <input name="candidate[email]" />
      <input name="candidate[phone]" />
      <input type="checkbox" name="candidate[consent_given]" />
      <input type="checkbox" name="candidate[consent_given_future_jobs]" />
    </form>`;
    const result = await fillAtsApplication({
      fullName: 'Taylor Example', email: 'taylor@example.com', profile, applicationProfile,
    });
    expect(document.querySelector<HTMLInputElement>('input[name="candidate[first_name]"]')?.value).toBe('Taylor');
    expect(document.querySelector<HTMLInputElement>('input[name="candidate[last_name]"]')?.value).toBe('Example');
    expect(document.querySelector<HTMLInputElement>('input[name="candidate[consent_given]"]')?.checked).toBe(false);
    expect(document.querySelector<HTMLInputElement>('input[name="candidate[consent_given_future_jobs]"]')?.checked).toBe(false);
    expect(result.skipped_reasons.some((reason) => /privacy terms/i.test(reason))).toBe(true);
  });

  it('never checks exact Teamtailor privacy and future-job labels', async () => {
    at('https://tractivegmbh.teamtailor.com/jobs/7365319-senior-tracking-engineer/applications/new');
    document.body.innerHTML = `<form>
      <label>
        <input id="privacy" type="checkbox" name="candidate[consent_given]" />
        By submitting this application, I agree that I have read the Privacy Policy and confirm that Tractive will store my personal data to be able to process my application.
      </label>
      <label>
        <input id="future" type="checkbox" name="candidate[consent_given_future_jobs]" />
        Yes, Tractive can contact me directly about specific future job opportunities.
      </label>
    </form>`;
    const result = await fillAtsApplication({
      fullName: 'Taylor Example', email: 'taylor@example.com', profile, applicationProfile,
    });
    expect(document.querySelector<HTMLInputElement>('#privacy')?.checked).toBe(false);
    expect(document.querySelector<HTMLInputElement>('#future')?.checked).toBe(false);
    expect(skippedReasonsNeedReview(result.skipped_reasons)).toBe(true);
  });

  it('uses an enforced submission capability gate, not the ceiling message', () => {
    expect(atsCanAutoSubmit('recruitee')).toBe(true);
    expect(atsCanAutoSubmit('teamtailor')).toBe(false);
    const teamtailor = ATS_SPECS.find((item) => item.id === 'teamtailor');
    expect(teamtailor?.autoSubmit).toBe('never');
  });

  it('never clicks Teamtailor submit from the dashboard programmatic path', () => {
    let clicks = 0;
    const button = { click: () => { clicks += 1; } } as Pick<HTMLElement, 'click'>;
    expect(clickDashboardSubmitIfAllowed('teamtailor', button)).toBe(false);
    expect(clicks).toBe(0);
  });

  it('structurally blocks hidden, prechecked Teamtailor consent without label text', async () => {
    at('https://career.teamtailor.com/jobs/8124573-role/applications/new');
    document.body.innerHTML = '<input type="checkbox" name="candidate[consent_given_future_jobs]" checked hidden />';
    const result = await fillAtsApplication({
      fullName: 'Taylor Example', email: 'taylor@example.com', profile, applicationProfile,
    });
    expect(document.querySelector<HTMLInputElement>('input')?.checked).toBe(true);
    expect(skippedReasonsNeedReview(result.skipped_reasons)).toBe(true);
  });

  it('recognizes detached provider controls from their native names alone', () => {
    const recruiteePolicy: GenericProviderPolicy = { provider: 'recruitee', forbidConsentWrites: true };
    const teamtailorPolicy: GenericProviderPolicy = { provider: 'teamtailor', forbidConsentWrites: true };
    const recruitee = document.createElement('input');
    recruitee.type = 'radio';
    recruitee.name = 'candidate.agreements.9001';
    const teamtailor = document.createElement('select');
    teamtailor.name = 'candidate[consent_given_future_jobs]';
    expect(recruitee.isConnected).toBe(false);
    expect(teamtailor.isConnected).toBe(false);
    expect(providerPolicyForbidsControl(recruiteePolicy, recruitee)).toBe(true);
    expect(providerPolicyForbidsControl(teamtailorPolicy, teamtailor)).toBe(true);
  });

  it('rejects Teamtailor product and API hosts', () => {
    for (const host of ['www.teamtailor.com', 'app.teamtailor.com', 'api.teamtailor.com', 'api.na.teamtailor.com']) {
      at(`https://${host}/jobs/1-role/applications/new`);
      expect(specForCurrentPage()).toBeNull();
    }
  });

  it('does not map either consent control', () => {
    const spec = ATS_SPECS.find((item) => item.id === 'teamtailor');
    expect(JSON.stringify(spec)).not.toContain('consent_given');
  });
});
