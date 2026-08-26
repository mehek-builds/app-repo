import { describe, expect, it, vi } from 'vitest';
import { deliverAutofillEventWithStableId } from './autofill-event-delivery';

const payload = {
  ats_name: 'workable',
  job_context: { company: 'Retry Co', role: 'Engineer' },
  fields_filled: 4,
  fields_skipped: 1,
  auto_submitted: true,
};

describe('deliverAutofillEventWithStableId', () => {
  it('reuses one generated UUID when a transport failure is retried', async () => {
    const sent: unknown[] = [];
    const transport = vi.fn(async (body: Record<string, unknown>) => {
      sent.push(structuredClone(body));
      if (sent.length === 1) throw new TypeError('network connection lost');
      return { ok: true, status: 204 };
    });

    await deliverAutofillEventWithStableId(payload, transport, () => '11111111-1111-4111-8111-111111111111');

    expect(transport).toHaveBeenCalledTimes(2);
    expect(sent).toEqual([
      { ...payload, client_event_id: '11111111-1111-4111-8111-111111111111' },
      { ...payload, client_event_id: '11111111-1111-4111-8111-111111111111' },
    ]);
  });

  it('reuses the same UUID for a server-error retry', async () => {
    const sentIds: unknown[] = [];
    const transport = vi.fn(async (body: Record<string, unknown>) => {
      sentIds.push(body.client_event_id);
      return sentIds.length === 1
        ? { ok: false, status: 503 }
        : { ok: true, status: 204 };
    });

    await deliverAutofillEventWithStableId(payload, transport, () => '22222222-2222-4222-8222-222222222222');

    expect(sentIds).toEqual([
      '22222222-2222-4222-8222-222222222222',
      '22222222-2222-4222-8222-222222222222',
    ]);
  });

  it('does not retry a conflict response', async () => {
    const transport = vi.fn(async () => ({ ok: false, status: 409 }));

    const response = await deliverAutofillEventWithStableId(payload, transport, () => '33333333-3333-4333-8333-333333333333');

    expect(response.status).toBe(409);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('does not collapse separate reports with identical company and role values', async () => {
    const generated = [
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
    ];
    const sentIds: unknown[] = [];
    const transport = async (body: Record<string, unknown>) => {
      sentIds.push(body.client_event_id);
      return { ok: true, status: 204 };
    };

    await deliverAutofillEventWithStableId(payload, transport, () => generated.shift()!);
    await deliverAutofillEventWithStableId(payload, transport, () => generated.shift()!);

    expect(sentIds).toEqual([
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
    ]);
  });
});
