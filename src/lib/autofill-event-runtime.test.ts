import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const background = readFileSync(new URL('../entrypoints/background.ts', import.meta.url), 'utf8');

describe('autofill event delivery wiring', () => {
  it('wraps the backend POST in stable-ID delivery instead of retrying a raw payload', () => {
    const handler = background.slice(
      background.indexOf("case 'AUTOFILL_EVENT':"),
      background.indexOf("case 'APPLICATION_PACKET_REVIEW_REQUIRED':"),
    );

    expect(handler).toContain('deliverAutofillEventWithStableId(message.payload');
    expect(handler).toContain("timeoutBackendFetch('/autofill/event'");
    expect(handler).toContain('body: JSON.stringify(stablePayload)');
    expect(handler).not.toContain('body: JSON.stringify(message.payload)');
  });
});
