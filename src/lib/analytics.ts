import { EXTENSION_VERSION } from './product';
import { ANALYTICS_ID_KEY, ANALYTICS_QUEUE_KEY } from './storage-keys';

const POSTHOG_PROJECT_TOKEN = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN?.trim();
const POSTHOG_HOST = (import.meta.env.VITE_POSTHOG_HOST?.trim() || 'https://us.i.posthog.com').replace(/\/+$/, '');
const ANALYTICS_TIMEOUT_MS = 5000;
const ANALYTICS_QUEUE_LIMIT = 50;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AnalyticsPrimitive = string | number | boolean;
type PropertyValidator = (value: unknown) => AnalyticsPrimitive | undefined;

const booleanValue: PropertyValidator = (value) => typeof value === 'boolean' ? value : undefined;
const boundedCount: PropertyValidator = (value) =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1000 ? value : undefined;
const atsName: PropertyValidator = (value) =>
  typeof value === 'string' && ['ashby', 'bamboohr', 'breezy', 'generic', 'greenhouse', 'lever', 'linkedin', 'rippling', 'workday'].includes(value)
    ? value
    : undefined;
const authorization: PropertyValidator = (value) =>
  value === 'user_initiated' || value === 'standing_consent' ? value : undefined;
const submissionOutcome: PropertyValidator = (value) =>
  value === 'confirmed' || value === 'failed' || value === 'unknown' ? value : undefined;

const EVENT_PROPERTIES = {
  extension_opened: { authenticated: booleanValue },
  authentication_completed: { returning: booleanValue },
  job_detected: {},
  application_generation_completed: {},
  application_fill_completed: {
    ats_name: atsName,
    fields_filled: boundedCount,
    fields_skipped: boundedCount,
    auto_submitted: booleanValue,
  },
  application_submission_requested: { authorization },
  application_submission_outcome_recorded: { outcome: submissionOutcome },
  application_submission_completed: {},
  outreach_draft_created: { draft_count: boundedCount },
} as const satisfies Record<string, Record<string, PropertyValidator>>;

export type ExtensionAnalyticsEvent = keyof typeof EVENT_PROPERTIES;

type CapturePayload = {
  api_key: string;
  event: ExtensionAnalyticsEvent;
  properties: Record<string, AnalyticsPrimitive>;
  timestamp?: string;
  uuid?: string;
};

type QueuedCapture = {
  event: ExtensionAnalyticsEvent;
  distinctId: string;
  properties: unknown;
  timestamp: string;
  uuid: string;
};

function storageGet<T>(key: string): Promise<T | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve((result[key] as T | undefined) ?? null);
    });
  });
}

function storageSet(key: string, value: unknown): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, () => resolve(!chrome.runtime.lastError));
  });
}

let anonymousIdInFlight: Promise<string> | null = null;

async function anonymousId(): Promise<string> {
  if (anonymousIdInFlight) return anonymousIdInFlight;
  anonymousIdInFlight = (async () => {
    const existing = await storageGet<string>(ANALYTICS_ID_KEY);
    if (existing && UUID_PATTERN.test(existing)) return existing;

    const generated = crypto.randomUUID();
    const stored = await storageSet(ANALYTICS_ID_KEY, generated);
    return stored ? (await storageGet<string>(ANALYTICS_ID_KEY)) ?? generated : generated;
  })();
  try {
    return await anonymousIdInFlight;
  } finally {
    anonymousIdInFlight = null;
  }
}

function safeProperties(event: ExtensionAnalyticsEvent, candidate: unknown): Record<string, AnalyticsPrimitive> {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return {};
  const input = candidate as Record<string, unknown>;
  const output: Record<string, AnalyticsPrimitive> = {};

  for (const [key, validate] of Object.entries(EVENT_PROPERTIES[event]) as Array<[string, PropertyValidator]>) {
    const value = validate(input[key]);
    if (value !== undefined) output[key] = value;
  }
  return output;
}

export function buildCapturePayload(
  projectToken: string,
  event: ExtensionAnalyticsEvent,
  distinctId: string,
  properties: unknown = {},
): CapturePayload {
  return {
    api_key: projectToken,
    event,
    properties: {
      distinct_id: distinctId,
      surface: 'chrome_extension',
      extension_version: EXTENSION_VERSION,
      $lib: 'litos-extension',
      $lib_version: EXTENSION_VERSION,
      $process_person_profile: false,
      ...safeProperties(event, properties),
    },
  };
}

export function isExtensionAnalyticsEvent(event: unknown): event is ExtensionAnalyticsEvent {
  return typeof event === 'string' && Object.prototype.hasOwnProperty.call(EVENT_PROPERTIES, event);
}

function validQueuedCapture(value: unknown): value is QueuedCapture {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<QueuedCapture>;
  return isExtensionAnalyticsEvent(item.event)
    && typeof item.distinctId === 'string'
    && UUID_PATTERN.test(item.distinctId)
    && typeof item.timestamp === 'string'
    && Number.isFinite(Date.parse(item.timestamp))
    && typeof item.uuid === 'string'
    && UUID_PATTERN.test(item.uuid);
}

async function queuedCaptures(): Promise<QueuedCapture[]> {
  const stored = await storageGet<unknown[]>(ANALYTICS_QUEUE_KEY);
  return Array.isArray(stored) ? stored.filter(validQueuedCapture).slice(-ANALYTICS_QUEUE_LIMIT) : [];
}

async function sendCapture(item: QueuedCapture): Promise<boolean> {
  if (!POSTHOG_PROJECT_TOKEN) return false;
  const payload = buildCapturePayload(POSTHOG_PROJECT_TOKEN, item.event, item.distinctId, item.properties);
  payload.timestamp = item.timestamp;
  payload.uuid = item.uuid;

  try {
    const response = await fetch(`${POSTHOG_HOST}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
      signal: AbortSignal.timeout(ANALYTICS_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    // Analytics must never interrupt a student's application flow.
    return false;
  }
}

let queueOperation: Promise<unknown> = Promise.resolve();

function serializeQueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = queueOperation.then(operation, operation);
  queueOperation = result.then(() => undefined, () => undefined);
  return result;
}

async function drainQueue(queue: QueuedCapture[]): Promise<{ delivered: Set<string>; remaining: QueuedCapture[] }> {
  const delivered = new Set<string>();
  for (let index = 0; index < queue.length; index += 1) {
    if (!(await sendCapture(queue[index]))) return { delivered, remaining: queue.slice(index) };
    delivered.add(queue[index].uuid);
  }
  return { delivered, remaining: [] };
}

export async function flushAnalyticsQueue(): Promise<boolean> {
  if (!POSTHOG_PROJECT_TOKEN) return false;
  return serializeQueue(async () => {
    const queue = await queuedCaptures();
    if (queue.length === 0) return true;
    const { remaining } = await drainQueue(queue);
    await storageSet(ANALYTICS_QUEUE_KEY, remaining);
    return remaining.length === 0;
  });
}

export async function trackExtensionEvent(event: unknown, properties: unknown = {}): Promise<boolean> {
  if (!POSTHOG_PROJECT_TOKEN || !isExtensionAnalyticsEvent(event)) return false;

  const item: QueuedCapture = {
    event,
    distinctId: await anonymousId(),
    properties: safeProperties(event, properties),
    timestamp: new Date().toISOString(),
    uuid: crypto.randomUUID(),
  };

  return serializeQueue(async () => {
    const queue = [...await queuedCaptures(), item].slice(-ANALYTICS_QUEUE_LIMIT);
    if (!(await storageSet(ANALYTICS_QUEUE_KEY, queue))) return sendCapture(item);
    const { delivered, remaining } = await drainQueue(queue);
    await storageSet(ANALYTICS_QUEUE_KEY, remaining);
    return delivered.has(item.uuid);
  });
}
