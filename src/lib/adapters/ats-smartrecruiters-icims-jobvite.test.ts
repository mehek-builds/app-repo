// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { ApplicationProfile, Profile } from '../types';
import {
  atsCanAutoSubmit,
  clickAtsSubmitIfAllowed,
  clickDashboardSubmitIfAllowed,
  fillAtsApplication,
  gatedPortalNotice,
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

describe('exact route detection', () => {
  it.each([
    'https://jobs.smartrecruiters.com/oneclick-ui/company/Lumina1/publication/f137edd9-1f3b-448a-9a5f-2c2ca63fddeb?dcr_ci=Lumina1',
    'https://jobs.smartrecruiters.com/oneclick-ui/company/BoschGroup/publication/8561d9da-6140-40b8-9afc-523214b5965a?dcr_ci=BoschGroup',
  ])('recognizes a live SmartRecruiters one-click form: %s', (url) => {
    at(url);
    expect(specForCurrentPage()?.id).toBe('smartrecruiters');
    expect(isAtsApplicationPage()).toBe(true);
  });

  it.each([
    'https://jobs.smartrecruiters.com/Lumina1/744000001027275-software-engineer',
    'https://jobs.smartrecruiters.com/company/Lumina1',
    'https://jobs.smartrecruiters.com/oneclick-ui/company/Lumina1/publication/not-a-uuid',
  ])('does not call a SmartRecruiters listing or malformed route an application form: %s', (url) => {
    at(url);
    expect(isAtsApplicationPage()).toBe(false);
  });

  it.each([
    ['https://externalhourly-omnihotels.icims.com/jobs/133505/commis/login', /account/i],
    ['https://jobs-express.icims.com/jobs/48173/sales-associate/job', /human/i],
    ['https://jobs.jobvite.com/worldfirst/job/oknrAfws/apply', /privacy/i],
    ['https://jobs.jobvite.com/genpactexperience/job/oZCwAfwr', /privacy/i],
  ])('recognizes only the measured gated route: %s', (url, expected) => {
    const parsed = new URL(url);
    expect(gatedPortalNotice(parsed.hostname, parsed.pathname)).toMatch(expected);
  });

  it.each([
    'https://externalhourly-omnihotels.icims.com/jobs/search',
    'https://externalhourly-omnihotels.icims.com/jobs/intro',
    'https://community.icims.com/jobs/123/demo/job',
    'https://jobs.jobvite.com/worldfirst/jobs',
    'https://jobs.jobvite.com/careers/worldfirst/jobs',
  ])('does not show an application-gate notice on listing, docs, or malformed routes: %s', (url) => {
    const parsed = new URL(url);
    expect(gatedPortalNotice(parsed.hostname, parsed.pathname)).toBeNull();
  });
});

describe('SmartRecruiters open-shadow first-page fill', () => {
  const profile: Profile = {
    full_name: 'Mehek Mandal',
    email: 'mehek@example.com',
    experience: [],
    skills: [],
    school: 'USC',
    grad_year: 2028,
  };
  const applicationProfile: ApplicationProfile = {
    phone: '+971500000000',
    linkedin_url: 'https://linkedin.com/in/mehek',
    portfolio_url: 'https://mehek.example',
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    at('https://jobs.smartrecruiters.com/oneclick-ui/company/Lumina1/publication/f137edd9-1f3b-448a-9a5f-2c2ca63fddeb?dcr_ci=Lumina1');
    class FakeDataTransfer {
      files: File[] = [];
      items = { add: (file: File) => { this.files.push(file); } };
    }
    (globalThis as unknown as Record<string, unknown>).DataTransfer = FakeDataTransfer;
    Object.defineProperty(HTMLInputElement.prototype, 'files', {
      configurable: true,
      get(this: HTMLInputElement) { return (this as unknown as Record<string, unknown>).__files ?? null; },
      set(this: HTMLInputElement, value: unknown) { (this as unknown as Record<string, unknown>).__files = value; },
    });
  });

  function shadowInput(hostTag: string, id?: string, inputAttrs: Record<string, string> = {}): HTMLInputElement {
    const host = document.createElement(hostTag);
    if (id) host.id = id;
    const root = host.attachShadow({ mode: 'open' });
    const input = document.createElement('input');
    for (const [key, value] of Object.entries(inputAttrs)) input.setAttribute(key, value);
    root.appendChild(input);
    document.body.appendChild(host);
    return input;
  }

  function visible<T extends HTMLElement>(el: T): T {
    el.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 24, width: 200, height: 24,
      toJSON: () => ({}),
    });
    document.body.appendChild(el);
    return el;
  }

  it('fills only stable factual controls, attaches the resume, and stops before later steps', async () => {
    const first = shadowInput('spl-input', 'first-name-input');
    const last = shadowInput('spl-input', 'last-name-input');
    const email = shadowInput('spl-input', 'email-input');
    const confirmEmail = shadowInput('spl-input', 'confirm-email-input');
    const phone = shadowInput('spl-phone-field', undefined, { 'aria-label': 'Phone number' });
    const linkedIn = shadowInput('spl-input', 'linkedin-input');
    const website = shadowInput('spl-input', 'website-input', { name: 'hp_field' });
    const sensitive = shadowInput('spl-input', 'social-security-input');
    const captcha = shadowInput('spl-input', 'h-captcha-response');
    const legal = shadowInput('spl-input', 'privacy-consent-input', { type: 'checkbox' });
    const lightEmail = visible(document.createElement('input'));
    lightEmail.type = 'email';
    lightEmail.name = 'email';
    const lightPhone = visible(document.createElement('input'));
    lightPhone.type = 'tel';
    lightPhone.name = 'phone';
    const lightText = visible(document.createElement('input'));
    lightText.type = 'text';
    lightText.name = 'full_name';
    const lightSelect = visible(document.createElement('select'));
    lightSelect.name = 'country';
    lightSelect.append(new Option('Choose', ''), new Option('United Arab Emirates', 'AE'));
    const lightRadio = visible(document.createElement('input'));
    lightRadio.type = 'radio';
    lightRadio.name = 'work_authorization';
    lightRadio.value = 'Yes';
    const lightCheckbox = visible(document.createElement('input'));
    lightCheckbox.type = 'checkbox';
    lightCheckbox.name = 'privacy_consent';
    const lightFile = visible(document.createElement('input'));
    lightFile.type = 'file';
    lightFile.name = 'resume';
    const lightEssay = visible(document.createElement('textarea'));
    lightEssay.name = 'why_this_role';
    const resumeHost = document.createElement('spl-dropzone');
    resumeHost.setAttribute('data-test', 'resume-upload');
    const resumeRoot = resumeHost.attachShadow({ mode: 'open' });
    const resume = document.createElement('input');
    resume.type = 'file';
    resumeRoot.appendChild(resume);
    document.body.appendChild(resumeHost);

    let draftCalls = 0;
    const result = await fillAtsApplication({
      fullName: 'Mehek Mandal',
      email: 'mehek@example.com',
      profile,
      applicationProfile,
      resumeBlob: new Blob(['pdf'], { type: 'application/pdf' }),
      resumeFileName: 'resume.pdf',
      draftAnswer: async () => {
        draftCalls += 1;
        return 'This must not be written';
      },
    });

    expect(first.value).toBe('Mehek');
    expect(last.value).toBe('Mandal');
    expect(email.value).toBe('mehek@example.com');
    expect(confirmEmail.value).toBe('mehek@example.com');
    expect(phone.value).toBe('+971500000000');
    expect(linkedIn.value).toBe(applicationProfile.linkedin_url);
    expect(website.value).toBe('');
    expect(sensitive.value).toBe('');
    expect(captcha.value).toBe('');
    expect(legal.checked).toBe(false);
    expect(lightEmail.value).toBe('');
    expect(lightPhone.value).toBe('');
    expect(lightText.value).toBe('');
    expect(lightSelect.value).toBe('');
    expect(lightRadio.checked).toBe(false);
    expect(lightCheckbox.checked).toBe(false);
    expect(lightFile.files?.length ?? 0).toBe(0);
    expect(lightEssay.value).toBe('');
    expect(draftCalls).toBe(0);
    expect(resume.files?.length).toBe(1);
    expect(result.ats_name).toBe('smartrecruiters');
    expect(result.skipped_reasons).toContainEqual(expect.stringMatching(/multi-step/i));
    expect(result.skipped_reasons).not.toContain('resume: no generated resume file available');
    expect(result.fields_skipped).toBe(0);
  });
});

describe('programmatic submit is denied at every exported entrance', () => {
  it.each(['smartrecruiters', 'icims', 'jobvite'])('denies %s', (family) => {
    let clicks = 0;
    const control = { click: () => { clicks += 1; } };
    expect(atsCanAutoSubmit(family)).toBe(false);
    expect(clickAtsSubmitIfAllowed(family, control)).toBe(false);
    expect(clickDashboardSubmitIfAllowed(family, control)).toBe(false);
    expect(clicks).toBe(0);
  });
});

describe('Jobvite and iCIMS live resume targeting', () => {
  const profile: Profile = {
    full_name: 'Mehek Mandal',
    email: 'applicant@litos.email',
    experience: [],
    skills: [],
    school: 'USC',
    grad_year: 2028,
  };
  const applicationProfile: ApplicationProfile = {};

  beforeEach(() => {
    document.body.innerHTML = '';
    at('https://jobs.jobvite.com/worldfirst/job/oknrAfws/apply');
    (globalThis as unknown as { CSS: { escape: (value: string) => string } }).CSS = { escape: (value) => value };
    class FakeDataTransfer {
      files: File[] = [];
      items = { add: (file: File) => { this.files.push(file); } };
    }
    (globalThis as unknown as Record<string, unknown>).DataTransfer = FakeDataTransfer;
    Object.defineProperty(HTMLInputElement.prototype, 'files', {
      configurable: true,
      get(this: HTMLInputElement) { return (this as unknown as Record<string, unknown>).__files ?? null; },
      set(this: HTMLInputElement, value: unknown) { (this as unknown as Record<string, unknown>).__files = value; },
    });
  });

  function makeVisible(input: HTMLInputElement): void {
    input.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, right: 200, bottom: 24, width: 200, height: 24,
      toJSON: () => ({}),
    });
  }

  it('attaches only to one visible semantic resume input, never a hidden stale input', async () => {
    document.body.innerHTML = `
      <div hidden><label>Resume<input id="stale" type="file"></label></div>
      <label>Resume<input id="live" type="file"></label>
      <label>Email<input id="email" type="email"></label>`;
    const live = document.querySelector<HTMLInputElement>('#live')!;
    const email = document.querySelector<HTMLInputElement>('#email')!;
    makeVisible(live);
    makeVisible(email);
    const result = await fillAtsApplication({
      fullName: 'Mehek Mandal',
      email: 'applicant@litos.email',
      profile,
      applicationProfile,
      resumeBlob: new Blob(['exact'], { type: 'application/pdf' }),
      resumeFileName: 'resume.pdf',
    });
    expect(document.querySelector<HTMLInputElement>('#stale')?.files?.length ?? 0).toBe(0);
    expect(live.files?.length).toBe(1);
    expect(result.skipped_reasons).not.toContain('resume: no file input found on this form');
  });

  it('refuses a cover-letter-only upload control', async () => {
    document.body.innerHTML = `
      <label>Cover letter<input id="cover" type="file"></label>
      <label>Email<input id="email" type="email"></label>`;
    makeVisible(document.querySelector<HTMLInputElement>('#cover')!);
    makeVisible(document.querySelector<HTMLInputElement>('#email')!);
    const result = await fillAtsApplication({
      fullName: 'Mehek Mandal',
      email: 'applicant@litos.email',
      profile,
      applicationProfile,
      resumeBlob: new Blob(['exact'], { type: 'application/pdf' }),
      resumeFileName: 'resume.pdf',
    });
    expect(document.querySelector<HTMLInputElement>('#cover')?.files?.length ?? 0).toBe(0);
    expect(result.skipped_reasons).toContain('resume: no file input found on this form');
  });
});
