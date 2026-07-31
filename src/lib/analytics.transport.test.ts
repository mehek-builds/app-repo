import { beforeEach, describe, expect, it, vi } from 'vitest';

const values: Record<string, unknown> = {};
let storageError: string | null = null;
const fetchMock = vi.fn();

Object.defineProperty(globalThis, 'chrome', {
  configurable: true,
  value: {
    runtime: {
      get lastError() {
        return storageError ? { message: storageError } : undefined;
      },
      getManifest: () => ({ version: '0.5.9' }),
    },
    storage: {
      local: {
        get: vi.fn((key: string, callback: (result: Record<string, unknown>) => void) => {
          callback(key in values ? { [key]: values[key] } : {});
        }),
        set: vi.fn((patch: Record<string, unknown>, callback: () => void) => {
          if (!storageError) Object.assign(values, patch);
          callback();
        }),
      },
    },
  },
});

vi.stubGlobal('fetch', fetchMock);

async function analytics(token = 'public-project-token') {
  vi.resetModules();
  vi.stubEnv('VITE_POSTHOG_PROJECT_TOKEN', token);
  vi.stubEnv('VITE_POSTHOG_HOST', 'https://us.i.posthog.com');
  return import('./analytics');
}

describe('extension analytics transport', () => {
  beforeEach(() => {
    for (const key of Object.keys(values)) delete values[key];
    storageError = null;
    fetchMock.mockReset();
    vi.unstubAllEnvs();
  });

  it('posts a sanitized event through the PostHog capture endpoint', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const { trackExtensionEvent } = await analytics();

    await expect(trackExtensionEvent('application_fill_completed', {
      ats_name: 'greenhouse',
      fields_filled: 8,
      company: 'Sensitive Company',
    })).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://us.i.posthog.com/capture/');
    expect(request).toMatchObject({ method: 'POST', keepalive: true });
    const payload = JSON.parse(String(request.body));
    expect(payload.event).toBe('application_fill_completed');
    expect(payload.properties).toMatchObject({ surface: 'chrome_extension', ats_name: 'greenhouse', fields_filled: 8 });
    expect(payload.properties).not.toHaveProperty('company');
  });

  it('stays disabled when a release token is absent', async () => {
    const { trackExtensionEvent } = await analytics('');
    await expect(trackExtensionEvent('extension_opened')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('contains network, response, and storage failures', async () => {
    const { trackExtensionEvent } = await analytics();
    fetchMock.mockResolvedValueOnce({ ok: false });
    await expect(trackExtensionEvent('extension_opened')).resolves.toBe(false);

    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(trackExtensionEvent('extension_opened')).resolves.toBe(false);

    storageError = 'Storage is unavailable';
    fetchMock.mockResolvedValueOnce({ ok: true });
    await expect(trackExtensionEvent('extension_opened')).resolves.toBe(true);
  });

  it('uses one identity when first-run events arrive concurrently', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const uuid = vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000003');
    const { trackExtensionEvent } = await analytics();

    await Promise.all([
      trackExtensionEvent('extension_opened'),
      trackExtensionEvent('job_detected'),
    ]);

    const ids = fetchMock.mock.calls.map(([, request]) => JSON.parse(String((request as RequestInit).body)).properties.distinct_id);
    expect(new Set(ids)).toEqual(new Set(['00000000-0000-4000-8000-000000000001']));
    uuid.mockRestore();
  });

  it('keeps failed events in a bounded outbox and retries them later', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false });
    const { flushAnalyticsQueue, trackExtensionEvent } = await analytics();

    await expect(trackExtensionEvent('job_detected')).resolves.toBe(false);
    expect(values.litos_posthog_event_queue).toHaveLength(1);

    fetchMock.mockResolvedValueOnce({ ok: true });
    await expect(flushAnalyticsQueue()).resolves.toBe(true);
    expect(values.litos_posthog_event_queue).toEqual([]);
  });
});
