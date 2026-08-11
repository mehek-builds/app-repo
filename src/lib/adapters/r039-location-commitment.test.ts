// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  fillGenericApplication,
  locationQuestion,
  drainR030CandidateLabels,
  noteR039Candidate,
} from './generic';
import type { ApplicationProfile, Profile } from '../types';

// R-039 through the REAL fill paths. The pure veto is pinned in classify.test.ts; what these
// cases prove is the two halves that actually run on a form: the generic identity chain's city
// leg (the register's original R-039 site) and locationQuestion (the site the two live labels
// took - Greenhouse routes its custom questions through it). Both live labels are asserted in
// their observed direction (no city lands) AND the R-002 direction is re-pinned (real residence
// asks keep filling), because every location guard in this repo that skipped one direction
// shipped the opposite bug. The telemetry contract is pinned too: a veto is recorded on the
// r030 channel with the r039-veto: tag, third-party hits with r039-third-party:, and recording
// NEVER changes what fills.

const GEMINI_RAW =
  "This role is required to be based near our New York City, NY office. Are you open to relocating if you're not currently near NYC?";
const FAIRE_RAW =
  'This role will be in-office on a hybrid schedule, can you commit to being in-office three days per week at the SF office?';

const profile = {} as Profile;
const ap: ApplicationProfile = {
  phone: '+971500000000',
  address_city: 'Dubai',
  address_state: 'Dubai',
  address_zip: '00000',
  address_country: 'United Arab Emirates',
  linkedin_url: 'https://linkedin.com/in/mehek',
  github_url: 'https://github.com/mehek',
  portfolio_url: 'https://mehek.example',
} as ApplicationProfile;

// The generic adapter's candidateInputs() gates on isVisible(), which reads a layout box jsdom
// never computes, so each control gets a stubbed rect (same harness as salary-fill.test.ts).
const RECT = {
  width: 200, height: 24, top: 0, left: 0, right: 200, bottom: 24, x: 0, y: 0,
  toJSON: () => ({}),
} as DOMRect;

let seq = 0;
function genericField(labelText: string, type = 'text'): HTMLInputElement {
  const id = `field-${++seq}`;
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = labelText;
  const el = document.createElement('input');
  el.type = type;
  el.id = id;
  el.getBoundingClientRect = () => RECT;
  document.body.append(label, el);
  return el;
}

function runGeneric(applicationProfile: ApplicationProfile) {
  return fillGenericApplication({
    fullName: 'Mehek Mandal',
    email: 'mehekman@usc.edu',
    profile,
    applicationProfile,
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
  seq = 0;
  drainR030CandidateLabels(); // isolate: no labels leak between tests
});

describe('R-039 veto through the generic identity chain', () => {
  it('the Gemini live label gets NO city, and the veto is recorded', async () => {
    const el = genericField(GEMINI_RAW);
    await runGeneric(ap);
    expect(el.value).toBe(''); // never "Dubai"
    const labels = drainR030CandidateLabels();
    expect(labels.some((l) => l.startsWith('r039-veto:') && /relocating/.test(l))).toBe(true);
  });

  it('a real residence ask still fills, with nothing recorded (R-002 direction)', async () => {
    const el = genericField('Location (City)');
    await runGeneric(ap);
    expect(el.value).toBe('Dubai');
    expect(drainR030CandidateLabels().filter((l) => l.startsWith('r039-'))).toEqual([]);
  });

  it("leaves a third-party email untouched and records the refusal", async () => {
    const el = genericField("Manager's email");
    await runGeneric(ap);
    expect(el.value).toBe('');
    const labels = drainR030CandidateLabels();
    expect(labels.some((l) => l.startsWith('r039-third-party:') && /manager/.test(l))).toBe(true);
  });

  it.each([
    ["Reference name", 'text'],
    ["Reference email", 'email'],
    ["Manager phone", 'tel'],
    ["Emergency contact city", 'text'],
    ["Supervisor postal address", 'text'],
    ["Recommender LinkedIn", 'url'],
    ["Other person's website", 'url'],
  ])('never substitutes applicant identity for %s', async (label, type) => {
      const el = genericField(label, type);
      await runGeneric(ap);
      expect(el.value).toBe('');
      expect(drainR030CandidateLabels().some((item) => item.startsWith('r039-third-party:'))).toBe(true);
    });

  it('still allows the applicant referral-source question', async () => {
    const el = genericField('How were you referred to this role?');
    await runGeneric({ ...ap, referral_source_default: 'Company website' });
    expect(drainR030CandidateLabels().filter((item) => item.startsWith('r039-third-party:'))).toEqual([]);
    expect(el.value).not.toBe('mehekman@usc.edu');
  });
});

describe('R-039 veto at locationQuestion (the live labels took this path on Greenhouse)', () => {
  it('both live labels return null and are recorded', () => {
    expect(locationQuestion(GEMINI_RAW, ap)).toBeNull();
    expect(locationQuestion(FAIRE_RAW, ap)).toBeNull();
    const labels = drainR030CandidateLabels();
    expect(labels).toHaveLength(2);
    expect(labels.every((l) => l.startsWith('r039-veto:'))).toBe(true);
  });

  it('a real residence ask still resolves her city', () => {
    expect(locationQuestion('Location (City)*', ap)).toEqual({ field: 'city', value: 'Dubai' });
    expect(drainR030CandidateLabels()).toEqual([]);
  });

  it('a work-eligibility label with location vocabulary stays on its own refusal, out of the sample', () => {
    expect(locationQuestion('Are you authorized to work in the location where this role is based?', ap)).toBeNull();
    expect(drainR030CandidateLabels()).toEqual([]);
  });
});

describe('noteR039Candidate contract', () => {
  it('tags, truncates to the backend max, and caps under the zod array bound', () => {
    noteR039Candidate('veto', 'x'.repeat(500));
    const [long] = drainR030CandidateLabels();
    expect(long.startsWith('r039-veto:')).toBe(true);
    expect(long.length).toBe(200); // the zod per-string bound

    for (let i = 0; i < 60; i++) noteR039Candidate('third-party', `label ${i}`);
    // Capped at 40 so link candidates keep headroom and the event can never exceed zod's max(50).
    expect(drainR030CandidateLabels()).toHaveLength(40);
  });
});
