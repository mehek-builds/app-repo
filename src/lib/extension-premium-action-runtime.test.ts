import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const background = readFileSync(new URL('../entrypoints/background.ts', import.meta.url), 'utf8');
const content = readFileSync(new URL('../entrypoints/content.ts', import.meta.url), 'utf8');
const popup = readFileSync(new URL('../entrypoints/popup/App.tsx', import.meta.url), 'utf8');
const mainScreen = readFileSync(new URL('../components/MainScreen.tsx', import.meta.url), 'utf8');
const draftEditor = readFileSync(new URL('../components/DraftEditor.tsx', import.meta.url), 'utf8');

describe('extension premium action runtime', () => {
  it('creates and owner-stores a pending action before opening extension pricing', () => {
    const handler = background.slice(
      background.indexOf("case 'OPEN_LITOS_PLANS'"),
      background.indexOf("case 'OPEN_MANUAL_OUTREACH'"),
    );
    expect(handler).toContain('sanitizeExtensionPremiumAction(trigger, message.action_context)');
    expect(handler).toContain('await refreshEntitlementSnapshot(token, plansAuthEpoch)');
    expect(handler).toContain('await createExtensionPremiumAction(');
    expect(handler).toContain("url.searchParams.set('action_nonce', actionNonce)");
    expect(handler.indexOf('await createExtensionPremiumAction(')).toBeLessThan(handler.indexOf('await chrome.tabs.create'));

    const creator = background.slice(
      background.indexOf('async function createExtensionPremiumAction'),
      background.indexOf('function parsePendingPremiumRetryFocus'),
    );
    expect(creator).toContain("timeoutBackendFetch('/billing/actions'");
    expect(creator).toContain('idempotency_key: idempotencyKey');
    expect(creator).toContain('contact_id: context.contact_id');
    expect(creator).toContain('body?.offer_id !== null');
    expect(creator).toContain('account_id: accountId');
    expect(creator).toContain('await storeExtensionPremiumAction(pending, authEpoch)');
  });

  it('binds checkout to the local and server action and forwards the exact nonce', () => {
    const checkout = background.slice(
      background.indexOf("if (message?.type === 'LITOS_CREATE_CHECKOUT')"),
      background.indexOf("if (message?.type === 'LITOS_RETRY_PREMIUM_ACTION')"),
    );
    expect(checkout).toContain('pendingAction.account_id !== checkoutOwner.account_id');
    expect(checkout).toContain('pendingAction.action_nonce !== actionNonce');
    expect(checkout).toContain('await readServerPremiumAction(token, actionNonce, checkoutAuthEpoch)');
    expect(checkout).toContain('await storeVerifiedPremiumActionExpiry(');
    expect(checkout).toContain('action_nonce: actionNonce');
    expect(checkout).toMatch(/response\.status === 202[\s\S]*?code: 'checkout_creating'/);
    expect(checkout).toContain('await readServerCheckoutOffer(token, body.offer_id, checkoutAuthEpoch)');
    expect(checkout).toContain('verifiedServerCheckoutExpiry(');
    expect(checkout).toContain('verifiedServerPremiumActionExpiry(pendingAction, serverAction, [\'pending\'])');
    expect(checkout).toContain('actionExpiresAt !== checkoutExpiresAt');
    expect(checkout).toMatch(/litos_pending_checkout:[\s\S]*?offer_id: body\.offer_id,[\s\S]*?account_id: checkoutOwner\.account_id,[\s\S]*?action_nonce[\s\S]*?expires_at: checkoutExpiresAt/);
    expect(checkout).toContain("expires_at: new Date(checkoutExpiresAt).toISOString()");
    expect(checkout).not.toContain('pendingAction.expires_at <= Date.now()');
    expect(checkout).toMatch(/if \(!authEpochIsCurrent\(checkoutAuthEpoch\)\)[\s\S]*?remove\('litos_pending_checkout'\)/);
  });

  it('verifies return account, nonce, and offer while cancellation preserves action context', () => {
    const checkoutReturn = background.slice(
      background.indexOf("message?.type === 'LITOS_ENTITLEMENTS_CHANGED'"),
      background.indexOf("if (message?.type === 'LITOS_PING')"),
    );
    expect(checkoutReturn).toContain('checkoutReturnMismatch(');
    expect(checkoutReturn).toContain('message.action_nonce');
    expect(checkoutReturn).toContain('await readServerCheckoutOffer(');
    expect(checkoutReturn).toContain('verifiedServerCheckoutExpiry(');
    expect(checkoutReturn).toContain('serverAction.offer_id !== pending.offer_id');
    expect(checkoutReturn).toContain('verifiedServerPremiumActionExpiry(');
    expect(checkoutReturn).toContain("['pending', 'consumed']");
    expect(checkoutReturn).toContain('actionExpiresAt !== checkoutExpiresAt');
    expect(checkoutReturn).toContain('checkoutActionReady = !cancelled');
    expect(checkoutReturn).toContain('featureEnabled(snapshot, verifiedPendingAction.feature_key)');
    expect(checkoutReturn).toContain('{ action_ready: checkoutActionReady }');
    expect(checkoutReturn).toContain("if (cancelled || (active && !pending?.action_nonce))");
    expect(checkoutReturn).not.toContain('pendingAction.expires_at <= Date.now()');
    expect(checkoutReturn).not.toContain('remove(PENDING_PREMIUM_ACTION_KEY)');
  });

  it('consumes only after explicit Retry, rechecks entitlement, and retains restore context', () => {
    const retry = background.slice(
      background.indexOf("if (message?.type === 'LITOS_RETRY_PREMIUM_ACTION')"),
      background.indexOf("message?.type === 'LITOS_ENTITLEMENTS_CHANGED'"),
    );
    expect(retry).toContain('await refreshEntitlementSnapshot(token, retryAuthEpoch)');
    expect(retry).toContain('readServerCheckoutOffer(token, pendingCheckout.offer_id, retryAuthEpoch)');
    expect(retry).toContain('verifiedServerCheckoutExpiry(');
    expect(retry).toContain('verifiedServerPremiumActionExpiry(');
    expect(retry).toContain('actionExpiresAt !== checkoutExpiresAt');
    expect(retry).toContain('featureEnabled(snapshot, verifiedPendingAction.feature_key)');
    expect(retry).toContain('serverAction.offer_id !== pendingCheckout.offer_id');
    expect(retry).toContain('chrome.storage.session.set({ litos_pending_checkout: verifiedPendingCheckout })');
    expect(retry).not.toContain('pendingAction.expires_at <= Date.now()');
    expect(retry).toContain('`/billing/actions/${encodeURIComponent(actionNonce)}/consume`');
    expect(retry.indexOf('/consume`')).toBeLessThan(retry.indexOf('await restoreExtensionPremiumActionControl'));
    expect(retry.indexOf('await storeExtensionPremiumAction(consumedPending')).toBeLessThan(retry.indexOf('await restoreExtensionPremiumActionControl'));
    expect(retry.indexOf('await restoreExtensionPremiumActionControl')).toBeLessThan(retry.indexOf("remove('litos_pending_checkout')"));
    expect(retry).toContain('return { ok: true, opened: true }');
    expect(retry).toContain('consumed.contact_id');
  });

  it('restores and focuses only a named Litos control without executing the paid action', () => {
    const restore = background.slice(
      background.indexOf('async function restoreExtensionPremiumActionControl'),
      background.indexOf('async function pendingFreeSubmissionMonitor'),
    );
    const focus = content.slice(
      content.indexOf('function focusPremiumRetryControl'),
      content.indexOf("if (message?.type === 'GET_CURRENT_APPLICATION_URL')"),
    );
    expect(restore).toContain("retryUrl.searchParams.set('retry_action', pending.feature_key)");
    expect(restore).toContain("retryUrl.searchParams.set('company', pending.company)");
    expect(restore).toContain("retryUrl.searchParams.set('action_nonce', pending.action_nonce)");
    expect(restore).toContain("type: 'FOCUS_PREMIUM_RETRY_CONTROL'");
    expect(restore).not.toMatch(/\.click\(/);
    expect(focus).toContain('premiumRetryControlSelector(feature)');
    expect(focus).toContain('control.focus({ preventScroll: true })');
    expect(focus).not.toMatch(/\.click\(/);
    expect(popup).toContain("retryAction === 'contact_discovery' && retryCompany && retryRole");
    expect(popup).toContain("focusContactDiscovery={retryAction === 'contact_discovery'}");
    expect(mainScreen).toContain('id="litos-contact-discovery-control"');
    expect(mainScreen).toContain("document.getElementById('litos-contact-discovery-control')?.focus");
  });

  it('restores owner-validated selected-contact DraftEditor context without auto-generation', () => {
    const contextHandler = background.slice(
      background.indexOf("case 'GET_PREMIUM_RETRY_ACTION_CONTEXT'"),
      background.indexOf("case 'COMPLETE_PREMIUM_RETRY_FOCUS'"),
    );
    expect(contextHandler).toContain("sender.url.startsWith(popupUrl)");
    expect(contextHandler).toContain("pending.feature_key !== 'outreach_email_generation'");
    expect(contextHandler).toContain('pending.contact_id');
    expect(contextHandler).toContain('pending.contact');
    expect(contextHandler).toContain('await storeVerifiedPremiumActionExpiry(');
    expect(contextHandler).toContain("['consumed']");
    expect(contextHandler).not.toContain('pending.expires_at <= Date.now()');
    expect(popup).toContain("type: 'GET_PREMIUM_RETRY_ACTION_CONTEXT'");
    expect(popup).toContain("setScreen('draft')");
    expect(popup).toContain('deferGeneration={Boolean(restoredOutreachAction)}');
    expect(draftEditor).toContain('id="litos-outreach-generation-control"');
    expect(draftEditor).toContain("document.getElementById('litos-outreach-generation-control')?.focus");
    const effect = draftEditor.slice(
      draftEditor.indexOf('useEffect(() => {'),
      draftEditor.indexOf('useEffect(() => {', draftEditor.indexOf('useEffect(() => {') + 1),
    );
    expect(effect).toMatch(/if \(deferGeneration\)[\s\S]*?return;[\s\S]*?void runGeneration\(\)/);
  });
});
