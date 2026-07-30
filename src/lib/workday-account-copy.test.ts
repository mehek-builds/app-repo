import { describe, expect, it } from 'vitest';
import {
  WORKDAY_ACCOUNT_PROMPT_BODY,
  WORKDAY_ACCOUNT_PROMPT_TITLE,
  workdayAccountCompletion,
} from './workday-account-copy';

describe('Workday account disclosure', () => {
  it('says before the click that Litos can make and fill a password', () => {
    expect(WORKDAY_ACCOUNT_PROMPT_TITLE).toBe('Fill in your account details?');
    expect(WORKDAY_ACCOUNT_PROMPT_BODY).toContain('make a password');
    expect(WORKDAY_ACCOUNT_PROMPT_BODY).toContain('You still click Create Account');
  });

  it('reports exactly which account fields were filled', () => {
    expect(workdayAccountCompletion(true, true)).toContain('Email and password filled in');
    expect(workdayAccountCompletion(true, false)).toContain('Type your password');
    expect(workdayAccountCompletion(false, false)).toContain('No email on file');
  });
});
