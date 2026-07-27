import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The extension is a THIRD writer of automatic_submission_enabled, and the one nobody thinks of.
 *
 * The backend refuses to enable unattended submission until the student has approved a few
 * applications themselves. The extension's setup screen writes the same flag through
 * PUT /onboarding/automation, so the gate holds, but the failure landed in the wrong place: the
 * call sat inside the same try as the experience bank and the application profile, so a refused
 * toggle threw, reported "Could not save your setup", and bounced the student back to a form whose
 * contents had already been written. They would have saved it twice to fix nothing.
 *
 * Source-text assertions, because the alternative is mounting the whole popup to prove a try/catch
 * boundary. What matters is the SHAPE: the permissions call is not in the same failure domain as
 * the data save, and the local switch cannot outlive a server refusal.
 */
const screen = readFileSync(
  path.join(__dirname, '..', 'components', 'AutofillSetupScreen.tsx'),
  'utf8',
);

describe('the automation permission is saved separately from the setup data', () => {
  it('a refused toggle does not discard the bank and profile save', () => {
    const bankSave = screen.indexOf('await putExperienceBank(');
    const firstCatch = screen.indexOf('} catch (err) {', bankSave);
    const automationSave = screen.indexOf('await putAutomationSettings(');
    expect(bankSave).toBeGreaterThan(-1);
    expect(automationSave).toBeGreaterThan(-1);
    expect(automationSave).toBeGreaterThan(firstCatch);
  });

  it('a server refusal forces the LOCAL switch off', () => {
    // Otherwise the extension counts down and clicks submit on a permission the backend never
    // granted, which is the exact outcome the gate exists to prevent.
    const automationSave = screen.indexOf('await putAutomationSettings(');
    const tail = screen.slice(automationSave);
    expect(tail).toMatch(/catch[\s\S]{0,400}setAutoSubmitEnabled\(false\)/);
  });

  it('the toggle is locked while ineligible and never locked while it is on', () => {
    expect(screen).toMatch(/disabled=\{!automationSettingsLoaded \|\| \(!autoSubmit && consentEligibility\?\.eligible === false\)\}/);
  });

  it('the lock says how many are left rather than just refusing', () => {
    // JSX wraps the sentence, so the count and the words can be split across lines.\n    expect(screen).toMatch(/consentEligibility\.remaining\}[\s\S]{0,40}go/);
  });
});
