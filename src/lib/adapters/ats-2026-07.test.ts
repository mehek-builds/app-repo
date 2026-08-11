// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ATS_SPECS, atsCanAutoSubmit, clickAtsSubmitIfAllowed, clickDashboardSubmitIfAllowed, gatedPortalNotice, isAtsApplicationPage, specForCurrentPage, fillAtsApplication } from './ats-2026-07';
import type { ApplicationProfile, Profile } from '../types';
import { contentInitRoute } from '../content-init-routing';

// Selectors and host rules read off live postings on 2026-07-29 (vault:
// litos-ats-dom-capture-2026-07-29.md). These tests exist to pin the captured facts, because the
// 2026-07-28 review found that most captured selectors were unpinned - changing one kept the suite
// green and the regression only showed up on a real employer's form.

function at(url: string): void {
  const u = new URL(url);
  Object.defineProperty(window, 'location', {
    value: { hostname: u.hostname, pathname: u.pathname, href: u.href, search: u.search },
    writable: true,
    configurable: true,
  });
}

describe('host rules reject the login and marketing pages that share these host spaces', () => {
  // Every one of these is the access.paylocity.com hazard in a new coat. app.rippling.com and
  // ultipro.com are CREDENTIAL pages; www.bamboohr.com/careers/application is BambooHR's own
  // careers page, which runs on Greenhouse.
  it.each([
    ['https://app.rippling.com/login', 'rippling HR product'],
    ['https://www.rippling.com/careers', 'rippling marketing'],
    ['https://breezy.hr/pricing', 'breezy marketing'],
    ['https://www.bamboohr.com/careers/application', 'bamboohr own careers, on Greenhouse'],
    ['https://www.bamboohr.com/careers/engineering-it-team', 'bamboohr marketing'],
  ])('does not claim %s (%s)', (url) => {
    at(url);
    // The HOST predicate must reject these outright, not merely fail the path check afterwards.
    // Mutation testing caught this: widening rippling to endsWith('rippling.com') and bamboohr to
    // endsWith('bamboohr.com') both kept an earlier version of this test green, because the path
    // rule happened to save them. It would stop saving them the moment a login page lived at a
    // path that matches - app.rippling.com/{anything}/apply is one URL away.
    expect(specForCurrentPage()).toBeNull();
  });

  it.each([
    ['https://ats.rippling.com/rippling/jobs/875b2547/apply', 'rippling'],
    ['https://zinier.breezy.hr/p/7eefd4d49b75-platform-support-engineer-l1/apply', 'breezy'],
    ['https://recruiting.breezy.hr/p/05c7fcbfad27-welding-engineer/apply', 'breezy'],
    ['https://prentkeromich.bamboohr.com/careers/480', 'bamboohr'],
    ['https://acme-studio.bamboohr.com/careers/7312', 'bamboohr'],
  ])('claims the real application page %s as %s', (url, id) => {
    at(url);
    expect(specForCurrentPage()?.id).toBe(id);
    expect(isAtsApplicationPage()).toBe(true);
  });
});

describe('the captured selectors', () => {
  it('uses data-testid for Rippling, whose name AND id are both randomised per render', () => {
    const rippling = ATS_SPECS.find((s) => s.id === 'rippling')!;
    expect(rippling.fields).toEqual({
      firstName: '[data-testid="input-first_name"]',
      lastName: '[data-testid="input-last_name"]',
      email: '[data-testid="input-email"]',
      phone: '[data-testid="input-phone_number"]',
    });
    expect(rippling.resume).toBe('input[type="file"][data-testid="input-resume"]');
    // Neither a name nor an id selector may appear: on the live form name="Z9gMtYRYFO" and
    // id="field-8", both regenerated every render.
    const serialised = JSON.stringify(rippling.fields);
    expect(serialised).not.toMatch(/\[name=|#field-/);
  });

  it('treats Breezy’s cName as ONE full-name field rather than a first/last pair', () => {
    const breezy = ATS_SPECS.find((s) => s.id === 'breezy')!;
    expect(breezy.fields.fullName).toBe('input[name="cName"]');
    expect(breezy.fields.firstName).toBeUndefined();
    expect(breezy.fields.lastName).toBeUndefined();
  });

  it('finds BambooHR’s resume input by aria-label, the only hook it has', () => {
    const bamboo = ATS_SPECS.find((s) => s.id === 'bamboohr')!;
    // The file input carries no name and no stable id (ids are FabricTextField-<n>, sequential).
    expect(bamboo.resume).toBe('input[type="file"][aria-label="file-input"]');
    expect(bamboo.fields.city).toBe('input[name="city.value"]');
  });

  it('maps nothing Litos must not answer on any of the three', () => {
    // Rippling's pronouns / phone-country / race comboboxes and its sms consent radio; Breezy's two
    // consent checkboxes and its honeypot; BambooHR's honeypot, salary and the address fields the
    // profile cannot know. A selector for any of these appearing here is the bug.
    const serialised = JSON.stringify(ATS_SPECS);
    for (const forbidden of [
      'select-search-input', 'sms_opt_in', 'smsConsent', 'gdprAgreement',
      'hp_', 'nickname_', 'desiredPay', 'streetAddress', 'zip.value', 'cSummary',
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });
});

describe('the platforms with no safe form to fill', () => {
  it.each([
    ['https://jobs.jobvite.com/ness/job/o3mfAfwY/apply', /privacy notice/i],
    ['https://jobs-express.icims.com/jobs/48173/sales-associate/login', /make an account/i],
    ['https://fa-etxx-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/2850', /code/i],
    ['https://recruiting.ultipro.com/WIN1014WINDQ/JobBoard/08eb8299-5b26-4208-adb7-897aa42c6959/OpportunityDetail?opportunityId=f6cd56f9-5b2f-4b53-9e86-2553b54524f9', /account|consent/i],
    ['https://recruiting.ultipro.com/LIT1004LDAC/JobBoard/30702fd2-636e-4886-b1ce-4fc3b07e37ec/OpportunityDetail?opportunityId=4fc30c2a-e2b3-42e0-bcaf-7805f741c04a', /account|consent/i],
    ['https://recruiting.ultipro.com/cov1003covcu/JobBoard/24b0bccd-d0f2-4641-a5f2-6ca809c72521/OpportunityDetail?opportunityId=954bed4e-7b77-4abd-ac78-add89ee3c71e', /account|consent/i],
    ['https://enterpriseplatform.dell.com/hcmUI/CandidateExperience/en/sites/careers/job/295586', /code/i],
    ['https://iawmqy.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/careers/job/295586', /code/i],
    ['https://sandboxxerox.avature.net/en_US/careers/JobDetail/2nd-Line-Technical-Analyst/44460', /login|resume intake/i],
    ['https://maximus.avature.net/careers/Job-Application', /login|resume intake/i],
    ['https://jobs.ea.com/en_US/careers/JobDetail/Software-Engineer-Intern/214956', /login|resume intake/i],
  ])('explains its own gate on %s', (url, expected) => {
    const parsed = new URL(url);
    expect(gatedPortalNotice(parsed.hostname, parsed.pathname, parsed.search)).toMatch(expected);
  });

  it('gives each a DIFFERENT reason rather than one vague sentence', () => {
    const notices = [
      'https://jobs.jobvite.com/ness/job/o3mfAfwY/apply',
      'https://jobs-express.icims.com/jobs/48173/sales-associate/login',
      'https://fa-etxx-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/2850',
      'https://recruiting.ultipro.com/WIN1014WINDQ/JobBoard/08eb8299-5b26-4208-adb7-897aa42c6959/OpportunityDetail?opportunityId=f6cd56f9-5b2f-4b53-9e86-2553b54524f9',
    ].map((raw) => {
      const parsed = new URL(raw);
      return gatedPortalNotice(parsed.hostname, parsed.pathname, parsed.search);
    });
    expect(notices.every(Boolean)).toBe(true);
    expect(new Set(notices).size).toBe(4);
  });

  it('never claims a form was filled, because none was reached', () => {
    for (const raw of [
      'https://jobs.jobvite.com/ness/job/o3mfAfwY/apply',
      'https://jobs-express.icims.com/jobs/48173/sales-associate/login',
      'https://fa-etxx-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/2850',
    ]) {
      const parsed = new URL(raw);
      expect(gatedPortalNotice(parsed.hostname, parsed.pathname)).not.toMatch(/filled/i);
    }
  });

  it('leaves the vendors’ own marketing and docs sites alone', () => {
    for (const host of ['www.icims.com', 'community.icims.com', 'www.jobvite.com', 'ultipro.com', 'www.oracle.com']) {
      expect(gatedPortalNotice(host, '/jobs/123/demo/job')).toBeNull();
    }
  });

  it('keeps an adapter disabled for every family without a measured post-gate form', () => {
    // Jobvite and iCIMS now expose a measured post-gate attended path. The remaining families
    // stay recognition-only until their real form is captured and reviewed.
    const ids = ATS_SPECS.map((s) => s.id);
    for (const gated of ['oraclecloud', 'ultipro', 'avature']) {
      expect(ids).not.toContain(gated);
    }
  });
});

describe('exact Bamboo, UKG, and Oracle route boundaries', () => {
  it.each([
    'https://mpathic2.bamboohr.com/careers/99evil',
    'https://mpathic2.bamboohr.com/careers/99/admin',
    'https://www.bamboohr.com/careers/99',
    'https://app.bamboohr.com/careers/99',
    'https://acme.bamboohr.com/careers/application',
    'https://enterpriseplatform.dell.com/hcmUI/CandidateExperience/en/sites/careers/login',
    'https://enterpriseplatform.dell.com/hcmUI/CandidateExperience/en/sites/careers/job/admin',
    'https://enterpriseplatform.dell.com/hcmUI/CandidateExperience/en/sites/careers/job/295586/payroll',
    'https://enterpriseplatform.dell.com/hcmUI/CandidateExperience/en/sites/careers/job/295587',
    'https://arbitrary.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/2850',
    'https://fa-etxx-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/payroll/2850',
    'https://recruiting.ultipro.com/WIN1014WINDQ/JobBoard/login',
    'https://recruiting.ultipro.com/WIN1014WINDQ/JobBoard/08eb8299-5b26-4208-adb7-897aa42c6959/OpportunityDetail',
    'https://recruiting.ultipro.com/ABC1000/JobBoard/11111111-1111-1111-1111-111111111111/OpportunityDetail?opportunityId=22222222-2222-2222-2222-222222222222',
    'https://recruiting.ultipro.com/cov1003covcu/JobBoard/24b0bccd-d0f2-4641-a5f2-6ca809c72521/OpportunityDetail?opportunityId=f6cd56f9-5b2f-4b53-9e86-2553b54524f9',
    'https://recruiting.ultipro.com/WIN1014WINDQ/JobBoard/24b0bccd-d0f2-4641-a5f2-6ca809c72521/OpportunityDetail?opportunityId=954bed4e-7b77-4abd-ac78-add89ee3c71e',
    'https://recruiting.ultipro.com/cov1003covcu/JobBoard/24b0bccd-d0f2-4641-a5f2-6ca809c72521/OpportunityDetail/extra?opportunityId=954bed4e-7b77-4abd-ac78-add89ee3c71e',
    'https://recruiting.ultipro.com/cov1003covcu/JobBoard/24b0bccd-d0f2-4641-a5f2-6ca809c72521/OpportunityDetail?opportunityId=954bed4e-7b77-4abd-ac78-add89ee3c71e&opportunityId=f6cd56f9-5b2f-4b53-9e86-2553b54524f9',
    'https://recruiting.ultipro.com/cov1003covcu/JobBoard/24b0bccd-d0f2-4641-a5f2-6ca809c72521/OpportunityDetail?opportunityId=f6cd56f9-5b2f-4b53-9e86-2553b54524f9&opportunityId=954bed4e-7b77-4abd-ac78-add89ee3c71e',
    'https://sandboxxerox.avature.net/en_US/careers/JobDetail/Other/44461',
    'https://arbitrary.avature.net/en_US/careers/JobDetail/2nd-Line-Technical-Analyst/44460',
    'https://jobs.ea.com/en_US/careers/JobDetail/Software-Engineer-Intern/214957',
    'https://jobs.ea.com/en_US/careers/JobDetail/Other-Role/214956',
    'https://jobs.ea.com/en_US/careers/JobDetail/Software-Engineer-Intern/214956/extra',
    'https://jobs.ea.com/en_US/careers/JobDetail/Software-Engineer-Intern/214956?jobId=214957',
    'https://jobs.ea.com/en_US/careers/JobDetail/Software-Engineer-Intern/214956?jobId=214956&jobId=214957',
    'https://sandboxxerox.avature.net/en_US/careers/JobDetail/Software-Engineer-Intern/214956',
  ])('ignores unmatched same-host route %s', (raw) => {
    const parsed = new URL(raw);
    expect(contentInitRoute({ hostname: parsed.hostname, pathname: parsed.pathname, search: parsed.search, hash: parsed.hash })).toBe('ignore');
    expect(gatedPortalNotice(parsed.hostname, parsed.pathname, parsed.search)).toBeNull();
  });

  it('does not grant BambooHR capabilities to a suffix-lookalike host', () => {
    const parsed = new URL('https://evilbamboohr.com/careers/99');
    expect(contentInitRoute(parsed)).not.toBe('ats');
    expect(gatedPortalNotice(parsed.hostname, parsed.pathname, parsed.search)).toBeNull();
    expect(ATS_SPECS.find((spec) => spec.id === 'bamboohr')?.host(parsed.hostname)).toBe(false);
  });

  it.each([
    'https://mpathic2.bamboohr.com/careers/99',
    'https://mpathic2.bamboohr.com/careers/99/',
    'https://acme-studio.bamboohr.com/careers/7312',
  ])('accepts exact Bamboo numeric route %s', (raw) => {
    const parsed = new URL(raw);
    expect(contentInitRoute({ hostname: parsed.hostname, pathname: parsed.pathname, search: parsed.search, hash: parsed.hash })).toBe('ats');
  });

  it.each([
    'https://recruiting.ultipro.com/WIN1014WINDQ/JobBoard/08eb8299-5b26-4208-adb7-897aa42c6959/OpportunityDetail?opportunityId=f6cd56f9-5b2f-4b53-9e86-2553b54524f9',
    'https://recruiting.ultipro.com/LIT1004LDAC/JobBoard/30702fd2-636e-4886-b1ce-4fc3b07e37ec/OpportunityDetail?opportunityId=4fc30c2a-e2b3-42e0-bcaf-7805f741c04a',
    'https://recruiting.ultipro.com/cov1003covcu/JobBoard/24b0bccd-d0f2-4641-a5f2-6ca809c72521/OpportunityDetail?opportunityId=954bed4e-7b77-4abd-ac78-add89ee3c71e',
    'https://sandboxxerox.avature.net/en_US/careers/JobDetail/2nd-Line-Technical-Analyst/44460',
    'https://maximus.avature.net/careers/Job-Application',
    'https://jobs.ea.com/en_US/careers/JobDetail/Software-Engineer-Intern/214956',
  ])('keeps exact UKG and Avature identities in attended handoff mode %s', (raw) => {
    const parsed = new URL(raw);
    expect(contentInitRoute(parsed)).toBe('gated');
    expect(gatedPortalNotice(parsed.hostname, parsed.pathname, parsed.search)).toMatch(/account|consent|login|resume intake/i);
  });

  it('matches only the exact EA internship route in the content script manifest', () => {
    const content = readFileSync('src/entrypoints/content.ts', 'utf8');
    expect(content).toContain("'https://jobs.ea.com/en_US/careers/JobDetail/Software-Engineer-Intern/214956'");
    expect(content).not.toContain("'https://jobs.ea.com/*'");
  });
});

describe('Bamboo programmatic submit is denied at every entrance', () => {
  it('denies countdown and post-reservation click helpers', () => {
    const click = vi.fn();
    const afterClick = vi.fn();
    expect(atsCanAutoSubmit('bamboohr')).toBe(false);
    expect(clickAtsSubmitIfAllowed('bamboohr', { click }, afterClick)).toBe(false);
    expect(click).not.toHaveBeenCalled();
    expect(afterClick).not.toHaveBeenCalled();
  });

  it('denies dashboard clicks while preserving the trusted direct-click runtime', () => {
    const click = vi.fn();
    expect(clickDashboardSubmitIfAllowed('bamboohr', { click })).toBe(false);
    expect(click).not.toHaveBeenCalled();
    const content = readFileSync('src/entrypoints/content.ts', 'utf8');
    const manual = content.match(/function armManualSubmissionTracking[\s\S]*?submitButton\.addEventListener\('click', onClick, true\);/)?.[0] ?? '';
    expect(manual).toContain('if (!event.isTrusted) return');
    expect(manual).toContain('submitButton.click()');
    expect(manual).not.toContain('clickAtsSubmitIfAllowed');
  });
});

describe('filling', () => {
  const profile: Profile = { full_name: 'Mehek Mandal', email: 'mehekman@usc.edu', experience: [], skills: [], school: 'USC', grad_year: 2028 };
  const ap: ApplicationProfile = {
    phone: '+971500000000',
    address_city: 'Dubai',
    linkedin_url: 'https://linkedin.com/in/mehek',
    portfolio_url: 'https://mehek-site.vercel.app',
  };
  const params = { fullName: 'Mehek Mandal', email: 'mehekman@usc.edu', profile, applicationProfile: ap };

  beforeEach(() => { document.body.innerHTML = ''; });

  it('fills Breezy’s single name field with the WHOLE name, not a first name', () => {
    at('https://zinier.breezy.hr/p/abc-role/apply');
    document.body.innerHTML = `
      <form>
        <label>Full Name<input name="cName" /></label>
        <label>Email<input name="cEmail" /></label>
        <label>Phone<input name="cPhoneNumber" /></label>
      </form>`;
    return fillAtsApplication(params).then(() => {
      expect(document.querySelector<HTMLInputElement>('input[name="cName"]')!.value).toBe('Mehek Mandal');
      expect(document.querySelector<HTMLInputElement>('input[name="cEmail"]')!.value).toBe('mehekman@usc.edu');
    });
  });

  it('splits the name for Rippling, which has separate fields, and finds them by data-testid', async () => {
    at('https://ats.rippling.com/acme/jobs/1/apply');
    // Names and ids are junk, exactly as the live form renders them.
    document.body.innerHTML = `
      <form>
        <input data-testid="input-first_name" name="Z9gMtYRYFO" id="field-8" />
        <input data-testid="input-last_name" name="wVZe2TgVzHs" id="field-12" />
        <input data-testid="input-email" name="aEdIYwwX14e" id="field-16" />
      </form>`;
    await fillAtsApplication(params);
    expect(document.querySelector<HTMLInputElement>('[data-testid="input-first_name"]')!.value).toBe('Mehek');
    expect(document.querySelector<HTMLInputElement>('[data-testid="input-last_name"]')!.value).toBe('Mandal');
  });

  it('never overwrites a value the student or the platform already put there', async () => {
    at('https://zinier.breezy.hr/p/abc-role/apply');
    document.body.innerHTML = `<form><label>Email<input name="cEmail" value="my.other@address.com" /></label></form>`;
    await fillAtsApplication(params);
    expect(document.querySelector<HTMLInputElement>('input[name="cEmail"]')!.value).toBe('my.other@address.com');
  });

  it('presses BambooHR’s reveal button, because the fields do not exist until it is clicked', async () => {
    at('https://prentkeromich.bamboohr.com/careers/480');
    const button = document.createElement('button');
    button.textContent = 'Apply for This Job';
    button.onclick = () => {
      // What the live page does: mount the form on click.
      const form = document.createElement('form');
      form.innerHTML = `<label>First Name<input name="firstName" /></label><label>Email<input name="email" /></label>`;
      document.body.appendChild(form);
    };
    document.body.appendChild(button);
    await fillAtsApplication(params);
    expect(document.querySelector<HTMLInputElement>('input[name="firstName"]')?.value).toBe('Mehek');
  });

  it('tells the student why BambooHR stops short, rather than reporting a silent partial fill', async () => {
    at('https://prentkeromich.bamboohr.com/careers/480');
    document.body.innerHTML = `<form><label>First Name<input name="firstName" /></label></form>`;
    const result = await fillAtsApplication(params);
    expect(result.ats_name).toBe('bamboohr');
    expect(result.skipped_reasons.some((r) => /prove you are human/i.test(r))).toBe(true);
  });

  it('keeps every non-captured BambooHR control untouched', async () => {
    at('https://mpathic2.bamboohr.com/careers/99');
    document.body.innerHTML = `<form>
      <input name="firstName" />
      <input name="nickname_hpcsaf" value="" />
      <input id="adversarial-text" type="text" /><input id="adversarial-email" type="email" />
      <input id="adversarial-tel" type="tel" /><input id="adversarial-file" type="file" />
      <select id="adversarial-select"><option value=""><\/option><option value="yes">Yes<\/option><\/select>
      <input id="adversarial-radio" type="radio" /><input id="adversarial-checkbox" type="checkbox" />
    </form>`;
    await fillAtsApplication(params);
    expect(document.querySelector<HTMLInputElement>('input[name="firstName"]')!.value).toBe('Mehek');
    for (const id of ['adversarial-text', 'adversarial-email', 'adversarial-tel']) {
      expect(document.querySelector<HTMLInputElement>(`#${id}`)!.value).toBe('');
    }
    expect(document.querySelector<HTMLSelectElement>('#adversarial-select')!.value).toBe('');
    expect(document.querySelector<HTMLInputElement>('#adversarial-radio')!.checked).toBe(false);
    expect(document.querySelector<HTMLInputElement>('#adversarial-checkbox')!.checked).toBe(false);
    expect(document.querySelector<HTMLInputElement>('#adversarial-file')!.files?.length ?? 0).toBe(0);
  });

  it('reports the platform that actually ran, not the generic engine it delegates to', async () => {
    at('https://zinier.breezy.hr/p/abc-role/apply');
    document.body.innerHTML = `<form><label>Full Name<input name="cName" /></label></form>`;
    expect((await fillAtsApplication(params)).ats_name).toBe('breezy');
  });
});

describe('the captured resume selector is actually used, not decorative', () => {
  // Caught in review. spec.resume was declared with carefully captured selectors and then never
  // read, so the resume attached through generic.ts's scoring heuristic instead.
  //
  // On Rippling that heuristic cannot work: BOTH file inputs have no name, no id, no aria-label and
  // no placeholder, and both sit beside the same "Drop or select (.doc / .docx / .pdf)" text. So
  // controlIdentity() is empty for both, both score 0, and the winner is whichever is FIRST IN THE
  // DOM. Correct today only because resume happens to come first.
  const profile: Profile = { full_name: 'Mehek Mandal', email: 'm@usc.edu', experience: [], skills: [], school: 'USC', grad_year: 2028 };
  const params = {
    fullName: 'Mehek Mandal',
    email: 'm@usc.edu',
    profile,
    applicationProfile: {} as ApplicationProfile,
    resumeBlob: new Blob(['pdf'], { type: 'application/pdf' }),
    resumeFileName: 'resume.pdf',
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    // jsdom implements neither DataTransfer nor a writable input.files, so both are stubbed. The
    // stub records WHICH input received the file, which is the entire thing under test here.
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

  it('attaches to the resume input even when the cover-letter input comes FIRST', async () => {
    at('https://ats.rippling.com/acme/jobs/1/apply');
    // Deliberately reversed from the live DOM order. This is the exact scenario the heuristic gets
    // wrong and the captured selector gets right.
    document.body.innerHTML = `
      <form>
        <label>Drop or select (.doc / .docx / .pdf)<input type="file" data-testid="input-cover_letter" /></label>
        <label>Drop or select (.doc / .docx / .pdf)<input type="file" data-testid="input-resume" /></label>
      </form>`;
    await fillAtsApplication(params);
    const resume = document.querySelector<HTMLInputElement>('[data-testid="input-resume"]')!;
    const cover = document.querySelector<HTMLInputElement>('[data-testid="input-cover_letter"]')!;
    expect(resume.files?.length).toBe(1);
    expect(cover.files?.length ?? 0).toBe(0);
  });

  it('skips hidden and collapsed duplicate Bamboo resume controls and attaches only to the visible exact input', async () => {
    at('https://prentkeromich.bamboohr.com/careers/480');
    document.body.innerHTML = `<form>
      <input id="hidden-resume" type="file" aria-label="file-input" style="display:none" />
      <div aria-hidden="true"><input id="honeypot-resume" type="file" aria-label="file-input" /></div>
      <input id="visible-resume" type="file" aria-label="file-input" />
    </form>`;
    Object.defineProperty(document.querySelector('#visible-resume'), 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ width: 120, height: 24 }),
    });
    await fillAtsApplication(params);
    expect(document.querySelector<HTMLInputElement>('#hidden-resume')!.files?.length ?? 0).toBe(0);
    expect(document.querySelector<HTMLInputElement>('#honeypot-resume')!.files?.length ?? 0).toBe(0);
    expect(document.querySelector<HTMLInputElement>('#visible-resume')!.files?.length).toBe(1);
  });
});
