import { describe, expect, it, vi } from 'vitest';
import {
  deliverPersistedSubmissionOutcome,
  greenhouseReceiptBindingMatches,
  parseSubmissionOutcomeOutbox,
  persistAndDeliverSubmissionOutcome,
  sanitizeSubmissionOutcomeConfirmation,
  sanitizeSubmissionOutcomeUrl,
  submissionOutcomeLogoutCanPurge,
  submissionOutcomeReceiptVisibility,
  SUBMISSION_OUTCOME_OUTBOX_MAX_ENTRIES,
  SUBMISSION_OUTCOME_LATE_OBSERVATION_MS,
  SubmissionOutcomeOutbox,
  WORKABLE_RECEIPT_TEXT,
  type SubmissionOutcomeInput,
  type SubmissionOutcomeOutboxStorage,
  type SubmissionOutcomeOutboxValue,
} from './submission-outcome-outbox';

const ACCOUNT_ID = '123e4567-e89b-42d3-a456-426614174000';
const APPLICATION_ID = '223e4567-e89b-42d3-a456-426614174000';
const CLAIM_ID = '323e4567-e89b-42d3-a456-426614174000';
const EVENT_ID = '423e4567-e89b-42d3-a456-426614174000';
const LEASE_ID = '523e4567-e89b-42d3-a456-426614174000';
const ACTIVATION_ID = '623e4567-e89b-42d3-a456-426614174000';
const NOW = Date.parse('2026-08-27T12:00:00.000Z');
const START_URL = 'https://apply.workable.com/acme/j/1234abcdef/apply/';
const FINAL_URL = `${START_URL}?success`;
const PROOF = {
  version: 1,
  family: 'workable',
  state: 'application_submitted',
  evidence: 'workable_successful_submit',
  form_still_present: false,
} as const;
const GREENHOUSE_START_URL = 'https://job-boards.greenhouse.io/acme/jobs/1234567';
const GREENHOUSE_FINAL_URL = `${GREENHOUSE_START_URL}/confirmation`;
const GREENHOUSE_PROOF = {
  version: 1,
  family: 'greenhouse',
  state: 'application_submitted',
  evidence: 'greenhouse_confirmation_content',
  form_still_present: false,
} as const;

function confirmedExtensionAck(applicationId = APPLICATION_ID, claimId = CLAIM_ID) {
  return {
    application_id: applicationId,
    attempt_id: claimId,
    outcome: 'confirmed',
    review: { status: 'submitted' },
    retry_safety: { kind: 'blocked_confirmed', attemptId: claimId },
    resolved_attempt_retry_safety: { kind: 'blocked_confirmed', attemptId: claimId },
  };
}

function confirmedFreeAck(applicationId = APPLICATION_ID, eventId = EVENT_ID) {
  return {
    application_id: applicationId,
    event_id: eventId,
    outcome: 'confirmed',
    resolved_attempt_retry_safety: { kind: 'blocked_confirmed', attemptId: eventId },
  };
}

function weakExtensionAck(applicationId = APPLICATION_ID, claimId = CLAIM_ID) {
  return {
    application_id: applicationId,
    attempt_id: claimId,
    outcome: 'unknown',
    review: {
      status: 'needs_attention',
      submission_claim_id: claimId,
      unverified_submission: { cause: 'no_confirmation_state' },
    },
    retry_safety: { kind: 'blocked_unverified', attemptId: claimId },
    resolved_attempt_retry_safety: { kind: 'blocked_unverified', attemptId: claimId },
  };
}

function weakFreeAck(applicationId = APPLICATION_ID, eventId = EVENT_ID, outcome: 'unknown' | 'failed' = 'unknown') {
  return {
    application_id: applicationId,
    event_id: eventId,
    outcome,
    resolved_attempt_retry_safety: { kind: 'blocked_unverified', attemptId: eventId },
  };
}

function attemptId(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

function extensionOutcome(overrides: Partial<SubmissionOutcomeInput> = {}): SubmissionOutcomeInput {
  return {
    lane: 'extension',
    accountId: ACCOUNT_ID,
    applicationId: APPLICATION_ID,
    claimId: CLAIM_ID,
    tabId: 7,
    frameId: 0,
    capturedAuthEpoch: 3,
    startUrl: START_URL,
    outcome: 'confirmed',
    finalUrl: `${FINAL_URL}#receipt`,
    confirmationText: `  ${WORKABLE_RECEIPT_TEXT}\n`,
    receiptProof: PROOF,
    capturedAt: NOW,
    ...overrides,
  } as SubmissionOutcomeInput;
}

function freeOutcome(overrides: Partial<SubmissionOutcomeInput> = {}): SubmissionOutcomeInput {
  return {
    lane: 'free',
    accountId: ACCOUNT_ID,
    applicationId: APPLICATION_ID,
    eventId: EVENT_ID,
    leaseId: LEASE_ID,
    activationId: ACTIVATION_ID,
    tabId: 8,
    frameId: 2,
    capturedAuthEpoch: 3,
    startUrl: START_URL,
    outcome: 'confirmed',
    finalUrl: FINAL_URL,
    confirmationText: WORKABLE_RECEIPT_TEXT,
    receiptProof: PROOF,
    capturedAt: NOW,
    ...overrides,
  } as SubmissionOutcomeInput;
}

class MemoryStorage implements SubmissionOutcomeOutboxStorage {
  value: unknown;
  legacyValue: unknown;
  legacyRemoved = false;
  readonly operations: string[] = [];
  failWrite = false;

  async read(): Promise<unknown> {
    this.operations.push('read');
    return this.value === undefined ? undefined : structuredClone(this.value);
  }

  async write(value: SubmissionOutcomeOutboxValue): Promise<void> {
    this.operations.push('write');
    if (this.failWrite) throw new Error('storage unavailable');
    this.value = structuredClone(value);
  }

  async remove(): Promise<void> {
    this.operations.push('remove');
    this.value = undefined;
  }

  async readLegacy(): Promise<unknown> {
    return this.legacyValue === undefined ? undefined : structuredClone(this.legacyValue);
  }

  async removeLegacy(): Promise<void> {
    this.legacyRemoved = true;
    this.legacyValue = undefined;
  }
}

async function armForOutcome(outbox: SubmissionOutcomeOutbox, input: SubmissionOutcomeInput): Promise<void> {
  if (input.lane === 'extension') {
    await outbox.arm({
      lane: 'extension',
      accountId: input.accountId,
      applicationId: input.applicationId,
      claimId: input.claimId,
      tabId: input.tabId,
      frameId: input.frameId,
      capturedAuthEpoch: input.capturedAuthEpoch,
      startUrl: input.startUrl,
      startedAt: input.capturedAt,
      packetVersion: 'a'.repeat(64),
      auditDigest: 'b'.repeat(64),
    });
    await outbox.markPressed({
      lane: 'extension', attemptId: input.claimId, accountId: input.accountId, pressedAt: NOW,
    });
    return;
  }
  await outbox.arm({
    lane: 'free',
    accountId: input.accountId,
    applicationId: input.applicationId,
    eventId: input.eventId,
    tabId: input.tabId,
    frameId: input.frameId,
    capturedAuthEpoch: input.capturedAuthEpoch,
    startUrl: input.startUrl,
    startedAt: input.capturedAt,
  });
  await outbox.markPressed({
    lane: 'free',
    attemptId: input.eventId,
    accountId: input.accountId,
    leaseId: input.leaseId,
    activationId: input.activationId,
    boundaryExpiresAt: NOW + 30_000,
    pressedAt: NOW,
  });
}

async function persist(outbox: SubmissionOutcomeOutbox, input: SubmissionOutcomeInput) {
  await armForOutcome(outbox, input);
  return outbox.persist(input, input.capturedAt ?? NOW);
}

describe('durable submission attempt journal', () => {
  it('binds the measured Greenhouse direct and embed trial identities exactly', () => {
    expect(greenhouseReceiptBindingMatches(
      'https://job-boards.greenhouse.io/schonfeld/jobs/8094080',
      'https://job-boards.greenhouse.io/schonfeld/jobs/8094080/confirmation',
    )).toBe(true);
    expect(greenhouseReceiptBindingMatches(
      'https://job-boards.greenhouse.io/figma/jobs/6131089004',
      'https://job-boards.greenhouse.io/figma/jobs/6131089004/confirmation',
    )).toBe(true);
    expect(greenhouseReceiptBindingMatches(
      'https://job-boards.greenhouse.io/embed/job_app?for=inter&token=6131089004',
      'https://job-boards.greenhouse.io/embed/job_app/confirmation?token=6131089004&for=inter',
    )).toBe(true);
    expect(greenhouseReceiptBindingMatches(
      'https://job-boards.greenhouse.io/embed/job_app?for=inter&token=6131089004',
      'https://job-boards.greenhouse.io/embed/job_app/confirmation?token=8094080&for=inter',
    )).toBe(false);
  });

  it('strictly parses a typed confirmed receipt and never stores private application data', async () => {
    const storage = new MemoryStorage();
    const outbox = new SubmissionOutcomeOutbox(storage);
    const entry = await persist(outbox, extensionOutcome());

    expect(entry.phase).toBe('outcome');
    expect(entry.finalUrl).toBe(FINAL_URL);
    expect(entry.confirmationText).toBe(WORKABLE_RECEIPT_TEXT);
    expect(entry.serializedBody).toBe(JSON.stringify({
      claim_id: CLAIM_ID,
      outcome: 'confirmed',
      final_url: FINAL_URL,
      confirmation_text: WORKABLE_RECEIPT_TEXT,
      receipt_proof: PROOF,
    }));
    expect(parseSubmissionOutcomeOutbox(storage.value)?.entries).toEqual([entry]);
    expect(entry.serializedBody).not.toContain('token');
    expect(entry).not.toHaveProperty('answers');
    expect(entry).not.toHaveProperty('profile');

    const malformed = structuredClone(storage.value) as { entries: Array<Record<string, unknown>> };
    malformed.entries[0]!.jwt = 'secret';
    expect(parseSubmissionOutcomeOutbox(malformed)).toBeNull();
  });

  it('rejects unsafe URLs, ambiguous proof, and bounds display-only evidence', async () => {
    expect(sanitizeSubmissionOutcomeUrl('http://jobs.example.com/apply')).toBeNull();
    expect(sanitizeSubmissionOutcomeUrl('https://user:pass@jobs.example.com/apply')).toBeNull();
    expect(sanitizeSubmissionOutcomeConfirmation('a'.repeat(2_100))).toHaveLength(2000);

    const outbox = new SubmissionOutcomeOutbox(new MemoryStorage());
    const ambiguous = extensionOutcome({ receiptProof: null, confirmationText: `Thank you ${WORKABLE_RECEIPT_TEXT}` });
    await armForOutcome(outbox, ambiguous);
    await expect(outbox.persist(ambiguous)).rejects.toThrow('exact supported receipt proof');
  });

  it('atomically grants exactly one of two concurrent arms at cap minus one', async () => {
    const outbox = new SubmissionOutcomeOutbox(new MemoryStorage());
    for (let index = 1; index < SUBMISSION_OUTCOME_OUTBOX_MAX_ENTRIES; index += 1) {
      await outbox.arm({
        lane: 'extension',
        accountId: ACCOUNT_ID,
        applicationId: attemptId(10_000 + index),
        claimId: attemptId(index),
        tabId: index,
        frameId: 0,
        capturedAuthEpoch: 3,
        startUrl: START_URL,
        packetVersion: 'a'.repeat(64),
        auditDigest: 'b'.repeat(64),
      });
    }
    const starts = await Promise.allSettled([64, 65].map((index) => outbox.arm({
      lane: 'extension',
      accountId: ACCOUNT_ID,
      applicationId: attemptId(20_000 + index),
      claimId: attemptId(index),
      tabId: index,
      frameId: 0,
      capturedAuthEpoch: 3,
      startUrl: START_URL,
      packetVersion: 'a'.repeat(64),
      auditDigest: 'b'.repeat(64),
    })));
    expect(starts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(starts.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await outbox.list()).toHaveLength(SUBMISSION_OUTCOME_OUTBOX_MAX_ENTRIES);
  });

  it('isolates a malformed slot while keeping valid attempts replayable and repair visible', async () => {
    const storage = new MemoryStorage();
    const seed = new SubmissionOutcomeOutbox(storage);
    const valid = await persist(seed, extensionOutcome());
    const root = structuredClone(storage.value) as {
      version: 2; entries: unknown[]; quarantined: unknown[]; acknowledged: unknown[];
    };
    root.entries.push({ version: 1, jwt: 'must-not-survive-repair' });
    storage.value = root;

    const recovered = new SubmissionOutcomeOutbox(storage);
    expect(await recovered.list()).toEqual([valid]);
    expect(await recovered.health()).toEqual({
      quarantined: 1, repairRequired: 0, capacityUsed: 2, capacityMax: 64, integrityBlocked: true,
    });
    await expect(recovered.arm({
      lane: 'extension', accountId: ACCOUNT_ID, applicationId: attemptId(91), claimId: attemptId(92),
      tabId: 9, frameId: 0, capturedAuthEpoch: 3, startUrl: START_URL,
      packetVersion: 'a'.repeat(64), auditDigest: 'b'.repeat(64),
    })).rejects.toThrow('needs repair');
    await recovered.discardQuarantinedAfterManualRepair();
    await recovered.arm({
      lane: 'extension',
      accountId: ACCOUNT_ID,
      applicationId: attemptId(900),
      claimId: attemptId(901),
      tabId: 9,
      frameId: 0,
      capturedAuthEpoch: 3,
      startUrl: START_URL,
      packetVersion: 'a'.repeat(64),
      auditDigest: 'b'.repeat(64),
    });
    expect(JSON.stringify(storage.value)).not.toContain('must-not-survive-repair');
    expect(parseSubmissionOutcomeOutbox(storage.value)?.quarantined).toEqual([]);
  });

  it('blocks duplicate attempt keys until exact manual repair preserves one authoritative record', async () => {
    const storage = new MemoryStorage();
    const seed = new SubmissionOutcomeOutbox(storage);
    const entry = await persist(seed, extensionOutcome());
    const root = structuredClone(storage.value) as SubmissionOutcomeOutboxValue;
    root.entries.push(structuredClone(entry));
    storage.value = root;
    const damaged = new SubmissionOutcomeOutbox(storage);
    await expect(damaged.list()).rejects.toThrow('duplicate durable attempts');
    expect(await damaged.health()).toEqual({
      quarantined: 0, repairRequired: 0, capacityUsed: 64, capacityMax: 64, integrityBlocked: true,
    });
    await expect(damaged.arm({
      lane: 'extension', accountId: ACCOUNT_ID, applicationId: attemptId(93), claimId: attemptId(94),
      tabId: 9, frameId: 0, capturedAuthEpoch: 3, startUrl: START_URL,
      packetVersion: 'a'.repeat(64), auditDigest: 'b'.repeat(64),
    })).rejects.toThrow('duplicate durable attempts');
    root.entries.pop();
    storage.value = root;
    expect(await damaged.list()).toEqual([entry]);
  });

  it('migrates a strict legacy journal to V2 without weakening a confirmed receipt', async () => {
    const seedStorage = new MemoryStorage();
    const seed = new SubmissionOutcomeOutbox(seedStorage);
    const entry = await persist(seed, extensionOutcome());
    const legacyEntry = { ...entry, version: 1 } as Record<string, unknown>;
    delete legacyEntry.pressedAt;
    delete legacyEntry.lateObservationDeadline;
    delete legacyEntry.repairReason;
    delete legacyEntry.repairStatus;
    delete legacyEntry.repairAt;
    const storage = new MemoryStorage();
    storage.legacyValue = { version: 1, entries: [legacyEntry], quarantined: [] };
    const migrated = new SubmissionOutcomeOutbox(storage);
    const [restored] = await migrated.list();
    expect(restored).toMatchObject({ version: 2, phase: 'outcome', outcome: 'confirmed' });
    expect(restored?.serializedBody).toBe(entry.serializedBody);
    expect(storage.legacyRemoved).toBe(true);
    expect(parseSubmissionOutcomeOutbox(storage.value)?.version).toBe(2);
  });

  it('verifies exact outcome bytes before the first backend send', async () => {
    const storage = new MemoryStorage();
    const outbox = new SubmissionOutcomeOutbox(storage);
    const outcome = extensionOutcome();
    await armForOutcome(outbox, outcome);
    storage.operations.length = 0;
    const send = vi.fn(async (entry: { applicationId: string }) => {
      storage.operations.push('send');
      return { ok: true, status: 200, body: confirmedExtensionAck(entry.applicationId) };
    });
    await expect(persistAndDeliverSubmissionOutcome({
      outbox,
      outcome,
      send,
      cleanup: async () => undefined,
      now: NOW,
    })).resolves.toMatchObject({ acknowledged: true });
    expect(storage.operations.slice(0, 4)).toEqual(['read', 'write', 'read', 'send']);
  });

  it('persists strict Greenhouse receipt proof with exact frozen posting identity', async () => {
    const outbox = new SubmissionOutcomeOutbox(new MemoryStorage());
    const outcome = extensionOutcome({
      startUrl: GREENHOUSE_START_URL,
      finalUrl: GREENHOUSE_FINAL_URL,
      confirmationText: 'Thank you, Acme will be in touch.',
      receiptProof: GREENHOUSE_PROOF,
    });
    await armForOutcome(outbox, outcome);
    const saved = await outbox.persist(outcome);
    expect(JSON.parse(saved.serializedBody)).toMatchObject({
      final_url: GREENHOUSE_FINAL_URL,
      confirmation_text: 'Thank you, Acme will be in touch.',
      receipt_proof: GREENHOUSE_PROOF,
    });
    await expect(outbox.persist(extensionOutcome({
      startUrl: GREENHOUSE_START_URL,
      finalUrl: `${GREENHOUSE_FINAL_URL}?source=bad`,
      confirmationText: 'Thank you.',
      receiptProof: GREENHOUSE_PROOF,
    }))).rejects.toThrow('exact supported receipt proof');
  });

  it('does not fetch when outcome storage fails', async () => {
    const storage = new MemoryStorage();
    const outbox = new SubmissionOutcomeOutbox(storage);
    const outcome = extensionOutcome();
    await armForOutcome(outbox, outcome);
    storage.failWrite = true;
    const send = vi.fn();
    await expect(persistAndDeliverSubmissionOutcome({
      outbox,
      outcome,
      send,
      cleanup: async () => undefined,
    })).rejects.toThrow('storage unavailable');
    expect(send).not.toHaveBeenCalled();
  });

  it('retains exact confirmed bytes on 409 and rejects a later unknown downgrade', async () => {
    const outbox = new SubmissionOutcomeOutbox(new MemoryStorage());
    const confirmed = await persist(outbox, extensionOutcome());
    const bytes = confirmed.serializedBody;
    const result = await deliverPersistedSubmissionOutcome({
      outbox,
      entry: confirmed,
      send: async () => ({ ok: false, status: 409, body: { code: 'changed' } }),
      cleanup: async () => undefined,
      now: NOW + 1,
      random: () => 0,
    });
    expect(result).toMatchObject({ acknowledged: false, status: 409 });
    const afterUnknown = await outbox.persist(extensionOutcome({
      outcome: 'unknown',
      finalUrl: START_URL,
      confirmationText: '',
      receiptProof: null,
      capturedAt: NOW + 2,
    }));
    expect(afterUnknown.outcome).toBe('confirmed');
    expect(afterUnknown.serializedBody).toBe(bytes);
  });

  it('blocks logout while any armed, pressed, or outcome entry remains', async () => {
    const outbox = new SubmissionOutcomeOutbox(new MemoryStorage());
    await outbox.arm({
      lane: 'free', accountId: ACCOUNT_ID, applicationId: APPLICATION_ID, eventId: EVENT_ID,
      tabId: 8, frameId: 0, capturedAuthEpoch: 3, startUrl: START_URL,
    });
    expect(submissionOutcomeLogoutCanPurge(await outbox.list(), ACCOUNT_ID)).toBe(false);
    expect(await outbox.cancelSafeNotSent('free', EVENT_ID, ACCOUNT_ID)).toBe(true);
    expect(submissionOutcomeLogoutCanPurge(await outbox.list(), ACCOUNT_ID)).toBe(true);
  });

  it('replays identical Free bytes after restart and a lost server response', async () => {
    const storage = new MemoryStorage();
    const firstWorker = new SubmissionOutcomeOutbox(storage);
    const entry = await persist(firstWorker, freeOutcome());
    const sent: string[] = [];
    await deliverPersistedSubmissionOutcome({
      outbox: firstWorker,
      entry,
      send: async (current) => {
        sent.push(current.serializedBody);
        throw new Error('response channel lost after server commit');
      },
      cleanup: async () => undefined,
      now: NOW + 1,
      random: () => 0,
    });
    const restartedWorker = new SubmissionOutcomeOutbox(storage);
    const [reloaded] = await restartedWorker.list();
    const accepted = await deliverPersistedSubmissionOutcome({
      outbox: restartedWorker,
      entry: reloaded!,
      send: async (current) => {
        sent.push(current.serializedBody);
        return { ok: true, status: 200, body: confirmedFreeAck() };
      },
      cleanup: async () => undefined,
      now: NOW + 3_000,
    });
    expect(accepted.acknowledged).toBe(true);
    expect(sent).toEqual([entry.serializedBody, entry.serializedBody]);
  });

  it('recovers an exact unpressed Free arm after worker and browser context restart', async () => {
    const storage = new MemoryStorage();
    const firstWorker = new SubmissionOutcomeOutbox(storage);
    await firstWorker.arm({
      lane: 'free',
      accountId: ACCOUNT_ID,
      applicationId: APPLICATION_ID,
      eventId: EVENT_ID,
      tabId: 8,
      frameId: 2,
      capturedAuthEpoch: 3,
      startUrl: START_URL,
      startedAt: NOW,
    });
    const restartedWorker = new SubmissionOutcomeOutbox(storage);
    const rebound = await restartedWorker.rebindArmedContext({
      lane: 'free',
      attemptId: EVENT_ID,
      accountId: ACCOUNT_ID,
      tabId: 18,
      frameId: 0,
    });
    expect(rebound).toMatchObject({
      phase: 'armed',
      eventId: EVENT_ID,
      accountId: ACCOUNT_ID,
      applicationId: APPLICATION_ID,
      startUrl: START_URL,
      tabId: 18,
      frameId: 0,
    });
  });

  it('rebinds a generated pressed attempt after a full browser restart before saving its receipt', async () => {
    const outbox = new SubmissionOutcomeOutbox(new MemoryStorage());
    const outcome = extensionOutcome();
    await armForOutcome(outbox, outcome);
    const rebound = await outbox.rebindRecoverableContext({
      lane: 'extension',
      accountId: ACCOUNT_ID,
      applicationId: APPLICATION_ID,
      attemptId: CLAIM_ID,
      startUrl: START_URL,
      currentUrl: FINAL_URL,
      tabId: 71,
      frameId: 3,
    });
    expect(rebound).toMatchObject({ phase: 'pressed', tabId: 71, frameId: 3, claimId: CLAIM_ID });
    const saved = await outbox.persist(extensionOutcome({ tabId: 71, frameId: 3 }));
    expect(saved).toMatchObject({ phase: 'outcome', outcome: 'confirmed', tabId: 71, frameId: 3 });
  });

  it('rebinds a Free pressed attempt after a full browser restart before saving its receipt', async () => {
    const outbox = new SubmissionOutcomeOutbox(new MemoryStorage());
    const outcome = freeOutcome();
    await armForOutcome(outbox, outcome);
    const rebound = await outbox.rebindRecoverableContext({
      lane: 'free',
      accountId: ACCOUNT_ID,
      applicationId: APPLICATION_ID,
      attemptId: EVENT_ID,
      startUrl: START_URL,
      currentUrl: FINAL_URL,
      tabId: 81,
      frameId: 4,
    });
    expect(rebound).toMatchObject({
      phase: 'pressed',
      tabId: 81,
      frameId: 4,
      eventId: EVENT_ID,
      leaseId: LEASE_ID,
      activationId: ACTIVATION_ID,
    });
    const saved = await outbox.persist(freeOutcome({ tabId: 81, frameId: 4 }));
    expect(saved).toMatchObject({ phase: 'outcome', outcome: 'confirmed', tabId: 81, frameId: 4 });
  });

  it('fails closed when a frozen page has zero or multiple recoverable pressed attempts', async () => {
    const outbox = new SubmissionOutcomeOutbox(new MemoryStorage());
    await expect(outbox.rebindRecoverableContext({
      lane: 'extension', accountId: ACCOUNT_ID, applicationId: APPLICATION_ID, attemptId: CLAIM_ID,
      startUrl: START_URL, currentUrl: FINAL_URL, tabId: 71, frameId: 0,
    })).rejects.toThrow('exactly one');

    for (const [applicationId, claimId] of [[APPLICATION_ID, CLAIM_ID], [attemptId(80), attemptId(81)]]) {
      await outbox.arm({
        lane: 'extension',
        accountId: ACCOUNT_ID,
        applicationId,
        claimId,
        tabId: 7,
        frameId: 0,
        capturedAuthEpoch: 3,
        startUrl: START_URL,
        packetVersion: 'a'.repeat(64),
        auditDigest: 'b'.repeat(64),
      });
      await outbox.markPressed({ lane: 'extension', attemptId: claimId, accountId: ACCOUNT_ID });
    }
    await expect(outbox.rebindRecoverableContext({
      lane: 'extension', accountId: ACCOUNT_ID, applicationId: APPLICATION_ID, attemptId: CLAIM_ID,
      startUrl: START_URL, currentUrl: FINAL_URL, tabId: 71, frameId: 0,
    })).rejects.toThrow('exactly one');
  });

  it('retains a typed receipt past boundary TTL until authoritative late acknowledgement', async () => {
    const outbox = new SubmissionOutcomeOutbox(new MemoryStorage());
    const entry = await persist(outbox, freeOutcome());
    const late = await deliverPersistedSubmissionOutcome({
      outbox,
      entry,
      send: async () => ({
        ok: true,
        status: 200,
        body: confirmedFreeAck(),
      }),
      cleanup: async () => undefined,
      now: NOW + 3 * 60_000,
    });
    expect(late.acknowledged).toBe(true);
    expect(await outbox.list()).toEqual([]);
  });

  it('captures a late typed confirmation after worker restart before any auth dependency', async () => {
    const storage = new MemoryStorage();
    const firstWorker = new SubmissionOutcomeOutbox(storage);
    const outcome = freeOutcome();
    await armForOutcome(firstWorker, outcome);
    const restartedWorker = new SubmissionOutcomeOutbox(storage);
    const saved = await restartedWorker.persist(outcome, NOW + 1);
    expect(saved).toMatchObject({ phase: 'outcome', outcome: 'confirmed', accountId: ACCOUNT_ID });
    expect(saved.serializedBody).toContain('workable_successful_submit');
    expect(await restartedWorker.list()).toEqual([saved]);
  });

  it('makes concurrent confirmed evidence dominate weak outcomes for one attempt', async () => {
    const outbox = new SubmissionOutcomeOutbox(new MemoryStorage());
    const base = freeOutcome({ outcome: 'unknown', confirmationText: '', receiptProof: null });
    await armForOutcome(outbox, base);
    await Promise.all([
      outbox.persist(base),
      outbox.persist(freeOutcome()),
      outbox.persist(freeOutcome({ outcome: 'failed', confirmationText: 'Failed to submit', receiptProof: null })),
    ]);
    const [entry] = await outbox.list();
    expect(entry?.outcome).toBe('confirmed');
    expect(entry?.confirmationText).toBe(WORKABLE_RECEIPT_TEXT);
  });

  it('retains evidence for a mismatched success body or needs-attention 200', async () => {
    for (const body of [
      confirmedExtensionAck(attemptId(99)),
      { ...confirmedExtensionAck(), attempt_id: attemptId(98) },
      { ...confirmedExtensionAck(), resolved_attempt_retry_safety: undefined },
      { ...confirmedExtensionAck(), resolved_attempt_retry_safety: { kind: 'blocked_confirmed', attemptId: attemptId(97) } },
      { application_id: APPLICATION_ID, review: { status: 'needs_attention' } },
    ]) {
      const outbox = new SubmissionOutcomeOutbox(new MemoryStorage());
      const entry = await persist(outbox, extensionOutcome());
      const cleanup = vi.fn();
      const result = await deliverPersistedSubmissionOutcome({
        outbox,
        entry,
        send: async () => ({ ok: true, status: 200, body }),
        cleanup,
        now: NOW + 1,
        random: () => 0,
      });
      expect(result.acknowledged).toBe(false);
      expect(cleanup).not.toHaveBeenCalled();
      expect(await outbox.list()).toHaveLength(1);
    }
  });

  it('acknowledges a weak extension outcome only from the exact durable unverified fold', async () => {
    const outcome = extensionOutcome({
      outcome: 'unknown',
      finalUrl: START_URL,
      confirmationText: '',
      receiptProof: null,
    });
    const exactAck = weakExtensionAck();
    const mismatches = [
      { ...exactAck, application_id: attemptId(99) },
      { ...exactAck, review: { ...exactAck.review, status: 'failed' } },
      { ...exactAck, review: { ...exactAck.review, submission_claim_id: attemptId(98) } },
      { ...exactAck, review: { ...exactAck.review, unverified_submission: { cause: 'employer_rejected' } } },
      { ...exactAck, review: { ...exactAck.review, unverified_submission: { cause: 'no_confirmation_state', resolution: 'not_sent' } } },
      { ...exactAck, resolved_attempt_retry_safety: { kind: 'blocked_unverified', attemptId: attemptId(97) } },
      { application_id: APPLICATION_ID, review: { status: 'needs_attention' } },
    ];

    for (const body of mismatches) {
      const outbox = new SubmissionOutcomeOutbox(new MemoryStorage());
      const entry = await persist(outbox, outcome);
      const result = await deliverPersistedSubmissionOutcome({
        outbox,
        entry,
        send: async () => ({ ok: true, status: 200, body }),
        cleanup: async () => undefined,
        now: NOW + 1,
        random: () => 0,
      });
      expect(result.acknowledged).toBe(false);
      expect(await outbox.list()).toHaveLength(1);
    }

    const outbox = new SubmissionOutcomeOutbox(new MemoryStorage());
    const entry = await persist(outbox, outcome);
    const result = await deliverPersistedSubmissionOutcome({
      outbox,
      entry,
      send: async () => ({ ok: true, status: 200, body: exactAck }),
      cleanup: async () => undefined,
    });
    expect(result.acknowledged).toBe(true);
    expect(await outbox.list()).toEqual([expect.objectContaining({ phase: 'awaiting_receipt', outcome: 'unknown' })]);
  });

  it('derives dead-letter visibility without mutating or removing the awaiting receipt', async () => {
    const outbox = new SubmissionOutcomeOutbox(new MemoryStorage());
    const outcome = extensionOutcome({
      outcome: 'unknown',
      finalUrl: START_URL,
      confirmationText: '',
      receiptProof: null,
    });
    const entry = await persist(outbox, outcome);
    await expect(deliverPersistedSubmissionOutcome({
      outbox,
      entry,
      send: async () => ({ ok: true, status: 200, body: weakExtensionAck() }),
      cleanup: async () => undefined,
      now: NOW,
    })).resolves.toMatchObject({ acknowledged: true });
    const [awaiting] = await outbox.list();
    const before = JSON.stringify(awaiting);
    expect(awaiting).toMatchObject({ phase: 'awaiting_receipt', outcome: 'unknown' });
    expect(submissionOutcomeReceiptVisibility(awaiting!, awaiting!.lateObservationDeadline! - 1)).toBe('pending');
    expect(submissionOutcomeReceiptVisibility(awaiting!, awaiting!.lateObservationDeadline!)).toBe('dead_letter');
    expect(JSON.stringify((await outbox.list())[0])).toBe(before);
  });

  it('derives overdue queued weak outcomes as dead-letter without mutating phase or releasing capacity', async () => {
    const outbox = new SubmissionOutcomeOutbox(new MemoryStorage());
    const queued = await persist(outbox, extensionOutcome({
      outcome: 'unknown',
      finalUrl: START_URL,
      confirmationText: '',
      receiptProof: null,
    }));
    const before = JSON.stringify(queued);
    expect(queued).toMatchObject({ phase: 'outcome', outcome: 'unknown' });
    expect(submissionOutcomeReceiptVisibility(queued, queued.lateObservationDeadline! - 1)).toBe('pending');
    expect(submissionOutcomeReceiptVisibility(queued, queued.lateObservationDeadline!)).toBe('dead_letter');
    const [unchanged] = await outbox.list();
    expect(JSON.stringify(unchanged)).toBe(before);
    expect(await outbox.hasCapacity()).toBe(true);
    expect(await outbox.list()).toHaveLength(1);
  });

  it('counts durable dead-letter receipts against capacity and refuses a sixty-fifth arm', async () => {
    const outbox = new SubmissionOutcomeOutbox(new MemoryStorage());
    for (let offset = 0; offset < SUBMISSION_OUTCOME_OUTBOX_MAX_ENTRIES; offset += 1) {
      const applicationId = attemptId(50_000 + offset * 2);
      const claimId = attemptId(50_001 + offset * 2);
      const outcome = extensionOutcome({
        applicationId,
        claimId,
        outcome: 'unknown',
        finalUrl: START_URL,
        confirmationText: '',
        receiptProof: null,
      });
      const entry = await persist(outbox, outcome);
      await deliverPersistedSubmissionOutcome({
        outbox,
        entry,
        send: async () => ({ ok: true, status: 200, body: weakExtensionAck(applicationId, claimId) }),
        cleanup: async () => undefined,
        now: NOW,
      });
    }
    const entries = await outbox.list();
    expect(entries).toHaveLength(SUBMISSION_OUTCOME_OUTBOX_MAX_ENTRIES);
    expect(entries.every((entry) => submissionOutcomeReceiptVisibility(
      entry,
      NOW + SUBMISSION_OUTCOME_LATE_OBSERVATION_MS,
    ) === 'dead_letter')).toBe(true);
    expect(await outbox.hasCapacity()).toBe(false);
    await expect(outbox.arm({
      lane: 'extension', accountId: ACCOUNT_ID, applicationId: attemptId(60_000), claimId: attemptId(60_001),
      tabId: 70, frameId: 0, capturedAuthEpoch: 3, startUrl: START_URL,
      packetVersion: 'a'.repeat(64), auditDigest: 'b'.repeat(64),
    })).rejects.toThrow('journal is full');
  });

  it('acknowledges before best-effort session cleanup so stale cache cannot retain authority', async () => {
    const outbox = new SubmissionOutcomeOutbox(new MemoryStorage());
    const entry = await persist(outbox, extensionOutcome());
    const result = await deliverPersistedSubmissionOutcome({
      outbox,
      entry,
      send: async () => ({ ok: true, status: 200, body: confirmedExtensionAck() }),
      cleanup: async () => { throw new Error('session cache changed'); },
    });
    expect(result.acknowledged).toBe(true);
    expect(await outbox.list()).toEqual([]);
  });

  it('persists a confirmed acknowledgement projection until the rebound page renders it', async () => {
    const outbox = new SubmissionOutcomeOutbox(new MemoryStorage());
    const entry = await persist(outbox, extensionOutcome());
    const result = await deliverPersistedSubmissionOutcome({
      outbox,
      entry,
      send: async () => ({ ok: true, status: 200, body: confirmedExtensionAck() }),
      cleanup: async () => undefined,
      now: NOW + 1,
    });
    expect(result.acknowledged).toBe(true);
    const [projection] = await outbox.listAcknowledgements();
    expect(projection).toMatchObject({ lane: 'extension', attemptId: CLAIM_ID, outcome: 'confirmed' });
    const rebound = await outbox.rebindAcknowledgementContext({
      lane: 'extension',
      accountId: ACCOUNT_ID,
      applicationId: APPLICATION_ID,
      attemptId: CLAIM_ID,
      startUrl: START_URL,
      currentUrl: FINAL_URL,
      tabId: 77,
      frameId: 2,
    });
    expect(rebound).toMatchObject({ tabId: 77, frameId: 2 });
    expect(await outbox.consumeAcknowledgement(rebound)).toBe(true);
    expect(await outbox.listAcknowledgements()).toEqual([]);
    await expect(outbox.arm({
      lane: 'extension', accountId: ACCOUNT_ID, applicationId: attemptId(55_000), claimId: attemptId(55_001),
      tabId: 79, frameId: 0, capturedAuthEpoch: 3, startUrl: START_URL,
      packetVersion: 'a'.repeat(64), auditDigest: 'b'.repeat(64),
    })).resolves.toMatchObject({ phase: 'armed' });
  });

  it('retains an acknowledgement when the same tab navigates away or its renderer fails', async () => {
    const storage = new MemoryStorage();
    const outbox = new SubmissionOutcomeOutbox(storage);
    const entry = await persist(outbox, extensionOutcome());
    await deliverPersistedSubmissionOutcome({
      outbox,
      entry,
      send: async () => ({ ok: true, status: 200, body: confirmedExtensionAck() }),
      cleanup: async () => { throw new Error('renderer session cleanup failed'); },
      now: NOW + 1,
    });
    const restarted = new SubmissionOutcomeOutbox(storage);
    const [projection] = await restarted.listAcknowledgements();
    await expect(restarted.rebindAcknowledgementContext({
      lane: 'extension',
      accountId: ACCOUNT_ID,
      applicationId: APPLICATION_ID,
      attemptId: CLAIM_ID,
      startUrl: START_URL,
      currentUrl: 'https://apply.workable.com/other/j/abcdef1234/apply/',
      tabId: projection!.tabId,
      frameId: projection!.frameId,
    })).rejects.toThrow('does not match this employer page');
    expect(await restarted.listAcknowledgements()).toEqual([projection]);
  });

  it('isolates permanent poison responses without deleting evidence or bypassing backoff', async () => {
    const outbox = new SubmissionOutcomeOutbox(new MemoryStorage());
    const entry = await persist(outbox, extensionOutcome());
    const result = await deliverPersistedSubmissionOutcome({
      outbox,
      entry,
      send: async () => ({ ok: false, status: 400, body: { code: 'STALE_CLIENT' } }),
      cleanup: async () => undefined,
      now: NOW + 1,
      random: () => 0,
    });
    expect(result.acknowledged).toBe(false);
    const [saved] = await outbox.list();
    expect(saved).toMatchObject({
      repairReason: 'permanent_client_error',
      repairStatus: 400,
      repairAt: NOW + 1,
      retryCount: 1,
    });
    expect(await outbox.health()).toEqual({
      quarantined: 0, repairRequired: 1, capacityUsed: 1, capacityMax: 64, integrityBlocked: false,
    });
    expect(await outbox.due(ACCOUNT_ID, NOW + 1, true)).toEqual([]);
    expect(await outbox.due(ACCOUNT_ID, saved!.nextAttemptAt)).toEqual([saved]);
  });

  it.each(['extension', 'free'] as const)('upgrades a %s unknown acknowledgement with a typed receipt after 61 seconds', async (lane) => {
    const outbox = new SubmissionOutcomeOutbox(new MemoryStorage());
    const weak = lane === 'extension'
      ? extensionOutcome({ outcome: 'unknown', finalUrl: START_URL, confirmationText: '', receiptProof: null })
      : freeOutcome({ outcome: 'unknown', finalUrl: START_URL, confirmationText: '', receiptProof: null });
    const weakEntry = await persist(outbox, weak);
    const weakResult = await deliverPersistedSubmissionOutcome({
      outbox,
      entry: weakEntry,
      send: async () => ({
        ok: true,
        status: 200,
        body: lane === 'extension' ? weakExtensionAck() : weakFreeAck(),
      }),
      cleanup: async () => undefined,
      now: NOW + 60_000,
    });
    expect(weakResult.acknowledged).toBe(true);
    expect((await outbox.list())[0]).toMatchObject({ phase: 'awaiting_receipt', outcome: 'unknown' });

    const confirmed = lane === 'extension'
      ? extensionOutcome({ capturedAt: NOW + 61_000 })
      : freeOutcome({ capturedAt: NOW + 61_000 });
    const confirmedEntry = await outbox.persist(confirmed, NOW + 61_000);
    expect(confirmedEntry).toMatchObject({ phase: 'outcome', outcome: 'confirmed', capturedAt: NOW + 61_000 });
    const confirmedResult = await deliverPersistedSubmissionOutcome({
      outbox,
      entry: confirmedEntry,
      send: async () => ({
        ok: true,
        status: 200,
        body: lane === 'extension' ? confirmedExtensionAck() : confirmedFreeAck(),
      }),
      cleanup: async () => undefined,
      now: NOW + 61_001,
    });
    expect(confirmedResult.acknowledged).toBe(true);
    expect(await outbox.list()).toEqual([]);
  });

  it.each(['extension', 'free'] as const)('upgrades a queued offline %s weak outcome after restart before weak acknowledgement', async (lane) => {
    const storage = new MemoryStorage();
    const firstWorker = new SubmissionOutcomeOutbox(storage);
    const weak = lane === 'extension'
      ? extensionOutcome({ outcome: 'unknown', finalUrl: START_URL, confirmationText: '', receiptProof: null })
      : freeOutcome({ outcome: 'unknown', finalUrl: START_URL, confirmationText: '', receiptProof: null });
    const weakEntry = await persist(firstWorker, weak);
    const weakBytes = weakEntry.serializedBody;
    const restarted = new SubmissionOutcomeOutbox(storage);
    const confirmed = lane === 'extension'
      ? extensionOutcome({ capturedAt: NOW + 1 })
      : freeOutcome({ capturedAt: NOW + 1 });
    const upgraded = await restarted.persist(confirmed, NOW + 1);
    expect(upgraded).toMatchObject({ phase: 'outcome', outcome: 'confirmed', lateObservationDeadline: null });
    expect(upgraded.serializedBody).not.toBe(weakBytes);
    expect(upgraded.serializedBody).toContain('workable_successful_submit');
    await restarted.persist(weak, NOW + 2);
    expect((await restarted.list())[0]?.serializedBody).toBe(upgraded.serializedBody);
  });

  it('uses durable press time and a captured-outcome deadline after an old Free arm restarts', async () => {
    const storage = new MemoryStorage();
    const outbox = new SubmissionOutcomeOutbox(storage);
    const oldArmAt = NOW - 60 * 60_000;
    const pressAt = NOW;
    const capturedAt = NOW + 10_000;
    await outbox.arm({
      lane: 'free', accountId: ACCOUNT_ID, applicationId: APPLICATION_ID, eventId: EVENT_ID,
      tabId: 8, frameId: 2, capturedAuthEpoch: 3, startUrl: GREENHOUSE_START_URL, startedAt: oldArmAt,
    });
    await outbox.markPressed({
      lane: 'free', attemptId: EVENT_ID, accountId: ACCOUNT_ID, leaseId: LEASE_ID,
      activationId: ACTIVATION_ID, boundaryExpiresAt: NOW + 30_000, pressedAt: pressAt,
    });
    const weak = await outbox.persist(freeOutcome({
      startUrl: GREENHOUSE_START_URL,
      outcome: 'unknown',
      finalUrl: GREENHOUSE_START_URL,
      confirmationText: '',
      receiptProof: null,
      capturedAt,
    }), capturedAt);
    expect(weak).toMatchObject({
      startedAt: oldArmAt,
      pressedAt: pressAt,
      capturedAt,
      lateObservationDeadline: capturedAt + SUBMISSION_OUTCOME_LATE_OBSERVATION_MS,
    });
    const restarted = new SubmissionOutcomeOutbox(storage);
    const rebound = await restarted.rebindRecoverableContext({
      lane: 'free', accountId: ACCOUNT_ID, applicationId: APPLICATION_ID, attemptId: EVENT_ID,
      startUrl: GREENHOUSE_START_URL, currentUrl: GREENHOUSE_START_URL, tabId: 88, frameId: 0,
    });
    expect(rebound.pressedAt).toBe(pressAt);
    const confirmationText = 'Thank you, Acme will be in touch.';
    const confirmed = await restarted.persist(freeOutcome({
      tabId: 88,
      frameId: 0,
      startUrl: GREENHOUSE_START_URL,
      finalUrl: GREENHOUSE_FINAL_URL,
      confirmationText,
      receiptProof: GREENHOUSE_PROOF,
      capturedAt: capturedAt + SUBMISSION_OUTCOME_LATE_OBSERVATION_MS - 1,
    }));
    expect(confirmed).toMatchObject({ outcome: 'confirmed', confirmationText, lateObservationDeadline: null });
  });

  it('never refreshes a weak late-observation deadline through repeated weaker outcomes', async () => {
    const outbox = new SubmissionOutcomeOutbox(new MemoryStorage());
    const unknown = freeOutcome({ outcome: 'unknown', finalUrl: START_URL, confirmationText: '', receiptProof: null });
    const first = await persist(outbox, unknown);
    const deadline = first.lateObservationDeadline;
    const failed = await outbox.persist(freeOutcome({
      outcome: 'failed', finalUrl: START_URL, confirmationText: 'Submission failed.', receiptProof: null,
      capturedAt: NOW + 60_000,
    }), NOW + 60_000);
    expect(failed.lateObservationDeadline).toBe(deadline);
    expect(deadline).toBe(NOW + SUBMISSION_OUTCOME_LATE_OBSERVATION_MS);
  });

  it('delivers the full 2,000-character durable Greenhouse receipt unchanged', async () => {
    const marker = ` ${WORKABLE_RECEIPT_TEXT}`;
    const confirmationText = `${'x'.repeat(2_000 - marker.length)}${marker}`;
    const outbox = new SubmissionOutcomeOutbox(new MemoryStorage());
    const entry = await persist(outbox, extensionOutcome({
      startUrl: GREENHOUSE_START_URL,
      finalUrl: GREENHOUSE_FINAL_URL,
      confirmationText,
      receiptProof: GREENHOUSE_PROOF,
    }));
    expect(confirmationText).toHaveLength(2_000);
    expect(entry.confirmationText).toBe(confirmationText);
    expect(JSON.parse(entry.serializedBody)).toMatchObject({ confirmation_text: confirmationText });
    const transportedBodies: string[] = [];
    await deliverPersistedSubmissionOutcome({
      outbox,
      entry,
      send: async (exact) => {
        transportedBodies.push(exact.serializedBody);
        return { ok: false, status: 409, body: null };
      },
      cleanup: async () => undefined,
      now: NOW,
    });
    expect(JSON.parse(transportedBodies[0]!)).toMatchObject({ confirmation_text: confirmationText });
  });

  it('fails closed on malformed acknowledgement data without rewriting or losing it', async () => {
    const storage = new MemoryStorage();
    const outbox = new SubmissionOutcomeOutbox(storage);
    const entry = await persist(outbox, extensionOutcome());
    await deliverPersistedSubmissionOutcome({
      outbox,
      entry,
      send: async () => ({ ok: true, status: 200, body: confirmedExtensionAck() }),
      cleanup: async () => undefined,
      now: NOW + 1,
    });
    const damaged = structuredClone(storage.value) as SubmissionOutcomeOutboxValue & {
      acknowledged: Array<Record<string, unknown>>;
    };
    damaged.acknowledged[0]!.unexpected = 'must-be-preserved-for-repair';
    storage.value = damaged;
    const before = JSON.stringify(storage.value);
    const restarted = new SubmissionOutcomeOutbox(storage);
    await expect(restarted.listAcknowledgements()).rejects.toThrow('acknowledgement is malformed');
    expect(await restarted.health()).toEqual({
      quarantined: 0, repairRequired: 0, capacityUsed: 64, capacityMax: 64, integrityBlocked: true,
    });
    await expect(restarted.arm({
      lane: 'extension', accountId: ACCOUNT_ID, applicationId: attemptId(920), claimId: attemptId(921),
      tabId: 9, frameId: 0, capturedAuthEpoch: 3, startUrl: START_URL,
      packetVersion: 'a'.repeat(64), auditDigest: 'b'.repeat(64),
    })).rejects.toThrow('acknowledgement is malformed');
    expect(JSON.stringify(storage.value)).toBe(before);
  });

  it.each([
    { label: 'missing', value: undefined },
    { label: 'malformed', value: 'corrupt' },
  ])('fails closed and preserves storage when the V2 quarantine collection is $label', async ({ value }) => {
    const storage = new MemoryStorage();
    const damaged: Record<string, unknown> = {
      version: 2,
      entries: [],
      quarantined: value,
      acknowledged: [],
    };
    if (value === undefined) delete damaged.quarantined;
    storage.value = damaged;
    const before = JSON.stringify(storage.value);
    const outbox = new SubmissionOutcomeOutbox(storage);

    await expect(outbox.hasCapacity()).rejects.toThrow('journal is invalid');
    await expect(outbox.arm({
      lane: 'extension', accountId: ACCOUNT_ID, applicationId: APPLICATION_ID, claimId: CLAIM_ID,
      tabId: 7, frameId: 0, capturedAuthEpoch: 3, startUrl: START_URL,
      packetVersion: 'a'.repeat(64), auditDigest: 'b'.repeat(64),
    })).rejects.toThrow('journal is invalid');
    expect(await outbox.health()).toMatchObject({
      capacityUsed: SUBMISSION_OUTCOME_OUTBOX_MAX_ENTRIES,
      integrityBlocked: true,
    });
    expect(JSON.stringify(storage.value)).toBe(before);
  });

  it('blocks an active and acknowledgement attempt-key collision without changing either record', async () => {
    const storage = new MemoryStorage();
    const outbox = new SubmissionOutcomeOutbox(storage);
    const active = await persist(outbox, extensionOutcome());
    await deliverPersistedSubmissionOutcome({
      outbox,
      entry: active,
      send: async () => ({ ok: true, status: 200, body: confirmedExtensionAck() }),
      cleanup: async () => undefined,
      now: NOW + 1,
    });
    const damaged = structuredClone(storage.value) as SubmissionOutcomeOutboxValue;
    damaged.entries.push(active);
    storage.value = damaged;
    const before = JSON.stringify(storage.value);
    const restarted = new SubmissionOutcomeOutbox(storage);
    await expect(restarted.list()).rejects.toThrow('duplicate durable attempts');
    await expect(restarted.purgeAccount(ACCOUNT_ID)).rejects.toThrow('duplicate durable attempts');
    expect(await restarted.health()).toMatchObject({ capacityUsed: 64, integrityBlocked: true });
    expect(JSON.stringify(storage.value)).toBe(before);
  });

  it('counts all 64 unrendered acknowledgements against one capacity bound without eviction', async () => {
    const storage = new MemoryStorage();
    storage.value = {
      version: 2,
      entries: [],
      quarantined: [],
      acknowledged: Array.from({ length: SUBMISSION_OUTCOME_OUTBOX_MAX_ENTRIES }, (_, offset) => ({
        version: 2,
        lane: 'extension',
        accountId: ACCOUNT_ID,
        applicationId: attemptId(10_001 + offset),
        attemptId: attemptId(1 + offset),
        tabId: offset + 1,
        frameId: 0,
        startUrl: START_URL,
        outcome: 'confirmed',
        acknowledgedAt: NOW + offset,
      })),
    } satisfies SubmissionOutcomeOutboxValue;
    const outbox = new SubmissionOutcomeOutbox(storage);
    const acknowledgements = await outbox.listAcknowledgements();
    expect(acknowledgements).toHaveLength(SUBMISSION_OUTCOME_OUTBOX_MAX_ENTRIES);
    expect(await outbox.hasCapacity()).toBe(false);
    await expect(outbox.arm({
      lane: 'extension', accountId: ACCOUNT_ID, applicationId: attemptId(30_000), claimId: attemptId(30_001),
      tabId: 90, frameId: 0, capturedAuthEpoch: 3, startUrl: START_URL,
      packetVersion: 'a'.repeat(64), auditDigest: 'b'.repeat(64),
    })).rejects.toThrow('confirmed receipt must finish rendering');
    expect(await outbox.listAcknowledgements()).toEqual(acknowledgements);
    expect(await outbox.list()).toEqual([]);
  });

  it('purges only one account and blocks logout while its acknowledgement is not rendered', async () => {
    const otherAccountId = '723e4567-e89b-42d3-a456-426614174000';
    const otherApplicationId = attemptId(40_000);
    const otherClaimId = attemptId(40_001);
    const storage = new MemoryStorage();
    storage.value = {
      version: 2,
      entries: [],
      quarantined: [],
      acknowledged: [
        {
          version: 2, lane: 'extension', accountId: ACCOUNT_ID, applicationId: APPLICATION_ID,
          attemptId: CLAIM_ID, tabId: 7, frameId: 0, startUrl: START_URL,
          outcome: 'confirmed', acknowledgedAt: NOW,
        },
        {
          version: 2, lane: 'extension', accountId: otherAccountId, applicationId: otherApplicationId,
          attemptId: otherClaimId, tabId: 8, frameId: 0, startUrl: START_URL,
          outcome: 'confirmed', acknowledgedAt: NOW + 1,
        },
      ],
    } satisfies SubmissionOutcomeOutboxValue;
    const outbox = new SubmissionOutcomeOutbox(storage);
    const acknowledgements = await outbox.listAcknowledgements();
    expect(submissionOutcomeLogoutCanPurge([], ACCOUNT_ID, acknowledgements)).toBe(false);

    await expect(outbox.arm({
      lane: 'extension', accountId: ACCOUNT_ID, applicationId: attemptId(40_002), claimId: attemptId(40_003),
      tabId: 9, frameId: 0, capturedAuthEpoch: 3, startUrl: START_URL,
      packetVersion: 'c'.repeat(64), auditDigest: 'd'.repeat(64),
    })).rejects.toThrow('confirmed receipt must finish rendering');

    const exactAccountAcknowledgement = acknowledgements.find((entry) => entry.accountId === ACCOUNT_ID)!;
    expect(await outbox.consumeAcknowledgement(exactAccountAcknowledgement)).toBe(true);
    await outbox.purgeAccount(ACCOUNT_ID);
    expect(await outbox.listAcknowledgements()).toEqual([
      expect.objectContaining({ accountId: otherAccountId, attemptId: otherClaimId }),
    ]);

    await expect(outbox.arm({
      lane: 'extension', accountId: ACCOUNT_ID, applicationId: attemptId(40_004), claimId: attemptId(40_005),
      tabId: 10, frameId: 0, capturedAuthEpoch: 3, startUrl: START_URL,
      packetVersion: 'e'.repeat(64), auditDigest: 'f'.repeat(64),
    })).rejects.toThrow('confirmed receipt must finish rendering');

    // This direct purge represents the explicit account-scoped privacy flow after ownership checks.
    await outbox.purgeAccount(otherAccountId);
    await expect(outbox.arm({
      lane: 'extension', accountId: ACCOUNT_ID, applicationId: attemptId(40_006), claimId: attemptId(40_007),
      tabId: 11, frameId: 0, capturedAuthEpoch: 3, startUrl: START_URL,
      packetVersion: '1'.repeat(64), auditDigest: '2'.repeat(64),
    })).resolves.toMatchObject({ accountId: ACCOUNT_ID, phase: 'armed' });
  });

  it.each([
    { status: 400, body: { code: 'STALE_CLIENT' } },
    { status: 200, body: { application_id: APPLICATION_ID, review: { status: 'submitted' } } },
  ])('does not bypass journal backoff after a poison response with status $status', async ({ status, body }) => {
    const outbox = new SubmissionOutcomeOutbox(new MemoryStorage());
    const outcome = extensionOutcome();
    await armForOutcome(outbox, outcome);
    const send = vi.fn(async () => ({ ok: status >= 200 && status < 300, status, body }));
    const first = await persistAndDeliverSubmissionOutcome({
      outbox,
      outcome,
      send,
      cleanup: async () => undefined,
      now: NOW + 1,
      random: () => 0,
    });
    expect(first.acknowledged).toBe(false);
    await persistAndDeliverSubmissionOutcome({
      outbox,
      outcome,
      send,
      cleanup: async () => undefined,
      now: NOW + 2,
      random: () => 0,
    });
    await persistAndDeliverSubmissionOutcome({
      outbox,
      outcome,
      send,
      cleanup: async () => undefined,
      now: NOW + 1_000,
      random: () => 0,
    });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
