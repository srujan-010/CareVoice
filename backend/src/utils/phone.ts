import { ValidationError } from './errors';

/**
 * Strict ITU-T E.164 phone number regex:
 * Must begin with '+' followed by country code [1-9] and 7 to 15 total digits.
 */
export const E164_PHONE_REGEX = /^\+[1-9]\d{6,14}$/;

export function isValidE164PhoneNumber(phone: string): boolean {
  if (typeof phone !== 'string') return false;
  return E164_PHONE_REGEX.test(phone.trim());
}

/**
 * Normalizes spacing/punctuation ONLY if the number already starts with '+',
 * and enforces strict E.164 formatting (+<country><subscriber>, 7-15 digits).
 */
export function normalizeAndValidateE164(phone: string, fieldName = 'phoneNumber'): string {
  if (typeof phone !== 'string') {
    throw new ValidationError(`${fieldName} must be a string in E.164 format (e.g., +919876543210)`);
  }

  const trimmed = phone.trim();
  if (!trimmed.startsWith('+')) {
    throw new ValidationError(
      `${fieldName} must be in E.164 format starting with '+' and country code (e.g., +919876543210)`
    );
  }

  const cleaned = `+${trimmed.slice(1).replace(/[\s()-]/g, '')}`;
  if (!E164_PHONE_REGEX.test(cleaned)) {
    throw new ValidationError(
      `${fieldName} must be a valid E.164 phone number (+ followed by 7 to 15 digits, no leading 0)`
    );
  }

  return cleaned;
}

