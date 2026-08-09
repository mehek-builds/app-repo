// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { skippedReasonsNeedReview } from '../autosubmit-gate';
import { contentInitRoute } from '../content-init-routing';
import type { ApplicationProfile, Profile } from '../types';
import {
  ATS_SPECS,
  atsCanAutoSubmit,
  clickAtsSubmitIfAllowed,
  clickDashboardSubmitIfAllowed,
  fillAtsApplication,
  isAtsApplicationPage,
  specForCurrentPage,
} from './ats-2026-07';

function at(url: string): void {
  const parsed = new URL(url);
  Object.defineProperty(window, 'location', {
    value: {
      hostname: parsed.hostname,
      pathname: parsed.pathname,
      href: parsed.href,
      search: parsed.search,
    },
    writable: true,
    configurable: true,
  });
}

const profile: Profile = {
  full_name: 'Mehek Mandal',
  email: 'mehekman@usc.edu',
  experience: [],
  skills: [],
  school: 'USC',
  grad_year: 2028,
};
const applicationProfile: ApplicationProfile = {
  phone: '+971500000000',
  address_city: 'Dubai',
  linkedin_url: 'https://linkedin.com/in/mehek',
  portfolio_url: 'https://mehek.example',
};
const params = { fullName: profile.full_name!, email: profile.email!, profile, applicationProfile };

describe('live tenant URL contracts', () => {
  it.each([
    ['https://arteus-energy.jobs.personio.de/job/2521967?apply=&language=de', 'personio'],
    ['https://matrix42.jobs.personio.com/job/2663722/apply?language=en', 'personio'],
    ['https://chrono24.jobs.personio.de/job/2661227/apply?language=en', 'personio'],
    ['https://propellerindustries.pinpointhq.com/postings/d29a48ed-c460-4ba9-872a-a3b93d025867/applications/new', 'pinpoint'],
    ['https://discogsinc.pinpointhq.com/en/postings/5bccb603-bbe0-4e1f-8f92-d983f78f77a7/applications/new', 'pinpoint'],
    ['https://www.comeet.co/jobs/A0.002/46.A6A/apply?token=tenant', 'comeet'],
    ['https://www.comeet.co/jobs/59.004/FF.C64/apply?token=tenant', 'comeet'],
  ])('recognizes %s as %s', (url, family) => {
    at(url);
    expect(specForCurrentPage()?.id).toBe(family);
    expect(isAtsApplicationPage()).toBe(true);
    if (family === 'personio') expect(contentInitRoute(new URL(url))).toBe('ats');
  });

  it.each([
    'https://arteus-energy.jobs.personio.de/job/2521967',
    'https://other.jobs.personio.de/job/2521967?apply=&language=de',
    'https://arteus-energy.jobs.personio.de/job/2521968?apply=&language=de',
    'https://arteus-energy.jobs.personio.de/job/2521967?apply=1&language=de',
    'https://arteus-energy.jobs.personio.de/job/2521967?apply=&apply=&language=de',
    'https://arteus-energy.jobs.personio.de/job/2521967?language=de&apply=',
    'https://arteus-energy.jobs.personio.de/job/2521967?apply=&language=en',
    'https://arteus-energy.jobs.personio.de/job/2521967%2Fapply?apply=&language=de',
    'https://arteus-energy.jobs.personio.de/job/2521967/apply?language=de',
    'https://arteus-energy.jobs.personio.de/jobs/2521967?apply=',
    'https://arteus-energy.jobs.personio.de/job/not-a-number?apply=',
    'https://jobs.personio.de/job/2521967?apply=',
    'https://arteus-energy.personio.de/job/2521967?apply=',
  ])('does not claim a Personio posting or lookalike route: %s', (url) => {
    at(url);
    expect(isAtsApplicationPage()).toBe(false);
    if (new URL(url).hostname.endsWith('.jobs.personio.de')) {
      expect(contentInitRoute(new URL(url))).toBe('ignore');
    }
  });

  it.each([
    'https://www.personio.com/login',
    'https://www.pinpointhq.com/pricing',
    'https://www.comeet.com/jobs/gett/A0.002/application-security-lead/46.A6A',
  ])('does not claim a vendor page or tokenless Comeet wrapper: %s', (url) => {
    at(url);
    expect(specForCurrentPage()).toBeNull();
  });

  it('requires a nonempty opaque token on the Comeet application iframe', () => {
    at('https://www.comeet.co/jobs/A0.002/46.A6A/apply');
    expect(isAtsApplicationPage()).toBe(false);
    at('https://www.comeet.co/jobs/A0.002/46.A6A/apply?token=');
    expect(isAtsApplicationPage()).toBe(false);
    at('https://www.comeet.co/jobs/A0.002/46.A6A/apply?source=x&token=%2FAbC%2B_9&lang=en');
    expect(isAtsApplicationPage()).toBe(true);
    expect(window.location.href).toContain('token=%2FAbC%2B_9');
  });
});

describe('captured declarative selectors', () => {
  it('maps only stable platform-owned selectors', () => {
    const personio = ATS_SPECS.find((spec) => spec.id === 'personio')!;
    const pinpoint = ATS_SPECS.find((spec) => spec.id === 'pinpoint')!;
    const comeet = ATS_SPECS.find((spec) => spec.id === 'comeet')!;
    expect(personio.resume).toBe('input[type="file"][name="documents.cv"]');
    expect(pinpoint.resume).toBe('input[type="file"][name="application_form[application][cv]"]');
    expect(comeet.resume).toBe('input[type="file"][name="cv"]');
    expect(JSON.stringify([personio, pinpoint, comeet])).not.toMatch(/custom_attribute_\d+|authenticity_token/);
  });

  it('pins explicit provider exclusions for privacy, human verification, and unreviewed claims', () => {
    const serialized = JSON.stringify(ATS_SPECS.filter((spec) => ['personio', 'pinpoint', 'comeet'].includes(spec.id)));
    expect(serialized).toContain('application[process_information]');
    expect(serialized).toContain('g-recaptcha-response');
    expect(serialized).toContain('salary_expectations');
    expect(serialized).toContain('available_from');
    expect(serialized).toContain('textarea[name=\\"comment\\"]');
  });
});

describe('provider-scoped generic policy', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('fills Personio identity fields but leaves salary and availability untouched', async () => {
    at('https://matrix42.jobs.personio.com/job/2663722/apply?language=en');
    document.body.innerHTML = `
      <form>
        <input name="first_name"><input name="last_name"><input name="email" type="email">
        <input name="phone"><input name="location"><input name="public_profile">
        <input name="salary_expectations"><input name="available_from">
      </form>`;
    const result = await fillAtsApplication(params);
    expect(document.querySelector<HTMLInputElement>('input[name="first_name"]')!.value).toBe('Mehek');
    expect(document.querySelector<HTMLInputElement>('input[name="last_name"]')!.value).toBe('Mandal');
    expect(document.querySelector<HTMLInputElement>('input[name="salary_expectations"]')!.value).toBe('');
    expect(document.querySelector<HTMLInputElement>('input[name="available_from"]')!.value).toBe('');
    expect(result.ats_name).toBe('personio');
    expect(skippedReasonsNeedReview(result.skipped_reasons)).toBe(true);
  });

  it('fills Pinpoint identity fields and never checks privacy-processing consent', async () => {
    at('https://propellerindustries.pinpointhq.com/postings/d29a48ed-c460-4ba9-872a-a3b93d025867/applications/new');
    document.body.innerHTML = `
      <form>
        <input name="application_form[application][first_name]">
        <input name="application_form[application][last_name]">
        <input name="application_form[application][email]" type="email">
        <label><input id="application_process_information" name="application[process_information]" type="checkbox">Allow us to process your personal information.</label>
      </form>`;
    const result = await fillAtsApplication(params);
    expect(document.querySelector<HTMLInputElement>('input[name="application_form[application][email]"]')!.value).toBe(profile.email);
    expect(document.querySelector<HTMLInputElement>('#application_process_information')!.checked).toBe(false);
    expect(result.skipped_reasons.some((reason) => /privacy-processing choice left for you/i.test(reason))).toBe(true);
  });

  it('fills Comeet identity fields and never drafts into its CAPTCHA token or personal note', async () => {
    at('https://www.comeet.co/jobs/A0.002/46.A6A/apply?token=tenant');
    document.body.innerHTML = `
      <form>
        <input name="firstName"><input name="lastName"><input name="email" type="email">
        <input name="phone" type="tel"><input name="websiteUrl" type="url">
        <textarea name="comment"></textarea><textarea name="g-recaptcha-response"></textarea>
      </form>`;
    const draftAnswer = vi.fn(async () => 'drafted');
    const result = await fillAtsApplication({ ...params, draftAnswer });
    expect(document.querySelector<HTMLInputElement>('input[name="firstName"]')!.value).toBe('Mehek');
    expect(document.querySelector<HTMLTextAreaElement>('textarea[name="comment"]')!.value).toBe('');
    expect(document.querySelector<HTMLTextAreaElement>('textarea[name="g-recaptcha-response"]')!.value).toBe('');
    expect(draftAnswer).not.toHaveBeenCalled();
    expect(result.skipped_reasons.some((reason) => /human verification left for you/i.test(reason))).toBe(true);
  });
});

describe('never-auto-submit gate', () => {
  it.each(['personio', 'pinpoint', 'comeet'])('produces zero countdown and post-reservation clicks for %s', (family) => {
    const click = vi.fn();
    expect(atsCanAutoSubmit(family)).toBe(false);
    expect(clickAtsSubmitIfAllowed(family, { click })).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });

  it.each(['personio', 'pinpoint', 'comeet'])('produces zero dashboard clicks for %s', (family) => {
    const click = vi.fn();
    expect(clickDashboardSubmitIfAllowed(family, { click })).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });

  it('is default-deny for unknown provider identities', () => {
    for (const provider of ['greenhouse', 'lever', 'ashby', 'workday', 'linkedin', 'generic', 'recruitee', 'rippling', 'breezy']) {
      expect(atsCanAutoSubmit(provider), provider).toBe(true);
    }
    expect(atsCanAutoSubmit('bamboohr')).toBe(false);
    expect(atsCanAutoSubmit('unknown')).toBe(false);
    const click = vi.fn();
    expect(clickAtsSubmitIfAllowed('unknown', { click })).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });

  it('wires all three providers and the provider gate into the content runtime', () => {
    const content = readFileSync('src/entrypoints/content.ts', 'utf8');
    expect(content).toContain("'https://*.jobs.personio.de/job/*'");
    expect(content).toContain("'https://*.pinpointhq.com/postings/*'");
    expect(content).toContain("'https://www.comeet.co/jobs/*'");
    expect(content).toContain('!atsCanAutoSubmit(fillResult.ats_name)');
    expect(content).toContain('clickDashboardSubmitIfAllowed(fillResult.ats_name, finalSubmitBtn)');
    expect(content).toContain('clickAtsSubmitIfAllowed(');
  });
});
