// Utilities: parse/build for TXT/VCF + helpers for splitting and admin
const vCardsJS = require('vcards-js');

// Existing TXT helpers
function parseNumbersFromTxt(text) {
  if (!text || typeof text !== 'string') return [];
  const rawTokens = text
    .split(/[\r\n,;]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
  return rawTokens;
}

function normalizeOne(raw) {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  if (!hasPlus && digits.startsWith('08')) return '+62' + digits.substring(1);
  if (hasPlus) return '+' + digits;
  return '+' + digits;
}

function normalizeNumbers(nums, { deduplicate = true, minDigits = 6 } = {}) {
  const out = [];
  const seen = new Set();
  for (const n of nums) {
    const normalized = normalizeOne(n);
    if (!normalized) continue;
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
    const contactName = many
      ? `${baseContactName} ${String(idx + 1)}`
      : baseContactName; // no padding
    vCard.version = '3.0';
    vCard.formattedName = contactName;
    vCard.cellPhone = num;
    const vcf = vCard.getFormattedString();
    chunks.push(vcf.trim());
  });
  const content = chunks.join('\n');
  return Buffer.from(content, 'utf8');
}

// NEW: build VCF from name-number pairs
function buildVcfFromPairs(pairs) {
  const chunks = [];
  for (const { name, number } of pairs) {
    if (!name || !number) continue;
    const vCard = vCardsJS();
    vCard.version = '3.0';
    vCard.formattedName = name;
    vCard.cellPhone = number;
    const vcf = vCard.getFormattedString();
    chunks.push(vcf.trim());
  }
  const content = chunks.join('\n');
  return Buffer.from(content, 'utf8');
}

function sanitizeFilename(name) {
  let n = String(name || '').trim();
  n = n.replace(/[/\\?%*:|"<>]/g, '');
  n = n.replace(/\s+/g, ' ').trim();
  if (!n) n = 'contacts';
  return n;
}

function ensureVcfExtension(name) {
  let n = String(name || '').trim();
  if (!n.toLowerCase().endsWith('.vcf')) n += '.vcf';
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

function deriveDefaultVcfNameFromXlsx(xlsxName) {
  if (!xlsxName) return 'contacts.vcf';
  const base = xlsxName.replace(/\.(xlsx|xls)$/i, '');
  return ensureVcfExtension(sanitizeFilename(base));
}

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
  if (!n.toLowerCase().endsWith('.txt')) n += '.txt';
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

function parseNumbersFromVcf(text) {
  const unfolded = unfoldVcf(text);
  const lines = unfolded.split('\n');
  const numbers = [];
  const telRegex = /^(?:item\d+\.)?tel(?:;[^:]*)?:(.+)$/i;
  for (let line of lines) {
    const m = line.match(telRegex);
    if (!m) continue;
    let val = m[1].trim();
    if (/^tel:/i.test(val)) val = val.replace(/^tel:/i, '');
    const parts = val.split(/[,]/).map((s) => s.trim()).filter(Boolean);
    for (const p of parts) numbers.push(p);
  }
  return numbers;
}

// ---------- Split helpers ----------
function splitVcfIntoBlocks(text) {
  if (!text || typeof text !== 'string') return [];
  const re = /BEGIN:VCARD[\s\S]*?END:VCARD/gi;
  const blocks = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    blocks.push(m[0].trim());
  }
  return blocks;
}

function buildVcfFromBlocks(blocks) {
  const content = blocks.join('\n') + (blocks.length ? '\n' : '');
  return Buffer.from(content, 'utf8');
}

// For splitting TXT: preserve lines order, remove empty lines; do not normalize/dedup
function parseLinesFromTxtRaw(text) {
  if (!text || typeof text !== 'string') return [];
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function buildTxtFromLines(lines) {
  const content = lines.join('\n') + (lines.length ? '\n' : '');
  return Buffer.from(content, 'utf8');
}

function splitArrayByFixedSize(arr, size) {
  const out = [];
  if (size <= 0) return out;
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function splitArrayIntoNParts(arr, parts) {
  const n = Math.max(1, Math.min(parts, arr.length));
  const out = [];
  const base = Math.floor(arr.length / n);
  let rem = arr.length % n;
  let idx = 0;
  for (let i = 0; i < n; i++) {
    const take = base + (rem > 0 ? 1 : 0);
    rem = Math.max(0, rem - 1);
    out.push(arr.slice(idx, idx + take));
    idx += take;
  }
  return out;
}

function getLowerExt(name) {
  const m = String(name || '').match(/\.([a-z0-9]+)$/i);
  return m ? `.${m[1].toLowerCase()}` : '';
}

function removeExt(name) {
  return String(name || '').replace(/\.[^.]+$/i, '');
}

function generateDefaultSequentialNamesFromSource(sourceName, count) {
  const ext = getLowerExt(sourceName);
  const base = sanitizeFilename(removeExt(sourceName));
  if (ext === '.vcf') {
    return generateSequentialFilenames(base, count);
  }
  if (ext === '.txt') {
    return generateSequentialTextFilenames(base, count);
  }
  // fallback .txt
  return generateSequentialTextFilenames(base, count);
}

function generateCustomSequentialNames(baseInput, count, ext) {
  const base = sanitizeFilename(baseInput || '');
  if (ext === '.vcf') {
    return generateSequentialFilenames(base, count);
  }
  return generateSequentialTextFilenames(base, count);
}

module.exports = {
  // TXT helpers
  parseNumbersFromTxt,
  normalizeNumbers,
  buildVcf,
  buildVcfFromPairs,
  sanitizeFilename,
  ensureVcfExtension,
  stripVcfExtension,
  deriveDefaultVcfNameFromTxt,
  deriveDefaultVcfNameFromXlsx,
  generateSequentialFilenames,

  // TXT filenames
  ensureTxtExtension,
  stripTxtExtension,
  deriveDefaultTxtNameFromVcf,
  generateSequentialTextFilenames,

  // VCF parse
  unfoldVcf,
  parseNumbersFromVcf,

  // Split helpers
  splitVcfIntoBlocks,
  buildVcfFromBlocks,
  parseLinesFromTxtRaw,
  buildTxtFromLines,
  splitArrayByFixedSize,
  splitArrayIntoNParts,
  getLowerExt,
  removeExt,
  generateDefaultSequentialNamesFromSource,
  generateCustomSequentialNames,
};
