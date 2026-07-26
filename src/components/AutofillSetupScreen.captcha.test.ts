import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const setup = readFileSync('src/components/AutofillSetupScreen.tsx', 'utf8');

describe('CAPTCHA pause-and-resume permission UI', () => {
  it('is a separate permission that starts unchecked and is saved explicitly', () => {
    expect(setup).toMatch(/const \[automaticCaptcha, setAutomaticCaptcha\] = useState\(false\)/);
    expect(setup).toMatch(/aria-label="Resume after I solve a CAPTCHA"/);
    expect(setup).toMatch(/Litos never clicks or solves the challenge/);
    expect(setup).toMatch(/automatic_captcha_enabled: automaticCaptcha/);
    expect(setup).toMatch(/setAutomaticCaptcha\(automation\.automatic_captcha_enabled\)/);
  });
});
