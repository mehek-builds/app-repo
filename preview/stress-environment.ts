import {
  manyContacts,
  manyEvents,
  manyExperienceEntries,
  normalContacts,
  normalDraft,
  normalEvents,
  normalProfile,
  stressApplicationProfile,
} from './stress-fixtures';

const API_PATHS = new Set([
  '/applications',
  '/auth/request-code',
  '/auth/session',
  '/auth/verify-code',
  '/draft',
  '/onboarding/automation',
  '/onboarding/state',
  '/profile',
  '/profile/application',
  '/profile/experience-bank',
  '/resolve',
  '/track/event',
  '/track/events',
]);

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function pendingResponse(): Promise<Response> {
  return new Promise<Response>(() => undefined);
}

function errorResponse(error: string, status = 503, code = 'server_error'): Response {
  return jsonResponse({ error, code, request_id: 'stress-fixture-request' }, status);
}

function resolvePayload() {
  return {
    contacts: normalContacts.map((contact) => ({
      contact: {
        id: contact.id,
        full_name: contact.full_name,
        title: contact.title,
        persona: contact.persona,
        school_match: contact.school_match,
        linkedin_url: contact.linkedin_url ?? '',
        company_domain: contact.company_domain,
      },
      email_resolution: {
        email: contact.email ?? '',
        status: contact.status,
        tier: contact.tier,
      },
    })),
  };
}

function setupUsesSavedBank(scenario: string): boolean {
  return [
    'setup-many',
    'setup-links-free',
    'setup-links-ineligible',
    'setup-links-eligible',
    'setup-saving',
    'setup-done',
    'setup-save-error',
    'setup-signout-confirm',
  ].includes(scenario);
}

function setupIsEligible(scenario: string): boolean {
  return [
    'setup-links-eligible',
    'setup-saving',
    'setup-done',
    'setup-save-error',
    'setup-signout-confirm',
  ].includes(scenario);
}

function installChromePreviewSurface() {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) return;

  const localValues: Record<string, unknown> = {};
  const sessionValues: Record<string, unknown> = {};

  const storageArea = (values: Record<string, unknown>) => ({
    get(
      keys: string | string[] | Record<string, unknown> | null,
      callback?: (items: Record<string, unknown>) => void,
    ) {
      let result: Record<string, unknown>;
      if (keys === null) {
        result = { ...values };
      } else if (typeof keys === 'string') {
        result = { [keys]: values[keys] };
      } else if (Array.isArray(keys)) {
        result = Object.fromEntries(keys.map((key) => [key, values[key]]));
      } else {
        result = Object.fromEntries(
          Object.entries(keys).map(([key, fallback]) => [key, values[key] ?? fallback]),
        );
      }
      callback?.(result);
      return Promise.resolve(result);
    },
    set(items: Record<string, unknown>, callback?: () => void) {
      Object.assign(values, items);
      callback?.();
      return Promise.resolve();
    },
    remove(keys: string | string[], callback?: () => void) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
      callback?.();
      return Promise.resolve();
    },
    clear(callback?: () => void) {
      for (const key of Object.keys(values)) delete values[key];
      callback?.();
      return Promise.resolve();
    },
  });

  Object.assign(globalThis, {
    chrome: {
      storage: {
        local: storageArea(localValues),
        session: storageArea(sessionValues),
      },
      runtime: {
        lastError: undefined,
        sendMessage(_message: unknown, callback?: (response: unknown) => void) {
          const response = { ok: true };
          callback?.(response);
          return Promise.resolve(response);
        },
        onMessage: {
          addListener() {},
          removeListener() {},
        },
      },
      tabs: {
        query(_info: unknown, callback?: (tabs: unknown[]) => void) {
          const tabs: unknown[] = [];
          callback?.(tabs);
          return Promise.resolve(tabs);
        },
        create(_properties: unknown, callback?: () => void) {
          callback?.();
          return Promise.resolve();
        },
      },
      scripting: {
        executeScript() {
          return Promise.resolve([]);
        },
      },
    },
  });
}

function installFailClosedStressApi(scenario: string) {
  const nativeFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request?.url ?? String(input), window.location.href);
    if (!API_PATHS.has(url.pathname)) return nativeFetch(input, init);

    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();

    if (url.pathname === '/auth/request-code') return jsonResponse({ sent: true });
    if (url.pathname === '/auth/session') return jsonResponse({ token: 'stress-onboarding-token' });
    if (url.pathname === '/auth/verify-code') return jsonResponse({ token: 'stress-onboarding-token' });

    if (url.pathname === '/profile' && method === 'POST') {
      if (scenario === 'onboarding-uploading') return pendingResponse();
      return jsonResponse(normalProfile);
    }
    if (url.pathname === '/profile') return jsonResponse(normalProfile);

    if (url.pathname === '/track/events') {
      if (scenario === 'tracking-loading') return pendingResponse();
      if (scenario === 'tracking-error' || scenario === 'main-events-error') {
        return errorResponse('Stress fixture could not load outreach history.');
      }
      if (scenario === 'tracking-empty' || scenario === 'main-empty') return jsonResponse([]);
      if (scenario === 'tracking-many' || scenario === 'main-long') return jsonResponse(manyEvents);
      if (scenario === 'tracking-one' || scenario === 'tracking-update-pending') {
        return jsonResponse([{ ...normalEvents[0], status: 'sent', subject: undefined, sent_at: undefined }]);
      }
      return jsonResponse(normalEvents);
    }

    if (url.pathname === '/track/event') {
      if (scenario === 'tracking-update-pending' || scenario === 'draft-send-pending') {
        return pendingResponse();
      }
      return jsonResponse({});
    }

    if (url.pathname === '/applications') {
      return jsonResponse({ application: { id: 'stress-application' } });
    }

    if (url.pathname === '/resolve') {
      if (scenario === 'main-find-loading') return pendingResponse();
      if (scenario === 'main-paywall') {
        return errorResponse(
          'Contact discovery is locked for this account.',
          402,
          'feature_locked',
        );
      }
      if (scenario === 'main-resolve-error') {
        return errorResponse('Stress fixture could not resolve contacts.');
      }
      return jsonResponse(resolvePayload());
    }

    if (url.pathname === '/draft') {
      if (scenario === 'draft-loading') return pendingResponse();
      if (scenario === 'draft-error') return errorResponse('Stress fixture could not generate this draft.');
      if (scenario === 'draft-paywall') {
        return errorResponse(
          'Outreach generation is locked for this account.',
          402,
          'feature_locked',
        );
      }
      return jsonResponse(normalDraft);
    }

    if (url.pathname === '/profile/experience-bank') {
      if (method === 'PUT') {
        if (scenario === 'setup-saving') return pendingResponse();
        return jsonResponse({ entries: setupUsesSavedBank(scenario) ? manyExperienceEntries : [] });
      }
      if (scenario === 'setup-loading') return pendingResponse();
      if (scenario === 'setup-load-error') {
        return errorResponse('Stress fixture could not load your setup data.');
      }
      if (scenario === 'setup-many') return jsonResponse({ entries: manyExperienceEntries });
      if (setupUsesSavedBank(scenario)) return jsonResponse({ entries: [manyExperienceEntries[0]] });
      return jsonResponse({ entries: [] });
    }

    if (url.pathname === '/profile/application') {
      if (method === 'PUT') return jsonResponse(stressApplicationProfile);
      if (scenario === 'setup-loading') return pendingResponse();
      if (scenario === 'setup-empty') {
        return errorResponse('No application profile exists yet.', 404, 'validation_failed');
      }
      return jsonResponse(stressApplicationProfile);
    }

    if (url.pathname === '/onboarding/state') {
      if (scenario === 'setup-loading') return pendingResponse();
      return jsonResponse({
        automatic_submission_enabled: false,
        automatic_verification_enabled: false,
        standing_consent_eligibility: {
          eligible: setupIsEligible(scenario),
          reviewed_submits: setupIsEligible(scenario) ? 3 : 0,
          required: 3,
          remaining: setupIsEligible(scenario) ? 0 : 3,
        },
      });
    }

    if (url.pathname === '/onboarding/automation') {
      if (scenario === 'setup-save-error') {
        return errorResponse(
          'Your answers were saved, but the automation permission could not be changed.',
          403,
          'validation_failed',
        );
      }
      return jsonResponse({
        automatic_submission_enabled: false,
        automatic_verification_enabled: false,
        standing_consent_eligibility: {
          eligible: setupIsEligible(scenario),
          reviewed_submits: setupIsEligible(scenario) ? 3 : 0,
          required: 3,
          remaining: setupIsEligible(scenario) ? 0 : 3,
        },
      });
    }

    return errorResponse(`No stress fixture exists for ${method} ${url.pathname}`, 500);
  };
}

export function installStressEnvironment(scenario: string) {
  installChromePreviewSurface();
  installFailClosedStressApi(scenario);
}

export const stressApiCounts = {
  contacts: manyContacts.length,
  events: manyEvents.length,
  experienceEntries: manyExperienceEntries.length,
} as const;
