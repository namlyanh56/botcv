// Utilities: parse numbers, normalize, and build VCF/TXT content
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

    vCard.version = '3.0';
    vCard.formattedName = contactName;
    vCard.cellPhone = num;

    const vcf = vCard.getFormattedString();
    chunks.push(vcf.trim());
  });

  const content = chunks.join('\n');
  return Buffer.from(content, 'utf8');
}

function sanitizeFilename(name) {
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
    const prefix = base.slice(0, -digits.length);
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

// ---------- VCF -> TXT helpers ----------

function ensureTxtExtension(name) {
  let n = String(name || '').trim();
  if (!n.toLowerCase().endsWith('.txt')) {
    n += '.txt';
  }
  return n;
}

function stripTxtExtension(name) {
  if (!name) return '';
  return String(name).replace(/\.txt$/i, '');
}

function deriveDefaultTxtNameFromVcf(vcfName) {
  if (!vcfName) return 'numbers.txt';
  const base = vcfName.replace(/\.vcf$/i, '');
  return ensureTxtExtension(sanitizeFilename(base));
}

/**
 * Generate sequential .txt filenames for multiple files, similar to generateSequentialFilenames.
 * - If count === 1 -> base.txt
 * - If base ends with digits: DF10.txt, DF11.txt, ...
 * - Else: base 1.txt, base 2.txt, ...
 */
function generateSequentialTextFilenames(baseInput, count) {
  const base = sanitizeFilename(stripTxtExtension(baseInput || 'numbers'));
  const results = [];

  if (count <= 1) {
    results.push(ensureTxtExtension(base));
    return results;
  }

  const m = base.match(/(\d+)$/);
  if (m) {
    const digits = m[1];
    const prefix = base.slice(0, -digits.length);
    let start = parseInt(digits, 10);
    for (let i = 0; i < count; i++) {
      const name = `${prefix}${start + i}`;
      results.push(ensureTxtExtension(sanitizeFilename(name)));
    }
  } else {
    for (let i = 0; i < count; i++) {
      const name = `${base} ${i + 1}`;
      results.push(ensureTxtExtension(sanitizeFilename(name)));
    }
  }
  return results;
}

/**
 * Unfold VCF lines: join lines that start with space or tab to the previous line.
 */
function unfoldVcf(text) {
  if (!text || typeof text !== 'string') return '';
  const raw = text.replace(/\r\n/g, '\n');
  const lines = raw.split('\n');
  const out = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && out.length > 0) {
      out[out.length - 1] += line.replace(/^[ \t]+/, '');
    } else {
      out.push(line);
    }
  }
  return out.join('\n');
}

/**
 * Extract phone numbers from a VCF text by collecting TEL fields.
 * Supports formats like:
 * - TEL:+6281...
 * - TEL;TYPE=CELL:+6281...
 * - TEL;VALUE=uri:tel:+6281...
 * - item1.TEL:+6281...
 */
function parseNumbersFromVcf(text) {
  const unfolded = unfoldVcf(text);
  const lines = unfolded.split('\n');
  const numbers = [];

  const telRegex = /^(?:item\d+\.)?tel(?:;[^:]*)?:(.+)$/i;

  for (let line of lines) {
    const m = line.match(telRegex);
    if (!m) continue;
    let val = m[1].trim();

    // Handle tel: prefix if present
    if (/^tel:/i.test(val)) {
      val = val.replace(/^tel:/i, '');
    }

    // Some cards might have multiple values separated by commas; split cautiously
    const parts = val.split(/[,]/).map(s => s.trim()).filter(Boolean);
    for (const p of parts) {
      numbers.push(p);
    }
  }

  return numbers;
}

module.exports = {
  // TXT helpers
  parseNumbersFromTxt,
  normalizeNumbers,
  buildVcf,
  sanitizeFilename,
  ensureVcfExtension,
  deriveDefaultVcfNameFromTxt,
  stripVcfExtension,
  generateSequentialFilenames,

  // VCF -> TXT helpers
  ensureTxtExtension,
  stripTxtExtension,
  deriveDefaultTxtNameFromVcf,
  generateSequentialTextFilenames,
  unfoldVcf,
  parseNumbersFromVcf,
};
