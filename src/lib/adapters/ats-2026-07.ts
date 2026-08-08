import type { AutofillResult } from '../types';
import { fillField, splitName } from './shared/dom';
import { fillGenericApplication, type GenericFillParams, type GenericProviderPolicy } from './generic';

// Adapters for the ATS platforms captured on 2026-07-29 (vault:
// litos-ats-dom-capture-2026-07-29.md). Every selector here came off a real rendered form; none was
// written from a naming pattern, which is the rule the 2026-07-28 capture set after the Ashby
// guessed-selector miss.
//
// WHY ONE FILE, AND WHY SO LITTLE CODE. lever.ts, greenhouse.ts and ashby.ts each carry their own
// copy of the question/EEO/combobox/draft machinery, and that duplication is where their bugs have
// come from - the splitName note in generic.ts is one adapter fixing a bug two others already had.
// Everything platform-specific about these three is WHICH SELECTOR HOLDS THE IDENTITY FIELDS. So
// each is a small declarative map, and every custom question, EEO block, textarea, combobox and
// honeypot is handed to generic.ts's engine, which already resolves them by label text and is the
// only copy under test for that behaviour.
//
// The four platforms that are NOT here (Jobvite, iCIMS, Oracle Cloud, UltiPro) have no adapter on
// purpose. Each puts a consent choice, an account wall or an emailed code before any application
// field exists, so there is nothing to fill. See gatedPortalNotice below.

type FieldKey = 'fullName' | 'firstName' | 'lastName' | 'email' | 'phone' | 'city' | 'linkedin' | 'portfolio';

interface AtsSpec {
  readonly id: 'rippling' | 'breezy' | 'bamboohr' | 'recruitee' | 'teamtailor';
  readonly host: (hostname: string) => boolean;
  readonly isApplicationPath: (pathname: string) => boolean;
  /** Selectors for the fields the profile can answer factually. Absent keys are simply not filled. */
  readonly fields: Partial<Record<FieldKey, string>>;
  readonly resume?: string;
  readonly jd?: string;
  /** A control that must be clicked before the form exists in the DOM at all. */
  readonly revealButton?: string;
  /** Text on that control, and a selector proving the form arrived. Both belong to the spec, not to
   *  revealAtsForm, which would otherwise hard-code one platform's button label and one platform's
   *  field name inside a function named for all of them. */
  readonly revealButtonText?: RegExp;
  readonly revealConfirms?: string;
  /** Present when the platform stops short of a submit even after a perfect fill. */
  readonly ceiling?: string;
  /** Enforced by the content-script submit gate, separate from explanatory prose. */
  readonly autoSubmit: 'conditional' | 'never';
  readonly genericPolicy?: GenericProviderPolicy;
}

export const ATS_SPECS: readonly AtsSpec[] = [
  {
    id: 'recruitee',
    host: (h) => /^(?!www\.)[^.]+\.recruitee\.com$/i.test(h),
    isApplicationPath: (p) => /^\/o\/[^/]+\/c\/new\/?$/i.test(p),
    fields: {
      fullName: 'input[name="candidate.name"]',
      email: 'input[name="candidate.email"]',
      phone: 'input[name="candidate.phone"]',
    },
    resume: 'input[type="file"][name="candidate.cv"]',
    jd: '[data-cy="offer-description"], main',
    autoSubmit: 'conditional',
    genericPolicy: { provider: 'recruitee', forbidConsentWrites: true },
    // Tenant agreements and SMS consent are intentionally absent. The generic pass leaves
    // unanswered consent controls for the applicant, and the auto-submit gate fails closed.
  },
  {
    id: 'teamtailor',
    host: (h) => /^(?!(?:www|app|api|partner|docs|support)\.)[^.]+\.teamtailor\.com$/i.test(h),
    isApplicationPath: (p) => /^\/jobs\/[^/]+\/applications\/new\/?$/i.test(p),
    fields: {
      firstName: 'input[name="candidate[first_name]"]',
      lastName: 'input[name="candidate[last_name]"]',
      email: 'input[name="candidate[email]"]',
      phone: 'input[name="candidate[phone]"]',
    },
    resume: '#upload_resume_field input[type="file"]',
    jd: '[data-job-description], main',
    autoSubmit: 'never',
    genericPolicy: { provider: 'teamtailor', forbidConsentWrites: true },
    ceiling:
      'This company asks you to confirm its applicant privacy terms before sending. Litos filled the form but left that choice and the send button to you.',
    // candidate[consent_given] and candidate[consent_given_future_jobs] are deliberately unmapped.
  },
  {
    id: 'rippling',
    // ats.* only. app.rippling.com is Rippling's HR product, where the equivalent-looking form is an
    // employee login - the same hazard as access.paylocity.com.
    host: (h) => h === 'ats.rippling.com',
    isApplicationPath: (p) => p.includes('/apply'),
    // THE trap: name AND id are both randomised per render (name="Z9gMtYRYFO", id="field-8"), so
    // data-testid is the only stable hook on this platform. It is stable on every field.
    fields: {
      firstName: '[data-testid="input-first_name"]',
      lastName: '[data-testid="input-last_name"]',
      email: '[data-testid="input-email"]',
      phone: '[data-testid="input-phone_number"]',
    },
    resume: 'input[type="file"][data-testid="input-resume"]',
    jd: '[data-testid="job-description"], main',
    autoSubmit: 'conditional',
    // NOT mapped, deliberately: all three of Rippling's comboboxes share ONE data-testid
    // ("input-select-search-input") and are pronouns, phone country code, and "Please identify your
    // race". Two are the applicant's own to declare or decline and the third is part of the phone
    // field, so there is nothing to fill and the selector ambiguity never has to be resolved.
    // Also unmapped: radio-sms_opt_in, a marketing consent control.
  },
  {
    id: 'breezy',
    host: (h) => h.endsWith('.breezy.hr'),
    // /p/{id}-{slug}. Excludes the bare breezy.hr marketing site.
    isApplicationPath: (p) => p.startsWith('/p/'),
    // cName is ONE full-name field, not a first/last pair. An adapter that splits finds nothing.
    fields: {
      fullName: 'input[name="cName"]',
      email: 'input[name="cEmail"]',
      phone: 'input[name="cPhoneNumber"]',
      city: 'input[name="cAddress"]',
    },
    resume: 'input[type="file"][name="cResume"]',
    jd: '.description, [class*="job-description"], main',
    autoSubmit: 'conditional',
    // NOT mapped: textarea[name="cSummary"] is candidate-authored positioning, the same judgement
    // made for Workable's headline. smsConsent and gdprAgreement are consent checkboxes. hp_<hex> is
    // the honeypot, and it is isHoneypotField's job rather than an omission here - see the
    // collapsed-ancestor rule in shared/dom.ts, which this capture is what prompted.
  },
  {
    id: 'bamboohr',
    host: (h) => h.endsWith('.bamboohr.com') && h !== 'www.bamboohr.com',
    // Numeric job id. Excludes www.bamboohr.com/careers/application, which is BambooHR's OWN careers
    // page and runs on Greenhouse, and the /careers/{department}-team marketing routes.
    isApplicationPath: (p) => /^\/careers\/\d+/.test(p),
    // ids are FabricTextField-<n>, sequential and render-dependent, so everything matches on name.
    fields: {
      firstName: 'input[name="firstName"]',
      lastName: 'input[name="lastName"]',
      email: 'input[name="email"]',
      phone: 'input[name="phone"]',
      city: 'input[name="city.value"]',
      linkedin: 'input[name="linkedinUrl"]',
      portfolio: 'input[name="websiteUrl"]',
    },
    // No name and no stable id on the file input; aria-label is the only hook.
    resume: 'input[type="file"][aria-label="file-input"]',
    jd: '.jss-job-description, main',
    autoSubmit: 'conditional',
    // The fields do not exist in the DOM until this is pressed, and /careers/{id}/apply is blank.
    revealButton: 'button',
    revealButtonText: /apply for this job/i,
    revealConfirms: 'input[name="firstName"]',
    ceiling:
      'This company’s page asks you to prove you are human before it will send. Litos filled everything it could, so the check and the send button are what is left.',
    // NOT mapped: nickname_<hex> (honeypot), desiredPay (salary is R-031's currency-gated rule and
    // belongs to the question path), state/country selects, and the required street address and ZIP,
    // which the profile cannot know. They surface to the student rather than being invented.
  },
];

export function specForCurrentPage(): AtsSpec | null {
  const host = window.location.hostname;
  return ATS_SPECS.find((spec) => spec.host(host)) ?? null;
}

export function isAtsApplicationPage(): boolean {
  const spec = specForCurrentPage();
  return spec ? spec.isApplicationPath(window.location.pathname) : false;
}

export function atsCanAutoSubmit(atsName: string): boolean {
  const spec = ATS_SPECS.find((item) => item.id === atsName);
  return spec?.autoSubmit !== 'never';
}

export function clickAtsSubmitIfAllowed(
  atsName: string,
  submitButton: Pick<HTMLElement, 'click'>,
  afterClick?: () => void,
): boolean {
  if (!atsCanAutoSubmit(atsName)) return false;
  submitButton.click();
  afterClick?.();
  return true;
}

export function clickDashboardSubmitIfAllowed(atsName: string, submitButton: Pick<HTMLElement, 'click'>): boolean {
  return clickAtsSubmitIfAllowed(atsName, submitButton);
}

export function extractAtsJdText(): string {
  const spec = specForCurrentPage();
  const node = spec?.jd ? document.querySelector(spec.jd) : null;
  return (node?.textContent?.trim() || document.body.innerText).trim().slice(0, 12000);
}

/**
 * BambooHR renders its form only after "Apply for This Job" is pressed. Scoped by visible text
 * rather than by a class, because the button carries only generated MUI classes.
 *
 * Returns whether a click happened, so the caller can wait for the form rather than racing it.
 */
export async function revealAtsForm(spec: AtsSpec): Promise<boolean> {
  if (!spec.revealButton) return false;
  const button = [...document.querySelectorAll<HTMLElement>(spec.revealButton)]
    .find((el) => !spec.revealButtonText || spec.revealButtonText.test(el.textContent ?? ''));
  if (!button) return false;
  button.click();
  // The form mounts client-side with no navigation, so polling beats both a fixed sleep and any
  // load-state wait: it returns as soon as the field exists, and gives up rather than hanging if the
  // click did nothing.
  if (!spec.revealConfirms) return true;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (document.querySelector(spec.revealConfirms)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return true;
}

/**
 * Fill the identity fields this platform holds in known selectors, then hand the rest of the form to
 * the generic engine.
 *
 * The generic pass is what answers custom questions, EEO blocks, open-ended textareas and
 * comboboxes, and it is also what applies the honeypot guard. Running it second matters: the fixed
 * selectors are more trustworthy than label matching for the fields they cover, so they win, and
 * generic skips anything already holding a value.
 */
export async function fillAtsApplication(params: GenericFillParams): Promise<AutofillResult> {
  const spec = specForCurrentPage();
  if (!spec) return fillGenericApplication(params);

  if (spec.revealButton) await revealAtsForm(spec);

  const { fullName, email, applicationProfile: ap } = params;
  const { first, last } = splitName(fullName);
  const values: Partial<Record<FieldKey, string | undefined>> = {
    fullName,
    firstName: first,
    lastName: last,
    email,
    phone: ap.phone,
    city: ap.address_city,
    linkedin: ap.linkedin_url,
    // Portfolio first, GitHub as the fallback, matching what the backend sends to the same field.
    portfolio: ap.portfolio_url ?? ap.github_url,
  };

  let filled = 0;
  for (const [key, selector] of Object.entries(spec.fields) as Array<[FieldKey, string]>) {
    const value = values[key];
    if (!value) continue;
    const el = document.querySelector<HTMLInputElement>(selector);
    // Never overwrite: the student may have typed something, or the platform may have prefilled it
    // from a previous application, and either is better information than ours.
    if (!el || el.value) continue;
    if (await fillField(el, value)) filled += 1;
  }

  // spec.resume is threaded through rather than left decorative. Without this the resume attaches
  // via generic's scoring heuristic, which cannot tell Rippling's two file inputs apart at all
  // (neither has a name, id, aria-label or placeholder, and both sit by the same "Drop or select"
  // text) and so picks whichever is first in the DOM. Right today, wrong the day Rippling reorders,
  // and the failure mode is a resume filed as a cover letter.
  const rest = await fillGenericApplication({
    ...params,
    resumeSelector: spec.resume,
    providerPolicy: spec.genericPolicy,
  });
  return {
    ...rest,
    // Names the real platform rather than inheriting generic's label, so the run's own record says
    // which adapter ran. The student's card and the issue register both read this.
    ats_name: spec.id,
    fields_filled: rest.fields_filled + filled,
    // The ceiling is surfaced to the student as a skip reason rather than swallowed, so a run that
    // stops one step short reads as a known platform limit instead of an unexplained partial fill.
    skipped_reasons: spec.ceiling ? [...rest.skipped_reasons, spec.ceiling] : rest.skipped_reasons,
  };
}

// ─── The four platforms with no form to fill ──────────────────────────────────
//
// Recognised and explained rather than attempted. Each stops a human-only gate before any
// application field exists, so there is no selector worth writing and an adapter would be a
// fill that silently does nothing. All four read live 2026-07-29.

type GatedPortal = 'jobvite' | 'icims' | 'oraclecloud' | 'ultipro';

const GATED_PORTALS: ReadonlyArray<{ id: GatedPortal; host: (h: string) => boolean; notice: string }> = [
  {
    id: 'jobvite',
    host: (h) => h === 'jobs.jobvite.com',
    // /apply renders a page headed "Data Consent" whose only control is a select whose only real
    // option is "Data Privacy Acknowledgement -- Global". Choosing it IS the acknowledgement.
    notice:
      'This company asks you to agree to their privacy notice before the application form opens. That choice is yours to make, so Litos stops here. Pick your country on the page and the form appears.',
  },
  {
    id: 'icims',
    host: (h) => h.endsWith('.icims.com') && h !== 'www.icims.com' && h !== 'community.icims.com',
    // The apply route redirects to /login: an email field plus an h-captcha-response textarea.
    notice:
      'This company asks you to make an account and prove you are human before the application form opens. Litos cannot do either of those for you.',
  },
  {
    id: 'oraclecloud',
    host: (h) => h.endsWith('.oraclecloud.com'),
    notice:
      'This company emails you a code and asks you to agree to their terms before the application form opens. Both of those need you.',
  },
  {
    id: 'ultipro',
    host: (h) => h === 'recruiting.ultipro.com',
    notice:
      'Litos can find this job but cannot read this company’s application form yet. Everything you need is ready to paste in, so apply on the page itself.',
  },
];

/**
 * The plain-language reason this page cannot be filled, or null if it is not one of them.
 *
 * Oracle is host-gated only in the extension, unlike the backend, which also requires the
 * /hcmUI/CandidateExperience path. The backend needs the tighter rule because it acts on a stored
 * url and oraclecloud.com hosts every Oracle Cloud product there is, including payroll logins. Here
 * the notice is only ever shown on a page the student opened herself, and it says nothing worse than
 * "this one needs you", so the wider match costs nothing and covers tenants on other paths.
 */
export function gatedPortalNotice(hostname = window.location.hostname): string | null {
  return GATED_PORTALS.find((portal) => portal.host(hostname))?.notice ?? null;
}
