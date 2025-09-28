// Utilities: parse numbers, normalize, and build VCF content
const vCardsJS = require('vcards-js');

// Split text into number tokens by newline/comma/semicolon
function parseNumbersFromTxt(text) {
  if (!text || typeof text !== 'string') return [];
  const rawTokens = text
    .split(/[\r\n,;]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
  return rawTokens;
}

// Normalize one number according to requested rules
function normalizeOne(raw) {
  if (!raw) return '';

  const trimmed = String(raw).trim();

  // Detect if original has leading '+'
  const hasPlus = trimmed.startsWith('+');

  // Keep digits only for the rest
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';

  // Special case: if starts with '08' (local ID), convert to +62 and drop leading '0'
  if (!hasPlus && digits.startsWith('08')) {
    // '08123456789' -> '+628123456789'
    return '+62' + digits.substring(1);
  }

  // If already had '+', keep '+' and digits only
  if (hasPlus) {
    return '+' + digits;
  }

  // Otherwise, just prefix '+'
  return '+' + digits;
}

function normalizeNumbers(nums, { deduplicate = true, minDigits = 6 } = {}) {
  const out = [];
  const seen = new Set();

  for (const n of nums) {
    const normalized = normalizeOne(n);
    if (!normalized) continue;

    // Ensure minimum digit length (after removing '+')
    const onlyDigits = normalized.replace(/\D/g, '');
    if (onlyDigits.length < minDigits) continue;

    if (deduplicate) {
      if (seen.has(normalized)) continue;
      seen.add(normalized);
    }
    out.push(normalized);
  }

  return out;
}

function buildVcf(numbers, baseContactName) {
  const many = numbers.length > 1;
  const chunks = [];

  numbers.forEach((num, idx) => {
    const vCard = vCardsJS();
    const contactName = many ? `${baseContactName} ${String(idx + 1).padStart(3, '0')}` : baseContactName;

    // Set vCard fields
    vCard.version = '3.0';
    vCard.formattedName = contactName;
    vCard.cellPhone = num;

    const vcf = vCard.getFormattedString(); // includes BEGIN/END:VCARD
    chunks.push(vcf.trim());
  });

  const content = chunks.join('\n');
  return Buffer.from(content, 'utf8');
}

function sanitizeFilename(name) {
  // Remove invalid filename characters and trim
  let n = String(name || '').trim();
  n = n.replace(/[/\\?%*:|"<>]/g, ''); // Windows-invalid chars
  n = n.replace(/\s+/g, ' ').trim();
  if (!n) n = 'contacts';
  return n;
}

function ensureVcfExtension(name) {
  let n = String(name || '').trim();
  if (!n.toLowerCase().endsWith('.vcf')) {
    n += '.vcf';
  }
  return n;
}

function stripVcfExtension(name) {
  if (!name) return '';
  return String(name).replace(/\.vcf$/i, '');
}

function deriveDefaultVcfNameFromTxt(txtName) {
  if (!txtName) return 'contacts.vcf';
  const base = txtName.replace(/\.txt$/i, '');
  return ensureVcfExtension(sanitizeFilename(base));
}

/**
 * Generate sequential filenames for multiple files based on a base input.
 * Rules:
 * - If count === 1: return [base.vcf] (no numbering).
 * - If base ends with digits (e.g., "DF10"): produce ["DF10.vcf", "DF11.vcf", ...]
 * - Otherwise: produce ["base 1.vcf", "base 2.vcf", ...]
 */
function generateSequentialFilenames(baseInput, count) {
  const base = sanitizeFilename(stripVcfExtension(baseInput || 'contacts'));
  const results = [];

  if (count <= 1) {
    results.push(ensureVcfExtension(base));
    return results;
  }

  const m = base.match(/(\d+)$/);
  if (m) {
    const digits = m[1];
    const prefix = base.slice(0, -digits.length); // keep any spaces as typed
    let start = parseInt(digits, 10);
    for (let i = 0; i < count; i++) {
      const name = `${prefix}${start + i}`;
      results.push(ensureVcfExtension(sanitizeFilename(name)));
    }
  } else {
    for (let i = 0; i < count; i++) {
      const name = `${base} ${i + 1}`;
      results.push(ensureVcfExtension(sanitizeFilename(name)));
    }
  }
  return results;
}

module.exports = {
  parseNumbersFromTxt,
  normalizeNumbers,
  buildVcf,
  sanitizeFilename,
  ensureVcfExtension,
  deriveDefaultVcfNameFromTxt,
  stripVcfExtension,
  generateSequentialFilenames,
};
