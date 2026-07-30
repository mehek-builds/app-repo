export const WORKDAY_ACCOUNT_PROMPT_TITLE = 'Fill in your account details?';

export const WORKDAY_ACCOUNT_PROMPT_BODY =
  'Litos can fill your email and make a password. You still click Create Account.';

export function workdayAccountCompletion(
  emailAvailable: boolean,
  passwordFilled: boolean,
): string {
  if (!emailAvailable) {
    return 'No email on file yet. Fill it in, set your password, then click Create Account.';
  }
  if (passwordFilled) {
    return 'Email and password filled in. Check them, then click Create Account.';
  }
  return 'Email filled in. Type your password, then click Create Account.';
}
