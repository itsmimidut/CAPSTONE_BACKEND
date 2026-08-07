export function maskCustomerName(name) {
  const normalized = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!normalized) return 'Verified Guest';
  const parts = normalized.split(' ');
  if (parts.length === 1) return parts[0];
  const firstName = parts[0];
  const initial = parts[parts.length - 1].charAt(0).toUpperCase();
  return initial ? `${firstName} ${initial}.` : firstName;
}

export function getPublicCustomerName({ isAnonymous, customerName }) {
  return Boolean(isAnonymous)
    ? 'Anonymous Guest'
    : maskCustomerName(customerName);
}
