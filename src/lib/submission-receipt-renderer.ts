import { applicationFormIdentityKey } from './web-handoff';
import type { SubmissionReceiptPresentation } from './submission-receipt-ui';

type VisibilityCapableElement = HTMLElement & {
  checkVisibility?: (options?: {
    checkOpacity?: boolean;
    checkVisibilityCSS?: boolean;
  }) => boolean;
};

function ancestorStylesPermitVisibility(card: HTMLElement): boolean {
  let element: HTMLElement | null = card;
  while (element) {
    if (element.hidden || element.getAttribute('aria-hidden')?.toLowerCase() === 'true') return false;
    const style = getComputedStyle(element);
    if (style.display === 'none'
      || style.visibility !== 'visible'
      || Number.parseFloat(style.opacity) === 0
      || style.getPropertyValue('content-visibility') === 'hidden') return false;
    element = element.parentElement;
  }
  return true;
}

function visiblyMeasured(card: HTMLElement): boolean {
  const styleProof = ancestorStylesPermitVisibility(card);
  if (!styleProof) return false;

  const checkVisibility = (card as VisibilityCapableElement).checkVisibility;
  if (typeof checkVisibility === 'function') {
    try {
      if (!checkVisibility.call(card, {
        checkOpacity: true,
        checkVisibilityCSS: true,
      })) return false;
    } catch {
      // The ancestor walk above is the conservative fallback for older implementations.
    }
  }

  return [...card.getClientRects()].some((rect) => rect.width > 0 && rect.height > 0);
}

export function renderBoundSubmissionReceipt(input: {
  frozenStartUrl: string;
  currentUrl: string;
  provenance: string;
  presentation: SubmissionReceiptPresentation;
  ensureCard: () => HTMLElement | null;
  setTerminalIcon?: (icon: HTMLElement) => void;
}): boolean {
  const frozenIdentity = applicationFormIdentityKey(input.frozenStartUrl);
  const currentIdentity = applicationFormIdentityKey(input.currentUrl);
  if (!frozenIdentity || !currentIdentity || frozenIdentity !== currentIdentity) return false;

  const card = input.ensureCard();
  const title = card?.querySelector<HTMLElement>('#wp-submit-title') ?? null;
  const status = card?.querySelector<HTMLElement>('#wp-submit-status') ?? null;
  const icon = card?.querySelector<HTMLElement>('#wp-submit-icon') ?? null;
  if (!card?.isConnected
    || !input.provenance
    || card.dataset.litosReceiptProvenance !== input.provenance
    || !title
    || !status) return false;

  card.dataset.litosReceiptIdentity = frozenIdentity;
  card.dataset.litosReceiptTerminal = input.presentation.terminal ? 'true' : 'false';
  title.textContent = input.presentation.title;
  status.textContent = input.presentation.status;
  if (input.presentation.terminal && icon && input.setTerminalIcon) input.setTerminalIcon(icon);

  return card.isConnected
    && visiblyMeasured(card)
    && visiblyMeasured(title)
    && visiblyMeasured(status)
    && card.dataset.litosReceiptProvenance === input.provenance
    && card.dataset.litosReceiptIdentity === frozenIdentity
    && card.dataset.litosReceiptTerminal === String(input.presentation.terminal)
    && title.textContent === input.presentation.title
    && status.textContent === input.presentation.status;
}
