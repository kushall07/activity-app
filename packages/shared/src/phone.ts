import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min';

/**
 * Normalises user-entered phone numbers to E.164 (e.g. "98765 43210" -> "+919876543210").
 * India is the default region because the app launches in Bengaluru.
 * Returns null for anything that is not a valid mobile-capable number.
 */
export function normalizePhone(input: string, defaultCountry: CountryCode = 'IN'): string | null {
  const parsed = parsePhoneNumberFromString(input.trim(), defaultCountry);
  if (!parsed || !parsed.isValid()) return null;
  const type = parsed.getType();
  // `min` metadata cannot always tell mobile from fixed line; reject only known non-mobile types.
  if (type && !['MOBILE', 'FIXED_LINE_OR_MOBILE'].includes(type)) return null;
  return parsed.number;
}

/** "+919876543210" -> "+91 98765 43210" for display. */
export function formatPhone(e164: string): string {
  return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
}
