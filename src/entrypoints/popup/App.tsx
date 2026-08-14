import React, { useState, useEffect } from 'react';
import { getToken, getProfile } from '../../lib/storage';
import {
  clearCachedEntitlements,
  parseEntitlementSnapshot,
  preferNewerEntitlementSnapshot,
  readCachedEntitlements,
  type EntitlementSnapshotV2,
} from '../../lib/entitlements';
import type { LitosPlusPlanId } from '../../lib/pricing';
import {
  sanitizeExtensionPremiumAction,
  type OutreachPremiumActionContext,
} from '../../lib/extension-premium-action';
import { requestBackgroundSessionClear } from '../../lib/popup-session';
import type { Contact, Draft, JobContext, OutreachDraftType, PendingDraft, Profile, Screen, Tier, ContactStatus } from '../../lib/types';
import OnboardingScreen from '../../components/OnboardingScreen';
import MainScreen from '../../components/MainScreen';
import ContactList from '../../components/ContactList';
import DraftEditor from '../../components/DraftEditor';
import TrackingDashboard from '../../components/TrackingDashboard';
import AutofillSetupScreen from '../../components/AutofillSetupScreen';
import LoadingSpinner from '../../components/LoadingSpinner';
import PlansScreen from '../../components/PlansScreen';

// Background-stored contacts omit the UI-only `status` field; derive it from the email tier
// so the pre-built-draft contacts render identically to freshly resolved ones.
function statusFromTier(tier: Tier): ContactStatus {
  return tier === 'green' ? 'verified' : tier === 'amber' ? 'likely' : 'linkedin_only';
}

function normalizeContact(c: Contact): Contact {
  return { ...c, status: c.status ?? statusFromTier(c.tier) };
}

type JobPlansActionContext = {
  application_id?: string;
  company: string;
  role: string;
  portal_url?: string;
};
type PlansActionContext = JobPlansActionContext | OutreachPremiumActionContext;

type RestoredOutreachAction = {
  operationId: string;
  draftType: OutreachDraftType;
  draftSubject: string;
  draftBody: string;
};

export default function App() {
  const retryParams = new URLSearchParams(window.location.search);
  const retryAction = retryParams.get('retry_action');
  const retryActionNonce = retryParams.get('action_nonce')?.trim() ?? '';
  const retryCompany = retryParams.get('company')?.trim() ?? '';
  const retryRole = retryParams.get('role')?.trim() ?? '';
  const retryApplicationId = retryParams.get('application_id')?.trim() ?? '';
  const [screen, setScreen] = useState<Screen>('onboarding');
  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [job, setJob] = useState<JobContext | null>(
    retryAction === 'contact_discovery' && retryCompany && retryRole
      ? {
          ...(retryApplicationId ? { application_id: retryApplicationId } : {}),
          company: retryCompany,
          role: retryRole,
        }
      : null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [pendingDraftCount, setPendingDraftCount] = useState(0);
  const [pendingDrafts, setPendingDrafts] = useState<PendingDraft[]>([]);
  // Pre-built drafts keyed by contact id, consumed by DraftEditor so it shows the
  // background-generated draft instead of re-calling /draft.
  const [prebuiltDrafts, setPrebuiltDrafts] = useState<Record<string, Draft>>({});
  const [entitlements, setEntitlements] = useState<EntitlementSnapshotV2 | null>(null);
  const [plansReturnScreen, setPlansReturnScreen] = useState<Screen>('main');
  const [plansTrigger, setPlansTrigger] = useState('manual');
  const [plansActionContext, setPlansActionContext] = useState<PlansActionContext | null>(null);
  const [restoredOutreachAction, setRestoredOutreachAction] = useState<RestoredOutreachAction | null>(null);

  // On popup open: check auth state
  useEffect(() => {
    (async () => {
      try {
        const [storedToken, storedProfile] = await Promise.all([
          getToken(),
          getProfile(),
        ]);
        if (storedToken && storedProfile) {
          setToken(storedToken);
          setProfile(storedProfile);
          if (retryAction === 'outreach_email_generation' && retryActionNonce) {
            const restored = await new Promise<{
              ok?: boolean;
              action?: {
                application_id?: unknown;
                contact?: unknown;
                job?: { application_id?: unknown; company?: unknown; role?: unknown; url?: unknown };
                operation_id?: unknown;
                draft_type?: unknown;
                draft_subject?: unknown;
                draft_body?: unknown;
              };
            } | undefined>((resolve) => {
              chrome.runtime.sendMessage({
                type: 'GET_PREMIUM_RETRY_ACTION_CONTEXT',
                action_nonce: retryActionNonce,
              }, (response) => {
                void chrome.runtime.lastError;
                resolve(response);
              });
            });
            const action = restored?.action;
            const sanitized = restored?.ok ? sanitizeExtensionPremiumAction('outreach_email_generation', {
              application_id: action?.application_id ?? action?.job?.application_id,
              contact_id: (action?.contact as { id?: unknown } | undefined)?.id,
              contact: action?.contact,
              company: action?.job?.company,
              role: action?.job?.role,
              ...(action?.job?.url === undefined ? {} : { portal_url: action.job.url }),
              operation_id: action?.operation_id,
              draft_type: action?.draft_type,
              draft_subject: action?.draft_subject,
              draft_body: action?.draft_body,
            }) : null;
            if (
              sanitized?.screen === 'draft'
              && sanitized.contact
              && sanitized.operation_id
              && sanitized.company
              && sanitized.role
            ) {
              setSelectedContact(sanitized.contact);
              setJob({
                application_id: sanitized.application_id,
                company: sanitized.company,
                role: sanitized.role,
                ...(sanitized.portal_url ? { url: sanitized.portal_url } : {}),
              });
              setRestoredOutreachAction({
                operationId: sanitized.operation_id,
                draftType: sanitized.draft_type ?? 'first_note',
                draftSubject: sanitized.draft_subject ?? '',
                draftBody: sanitized.draft_body ?? '',
              });
              setScreen('draft');
            } else {
              setScreen('main');
            }
          } else {
            setScreen(retryAction === 'automatic_submission' ? 'autofill-setup' : 'main');
          }
        } else {
          setScreen('onboarding');
        }
        void chrome.runtime.sendMessage({
          type: 'ANALYTICS_EVENT',
          event: 'extension_opened',
          properties: { authenticated: Boolean(storedToken && storedProfile) },
        }).catch(() => {});
      } catch {
        setScreen('onboarding');
      } finally {
        setIsLoading(false);
      }
    })();
  }, [retryAction, retryActionNonce]);

  useEffect(() => {
    if (!token) {
      setEntitlements(null);
      return;
    }
    let active = true;
    void readCachedEntitlements()
      .then((cached) => {
        if (active && cached) {
          setEntitlements((current) => preferNewerEntitlementSnapshot(current, cached.snapshot));
        }
      })
      .catch(() => {});
    chrome.runtime.sendMessage({ type: 'GET_ENTITLEMENTS' }, (response) => {
      if (!active || chrome.runtime.lastError || !response?.snapshot) return;
      try {
        const snapshot = parseEntitlementSnapshot(response.snapshot);
        setEntitlements((current) => preferNewerEntitlementSnapshot(current, snapshot));
      } catch {
        // A missing plan response never blocks Free filling. Premium actions still fail closed
        // at the backend, and the popup keeps the last fresh account-scoped display state.
      }
    });
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    const handler = (message: { type?: string; snapshot?: unknown }) => {
      if (message.type !== 'ENTITLEMENTS_UPDATED' || !message.snapshot) return;
      if (!token) return;
      try {
        const snapshot = parseEntitlementSnapshot(message.snapshot);
        setEntitlements((current) => preferNewerEntitlementSnapshot(current, snapshot));
      } catch {
        // Ignore an invalid broadcast. Live premium actions still refresh in the background.
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, [token]);

  // On popup open: fetch detected job + pending drafts from background
  useEffect(() => {
    if (screen !== 'main') return;
    chrome.runtime.sendMessage({ type: 'GET_LAST_JOB' }, (response) => {
      if (response?.job && retryAction !== 'contact_discovery') {
        setJob({ company: response.job.company, role: response.job.title, url: response.job.url });
      }
    });
    chrome.runtime.sendMessage({ type: 'GET_PENDING_DRAFTS' }, (response) => {
      if (response?.drafts?.length) {
        setPendingDrafts(response.drafts as PendingDraft[]);
        setPendingDraftCount(response.drafts.length);
      }
    });
    chrome.runtime.sendMessage({ type: 'CLEAR_JOB_BADGE' });
  }, [screen, retryAction]);

  // Listen for drafts ready while popup is open. The DRAFTS_READY ping only carries a count,
  // so re-fetch the full payload from the background to keep pendingDrafts in sync.
  useEffect(() => {
    const handler = (message: { type: string; payload?: { count: number } }) => {
      if (message.type === 'DRAFTS_READY') {
        setPendingDraftCount(message.payload?.count ?? 1);
        chrome.runtime.sendMessage({ type: 'GET_PENDING_DRAFTS' }, (response) => {
          if (response?.drafts?.length) setPendingDrafts(response.drafts as PendingDraft[]);
        });
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  // Also listen for live detections while popup is open
  useEffect(() => {
    const handler = (message: { type: string; payload: { title: string; company: string; url: string } }) => {
      if (message.type === 'JOB_DETECTED' && screen === 'main' && retryAction !== 'contact_discovery') {
        setJob({ company: message.payload.company, role: message.payload.title, url: message.payload.url });
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, [screen, retryAction]);

  const handleOnboardingComplete = (newProfile: Profile, newToken: string, returning = false) => {
    setToken(newToken);
    setProfile(newProfile);
    void chrome.runtime.sendMessage({
      type: 'ANALYTICS_EVENT',
      event: 'authentication_completed',
      properties: { returning },
    }).catch(() => {});
    // Someone signing back in already did setup. Sending them through it again was the whole
    // reason the extension had no sign-in path to begin with.
    if (returning) {
      setScreen('main');
      return;
    }
    // Route straight into autofill setup at JOIN time so work-auth, EEO, DOB, salary, and links
    // are collected once, up front - never asked mid-application. That keeps the first (and
    // every) fill instant: the adapter only ever reads stored data or skips, it never prompts.
    setScreen('autofill-setup');
  };

  const handleContactsFound = (found: Contact[], jobCtx: JobContext) => {
    setContacts(found);
    setJob(jobCtx);
    setScreen('contacts');
  };

  // Tapping the "drafts ready" banner: open the contacts list populated with the people the
  // background already drafted for, with each pre-built draft available so opening a contact
  // shows it instantly. Clear the badge but keep the data in React state for this session.
  const handleViewDrafts = () => {
    if (pendingDrafts.length === 0) return;
    setContacts(pendingDrafts.map((pd) => normalizeContact(pd.contact)));
    setJob(pendingDrafts[0].job);
    setPrebuiltDrafts(
      Object.fromEntries(pendingDrafts.map((pd) => [pd.contact.id, pd.draft])),
    );
    setScreen('contacts');
    setPendingDraftCount(0);
    chrome.runtime.sendMessage({ type: 'CLEAR_PENDING_DRAFTS' });
  };

  const handleDraft = (contact: Contact) => {
    setSelectedContact(contact);
    setScreen('draft');
  };

  const handleLogout = async () => {
    await requestBackgroundSessionClear();
    await clearCachedEntitlements().catch(() => {});
    setToken(null);
    setProfile(null);
    setContacts([]);
    setSelectedContact(null);
    setJob(null);
    setEntitlements(null);
    setScreen('onboarding');
  };

  const openPlans = (trigger = 'manual', actionContext?: PlansActionContext) => {
    setPlansReturnScreen(screen === 'plans' ? 'main' : screen);
    setPlansTrigger(trigger);
    setPlansActionContext(actionContext ?? (
      (trigger === 'contact_discovery' || trigger === 'outreach_email_generation') && job
        ? {
            ...(job.application_id ? { application_id: job.application_id } : {}),
            company: job.company,
            role: job.role,
            ...(job.url ? { portal_url: job.url } : {}),
          }
        : null
    ));
    setScreen('plans');
  };

  const openWebsitePlan = (
    planId: LitosPlusPlanId,
    trigger: string,
  ): Promise<{ ok: boolean; error?: string }> => new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: 'OPEN_LITOS_PLANS',
      plan_id: planId,
      trigger,
      ...(plansActionContext ? { action_context: plansActionContext } : {}),
    }, (response: { ok?: boolean; error?: string } | undefined) => {
      const runtimeError = chrome.runtime.lastError?.message;
      resolve(response?.ok === true
        ? { ok: true }
        : { ok: false, error: response?.error ?? runtimeError ?? 'Litos+ options could not open.' });
    });
  });

  const openBillingManagement = () => {
    chrome.runtime.sendMessage({ type: 'OPEN_BILLING_PORTAL' }, () => {
      void chrome.runtime.lastError;
    });
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[200px] w-[380px] items-center justify-center bg-white font-sans">
        <LoadingSpinner size="md" message="Loading Litos…" />
      </div>
    );
  }

  const visibleScreen = screen === 'plans' ? plansReturnScreen : screen;

  return (
    <div className="relative flex h-[580px] w-[380px] flex-col overflow-y-auto bg-white font-sans text-gray-950 antialiased">
      {visibleScreen === 'onboarding' && (
        <OnboardingScreen onComplete={handleOnboardingComplete} />
      )}

      {visibleScreen === 'main' && token && profile && (
        <MainScreen
          token={token}
          detectedJob={job}
          pendingDraftCount={pendingDraftCount}
          onViewDrafts={handleViewDrafts}
          onContactsFound={handleContactsFound}
          onViewTracking={() => setScreen('tracking')}
          onViewAutofillSetup={() => setScreen('autofill-setup')}
          entitlements={entitlements}
          onViewPlans={openPlans}
          userSchool={profile.school}
          focusContactDiscovery={retryAction === 'contact_discovery'}
        />
      )}

      {visibleScreen === 'autofill-setup' && token && profile && (
        <AutofillSetupScreen
          token={token}
          profile={profile}
          entitlements={entitlements}
          focusAutomaticSubmission={retryAction === 'automatic_submission'}
          onViewPlans={() => openPlans('automatic_submission')}
          onBack={() => setScreen('main')}
          onLogout={handleLogout}
        />
      )}

      {visibleScreen === 'contacts' && token && job && (
        <ContactList
          contacts={contacts}
          job={job}
          loading={false}
          onDraft={handleDraft}
          onBack={() => setScreen('main')}
        />
      )}

      {visibleScreen === 'draft' && token && profile && selectedContact && job && (
        <DraftEditor
          contact={selectedContact}
          job={job}
          token={token}
          profile={profile}
          prebuiltDraft={prebuiltDrafts[selectedContact.id] ?? null}
          onViewPlans={(actionContext) => openPlans('outreach_email_generation', actionContext)}
          deferGeneration={Boolean(restoredOutreachAction)}
          focusGenerate={Boolean(restoredOutreachAction)}
          operationIdOverride={restoredOutreachAction?.operationId}
          initialDraftType={restoredOutreachAction?.draftType}
          initialSubject={restoredOutreachAction?.draftSubject}
          initialBody={restoredOutreachAction?.draftBody}
          onBack={() => setScreen(restoredOutreachAction ? 'main' : 'contacts')}
          onDraftAnother={() => setScreen(restoredOutreachAction ? 'main' : 'contacts')}
        />
      )}

      {visibleScreen === 'tracking' && token && (
        <TrackingDashboard
          token={token}
          onBack={() => setScreen('main')}
        />
      )}

      {screen === 'plans' && token && (
        <div className="absolute inset-0 z-50 overflow-y-auto bg-white" role="dialog" aria-modal="true" aria-label="Litos+ plans">
          <PlansScreen
            snapshot={entitlements}
            trigger={plansTrigger}
            onBack={() => setScreen(plansReturnScreen)}
            onContinue={openWebsitePlan}
            onManageBilling={openBillingManagement}
          />
        </div>
      )}
    </div>
  );
}
