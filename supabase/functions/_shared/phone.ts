export function normalizePhoneCountryCode(value = ''): string {
  const digits = String(value).replace(/\D/g, '').slice(0, 3);
  return digits ? `+${digits}` : '';
}

export function normalizePhoneNumber(value = ''): string {
  return String(value).replace(/\D/g, '').slice(0, 15);
}

export function isValidPhone(countryCode: string, phoneNumber: string): boolean {
  const normalizedCountry = normalizePhoneCountryCode(countryCode);
  const normalizedNumber = normalizePhoneNumber(phoneNumber);
  if (!/^\+[1-9]\d{0,2}$/.test(normalizedCountry)) return false;
  if (normalizedCountry === '+55') return /^\d{11}$/.test(normalizedNumber);
  return /^\d{8,15}$/.test(normalizedNumber);
}
