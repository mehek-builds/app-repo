// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { ATS_SPECS, gatedPortalNotice, isAtsApplicationPage, specForCurrentPage, fillAtsApplication } from './ats-2026-07';
import type { ApplicationProfile, Profile } from '../types';

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

describe('the four platforms with no form to fill', () => {
  it.each([
    ['https://jobs.jobvite.com/ness/job/o3mfAfwY/apply', /privacy notice/i],
    ['https://jobs-express.icims.com/jobs/48173/sales-associate/login', /make an account/i],
    ['https://eeho.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/jobsearch/job/1', /code/i],
    ['https://recruiting.ultipro.com/she1011sphs/JobBoard/62d52737', /cannot read/i],
  ])('explains its own gate on %s', (url, expected) => {
    expect(gatedPortalNotice(new URL(url).hostname)).toMatch(expected);
  });

  it('gives each a DIFFERENT reason rather than one vague sentence', () => {
    const notices = [
      'jobs.jobvite.com', 'jobs-express.icims.com', 'eeho.fa.us2.oraclecloud.com', 'recruiting.ultipro.com',
    ].map((h) => gatedPortalNotice(h));
    expect(notices.every(Boolean)).toBe(true);
    expect(new Set(notices).size).toBe(4);
  });

  it('never claims a form was filled, because none was reached', () => {
    for (const host of ['jobs.jobvite.com', 'jobs-express.icims.com', 'eeho.fa.us2.oraclecloud.com']) {
      expect(gatedPortalNotice(host)).not.toMatch(/filled/i);
    }
  });

  it('leaves the vendors’ own marketing and docs sites alone', () => {
    for (const host of ['www.icims.com', 'community.icims.com', 'www.jobvite.com', 'ultipro.com', 'www.oracle.com']) {
      expect(gatedPortalNotice(host)).toBeNull();
    }
  });

  it('has no adapter at all for any of them', () => {
    // The point of the tier: recognise and explain, never a fill that silently does nothing.
    const ids = ATS_SPECS.map((s) => s.id);
    for (const gated of ['jobvite', 'icims', 'oraclecloud', 'ultipro']) {
      expect(ids).not.toContain(gated);
    }
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
    at('https://acme.bamboohr.com/careers/480');
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
    at('https://acme.bamboohr.com/careers/480');
    document.body.innerHTML = `<form><label>First Name<input name="firstName" /></label></form>`;
    const result = await fillAtsApplication(params);
    expect(result.ats_name).toBe('bamboohr');
    expect(result.skipped_reasons.some((r) => /prove you are human/i.test(r))).toBe(true);
  });

  it('reports the platform that actually ran, not the generic engine it delegates to', async () => {
    at('https://zinier.breezy.hr/p/abc-role/apply');
    document.body.innerHTML = `<form><label>Full Name<input name="cName" /></label></form>`;
    expect((await fillAtsApplication(params)).ats_name).toBe('breezy');
  });
});
