// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ATS_SPECS,
  atsCanAutoSubmit,
  clickAtsSubmitIfAllowed,
  fillAtsApplication,
  gatedPortalNotice,
  isAtsApplicationPage,
  specForCurrentPage,
} from './ats-2026-07';
import { providerPolicyForbidsControl } from './generic';
import { bullhornEmployerName, contentInitRoute } from '../content-init-routing';
import {
  browserApplicationCapability,
  isResearchedBrowserTenant,
} from './browser-application-capabilities';
import type { ApplicationProfile, Profile } from '../types';

function at(raw: string): void {
  const url = new URL(raw);
  Object.defineProperty(window, 'location', {
    value: { hostname: url.hostname, pathname: url.pathname, hash: url.hash, href: url.href, search: url.search },
    configurable: true,
  });
}

const profile: Profile = {
  full_name: 'Taylor Example',
  email: 'profile@example.com',
  experience: [],
  skills: [],
  school: 'Example University',
  grad_year: 2028,
};
const applicationProfile = { phone: '+971500000000' } as ApplicationProfile;

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

describe('shared default-deny capability registry', () => {
  it.each(['zoho_recruit', 'bullhorn', 'sap_successfactors'] as const)('%s denies submit, account creation and polling', (family) => {
    const capability = browserApplicationCapability(family)!;
    expect(capability.programmaticSubmit).toBe(false);
    expect(capability.createAccount).toBe(false);
    expect(capability.pollPublicListings).toBe(false);
    expect(capability.trustedDirectClick).toBe(true);
    expect(atsCanAutoSubmit(family)).toBe(false);
  });

  it('denies unknown families instead of inheriting a neighboring adapter', () => {
    expect(browserApplicationCapability('future_ats')).toBeNull();
    expect(atsCanAutoSubmit('future_ats')).toBe(false);
  });
});

describe('Zoho Recruit declarative adapter', () => {
  it.each([
    'https://genovice.zohorecruit.com/jobs/Careers/618725000005596009/Calibration-Maintenance-Planner-Scheduler',
    'https://solution25.zohorecruit.eu/jobs/Careers/123456789/Engineer',
  ])('recognizes only the native detail route %s', (url) => {
    at(url);
    expect(specForCurrentPage()?.id).toBe('zoho_recruit');
    expect(isAtsApplicationPage()).toBe(true);
  });

  it('uses the frozen packet email and leaves consent controls untouched', async () => {
    at('https://genovice.zohorecruit.com/jobs/Careers/618725000005596009/Role');
    document.body.innerHTML = `<form>
      <input name="First_Name" />
      <input name="Last_Name" />
      <input type="email" name="Email" style="display:none" />
      <input type="email" name="Email" />
      <input type="tel" name="Phone" />
      <input type="email" name="nickname_email" />
      <input type="file" name="Resume" />
      <label><input type="checkbox" name="candidateConsent" required /> I consent to retention for future jobs</label>
      <label><input type="checkbox" name="eeo" required /> Race or ethnicity (EEO)</label>
      <label><input type="checkbox" name="attestation" required /> I attest that this application is accurate</label>
    </form>`;
    const result = await fillAtsApplication({
      fullName: 'Taylor Example',
      email: 'apply+frozen@trylitos.com',
      profile,
      applicationProfile,
    });
    expect(document.querySelectorAll<HTMLInputElement>('input[name="Email"]')[0]?.value).toBe('');
    expect(document.querySelectorAll<HTMLInputElement>('input[name="Email"]')[1]?.value).toBe('apply+frozen@trylitos.com');
    expect(document.querySelector<HTMLInputElement>('input[name="nickname_email"]')?.value).toBe('');
    const spec = ATS_SPECS.find((candidate) => candidate.id === 'zoho_recruit')!;
    expect(document.querySelector(spec.resume!)).not.toBeNull();
    expect(document.querySelector<HTMLInputElement>('input[name="candidateConsent"]')?.checked).toBe(false);
    expect(document.querySelector<HTMLInputElement>('input[name="eeo"]')?.checked).toBe(false);
    expect(document.querySelector<HTMLInputElement>('input[name="attestation"]')?.checked).toBe(false);
    expect(result.skipped_reasons.join(' ')).toMatch(/privacy.*retention.*EEO.*attestation.*CAPTCHA/i);
  });

  it('refuses a human-decision control when the sensitive meaning appears only in its options', () => {
    at('https://genovice.zohorecruit.com/jobs/Careers/618725000005596009/Role');
    document.body.innerHTML = `<label for="choice">Choose one</label><select id="choice"><option>Pregnancy status</option></select>`;
    for (const id of ['zoho_recruit', 'bullhorn'] as const) {
      const spec = ATS_SPECS.find((candidate) => candidate.id === id)!;
      expect(providerPolicyForbidsControl(spec.genericPolicy, document.querySelector('select')!)).toBe(true);
    }
  });

  it.each([
    ['Salary expectation', '<label for="decision">Salary expectation</label><input id="decision" />'],
    ['selector identity', '<input id="decision" name="notice_period" />'],
    ['option context', '<label for="decision">Choose one</label><select id="decision"><option>Available from date</option></select>'],
    ['group context', '<fieldset><legend>Preferred start date</legend><label><input id="decision" type="radio" />Immediately</label></fieldset>'],
    ['compensation wording', '<label for="decision">Compensation</label><input id="decision" />'],
    ['pay expectation wording', '<label for="decision">Pay expectation</label><input id="decision" />'],
  ])('refuses compensation and timing decisions found through %s', (_case, html) => {
    at('https://genovice.zohorecruit.com/jobs/Careers/618725000005596009/Role');
    document.body.innerHTML = html;
    for (const id of ['zoho_recruit', 'bullhorn'] as const) {
      const spec = ATS_SPECS.find((candidate) => candidate.id === id)!;
      expect(providerPolicyForbidsControl(spec.genericPolicy, document.querySelector('#decision')!)).toBe(true);
    }
  });

  it.each([
    'When are you available to start?',
    'When can you start?',
    'Earliest possible starting date',
    'Expected pay',
    'Desired pay',
    'How long are you available?',
  ])('uses the shared salary, start-date, and term classifiers to refuse "%s"', (question) => {
    document.body.innerHTML = `<label for="decision">${question}</label><input id="decision" />`;
    for (const id of ['zoho_recruit', 'bullhorn'] as const) {
      const spec = ATS_SPECS.find((candidate) => candidate.id === id)!;
      expect(providerPolicyForbidsControl(spec.genericPolicy, document.querySelector('#decision')!)).toBe(true);
    }
  });
});

describe('Bullhorn OSCP declarative adapter', () => {
  it.each([
    'https://www.serverlogic.com/wp-content/plugins/bullhorn-oscp/#/jobs/5942',
    'https://www.staffingsolutionsenterprises.com/wp-content/plugins/bullhorn-oscp/#/jobs/381/apply',
  ])('recognizes an exact researched tenant route %s', (url) => {
    at(url);
    expect(specForCurrentPage()?.id).toBe('bullhorn');
    expect(isAtsApplicationPage()).toBe(true);
  });

  it('does not claim another site carrying the same self-hosted path', () => {
    at('https://example.com/wp-content/plugins/bullhorn-oscp/#/jobs/5942');
    expect(specForCurrentPage()).toBeNull();
  });

  it('fills stock factual controls but never clicks submit', async () => {
    at('https://www.serverlogic.com/wp-content/plugins/bullhorn-oscp/#/jobs/5942');
    document.body.innerHTML = `<form>
      <input formcontrolname="firstName" />
      <input formcontrolname="lastName" />
      <input formcontrolname="email" />
      <input formcontrolname="phone" />
      <input type="file" formcontrolname="resume" />
      <button type="submit">Apply Now</button>
    </form>`;
    const result = await fillAtsApplication({
      fullName: 'Taylor Example', email: 'apply+frozen@trylitos.com', profile, applicationProfile,
    });
    expect(document.querySelector<HTMLInputElement>('input[formcontrolname="email"]')?.value).toBe('apply+frozen@trylitos.com');
    const button = document.querySelector<HTMLButtonElement>('button')!;
    const click = vi.spyOn(button, 'click');
    expect(clickAtsSubmitIfAllowed(result.ats_name, button)).toBe(false);
    expect(click).not.toHaveBeenCalled();
    const spec = ATS_SPECS.find((candidate) => candidate.id === 'bullhorn')!;
    expect(document.querySelector(spec.resume!)).not.toBeNull();
  });

  it('maps each researched tenant to the employer instead of the www label', () => {
    expect(bullhornEmployerName('www.serverlogic.com')).toBe('ServerLogic');
    expect(bullhornEmployerName('www.staffingsolutionsenterprises.com')).toBe('Staffing Solutions Enterprises');
  });
});

describe('SAP SuccessFactors handoff', () => {
  it.each([
    ['career2.successfactors.eu', 'southafr02'],
    ['career8.successfactors.com', 'MoodysProd'],
  ])('recognizes an exact career route on %s without filling credentials', (host, company) => {
    expect(gatedPortalNotice(host, '/sfcareer/jobreqcareer', `?jobId=123&company=${company}`)).toMatch(/sign in or create.*account/i);
  });

  it('does not treat the SuccessFactors product login as an application tenant', () => {
    expect(gatedPortalNotice('performancemanager.successfactors.eu')).toBeNull();
  });
});

describe('content initialization routing', () => {
  it.each([
    ['https://genovice.zohorecruit.com/jobs/Careers/618725000005596009/Role', 'ats'],
    ['https://www.serverlogic.com/wp-content/plugins/bullhorn-oscp/#/jobs/5942', 'ats'],
    ['https://career2.successfactors.eu/sfcareer/jobreqcareer?jobId=123&company=southafr02', 'gated'],
  ] as const)('routes the proven application URL %s through %s initialization', (raw, route) => {
    expect(contentInitRoute(new URL(raw))).toBe(route);
  });

  it.each([
    'https://genovice.zohorecruit.com/jobs/Careers',
    'https://genovice.zohorecruit.com/login',
    'https://www.serverlogic.com/wp-content/plugins/bullhorn-oscp/#/search',
    'https://performancemanager.successfactors.eu/sf/login',
    'https://career2.successfactors.eu/sfcareer/jobreqcareer?company=southafr02',
    'https://career2.successfactors.eu/admin',
    'https://accounts.zoho.com/signin',
    'https://www.bullhorn.com/login',
  ])('returns before generic initialization on an untrusted product or malformed route %s', (raw) => {
    expect(contentInitRoute(new URL(raw))).toBe('ignore');
  });
});

it('researched tenant allowlists are exact', () => {
  expect(isResearchedBrowserTenant('zoho_recruit', 'genovice.zohorecruit.com')).toBe(true);
  expect(isResearchedBrowserTenant('bullhorn', 'www.serverlogic.com')).toBe(true);
  expect(isResearchedBrowserTenant('sap_successfactors', 'career8.successfactors.com')).toBe(true);
  expect(isResearchedBrowserTenant('bullhorn', 'serverlogic.com')).toBe(false);
});
