export const WORKDAY_ACCOUNT_PROMPT_TITLE = 'Fill in your account details?';

export const WORKDAY_ACCOUNT_PROMPT_BODY =
  'Litos uses your application email and makes a unique password on this device. ' +
  'It creates or signs in only for an account it made, and stops for CAPTCHA or consent.';

export interface WorkdayAccountCompletion {
  creatingAccount: boolean;
  emailFilled: boolean;
  passwordFilled: boolean;
  passwordWithheldReason?: string;
  blockingReason?: string;
  actionStarted?: 'create' | 'sign_in';
}

export function workdayAccountCompletion(result: WorkdayAccountCompletion): string {
  if (result.blockingReason) {
    const prefix = result.emailFilled || result.passwordFilled ? 'Safe account fields filled. ' : '';
    return `${prefix}${result.blockingReason}`;
  }
  if (result.actionStarted === 'create') return 'Account creation started. Waiting for Workday to confirm it.';
  if (result.actionStarted === 'sign_in') return 'Sign-in started. Waiting for Workday to confirm it.';
  if (result.passwordFilled) {
    const fields = result.emailFilled ? 'Email and password' : 'Password';
    return result.creatingAccount
      ? `${fields} filled. Review the fields, then click Create Account yourself.`
      : `${fields} filled. Review the fields, then sign in yourself.`;
  }

  if (result.emailFilled) {
    return result.passwordWithheldReason
      ? `Email filled. ${result.passwordWithheldReason}`
      : 'Email filled. Enter your password yourself. Litos did not submit the form.';
  }

  return result.passwordWithheldReason
    ? `Nothing was changed. ${result.passwordWithheldReason}`
    : 'Nothing was changed. Complete the account fields yourself.';
}
