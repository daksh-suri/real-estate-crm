// Contact identity normalization
// Email: trim, lower case
// Phone: remove formatting, handle Indian numbers (+91, 91, 0 prefix) to 10-digit canonical

function normalizeEmail(email) {
  if (!email || typeof email !== 'string') return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed || null;
}

function normalizePhone(phone) {
  if (!phone || typeof phone !== 'string') return null;
  // Remove all non-digit characters
  let digits = phone.replace(/\D/g, '');
  if (!digits) return null;

  // Handle Indian numbers — strip leading zeros and country code 91
  // Examples: +91 98765 43210 (12) -> 9876543210, 0919876543210 (13) -> 9876543210, 919876543210 (12) -> 9876543210
  // Remove leading zeros first (e.g., 0, 00)
  while (digits.length > 10 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  }
  if (digits.length === 10) return digits;
  // For other lengths, keep as digits (document limitation: only IN +91/0 normalized)
  // If still longer and starts with 91, try strip once more
  if (digits.length > 10 && digits.startsWith('91')) {
    const stripped = digits.slice(2);
    if (stripped.length === 10) return stripped;
  }
  return digits || null;
}

module.exports = { normalizeEmail, normalizePhone };
