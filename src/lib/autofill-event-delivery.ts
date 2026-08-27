export type AutofillEventPayload = Record<string, unknown>;

export type AutofillEventTransportResponse = {
  ok: boolean;
  status: number;
};

type AutofillEventTransport<TResponse extends AutofillEventTransportResponse> = (
  payload: AutofillEventPayload & { client_event_id: string },
) => Promise<TResponse>;

/**
 * Give one report a stable identity and preserve it across transport retries.
 * Separate invocations always get separate IDs, even when their field values are identical.
 */
export async function deliverAutofillEventWithStableId<TResponse extends AutofillEventTransportResponse>(
  payload: AutofillEventPayload,
  transport: AutofillEventTransport<TResponse>,
  newEventId: () => string = () => crypto.randomUUID(),
): Promise<TResponse> {
  const stablePayload = {
    ...payload,
    client_event_id: newEventId(),
  };
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await transport(stablePayload);
      if (response.ok || response.status < 500 || attempt === 1) return response;
    } catch (error) {
      lastError = error;
      if (attempt === 1) throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Autofill event delivery failed');
}
