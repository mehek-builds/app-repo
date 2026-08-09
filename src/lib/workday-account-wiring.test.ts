import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const background = readFileSync('src/entrypoints/background.ts', 'utf8');
const content = readFileSync('src/entrypoints/content.ts', 'utf8');
const storage = readFileSync('src/lib/storage.ts', 'utf8');

describe('Workday account flow wiring', () => {
  it('uses the frozen packet application id for the pinned-email verification route', () => {
    expect(background).toMatch(/case 'GET_WORKDAY_VERIFICATION_CODE'/);
    expect(background).toMatch(/applications\/\$\{applicationId\}\/workday-verification-code/);
    expect(content).toMatch(/applicationId: pending\.applicationId/);
  });

  it('never stores the raw derived password or verification code', () => {
    expect(storage).not.toMatch(/password\s*:/i);
    expect(storage).not.toMatch(/verificationCode|verification_code|\bcode\s*:/i);
    expect(storage).toMatch(/saltFingerprint/);
  });

  it('activates a tenant account only after positive Workday receipt proof', () => {
    const proof = content.indexOf('workdayAccountReceiptProof(identity.email)');
    const activation = content.indexOf("type: 'ACTIVATE_WORKDAY_ACCOUNT'", proof);
    expect(proof).toBeGreaterThan(-1);
    expect(activation).toBeGreaterThan(proof);
    expect(content.slice(activation, activation + 300)).toMatch(/email: identity\.email/);
  });

  it('keeps first-claim mutation in the single background context', () => {
    expect(background).toMatch(/case 'CLAIM_WORKDAY_ACCOUNT'/);
    expect(background).toMatch(/recordPendingPortalAccount/);
    expect(content).not.toMatch(/from '\.\.\/lib\/storage'/);
  });

  it('abandons a newly acquired claim whenever no account click starts', () => {
    expect(content).toMatch(/runBoundedWorkdayAccountAction/);
    expect(content).toMatch(/ABANDON_WORKDAY_ACCOUNT_CLAIM/);
  });

  it('never sends a verification continuation through an application submit selector', () => {
    expect(content).toMatch(/findWorkdayVerificationContinue/);
    expect(content).not.toMatch(/GET_WORKDAY_VERIFICATION_CODE[\s\S]{0,1800}findFinalSubmitButton/);
  });

  it('guards account work behind a trusted pointer event', () => {
    const handler = content.indexOf("addEventListener('click', async (event)");
    expect(handler).toBeGreaterThan(-1);
    expect(content.slice(handler, handler + 220)).toMatch(/isTrustedWorkdayAccountIntent\(event\)/);
  });

  it('revalidates the exact Workday final control in dashboard and countdown paths', () => {
    expect(content).toMatch(/findProgrammaticFinalSubmitButton\(fillResult\.ats_name\) !== finalSubmitBtn/);
    expect(content).toMatch(/safeAfterReservation[\s\S]{0,700}workdayProgrammaticFinalSubmitAllowed\(target\)/);
    expect(content.match(/workdayProgrammaticFinalSubmitAllowed\(target\)/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
