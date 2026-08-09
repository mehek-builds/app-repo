// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplicationProfile, Profile } from '../types';
import {
  atsCanAutoSubmit,
  clickAtsSubmitIfAllowed,
  fillAtsApplication,
  gatedPortalNotice,
  isAtsApplicationPage,
  specForCurrentPage,
} from './ats-2026-07';
import { browserApplicationCapability } from './browser-application-capabilities';
import { contentInitRoute } from '../content-init-routing';

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
const applicationProfile = { phone: '+971500000000', city: 'Dubai' } as ApplicationProfile;

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
  class FakeDataTransfer {
    files: File[] = [];
    items = { add: (file: File) => { this.files.push(file); } };
  }
  (globalThis as unknown as Record<string, unknown>).DataTransfer = FakeDataTransfer;
  Object.defineProperty(HTMLInputElement.prototype, 'files', {
    configurable: true,
    get(this: HTMLInputElement) { return (this as unknown as Record<string, unknown>).__files ?? []; },
    set(this: HTMLInputElement, value: unknown) { (this as unknown as Record<string, unknown>).__files = value; },
  });
});

describe('Taleo and ADP zero-action gates', () => {
  it.each([
    ['fa007.taleo.net', '/careersection/ex/jobdetail.ftl', '?job=25000743'],
    ['aa270.taleo.net', '/careersection/ex/jobdetail.ftl', '?job=827258'],
  ])('recognizes an exact Taleo job route on %s', (host, path, search) => {
    expect(gatedPortalNotice(host, path, search)).toMatch(/legal notice/i);
    expect(contentInitRoute(new URL(`https://${host}${path}${search}`))).toBe('gated');
  });

  it.each([
    '/guitarcenterexternal/cx/job-details?reqId=5001217533500',
    '/kaisercareers/cx/job-details?reqId=5001215578500',
  ])('recognizes an exact ADP tenant route %s', (route) => {
    const url = new URL(`https://myjobs.adp.com${route}`);
    expect(gatedPortalNotice(url.hostname, url.pathname, url.search)).toMatch(/requires an account/i);
    expect(contentInitRoute(url)).toBe('gated');
  });

  it.each([
    'https://aa270.taleo.net/careersection/ex/jobsearch.ftl?lang=en',
    'https://aa270.taleo.net/careersection/ex/jobdetail.ftl?job=bad',
    'https://aa270.taleo.net/careersection/admin/jobdetail.ftl?job=827258',
    'https://aa270.taleo.net/other/ex/jobdetail.ftl?job=827258',
    'https://aa270.taleo.net/careersection/ex/application.ftl?job=827258',
    'https://myjobs.adp.com/guitarcenterexternal/auth',
    'https://myjobs.adp.com/unresearched/cx/job-details?reqId=5001217533500',
  ])('returns before generic initialization on malformed or non-application route %s', (raw) => {
    expect(contentInitRoute(new URL(raw))).toBe('ignore');
  });
});

describe('JazzHR fixed factual adapter', () => {
  it.each([
    'https://utilidata.applytojob.com/apply/jobs/details/VSeisrJblO',
    'https://foundationai.applytojob.com/apply/jobs/details/ZBfHaf2Nv9',
  ])('recognizes an exact active application route %s', (raw) => {
    at(raw);
    expect(specForCurrentPage()?.id).toBe('jazzhr');
    expect(isAtsApplicationPage()).toBe(true);
    expect(contentInitRoute(new URL(raw))).toBe('ats');
  });

  it.each([
    'https://evil.applytojob.com/apply/jobs/details/VSeisrJblO',
    'https://utilidata.applytojob.com/apply/VSeisrJblO/engineer',
    'https://utilidata.applytojob.com/apply/jobs/details/VSeisrJblO/engineer',
  ])('rejects an unresearched JazzHR host or legacy route %s', (raw) => {
    at(raw);
    if (new URL(raw).hostname === 'evil.applytojob.com') {
      expect(specForCurrentPage()).toBeNull();
      expect(contentInitRoute(new URL(raw))).toBe('generic');
    } else {
      expect(specForCurrentPage()?.id).toBe('jazzhr');
      expect(isAtsApplicationPage()).toBe(false);
      expect(contentInitRoute(new URL(raw))).toBe('ignore');
    }
  });

  it('fills exact platform controls and leaves benign, legal, EEO and human-decision adversaries untouched', async () => {
    at('https://utilidata.applytojob.com/apply/jobs/details/VSeisrJblO');
    document.body.innerHTML = `<form>
      <input name="resumator-firstname-value" style="display:none" />
      <input name="resumator-firstname-value" />
      <input name="resumator-lastname-value" />
      <input name="resumator-email-value" />
      <input name="resumator-phone-value" />
      <input name="resumator-city-value" />
      <input type="file" name="reference-upload" />
      <input type="file" name="resumator-resume-value" />
      <input type="file" name="cover-letter-upload" />
      <textarea name="bio"></textarea>
      <select name="color"><option>Blue</option></select>
      <label><input type="radio" name="travel" value="yes" />Can travel</label>
      <input name="resumator-salary-value" />
      <input name="resumator-start-value" />
      <select name="resumator-eeo_gender-value"><option value="0">Decline to answer</option></select>
      <textarea name="g-recaptcha-response"></textarea>
      <label><input type="checkbox" name="resumator-sms-consent" />SMS consent</label>
      <button type="submit">Submit Application</button>
    </form>`;
    const result = await fillAtsApplication({
      fullName: 'Taylor Example',
      email: 'apply+frozen@trylitos.com',
      profile,
      applicationProfile,
      resumeBlob: new Blob(['exact resume bytes'], { type: 'application/pdf' }),
      resumeFileName: 'Taylor_Exact_Resume.pdf',
    });
    const firstNames = document.querySelectorAll<HTMLInputElement>('input[name="resumator-firstname-value"]');
    expect(firstNames[0]?.value).toBe('');
    expect(firstNames[1]?.value).toBe('Taylor');
    expect(document.querySelector<HTMLInputElement>('input[name="resumator-email-value"]')?.value).toBe('apply+frozen@trylitos.com');
    const resumeInput = document.querySelector<HTMLInputElement>('input[name="resumator-resume-value"]')!;
    expect(resumeInput.files).toHaveLength(1);
    expect(resumeInput.files?.[0]?.name).toBe('Taylor_Exact_Resume.pdf');
    expect(resumeInput.files?.[0]?.type).toBe('application/pdf');
    expect(resumeInput.files?.[0]?.size).toBe(new Blob(['exact resume bytes']).size);
    expect(document.querySelector<HTMLInputElement>('input[name="reference-upload"]')?.files).toHaveLength(0);
    expect(document.querySelector<HTMLInputElement>('input[name="cover-letter-upload"]')?.files).toHaveLength(0);
    for (const selector of ['textarea[name="bio"]', 'select[name="color"]', 'input[name="travel"]', 'input[name="resumator-salary-value"]', 'input[name="resumator-start-value"]']) {
      const control = document.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(selector)!;
      expect(control.value).toBe(selector.includes('color') ? 'Blue' : selector.includes('travel') ? 'yes' : '');
    }
    expect(document.querySelector<HTMLInputElement>('input[name="resumator-sms-consent"]')?.checked).toBe(false);
    expect(result.skipped_reasons.join(' ')).toMatch(/Human Check.*tenant-specific/i);
    const button = document.querySelector<HTMLButtonElement>('button')!;
    const click = vi.spyOn(button, 'click');
    expect(clickAtsSubmitIfAllowed(result.ats_name, button)).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });
});

it.each(['oracle_taleo', 'adp_recruiting', 'jazzhr'] as const)('%s remains default deny', (family) => {
  const capability = browserApplicationCapability(family)!;
  expect(capability.programmaticSubmit).toBe(false);
  expect(capability.createAccount).toBe(false);
  expect(capability.pollPublicListings).toBe(false);
  expect(capability.trustedDirectClick).toBe(true);
  expect(atsCanAutoSubmit(family)).toBe(false);
});
