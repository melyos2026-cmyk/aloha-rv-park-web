// Resident portal password requirements — stricter than a typical login
// because residents may store payment info (autopay) on their account.
export const PASSWORD_REQUIREMENTS_TEXT =
  "At least 9 characters, with 1 uppercase letter, 1 lowercase letter, 1 number, and 1 special character.";

export function validatePassword(password: string): string | null {
  if (password.length < 9) return PASSWORD_REQUIREMENTS_TEXT;
  if (!/[A-Z]/.test(password)) return PASSWORD_REQUIREMENTS_TEXT;
  if (!/[a-z]/.test(password)) return PASSWORD_REQUIREMENTS_TEXT;
  if (!/[0-9]/.test(password)) return PASSWORD_REQUIREMENTS_TEXT;
  if (!/[^A-Za-z0-9]/.test(password)) return PASSWORD_REQUIREMENTS_TEXT;
  return null;
}
