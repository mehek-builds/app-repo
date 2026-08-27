// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { finalizeSubmissionAcknowledgement } from './submission-ack-finalizer';
import { renderBoundSubmissionReceipt } from './submission-receipt-renderer';
import {
  deadLetterSubmissionReceiptPresentation,
  pendingSubmissionReceiptPresentation,
  submissionReceiptPresentation,
} from './submission-receipt-ui';

const START_URL = 'https://job-boards.greenhouse.io/acme/jobs/6131089004';
const CONFIRMATION_URL = 'https://job-boards.greenhouse.io/acme/jobs/6131089004/confirmation';
const PROVENANCE = '7dc8cf38-0260-426a-8f17-d4574a226cf4';

function positiveRect(): DOMRectList {
  return [{ width: 272, height: 80 } as DOMRect] as unknown as DOMRectList;
}

function createCard(provenance: string | null = PROVENANCE): HTMLElement {
  const card = document.createElement('div');
  card.id = 'litos-submit-card';
  if (provenance) card.dataset.litosReceiptProvenance = provenance;
  card.innerHTML = '<span id="wp-submit-icon"></span><div id="wp-submit-title"></div><div id="wp-submit-status"></div>';
  for (const element of [
    card,
    card.querySelector<HTMLElement>('#wp-submit-title')!,
    card.querySelector<HTMLElement>('#wp-submit-status')!,
  ]) {
    Object.defineProperty(element, 'getClientRects', { configurable: true, value: positiveRect });
    Object.defineProperty(element, 'checkVisibility', { configurable: true, value: () => true });
  }
  document.body.appendChild(card);
  return card;
}

function renderSent(ensureCard: () => HTMLElement | null): boolean {
  return renderBoundSubmissionReceipt({
    frozenStartUrl: START_URL,
    currentUrl: CONFIRMATION_URL,
    provenance: PROVENANCE,
    presentation: submissionReceiptPresentation({ ok: true, submitted: true }),
    ensureCard,
  });
}

async function expectAcknowledgementRetained(ensureCard: () => HTMLElement | null): Promise<void> {
  const consume = vi.fn(async () => true);
  await expect(finalizeSubmissionAcknowledgement({
    requiresSessionCleanup: false,
    cleanup: async () => undefined,
    render: async () => renderSent(ensureCard),
    consume,
  })).resolves.toEqual({ terminalReady: false, cleanupPending: false });
  expect(consume).not.toHaveBeenCalled();
}

describe('bound submission receipt renderer', () => {
  it('creates and verifies an exact visible Litos-owned state on a fresh matching confirmation document', () => {
    document.body.replaceChildren();
    expect(renderBoundSubmissionReceipt({
      frozenStartUrl: START_URL,
      currentUrl: CONFIRMATION_URL,
      provenance: PROVENANCE,
      presentation: pendingSubmissionReceiptPresentation(),
      ensureCard: createCard,
    })).toBe(true);
    expect(document.querySelector('#litos-submit-card')?.getAttribute('data-litos-receipt-identity'))
      .toContain('/acme/jobs/6131089004');
  });

  it('rejects an employer-owned colliding card and retains the durable acknowledgement', async () => {
    document.body.replaceChildren();
    const collision = createCard(null);
    await expectAcknowledgementRetained(() => collision);
    expect(collision.querySelector('#wp-submit-title')?.textContent).toBe('');
  });

  it('rejects display-none UI and retains the durable acknowledgement', async () => {
    document.body.replaceChildren();
    const card = createCard();
    card.style.display = 'none';
    await expectAcknowledgementRetained(() => card);
  });

  it('rejects hidden receipt text despite a visible outer card and retains the durable acknowledgement', async () => {
    document.body.replaceChildren();
    const card = createCard();
    card.querySelector<HTMLElement>('#wp-submit-title')!.style.display = 'none';
    card.querySelector<HTMLElement>('#wp-submit-status')!.style.display = 'none';
    await expectAcknowledgementRetained(() => card);
  });

  it('rejects aria-hidden UI and retains the durable acknowledgement', async () => {
    document.body.replaceChildren();
    const card = createCard();
    card.setAttribute('aria-hidden', 'true');
    await expectAcknowledgementRetained(() => card);
  });

  it('rejects the hidden attribute and retains the durable acknowledgement', async () => {
    document.body.replaceChildren();
    const card = createCard();
    card.hidden = true;
    await expectAcknowledgementRetained(() => card);
  });

  it('rejects computed hidden visibility and retains the durable acknowledgement', async () => {
    document.body.replaceChildren();
    const card = createCard();
    card.style.visibility = 'hidden';
    await expectAcknowledgementRetained(() => card);
  });

  it('rejects a zero-rectangle card and retains the durable acknowledgement', async () => {
    document.body.replaceChildren();
    const card = createCard();
    Object.defineProperty(card, 'getClientRects', {
      configurable: true,
      value: () => [{ width: 0, height: 0 } as DOMRect] as unknown as DOMRectList,
    });
    await expectAcknowledgementRetained(() => card);
  });

  it('rejects opacity-zero UI and retains the durable acknowledgement', async () => {
    document.body.replaceChildren();
    const card = createCard();
    card.style.opacity = '0';
    await expectAcknowledgementRetained(() => card);
  });

  it('rejects an opacity-zero ancestor and retains the durable acknowledgement', async () => {
    document.body.replaceChildren();
    const ancestor = document.createElement('section');
    ancestor.style.opacity = '0';
    document.body.appendChild(ancestor);
    const card = createCard();
    ancestor.appendChild(card);
    await expectAcknowledgementRetained(() => card);
  });

  it('rejects content-visibility-hidden UI and retains the durable acknowledgement', async () => {
    document.body.replaceChildren();
    const card = createCard();
    card.style.setProperty('content-visibility', 'hidden');
    await expectAcknowledgementRetained(() => card);
  });

  it('rejects a negative browser visibility measurement and retains the durable acknowledgement', async () => {
    document.body.replaceChildren();
    const card = createCard();
    Object.defineProperty(card, 'checkVisibility', { configurable: true, value: () => false });
    await expectAcknowledgementRetained(() => card);
  });

  it('does not create, mutate, or verify UI on a different posting or null identity', () => {
    document.body.replaceChildren();
    const ensureCard = vi.fn(createCard);
    expect(renderBoundSubmissionReceipt({
      frozenStartUrl: START_URL,
      currentUrl: 'https://job-boards.greenhouse.io/acme/jobs/8094080/confirmation',
      provenance: PROVENANCE,
      presentation: pendingSubmissionReceiptPresentation(),
      ensureCard,
    })).toBe(false);
    expect(renderBoundSubmissionReceipt({
      frozenStartUrl: 'http://job-boards.greenhouse.io/acme/jobs/6131089004',
      currentUrl: CONFIRMATION_URL,
      provenance: PROVENANCE,
      presentation: pendingSubmissionReceiptPresentation(),
      ensureCard,
    })).toBe(false);
    expect(ensureCard).not.toHaveBeenCalled();
  });

  it('keeps pending and dead-letter states nonterminal', () => {
    for (const presentation of [
      pendingSubmissionReceiptPresentation(),
      deadLetterSubmissionReceiptPresentation(),
    ]) {
      document.body.replaceChildren();
      expect(renderBoundSubmissionReceipt({
        frozenStartUrl: START_URL,
        currentUrl: CONFIRMATION_URL,
        provenance: PROVENANCE,
        presentation,
        ensureCard: createCard,
      })).toBe(true);
      expect(document.querySelector('#litos-submit-card')?.getAttribute('data-litos-receipt-terminal')).toBe('false');
      expect(document.querySelector('#wp-submit-title')?.textContent).not.toBe('Sent');
    }
  });

  it('renders Sent and consumes the acknowledgement only after exact visible DOM verification', async () => {
    document.body.replaceChildren();
    const consume = vi.fn(async () => true);
    await expect(finalizeSubmissionAcknowledgement({
      requiresSessionCleanup: false,
      cleanup: async () => undefined,
      render: async () => renderSent(createCard),
      consume,
    })).resolves.toEqual({ terminalReady: true, cleanupPending: false });
    expect(consume).toHaveBeenCalledOnce();

    const detached = createCard();
    detached.remove();
    await expectAcknowledgementRetained(() => detached);
  });
});
