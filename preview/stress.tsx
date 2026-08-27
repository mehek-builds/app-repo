import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/hanken-grotesk';
import '@fontsource-variable/azeret-mono';
import '../src/styles/globals.css';
import AutofillSetupScreen from '../src/components/AutofillSetupScreen';
import ContactList from '../src/components/ContactList';
import DraftEditor from '../src/components/DraftEditor';
import MainScreen from '../src/components/MainScreen';
import OnboardingScreen from '../src/components/OnboardingScreen';
import PlansScreen from '../src/components/PlansScreen';
import TrackingDashboard from '../src/components/TrackingDashboard';
import { COLOR, FONT, RADIUS, SHADOW } from '../src/styles/tokens';
import { installStressEnvironment, stressApiCounts } from './stress-environment';
import {
  emptyProfile,
  freeSnapshot,
  incompleteContact,
  longDraft,
  longJob,
  manyContacts,
  normalContacts,
  normalDraft,
  normalJob,
  normalProfile,
  paidSnapshot,
  trialSnapshot,
  UNBREAKABLE,
} from './stress-fixtures';

type ScenarioDriver = (root: HTMLElement) => Promise<void>;

type ScenarioDefinition = {
  id: string;
  group: string;
  component: string;
  label: string;
  description: string;
  width: 320 | 380;
  render: () => React.ReactNode;
  prepare?: ScenarioDriver;
};

const noop = () => {};
const TOKEN_PREFIX = 'stress-token:';

function tokenFor(id: string) {
  return `${TOKEN_PREFIX}${id}`;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function normalizeText(value: string | null | undefined) {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

async function waitForElement<T extends Element>(
  root: HTMLElement,
  selector: string,
  timeoutMs = 4_000,
): Promise<T> {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    const match = root.querySelector<T>(selector);
    if (match) return match;
    await delay(25);
  }
  throw new Error(`Timed out waiting for ${selector}`);
}

async function waitForText(root: HTMLElement, text: string, timeoutMs = 4_000): Promise<void> {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    if ((root.textContent ?? '').includes(text)) return;
    await delay(25);
  }
  throw new Error(`Timed out waiting for text: ${text}`);
}

async function waitForControlValue(root: HTMLElement, value: string, timeoutMs = 4_000): Promise<void> {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    const controls = Array.from(root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'));
    if (controls.some((control) => control.value === value)) return;
    await delay(25);
  }
  throw new Error(`Timed out waiting for control value: ${value}`);
}

function findButton(root: HTMLElement, label: string, startsWith = false): HTMLButtonElement {
  const wanted = normalizeText(label);
  const match = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((button) => {
    const text = normalizeText(button.textContent);
    return startsWith ? text.startsWith(wanted) : text === wanted;
  });
  if (!match) throw new Error(`Could not find button: ${label}`);
  return match;
}

function setTextControlValue(
  control: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const prototype = control instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(control, value);
  control.dispatchEvent(new Event('input', { bubbles: true }));
  control.dispatchEvent(new Event('change', { bubbles: true }));
}

function attachFile(input: HTMLInputElement, name: string, type: string) {
  const transfer = new DataTransfer();
  transfer.items.add(new File(['stress fixture'], name, { type }));
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: transfer.files,
  });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function driveSignupForm(
  root: HTMLElement,
  options: { email?: string; fileName?: string; fileType?: string } = {},
) {
  await waitForText(root, 'Set up Litos');
  const email = await waitForElement<HTMLInputElement>(root, '#signup-email');
  setTextControlValue(email, options.email ?? 'stress@example.com');
  if (options.fileName) {
    const file = await waitForElement<HTMLInputElement>(root, '#resume-upload');
    attachFile(file, options.fileName, options.fileType ?? 'application/pdf');
  }
}

async function driveOnboardingToCode(root: HTMLElement) {
  await driveSignupForm(root, { fileName: 'stress-resume.pdf' });
  findButton(root, 'Continue').click();
  await waitForElement(root, '#verification-code');
}

async function driveSetupTo(root: HTMLElement, target: 'checks' | 'required') {
  await waitForText(root, 'Your experience');
  findButton(root, 'Continue').click();
  await waitForText(root, 'About you');
  if (target === 'required') {
    findButton(root, 'Continue').click();
    await waitForText(root, 'Every form asks these');
    findButton(root, 'Questions about race and gender', true).click();
    await waitForElement(root, '#eeo-fields');
  }
}

async function waitForLinks(root: HTMLElement) {
  await waitForText(root, 'Your links');
  await waitForElement(root, '#litos-automatic-submission-control');
}

function mainScreen(id: string, options: {
  detectedJob?: typeof normalJob | null;
  pendingDraftCount?: number;
  entitlements?: typeof trialSnapshot | null;
}) {
  return (
    <MainScreen
      token={tokenFor(id)}
      detectedJob={options.detectedJob}
      pendingDraftCount={options.pendingDraftCount}
      onViewDrafts={noop}
      onContactsFound={noop}
      onViewTracking={noop}
      onViewAutofillSetup={noop}
      onViewPlans={noop}
      entitlements={options.entitlements}
      userSchool={normalProfile.school}
    />
  );
}

function setupScreen(
  id: string,
  options: {
    profile?: typeof normalProfile;
    entitlements?: typeof trialSnapshot;
    focusAutomaticSubmission?: boolean;
  } = {},
) {
  return (
    <AutofillSetupScreen
      token={tokenFor(id)}
      profile={options.profile ?? normalProfile}
      entitlements={options.entitlements ?? trialSnapshot}
      focusAutomaticSubmission={options.focusAutomaticSubmission ?? false}
      onViewPlans={noop}
      onBack={noop}
      onLogout={noop}
    />
  );
}

function draftScreen(
  id: string,
  options: {
    contact?: typeof normalContacts[number];
    job?: typeof normalJob;
    prebuiltDraft?: typeof normalDraft | null;
    deferGeneration?: boolean;
  } = {},
) {
  return (
    <DraftEditor
      contact={options.contact ?? normalContacts[0]}
      job={options.job ?? normalJob}
      token={tokenFor(id)}
      profile={normalProfile}
      prebuiltDraft={options.prebuiltDraft}
      deferGeneration={options.deferGeneration}
      onBack={noop}
      onDraftAnother={noop}
      onViewPlans={noop}
    />
  );
}

const scenarios: ScenarioDefinition[] = [
  {
    id: 'onboarding-signup',
    group: 'Onboarding',
    component: 'OnboardingScreen',
    label: 'Signup, no data',
    description: 'Initial email and resume state at the shipped popup width.',
    width: 380,
    render: () => <OnboardingScreen onComplete={noop} />,
  },
  {
    id: 'onboarding-signin',
    group: 'Onboarding',
    component: 'OnboardingScreen',
    label: 'Returning sign in',
    description: 'Real mode switch with the resume control removed.',
    width: 320,
    render: () => <OnboardingScreen onComplete={noop} />,
    prepare: async (root) => {
      await waitForText(root, 'Already have an account?');
      findButton(root, 'Sign in').click();
      await waitForText(root, 'Use the email you signed up with.');
    },
  },
  {
    id: 'onboarding-missing-resume',
    group: 'Onboarding',
    component: 'OnboardingScreen',
    label: 'Missing required resume',
    description: 'Client validation error with a complete email and no file.',
    width: 320,
    render: () => <OnboardingScreen onComplete={noop} />,
    prepare: async (root) => {
      await driveSignupForm(root);
      findButton(root, 'Continue').click();
      await waitForText(root, 'Add your resume.');
    },
  },
  {
    id: 'onboarding-invalid-file',
    group: 'Onboarding',
    component: 'OnboardingScreen',
    label: 'Unsupported resume file',
    description: 'Real file validation with a plain text upload.',
    width: 320,
    render: () => <OnboardingScreen onComplete={noop} />,
    prepare: async (root) => {
      await driveSignupForm(root, {
        fileName: 'resume.txt',
        fileType: 'text/plain',
      });
      await waitForText(root, 'Use a PDF or a Word file.');
    },
  },
  {
    id: 'onboarding-long-file',
    group: 'Onboarding',
    component: 'OnboardingScreen',
    label: 'Long unbreakable filename',
    description: 'Selected PDF with an extreme filename and email at 320px.',
    width: 320,
    render: () => <OnboardingScreen onComplete={noop} />,
    prepare: async (root) => {
      await driveSignupForm(root, {
        email: `${UNBREAKABLE}@example.com`,
        fileName: `${UNBREAKABLE}.pdf`,
      });
      await waitForText(root, `${UNBREAKABLE}.pdf`);
    },
  },
  {
    id: 'onboarding-code',
    group: 'Onboarding',
    component: 'OnboardingScreen',
    label: 'Verification code',
    description: 'The real second step reached through form submission.',
    width: 380,
    render: () => <OnboardingScreen onComplete={noop} />,
    prepare: driveOnboardingToCode,
  },
  {
    id: 'onboarding-uploading',
    group: 'Onboarding',
    component: 'OnboardingScreen',
    label: 'Reading resume',
    description: 'The upload request stays pending after a valid code.',
    width: 380,
    render: () => <OnboardingScreen onComplete={noop} />,
    prepare: async (root) => {
      await driveOnboardingToCode(root);
      const code = await waitForElement<HTMLInputElement>(root, '#verification-code');
      setTextControlValue(code, '123456');
      findButton(root, 'Verify and continue').click();
      await waitForText(root, 'Reading your resume');
    },
  },
  {
    id: 'setup-loading',
    group: 'Answer setup',
    component: 'AutofillSetupScreen',
    label: 'Loading setup',
    description: 'All three initial setup reads stay pending.',
    width: 380,
    render: () => setupScreen('setup-loading'),
    prepare: () => delay(150),
  },
  {
    id: 'setup-empty',
    group: 'Answer setup',
    component: 'AutofillSetupScreen',
    label: 'No experience',
    description: 'No resume entries, no saved bank, and Continue disabled.',
    width: 320,
    render: () => setupScreen('setup-empty', { profile: emptyProfile as typeof normalProfile }),
    prepare: async (root) => {
      await waitForText(root, 'Your experience');
      if (!findButton(root, 'Continue').disabled) throw new Error('Expected Continue to be disabled');
    },
  },
  {
    id: 'setup-experience',
    group: 'Answer setup',
    component: 'AutofillSetupScreen',
    label: 'One seeded experience',
    description: 'First-run resume seed with editable fields.',
    width: 380,
    render: () => setupScreen('setup-experience'),
    prepare: async (root) => waitForControlValue(root, 'Campus Labs'),
  },
  {
    id: 'setup-many',
    group: 'Answer setup',
    component: 'AutofillSetupScreen',
    label: `${stressApiCounts.experienceEntries} saved entries`,
    description: 'Many experience rows with long and unbreakable content.',
    width: 320,
    render: () => setupScreen('setup-many'),
    prepare: async (root) => waitForControlValue(root, 'Organization 16'),
  },
  {
    id: 'setup-checks',
    group: 'Answer setup',
    component: 'AutofillSetupScreen',
    label: 'About you step',
    description: 'The real second answer step reached through Continue.',
    width: 320,
    render: () => setupScreen('setup-checks'),
    prepare: async (root) => driveSetupTo(root, 'checks'),
  },
  {
    id: 'setup-required',
    group: 'Answer setup',
    component: 'AutofillSetupScreen',
    label: 'Required answers and EEO',
    description: 'Dates, salary, work eligibility, sponsorship, and expanded optional EEO.',
    width: 320,
    render: () => setupScreen('setup-required'),
    prepare: async (root) => driveSetupTo(root, 'required'),
  },
  {
    id: 'setup-links-free',
    group: 'Answer setup',
    component: 'AutofillSetupScreen',
    label: 'Free plan permission lock',
    description: 'Automatic submission is plan-locked and disabled.',
    width: 320,
    render: () => setupScreen('setup-links-free', {
      entitlements: freeSnapshot as typeof trialSnapshot,
      focusAutomaticSubmission: true,
    }),
    prepare: async (root) => {
      await waitForLinks(root);
      const toggle = await waitForElement<HTMLButtonElement>(root, '#litos-automatic-submission-control');
      if (!toggle.disabled) throw new Error('Expected the plan-locked toggle to be disabled');
      await waitForText(root, 'included in the Litos+ trial and paid plans');
    },
  },
  {
    id: 'setup-links-ineligible',
    group: 'Answer setup',
    component: 'AutofillSetupScreen',
    label: 'Consent not earned',
    description: 'Plan allows the feature, but reviewed-submit permission is not earned.',
    width: 380,
    render: () => setupScreen('setup-links-ineligible', { focusAutomaticSubmission: true }),
    prepare: async (root) => {
      await waitForLinks(root);
      const toggle = await waitForElement<HTMLButtonElement>(root, '#litos-automatic-submission-control');
      if (!toggle.disabled) throw new Error('Expected the consent-locked toggle to be disabled');
      await waitForText(root, '3 to go');
    },
  },
  {
    id: 'setup-links-eligible',
    group: 'Answer setup',
    component: 'AutofillSetupScreen',
    label: 'Permission earned',
    description: 'Automatic submission is entitled, earned, available, and off.',
    width: 380,
    render: () => setupScreen('setup-links-eligible', { focusAutomaticSubmission: true }),
    prepare: async (root) => {
      await waitForLinks(root);
      const toggle = await waitForElement<HTMLButtonElement>(root, '#litos-automatic-submission-control');
      if (toggle.disabled) throw new Error('Expected the earned toggle to be available');
    },
  },
  {
    id: 'setup-saving',
    group: 'Answer setup',
    component: 'AutofillSetupScreen',
    label: 'Saving setup',
    description: 'Save remains pending with its primary action disabled by screen replacement.',
    width: 380,
    render: () => setupScreen('setup-saving', { focusAutomaticSubmission: true }),
    prepare: async (root) => {
      await waitForLinks(root);
      findButton(root, 'Save and finish').click();
      await waitForText(root, 'Saving your setup');
    },
  },
  {
    id: 'setup-done',
    group: 'Answer setup',
    component: 'AutofillSetupScreen',
    label: 'Setup complete',
    description: 'Successful save and the real completion action.',
    width: 380,
    render: () => setupScreen('setup-done', { focusAutomaticSubmission: true }),
    prepare: async (root) => {
      await waitForLinks(root);
      findButton(root, 'Save and finish').click();
      await waitForText(root, "You're set up");
    },
  },
  {
    id: 'setup-load-error',
    group: 'Answer setup',
    component: 'AutofillSetupScreen',
    label: 'Setup load error',
    description: 'Initial bank read fails and the component exposes its real recovery surface.',
    width: 320,
    render: () => setupScreen('setup-load-error'),
    prepare: async (root) => waitForText(root, 'Stress fixture could not load your setup data.'),
  },
  {
    id: 'setup-save-error',
    group: 'Answer setup',
    component: 'AutofillSetupScreen',
    label: 'Automation save denied',
    description: 'Answers save, permission write fails, and completion stays honest.',
    width: 380,
    render: () => setupScreen('setup-save-error', { focusAutomaticSubmission: true }),
    prepare: async (root) => {
      await waitForLinks(root);
      findButton(root, 'Save and finish').click();
      await waitForText(root, 'automation permission could not be changed');
      await waitForText(root, "You're set up");
    },
  },
  {
    id: 'setup-signout-confirm',
    group: 'Answer setup',
    component: 'AutofillSetupScreen',
    label: 'Sign-out confirmation',
    description: 'The real two-tap confirmation state at 320px.',
    width: 320,
    render: () => setupScreen('setup-signout-confirm', { focusAutomaticSubmission: true }),
    prepare: async (root) => {
      await waitForLinks(root);
      findButton(root, 'Sign out').click();
      await waitForText(root, 'Sign out of Litos?');
    },
  },
  {
    id: 'main-normal',
    group: 'Main screen',
    component: 'MainScreen',
    label: 'Detected job and one draft',
    description: 'Normal detected job, one pending draft, trial usage, and one recent event.',
    width: 380,
    render: () => mainScreen('main-normal', {
      detectedJob: normalJob,
      pendingDraftCount: 1,
      entitlements: trialSnapshot,
    }),
    prepare: async (root) => waitForText(root, 'Marcus Lee'),
  },
  {
    id: 'main-empty',
    group: 'Main screen',
    component: 'MainScreen',
    label: 'No job, drafts, or events',
    description: 'Manual job entry and the zero-data recent-email state.',
    width: 320,
    render: () => mainScreen('main-empty', {
      detectedJob: null,
      pendingDraftCount: 0,
      entitlements: freeSnapshot,
    }),
    prepare: async (root) => waitForText(root, 'No emails yet.'),
  },
  {
    id: 'main-long',
    group: 'Main screen',
    component: 'MainScreen',
    label: 'Huge draft count and long job',
    description: 'Maximum safe integer count plus long and unbreakable job content at 320px.',
    width: 320,
    render: () => mainScreen('main-long', {
      detectedJob: longJob as typeof normalJob,
      pendingDraftCount: Number.MAX_SAFE_INTEGER,
      entitlements: trialSnapshot,
    }),
    prepare: async (root) => waitForText(root, `${Number.MAX_SAFE_INTEGER} drafts ready`),
  },
  {
    id: 'main-events-error',
    group: 'Main screen',
    component: 'MainScreen',
    label: 'Recent events error',
    description: 'The main workflow remains usable while outreach history fails.',
    width: 380,
    render: () => mainScreen('main-events-error', {
      detectedJob: normalJob,
      pendingDraftCount: 0,
      entitlements: trialSnapshot,
    }),
    prepare: async (root) => waitForText(root, 'Stress fixture could not load outreach history.'),
  },
  {
    id: 'main-find-loading',
    group: 'Main screen',
    component: 'MainScreen',
    label: 'Contact discovery loading',
    description: 'Find people remains pending and the action is disabled.',
    width: 380,
    render: () => mainScreen('main-find-loading', {
      detectedJob: normalJob,
      pendingDraftCount: 0,
      entitlements: trialSnapshot,
    }),
    prepare: async (root) => {
      await waitForText(root, 'Recent emails');
      findButton(root, 'Find people').click();
      await waitForText(root, 'Looking');
      const button = await waitForElement<HTMLButtonElement>(root, '#litos-contact-discovery-control');
      if (!button.disabled) throw new Error('Expected contact discovery to be disabled while loading');
    },
  },
  {
    id: 'main-paywall',
    group: 'Main screen',
    component: 'MainScreen',
    label: 'Contact permission denied',
    description: 'The backend denies contact discovery and the free workflow remains available.',
    width: 320,
    render: () => mainScreen('main-paywall', {
      detectedJob: normalJob,
      pendingDraftCount: 0,
      entitlements: freeSnapshot,
    }),
    prepare: async (root) => {
      await waitForText(root, 'Recent emails');
      findButton(root, 'Find people').click();
      await waitForText(root, 'Contact discovery is part of Litos+.');
      await waitForText(root, 'See Litos+');
    },
  },
  {
    id: 'contacts-loading',
    group: 'Contacts',
    component: 'ContactList',
    label: 'Loading contacts',
    description: 'Real contact skeletons and live-region copy.',
    width: 380,
    render: () => <ContactList contacts={[]} job={normalJob} loading onDraft={noop} onBack={noop} />,
  },
  {
    id: 'contacts-empty',
    group: 'Contacts',
    component: 'ContactList',
    label: 'No contacts',
    description: 'Zero-result recovery action at 320px.',
    width: 320,
    render: () => <ContactList contacts={[]} job={normalJob} loading={false} onDraft={noop} onBack={noop} />,
  },
  {
    id: 'contacts-one',
    group: 'Contacts',
    component: 'ContactList',
    label: 'One incomplete contact',
    description: 'Missing title and reachability with an unbreakable name and job heading.',
    width: 320,
    render: () => <ContactList contacts={[incompleteContact]} job={longJob} loading={false} onDraft={noop} onBack={noop} />,
  },
  {
    id: 'contacts-many',
    group: 'Contacts',
    component: 'ContactList',
    label: `${stressApiCounts.contacts} contacts`,
    description: 'Many rows across every contact status and persona.',
    width: 380,
    render: () => <ContactList contacts={manyContacts} job={normalJob} loading={false} onDraft={noop} onBack={noop} />,
  },
  {
    id: 'draft-zero',
    group: 'Draft editor',
    component: 'DraftEditor',
    label: 'No generated draft',
    description: 'Restored contact with generation deliberately deferred.',
    width: 320,
    render: () => draftScreen('draft-zero', { prebuiltDraft: null, deferGeneration: true }),
  },
  {
    id: 'draft-loading',
    group: 'Draft editor',
    component: 'DraftEditor',
    label: 'Draft loading',
    description: 'Generation remains pending with the real skeleton.',
    width: 380,
    render: () => draftScreen('draft-loading'),
    prepare: () => delay(150),
  },
  {
    id: 'draft-error',
    group: 'Draft editor',
    component: 'DraftEditor',
    label: 'Draft generation error',
    description: 'No draft exists after a backend error.',
    width: 320,
    render: () => draftScreen('draft-error'),
    prepare: async (root) => waitForText(root, 'Stress fixture could not generate this draft.'),
  },
  {
    id: 'draft-paywall',
    group: 'Draft editor',
    component: 'DraftEditor',
    label: 'Draft permission denied',
    description: 'Manual writing remains available after the premium action is denied.',
    width: 320,
    render: () => draftScreen('draft-paywall'),
    prepare: async (root) => {
      await waitForText(root, 'A new AI outreach draft is part of Litos+.');
      await waitForText(root, 'See Litos+');
    },
  },
  {
    id: 'draft-one',
    group: 'Draft editor',
    component: 'DraftEditor',
    label: 'One complete draft',
    description: 'Prebuilt draft with all edit and delivery controls.',
    width: 380,
    render: () => draftScreen('draft-one', { prebuiltDraft: normalDraft }),
  },
  {
    id: 'draft-long',
    group: 'Draft editor',
    component: 'DraftEditor',
    label: 'Long incomplete draft',
    description: 'Unbreakable subject, long body, warnings, and no reachable address at 320px.',
    width: 320,
    render: () => draftScreen('draft-long', {
      contact: incompleteContact as typeof normalContacts[number],
      job: longJob as typeof normalJob,
      prebuiltDraft: longDraft,
    }),
  },
  {
    id: 'draft-send-pending',
    group: 'Draft editor',
    component: 'DraftEditor',
    label: 'Mark sent pending',
    description: 'The tracking write stays pending and the action is disabled.',
    width: 380,
    render: () => draftScreen('draft-send-pending', { prebuiltDraft: normalDraft }),
    prepare: async (root) => {
      await waitForText(root, 'I sent it');
      findButton(root, 'I sent it').click();
      await waitForText(root, 'Saving');
      const pending = findButton(root, 'Saving', true);
      if (!pending.disabled) throw new Error('Expected mark-sent action to be disabled');
    },
  },
  {
    id: 'tracking-loading',
    group: 'Email tracking',
    component: 'TrackingDashboard',
    label: 'Events loading',
    description: 'History request remains pending with real skeleton rows.',
    width: 380,
    render: () => <TrackingDashboard token={tokenFor('tracking-loading')} onBack={noop} />,
    prepare: () => delay(150),
  },
  {
    id: 'tracking-error',
    group: 'Email tracking',
    component: 'TrackingDashboard',
    label: 'Events error',
    description: 'History error and zero-event fallback at 320px.',
    width: 320,
    render: () => <TrackingDashboard token={tokenFor('tracking-error')} onBack={noop} />,
    prepare: async (root) => waitForText(root, 'Stress fixture could not load outreach history.'),
  },
  {
    id: 'tracking-empty',
    group: 'Email tracking',
    component: 'TrackingDashboard',
    label: 'Zero events',
    description: 'No-email recovery action at 320px.',
    width: 320,
    render: () => <TrackingDashboard token={tokenFor('tracking-empty')} onBack={noop} />,
    prepare: async (root) => waitForText(root, 'No emails yet'),
  },
  {
    id: 'tracking-one',
    group: 'Email tracking',
    component: 'TrackingDashboard',
    label: 'One incomplete event',
    description: 'Sent event without subject or timestamp.',
    width: 380,
    render: () => <TrackingDashboard token={tokenFor('tracking-one')} onBack={noop} />,
    prepare: async (root) => waitForText(root, 'Not sent'),
  },
  {
    id: 'tracking-many',
    group: 'Email tracking',
    component: 'TrackingDashboard',
    label: `${stressApiCounts.events} events`,
    description: 'Many rows, all statuses, long subjects, and missing dates.',
    width: 380,
    render: () => <TrackingDashboard token={tokenFor('tracking-many')} onBack={noop} />,
    prepare: async (root) => waitForText(root, `${stressApiCounts.events} total`),
  },
  {
    id: 'tracking-update-pending',
    group: 'Email tracking',
    component: 'TrackingDashboard',
    label: 'Status update pending',
    description: 'Got a reply remains pending and both row actions are disabled.',
    width: 320,
    render: () => <TrackingDashboard token={tokenFor('tracking-update-pending')} onBack={noop} />,
    prepare: async (root) => {
      await waitForText(root, 'Got a reply');
      findButton(root, 'Got a reply').click();
      await waitForText(root, 'Marking');
      const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button'))
        .filter((button) => ['Marking', 'It bounced'].some((text) => normalizeText(button.textContent).startsWith(text)));
      if (buttons.length !== 2 || buttons.some((button) => !button.disabled)) {
        throw new Error('Expected both status actions to be disabled');
      }
    },
  },
  {
    id: 'plans-free',
    group: 'Plans',
    component: 'PlansScreen',
    label: 'Free plan',
    description: 'Plan choices and checkout action at 320px.',
    width: 320,
    render: () => <PlansScreen snapshot={freeSnapshot} onBack={noop} onContinue={async () => ({ ok: true })} onManageBilling={noop} />,
  },
  {
    id: 'plans-trial',
    group: 'Plans',
    component: 'PlansScreen',
    label: 'Trial plan',
    description: 'Trial account with the same term choices.',
    width: 380,
    render: () => <PlansScreen snapshot={trialSnapshot} onBack={noop} onContinue={async () => ({ ok: true })} onManageBilling={noop} />,
  },
  {
    id: 'plans-paid',
    group: 'Plans',
    component: 'PlansScreen',
    label: 'Paid plan',
    description: 'Term choices are replaced by Manage billing.',
    width: 380,
    render: () => <PlansScreen snapshot={paidSnapshot} onBack={noop} onContinue={async () => ({ ok: true })} onManageBilling={noop} />,
  },
  {
    id: 'plans-checkout-busy',
    group: 'Plans',
    component: 'PlansScreen',
    label: 'Checkout pending',
    description: 'The checkout promise stays pending and the primary action is disabled.',
    width: 320,
    render: () => (
      <PlansScreen
        snapshot={freeSnapshot}
        onBack={noop}
        onContinue={() => new Promise(() => undefined)}
        onManageBilling={noop}
      />
    ),
    prepare: async (root) => {
      const checkout = findButton(root, 'Continue with', true);
      checkout.click();
      await waitForText(root, 'Opening secure checkout...');
      if (!checkout.disabled) throw new Error('Expected checkout to be disabled while pending');
    },
  },
  {
    id: 'plans-checkout-error',
    group: 'Plans',
    component: 'PlansScreen',
    label: 'Checkout error',
    description: 'The real inline checkout error while plan choices remain usable.',
    width: 320,
    render: () => (
      <PlansScreen
        snapshot={freeSnapshot}
        onBack={noop}
        onContinue={async () => ({ ok: false, error: 'Stress fixture could not open checkout.' })}
        onManageBilling={noop}
      />
    ),
    prepare: async (root) => {
      findButton(root, 'Continue with', true).click();
      await waitForText(root, 'Stress fixture could not open checkout.');
    },
  },
];

function ScenarioSurface({ scenario }: { scenario: ScenarioDefinition }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'running' | 'ready' | 'driver-error'>('running');
  const [driverError, setDriverError] = useState<string | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let active = true;
    void (scenario.prepare ? scenario.prepare(root) : delay(100))
      .then(() => {
        if (active) setStatus('ready');
      })
      .catch((error) => {
        if (!active) return;
        const message = error instanceof Error ? error.message : String(error);
        setDriverError(message);
        setStatus('driver-error');
        console.error(`[stress:${scenario.id}] ${message}`);
      });
    return () => {
      active = false;
    };
  }, [scenario]);

  return (
    <div
      ref={rootRef}
      data-stress-root={scenario.id}
      data-stress-component={scenario.component}
      data-stress-status={status}
      data-stress-width={scenario.width}
      data-stress-driver-error={driverError ?? undefined}
      style={{
        width: '100%',
        height: 580,
        overflowY: 'auto',
        background: COLOR.surface,
        color: COLOR.ink,
        fontFamily: FONT.sans,
      }}
    >
      <div className="font-sans text-gray-950 antialiased" style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
        {scenario.render()}
      </div>
    </div>
  );
}

function scenarioUrl(id: string) {
  const url = new URL('/preview-stress.html', window.location.origin);
  url.searchParams.set('scenario', id);
  return url.toString();
}

function Gallery() {
  const grouped = useMemo(() => {
    const result = new Map<string, ScenarioDefinition[]>();
    for (const scenario of scenarios) {
      const group = result.get(scenario.group) ?? [];
      group.push(scenario);
      result.set(scenario.group, group);
    }
    return result;
  }, []);

  return (
    <main
      data-stress-gallery="popup"
      data-stress-scenario-count={scenarios.length}
      data-stress-dark-mode="skipped-unsupported"
      style={{
        minHeight: '100vh',
        padding: 28,
        background: COLOR.surfaceAlt,
        color: COLOR.ink,
        fontFamily: FONT.sans,
      }}
    >
      <header style={{ maxWidth: 920, marginBottom: 32 }}>
        <p style={{ margin: 0, color: COLOR.brandInk, fontFamily: FONT.mono, fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Dev-only stress gallery
        </p>
        <h1 style={{ margin: '10px 0 8px', fontSize: 32, lineHeight: 1.15, fontWeight: 500, letterSpacing: '-0.025em' }}>
          Litos extension popup states
        </h1>
        <p style={{ margin: 0, maxWidth: 820, color: COLOR.muted, fontSize: 15, lineHeight: 1.6 }}>
          {scenarios.length} isolated frames mount the real popup components at 320px and 380px. Each frame uses a browser-local, fail-closed API fixture and never connects to production data.
        </p>
        <div
          data-stress-exclusion="employer-injected-cards"
          style={{ marginTop: 16, padding: 14, border: `1px solid ${COLOR.border}`, borderRadius: RADIUS.inner, background: COLOR.surface, color: COLOR.muted, fontSize: 13, lineHeight: 1.55 }}
        >
          Employer-page cards are intentionally not recreated here. They are nested inside WXT content entrypoints and are not importable as real components. Test them with the built extension against local employer fixture pages. Dark mode is skipped because the extension does not support it.
        </div>
      </header>

      {Array.from(grouped.entries()).map(([group, groupScenarios]) => (
        <section key={group} data-stress-group={group} style={{ marginBottom: 40 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 500 }}>{group}</h2>
            <span style={{ color: COLOR.muted, fontFamily: FONT.mono, fontSize: 11 }}>{groupScenarios.length} states</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 24 }}>
            {groupScenarios.map((scenario) => (
              <article
                key={scenario.id}
                data-stress-card={scenario.id}
                data-stress-component={scenario.component}
                data-stress-width={scenario.width}
                style={{ width: scenario.width }}
              >
                <div style={{ minHeight: 76, marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{scenario.label}</h3>
                    <span style={{ flexShrink: 0, color: COLOR.muted, fontFamily: FONT.mono, fontSize: 10 }}>{scenario.width}px</span>
                  </div>
                  <p style={{ margin: '5px 0 0', color: COLOR.muted, fontSize: 12, lineHeight: 1.45 }}>{scenario.description}</p>
                </div>
                <div style={{ overflow: 'hidden', border: `1px solid ${COLOR.border}`, borderRadius: RADIUS.inner, background: COLOR.surface, boxShadow: SHADOW.raised }}>
                  <iframe
                    data-stress-frame={scenario.id}
                    title={`${scenario.label} stress state`}
                    src={scenarioUrl(scenario.id)}
                    width={scenario.width}
                    height="580"
                    style={{ display: 'block', border: 0, background: COLOR.surface }}
                  />
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}

const params = new URLSearchParams(window.location.search);
const scenarioId = params.get('scenario');
const activeScenario = scenarioId ? scenarios.find((scenario) => scenario.id === scenarioId) : undefined;

if (scenarioId) {
  installStressEnvironment(scenarioId);
  document.body.style.width = `${activeScenario?.width ?? 380}px`;
  document.body.style.height = '580px';
  document.body.style.overflow = 'hidden';
  document.body.style.background = COLOR.surface;
  document.title = activeScenario ? `${activeScenario.label} | Litos stress` : 'Unknown Litos stress state';
} else {
  document.body.style.background = COLOR.surfaceAlt;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  activeScenario ? (
    <ScenarioSurface scenario={activeScenario} />
  ) : scenarioId ? (
    <div
      data-stress-root={scenarioId}
      data-stress-status="driver-error"
      style={{ padding: 20, color: COLOR.danger, fontFamily: FONT.sans }}
    >
      Unknown stress scenario: {scenarioId}
    </div>
  ) : (
    <Gallery />
  ),
);
