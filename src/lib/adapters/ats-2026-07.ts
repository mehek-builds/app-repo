import type { AutofillResult } from '../types';
import { fillField, isHoneypotField, splitName } from './shared/dom';
import { fillGenericApplication, type GenericFillParams, type GenericProviderPolicy } from './generic';
import { browserApplicationCapability } from './browser-application-capabilities';

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

type FieldKey = 'fullName' | 'firstName' | 'lastName' | 'email' | 'confirmEmail' | 'phone' | 'city' | 'linkedin' | 'portfolio';

interface AtsSpec {
  readonly id: 'smartrecruiters' | 'rippling' | 'breezy' | 'bamboohr' | 'recruitee' | 'teamtailor' | 'personio' | 'pinpoint' | 'comeet' | 'zoho_recruit' | 'bullhorn' | 'jazzhr';
  readonly host: (hostname: string) => boolean;
  readonly isApplicationPath: (pathname: string, rawSearch: string, hash: string) => boolean;
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
  /** Mirrors the single capability registry for tests and adapter diagnostics. */
  readonly autoSubmit: 'conditional' | 'never';
  /** Fixed controls live one open shadow root below the captured host selector. */
  readonly openShadowRoots?: true;
  readonly genericPolicy?: GenericProviderPolicy;
}

// One capability registry guards every non-user-initiated click path. It is intentionally
// default-deny: a newly added or misspelled provider cannot inherit submission permission merely
// because it is absent. Direct clicks by the applicant do not call this capability.
const AUTO_SUBMIT_CAPABILITIES = {
  greenhouse: 'conditional',
  lever: 'conditional',
  ashby: 'conditional',
  workday: 'conditional',
  linkedin: 'conditional',
  generic: 'conditional',
  recruitee: 'conditional',
  rippling: 'conditional',
  breezy: 'conditional',
  bamboohr: 'conditional',
  teamtailor: 'never',
  personio: 'never',
  pinpoint: 'never',
  comeet: 'never',
  smartrecruiters: 'never',
} as const satisfies Record<string, 'conditional' | 'never'>;

export const ATS_SPECS: readonly AtsSpec[] = [
  {
    id: 'jazzhr',
    host: (h) => h === 'utilidata.applytojob.com' || h === 'foundationai.applytojob.com',
    isApplicationPath: (p) => /^\/apply\/jobs\/details\/[A-Za-z0-9]{10}\/?$/.test(p),
    fields: {
      firstName: 'input[name="resumator-firstname-value"]',
      lastName: 'input[name="resumator-lastname-value"]',
      email: 'input[name="resumator-email-value"]',
      phone: 'input[name="resumator-phone-value"]',
      city: 'input[name="resumator-city-value"]',
      linkedin: 'input[name="resumator-linkedin-value"]',
    },
    resume: 'input[type="file"][name="resumator-resume-value"]',
    jd: 'main, #resumator-job-description',
    autoSubmit: 'never',
    ceiling:
      'JazzHR requires a Human Check and can add tenant-specific legal, EEO, availability and compensation questions. Litos filled only the fixed factual controls and left every other control and the send button to you.',
  },
  {
    id: 'smartrecruiters',
    host: (h) => h === 'jobs.smartrecruiters.com',
    // The public posting and one-click form are separate. Only the latter contains applicant
    // controls, and the publication id is a UUID observed on both live tenants in this pass.
    isApplicationPath: (p) => /^\/oneclick-ui\/company\/[a-z0-9._-]+\/publication\/[0-9a-f-]{36}\/?$/i.test(p),
    fields: {
      firstName: 'spl-input#first-name-input input',
      lastName: 'spl-input#last-name-input input',
      email: 'spl-input#email-input input',
      confirmEmail: 'spl-input#confirm-email-input input',
      phone: 'spl-phone-field input[aria-label="Phone number"]',
      linkedin: 'spl-input#linkedin-input input',
      portfolio: 'spl-input#website-input input',
    },
    resume: 'spl-dropzone[data-test="resume-upload"] input[type="file"]',
    jd: 'main',
    openShadowRoots: true,
    autoSubmit: AUTO_SUBMIT_CAPABILITIES.smartrecruiters,
    ceiling:
      'SmartRecruiters uses a multi-step application. Litos filled the factual fields on this page and left every later question, confirmation, and send action to you.',
  },
  {
    id: 'zoho_recruit',
    host: (h) => /^[^.]+\.zohorecruit\.(?:com|eu|in)$/i.test(h),
    isApplicationPath: (p) => /^\/jobs\/Careers\/\d+\/[^/]+\/?$/i.test(p),
    fields: {
      firstName: 'input[name="First_Name"], input[name="firstName"]',
      lastName: 'input[name="Last_Name"], input[name="lastName"]',
      email: 'input[name="Email"], input[name="email"]',
      phone: 'input[name="Phone"], input[name="phone"]',
    },
    resume: 'input[type="file"][name*="Resume" i], input[type="file"][data-zcqa*="resume" i]',
    jd: '#spandesc, career-website-detail, main',
    autoSubmit: 'never',
    genericPolicy: { provider: 'zoho_recruit', forbidConsentWrites: true, forbidHumanDecisionWrites: true },
    ceiling:
      'Litos filled the public Zoho Recruit form but left every privacy, retention, EEO, attestation, CAPTCHA and send control to you.',
  },
  {
    id: 'bullhorn',
    // OSCP is self-hosted and customizable. Only the exact tenants inspected live are claimed.
    host: (h) => h === 'www.serverlogic.com' || h === 'www.staffingsolutionsenterprises.com',
    isApplicationPath: (p, _search, hash) => /^\/wp-content\/plugins\/bullhorn-oscp\/?$/i.test(p)
      && /^#\/jobs\/\d+(?:\/apply)?\/?$/i.test(hash),
    fields: {
      firstName: 'input[formcontrolname="firstName"], input[name="firstName"]',
      lastName: 'input[formcontrolname="lastName"], input[name="lastName"]',
      email: 'input[formcontrolname="email"], input[name="email"]',
      phone: 'input[formcontrolname="phone"], input[name="phone"]',
    },
    resume: 'input[type="file"][formcontrolname="resume"], input[type="file"][name="resume"]',
    jd: 'novo-activity-table, app-job, main',
    autoSubmit: 'never',
    genericPolicy: { provider: 'bullhorn', forbidConsentWrites: true, forbidHumanDecisionWrites: true },
    ceiling:
      'Litos filled the Bullhorn form but left every legal choice and the send button to you because each company can customize this portal.',
  },
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
    autoSubmit: AUTO_SUBMIT_CAPABILITIES.recruitee,
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
    autoSubmit: AUTO_SUBMIT_CAPABILITIES.teamtailor,
    genericPolicy: { provider: 'teamtailor', forbidConsentWrites: true },
    ceiling:
      'This company asks you to confirm its applicant privacy terms before sending. Litos filled the form but left that choice and the send button to you.',
    // candidate[consent_given] and candidate[consent_given_future_jobs] are deliberately unmapped.
  },
  {
    id: 'personio',
    host: (h) => /^[a-z0-9-]+\.jobs\.personio\.(?:de|com)$/i.test(h),
    isApplicationPath: (p) => /^\/job\/\d+\/apply\/?$/i.test(p),
    fields: {
      firstName: 'input[name="first_name"]',
      lastName: 'input[name="last_name"]',
      email: 'input[name="email"]',
      phone: 'input[name="phone"]',
      city: 'input[name="location"]',
      linkedin: 'input[name="public_profile"]',
    },
    resume: 'input[type="file"][name="documents.cv"]',
    jd: 'main, [data-testid="job-description"]',
    autoSubmit: AUTO_SUBMIT_CAPABILITIES.personio,
    genericPolicy: {
      provider: 'personio',
      neverFillSelectors: ['input[name="salary_expectations"]', 'input[name="available_from"]'],
      reviewReason: 'Personio final review left for you: the page does not expose every required field to Litos.',
    },
    ceiling: 'Personio does not expose every required field to Litos. Review the form and send it yourself.',
  },
  {
    id: 'pinpoint',
    host: (h) => h !== 'www.pinpointhq.com' && /^[a-z0-9-]+\.pinpointhq\.com$/i.test(h),
    isApplicationPath: (p) => /^\/(?:[a-z]{2}\/)?postings\/[0-9a-f-]+\/applications\/new\/?$/i.test(p),
    fields: {
      firstName: 'input[name="application_form[application][first_name]"]',
      lastName: 'input[name="application_form[application][last_name]"]',
      email: 'input[name="application_form[application][email]"]',
      phone: 'input[name="application_form[application][phone]"]',
      city: 'input[name="application_form[application][town]"]',
      linkedin: 'input[name="application_form[application][linkedin_url]"][type="text"]',
    },
    resume: 'input[type="file"][name="application_form[application][cv]"]',
    jd: 'main, [class*="posting-description"]',
    autoSubmit: AUTO_SUBMIT_CAPABILITIES.pinpoint,
    genericPolicy: {
      provider: 'pinpoint',
      forbidConsentWrites: true,
      neverFillSelectors: ['input[name="application[process_information]"]', '#application_process_information'],
      reviewReason: 'Pinpoint privacy-processing choice left for you: review the notice before submitting.',
    },
    ceiling: 'Pinpoint requires your privacy-processing choice. Review the notice and send the form yourself.',
  },
  {
    id: 'comeet',
    host: (h) => h === 'www.comeet.co',
    // Inspect the raw query instead of URLSearchParams so the opaque token is never decoded,
    // trimmed, normalized, or re-encoded by runtime detection.
    isApplicationPath: (p, rawSearch) => /^\/jobs\/[A-Z0-9.]+\/[A-Z0-9.-]+\/apply\/?$/i.test(p)
      && /(?:^\?|&)token=[^&]+(?:&|$)/.test(rawSearch),
    fields: {
      firstName: 'input[name="firstName"]',
      lastName: 'input[name="lastName"]',
      email: 'input[name="email"]',
      phone: 'input[name="phone"]',
      portfolio: 'input[name="websiteUrl"]',
    },
    resume: 'input[type="file"][name="cv"]',
    jd: 'main, body',
    autoSubmit: AUTO_SUBMIT_CAPABILITIES.comeet,
    genericPolicy: {
      provider: 'comeet',
      neverFillSelectors: [
        'textarea[name="g-recaptcha-response"]',
        'input[name="g-recaptcha-response"]',
        'textarea[name="comment"]',
      ],
      reviewReason: 'Comeet human verification left for you: solve the check and review the form before submitting.',
    },
    ceiling: 'Comeet requires human verification. Solve the check, review the form, and send it yourself.',
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
    autoSubmit: AUTO_SUBMIT_CAPABILITIES.rippling,
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
    autoSubmit: AUTO_SUBMIT_CAPABILITIES.breezy,
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
    autoSubmit: AUTO_SUBMIT_CAPABILITIES.bamboohr,
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

export function specForLocation(location: Pick<Location, 'hostname' | 'pathname' | 'search' | 'hash'>): AtsSpec | null {
  return ATS_SPECS.find((candidate) => candidate.host(location.hostname)) ?? null;
}

export function specForCurrentPage(): AtsSpec | null {
  return specForLocation(window.location);
}

export function isAtsApplicationPage(): boolean {
  const spec = specForCurrentPage();
  return spec ? spec.isApplicationPath(window.location.pathname, window.location.search, window.location.hash) : false;
}

export function atsCanAutoSubmit(atsName: string): boolean {
  const capability = browserApplicationCapability(atsName);
  if (capability) return capability.programmaticSubmit;
  return AUTO_SUBMIT_CAPABILITIES[atsName as keyof typeof AUTO_SUBMIT_CAPABILITIES] === 'conditional';
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

function visibleSafeFixedInput(selector: string): HTMLInputElement | null {
  return [...document.querySelectorAll<HTMLInputElement>(selector)].find((candidate) => {
    if (candidate.closest('[id*="litos"]') || isHoneypotField(candidate)) return false;
    const rect = candidate.getBoundingClientRect();
    const style = getComputedStyle(candidate);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  }) ?? null;
}

export function extractAtsJdText(): string {
  const spec = specForCurrentPage();
  const node = spec?.jd ? document.querySelector(spec.jd) : null;
  return (node?.textContent?.trim() || document.body.innerText).trim().slice(0, 12000);
}

function queryAtsControl<T extends Element>(spec: AtsSpec, selector: string): T | null {
  if (!spec.openShadowRoots) return document.querySelector<T>(selector);
  // Each captured SmartRecruiters selector crosses one open-shadow boundary. Native
  // querySelector does not, unlike Playwright, so resolve the stable host first and then the
  // captured inner selector. Reject a selector with no boundary instead of searching every shadow
  // root broadly and risking an unrelated field.
  const boundary = selector.indexOf(' ');
  if (boundary < 1) return null;
  const hostSelector = selector.slice(0, boundary);
  const innerSelector = selector.slice(boundary + 1);
  const host = document.querySelector<HTMLElement>(hostSelector);
  return host?.shadowRoot?.querySelector<T>(innerSelector) ?? null;
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
    confirmEmail: email,
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
    const el = spec.id === 'zoho_recruit' || spec.id === 'bullhorn' || spec.id === 'jazzhr'
      ? visibleSafeFixedInput(selector)
      : queryAtsControl<HTMLInputElement>(spec, selector);
    // Never overwrite: the student may have typed something, or the platform may have prefilled it
    // from a previous application, and either is better information than ours.
    if (!el || el.value || isHoneypotField(el)) continue;
    if (await fillField(el, value)) filled += 1;
  }

  // spec.resume is threaded through rather than left decorative. Without this the resume attaches
  // via generic's scoring heuristic, which cannot tell Rippling's two file inputs apart at all
  // (neither has a name, id, aria-label or placeholder, and both sit by the same "Drop or select"
  // text) and so picks whichever is first in the DOM. Right today, wrong the day Rippling reorders,
  // and the failure mode is a resume filed as a cover letter.
  // SmartRecruiters keeps the upload inside the same open-shadow component boundary as its text
  // controls. Attach it here because generic.ts intentionally scans only the light DOM. For every
  // other ATS, generic keeps using the exact captured selector as before.
  let exactResumeAttached = false;
  if ((spec.openShadowRoots || spec.id === 'jazzhr') && spec.resume && params.resumeBlob && params.resumeFileName) {
    const input = spec.id === 'jazzhr'
      ? visibleSafeFixedInput(spec.resume)
      : queryAtsControl<HTMLInputElement>(spec, spec.resume);
    if (input) {
      const file = new File([params.resumeBlob], params.resumeFileName, { type: 'application/pdf' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      exactResumeAttached = true;
    }
  }

  // SmartRecruiters is intentionally fixed-field-only. Its measured capability is the exact
  // first-page shadow controls above, not arbitrary light-DOM fields that a tenant, injected page,
  // or later wizard step may expose. Do not call the generic writer at all for this family.
  if (spec.id === 'smartrecruiters' || spec.id === 'jazzhr') {
    const resumeReason = !params.resumeBlob || !params.resumeFileName
      ? 'resume: no generated resume file available'
      : exactResumeAttached
        ? null
        : 'resume: no file input found on this form';
    const skippedReasons = [
      ...(resumeReason ? [resumeReason] : []),
      ...(spec.ceiling ? [spec.ceiling] : []),
    ];
    const result = {
      ats_name: spec.id,
      fields_filled: filled + (exactResumeAttached ? 1 : 0),
      fields_skipped: resumeReason ? 1 : 0,
      ai_drafted: 0,
      skipped_reasons: skippedReasons,
    } satisfies AutofillResult;
    params.onProgress?.({
      fields_filled: result.fields_filled,
      fields_skipped: result.fields_skipped,
      ai_drafted: 0,
      pendingEssays: 0,
    });
    return result;
  }

  const rest = await fillGenericApplication({
    ...params,
    resumeBlob: spec.openShadowRoots ? undefined : params.resumeBlob,
    resumeFileName: spec.openShadowRoots ? undefined : params.resumeFileName,
    resumeSelector: spec.resume,
    providerPolicy: spec.genericPolicy,
  });
  const genericMissingResume = 'resume: no generated resume file available';
  const skippedReasons = spec.openShadowRoots
    ? rest.skipped_reasons.map((reason) => reason === genericMissingResume
      ? exactResumeAttached
        ? ''
        : 'resume: no file input found on this form'
      : reason).filter(Boolean)
    : rest.skipped_reasons;
  return {
    ...rest,
    // Names the real platform rather than inheriting generic's label, so the run's own record says
    // which adapter ran. The student's card and the issue register both read this.
    ats_name: spec.id,
    fields_filled: rest.fields_filled + filled + (exactResumeAttached ? 1 : 0),
    fields_skipped: Math.max(0, rest.fields_skipped - (exactResumeAttached ? 1 : 0)),
    // The ceiling is surfaced to the student as a skip reason rather than swallowed, so a run that
    // stops one step short reads as a known platform limit instead of an unexplained partial fill.
    skipped_reasons: spec.ceiling ? [...skippedReasons, spec.ceiling] : skippedReasons,
  };
}

// ─── The four platforms with no form to fill ──────────────────────────────────
//
// Recognised and explained rather than attempted. Each stops a human-only gate before any
// application field exists, so there is no selector worth writing and an adapter would be a
// fill that silently does nothing. All four read live 2026-07-29.

type GatedPortal = 'jobvite' | 'icims' | 'oraclecloud' | 'ultipro' | 'sap_successfactors' | 'oracle_taleo' | 'adp_recruiting';

const GATED_PORTALS: ReadonlyArray<{
  id: GatedPortal;
  host: (h: string) => boolean;
  path: (pathname: string) => boolean;
  notice: string;
}> = [
  {
    id: 'jobvite',
    host: (h) => h === 'jobs.jobvite.com',
    path: (p) => /^\/[a-z0-9._-]+\/job\/[a-z0-9]+(?:\/apply)?\/?$/i.test(p),
    // /apply renders a location-of-residence choice before the application. The selected region
    // determines the privacy acknowledgement and form that follow, so Litos leaves it untouched.
    notice:
      'This company asks you to choose your location and review its privacy notice before the application form opens. Those choices are yours to make, so Litos stops here.',
  },
  {
    id: 'icims',
    host: (h) => /^(?!(?:www|community|login|api)\.)[a-z0-9-]+\.icims\.com$/i.test(h),
    path: (p) => /^\/jobs\/\d+\/[a-z0-9%._~-]+\/(?:job|login)\/?$/i.test(p),
    // The apply route redirects to /login: an email field plus an h-captcha-response textarea.
    notice:
      'This company asks you to make an account and prove you are human before the application form opens. Litos cannot do either of those for you.',
  },
  {
    id: 'oraclecloud',
    host: (h) => h.endsWith('.oraclecloud.com'),
    path: (p) => /^\/hcmUI\/CandidateExperience\//i.test(p),
    notice:
      'This company emails you a code and asks you to agree to their terms before the application form opens. Both of those need you.',
  },
  {
    id: 'ultipro',
    host: (h) => h === 'recruiting.ultipro.com',
    path: (p) => /^\/[a-z0-9._-]+\/JobBoard\//i.test(p),
    notice:
      'Litos can find this job but cannot read this company’s application form yet. Everything you need is ready to paste in, so apply on the page itself.',
  },
  {
    id: 'sap_successfactors',
    host: (h) => /^career\d+\.successfactors\.(?:com|eu)$/i.test(h),
    path: (p) => /^\/(?:sfcareer\/jobreqcareer|career|portalcareer)\/?$/i.test(p),
    notice:
      'This company asks you to sign in or create a SuccessFactors account before the application form opens. Litos leaves that account and every later legal choice to you.',
  },
  {
    id: 'oracle_taleo',
    host: (h) => h === 'fa007.taleo.net' || h === 'aa270.taleo.net',
    path: (p) => /^\/careersection\/ex\/jobdetail\.ftl$/i.test(p),
    notice:
      'This Taleo application asks you to accept the employer legal notice before any application fields open. Litos leaves that decision and the later account flow to you.',
  },
  {
    id: 'adp_recruiting',
    host: (h) => h === 'myjobs.adp.com',
    path: (p) => /^\/(?:guitarcenterexternal|kaisercareers)\/cx\/job-details\/?$/i.test(p),
    notice:
      'This ADP Recruiting application requires an account before any application fields open. Litos leaves the account and every later legal choice to you.',
  },
];

/**
 * The plain-language reason this page cannot be filled, or null if it is not one of them.
 *
 * Host and path must both match. This keeps vendor pages, search routes, and unrelated Oracle Cloud
 * products from inheriting an application capability or a misleading handoff notice.
 */
export function gatedPortalNotice(
  hostname = window.location.hostname,
  pathname = window.location.pathname,
  search = window.location.search,
): string | null {
  const portal = GATED_PORTALS.find((candidate) => candidate.host(hostname) && candidate.path(pathname));
  if (!portal) return null;
  if (portal.id === 'oracle_taleo') {
    return /^\d+$/.test(new URLSearchParams(search).get('job') ?? '') ? portal.notice : null;
  }
  if (portal.id === 'adp_recruiting') {
    return /^\d+$/.test(new URLSearchParams(search).get('reqId') ?? '') ? portal.notice : null;
  }
  if (portal.id !== 'sap_successfactors') return portal.notice;
  const query = new URLSearchParams(search);
  const jobId = query.get('jobId') ?? query.get('career_job_req_id') ?? query.get('job_application');
  const company = query.get('company');
  return /^\d+$/.test(jobId ?? '') && /^[A-Za-z0-9_-]+$/.test(company ?? '') ? portal.notice : null;
}
