// Flow state machine for 👤CV Admin👤 (convert structured message -> VCF)
const fs = require('fs');
const path = require('path');

// Safe optional stop manager
let stop = { shouldStop: () => false, snapshot: () => 0, shouldAbort: () => false };
try { stop = require('./stopManager'); } catch (_) {}

const {
  actions,
  getCancelMenu,
  getMainMenu,
} = require('./keyboards');

const {
  normalizeNumbers,
  buildVcfFromPairs,
  sanitizeFilename,
  ensureVcfExtension,
} = require('./format');

const TMP_DIR = path.join(process.cwd(), 'tmp');
const MAX_TOTAL_NUMBERS = 100;

const STATES = {
  IDLE: 'idle',
  WAITING_MESSAGE: 'waiting_message',
  WAITING_FILENAME: 'waiting_filename',
  PROCESSING: 'processing',
};

function ensureTmpDir() {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
}

function initSession(sessions, chatId) {
  const s = {
    state: STATES.IDLE,
    rawText: '',
    categories: [], // [{name, rawNumbers:[], normalized:[] }]
    outputFileName: '',
    createdAt: Date.now(),
  };
  sessions.set(chatId, s);
  return s;
}

function getSession(sessions, chatId) {
  if (!sessions.has(chatId)) return initSession(sessions, chatId);
  return sessions.get(chatId);
}

function resetSession(sessions, chatId) {
  sessions.delete(chatId);
}

function buildInstructionText() {
  return (
`📲 Mohon masukkan kontak sesuai format:

Admin
+818987654321
+637998877665

Navy
+62466778899
+1422113344

📌Maks 100 nomor.`
  );
}

function parseAdminMessageToCategories(text) {
  // Returns array of { name, numbers } without normalization; validation required after
  const lines = String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(l => l.trim());

  const cats = [];
  let current = null;

  const isHeaderLine = (line) => {
    if (!line) return false;
    const first = line[0];
    // Header: first non-space char is NOT '+' and NOT a digit
    return !(first === '+' || /\d/.test(first));
  };

  for (const line of lines) {
    if (!line) {
      continue;
    }
    if (isHeaderLine(line)) {
      current = { name: line, numbers: [] };
      cats.push(current);
      continue;
    }
    if (!current) {
      return { ok: false, categories: [] };
    }
    current.numbers.push(line);
  }

  if (cats.length === 0) return { ok: false, categories: [] };
  for (const c of cats) {
    if (!c.numbers || c.numbers.length === 0) return { ok: false, categories: [] };
  }

  return { ok: true, categories: cats };
}

function createAdminFromMessageFlow(bot, sessions) {
  async function handleStart(chatId) {
    const s = getSession(sessions, chatId);
    s.state = STATES.WAITING_MESSAGE;
    s.rawText = '';
    s.categories = [];
    s.outputFileName = '';

    await bot.sendMessage(
      chatId,
      buildInstructionText(),
      getCancelMenu()
    );
  }

  async function handleCancel(chatId) {
    resetSession(sessions, chatId);
    await bot.sendMessage(
      chatId,
      `╭─❖ *SELAMAT DATANG* ❖─╮
📑 Convert All File ➝ VCF
🔹 Pilih menu untuk mulai

📢 Ads : @PanoramaaStoree
👑 Owner : @Jaehype
╰───────────────────╯`,
      getMainMenu()
    );
  }

  async function handleCallbackQuery(query) {
    try {
      const chatId = query.message.chat.id;
      const data = query.data;
      const s = getSession(sessions, chatId);

      await bot.answerCallbackQuery(query.id);

      if (data === actions.CANCEL) {
        if (s.state !== STATES.IDLE) {
          return handleCancel(chatId);
        }
        return;
      }

      if (data === actions.START_ADMIN_FROM_MESSAGE) {
        return handleStart(chatId);
      }
    } catch (err) {
      console.error('adminFromMessage handleCallbackQuery error:', err);
    }
  }

  async function handleMessage(msg) {
    try {
      const chatId = msg.chat.id;
      const s = getSession(sessions, chatId);

      if (s.state === STATES.IDLE) return;

      if (s.state === STATES.WAITING_MESSAGE) {
        if (!msg.text) {
          await bot.sendMessage(chatId, 'Kirim pesan sesuai format!!', getCancelMenu());
          await bot.sendMessage(chatId, buildInstructionText(), getCancelMenu());
          return;
        }

        const { ok, categories } = parseAdminMessageToCategories(msg.text);
        if (!ok) {
          await bot.sendMessage(chatId, 'Kirim pesan sesuai format!!', getCancelMenu());
          await bot.sendMessage(chatId, buildInstructionText(), getCancelMenu());
          return;
        }

        // Normalize and dedup per category, also enforce global limit 100 in order
        let totalAdded = 0;
        const prepared = [];
        for (const c of categories) {
          const normalized = normalizeNumbers(c.numbers, { deduplicate: true, minDigits: 6 });
          if (normalized.length === 0) continue;

          const spaceLeft = MAX_TOTAL_NUMBERS - totalAdded;
          if (spaceLeft <= 0) break;
          const take = normalized.slice(0, spaceLeft);
          totalAdded += take.length;

          prepared.push({
            name: c.name,
            numbers: take,
          });

          if (totalAdded >= MAX_TOTAL_NUMBERS) break;
        }

        if (prepared.length === 0) {
          await bot.sendMessage(chatId, 'Kirim pesan sesuai format!!', getCancelMenu());
          await bot.sendMessage(chatId, buildInstructionText(), getCancelMenu());
          return;
        }

        s.categories = prepared;
        s.state = STATES.WAITING_FILENAME;

        return bot.sendMessage(chatId, 'Apa nama file VCF anda?', getCancelMenu());
      }

      if (s.state === STATES.WAITING_FILENAME) {
        if (!msg.text) {
          return bot.sendMessage(chatId, 'Apa nama file VCF anda?', getCancelMenu());
        }
        const raw = msg.text.trim();
        const clean = ensureVcfExtension(sanitizeFilename(raw));
        s.outputFileName = clean;
        s.state = STATES.PROCESSING;

        return processNow(chatId, s);
      }
    } catch (err) {
      console.error('adminFromMessage handleMessage error:', err);
    }
  }

  async function processNow(chatId, s) {
    try {
      // Build name-number pairs
      const pairs = [];
      for (const cat of s.categories) {
        const nums = cat.numbers || [];
        const baseName = cat.name;
        if (nums.length === 1) {
          pairs.push({ name: baseName, number: nums[0] });
        } else {
          nums.forEach((num, idx) => {
            pairs.push({ name: `${baseName} ${idx + 1}`, number: num });
          });
        }
      }

      if (pairs.length === 0) {
        await bot.sendMessage(chatId, 'Kirim pesan sesuai format!!', getMainMenu());
        resetSession(sessions, chatId);
        return;
      }

      const token = stop.snapshot ? stop.snapshot(chatId) : 0;

      const vcfBuffer = buildVcfFromPairs(pairs);

      ensureTmpDir();
      const outPath = path.join(TMP_DIR, s.outputFileName || 'contacts.vcf');
      await fs.promises.writeFile(outPath, vcfBuffer);

      if (stop.shouldAbort && stop.shouldAbort(chatId, token)) {
        await fs.promises.unlink(outPath).catch(() => {});
        await bot.sendMessage(chatId, 'Dihentikan.');
        return;
      }

      await bot.sendDocument(chatId, outPath);
      await fs.promises.unlink(outPath).catch(() => {});

      await bot.sendMessage(chatId, 'File berhasil dikonversi');
      // Tidak kirim "Selesai."
    } catch (err) {
      console.error('adminFromMessage processing error:', err);
      await bot.sendMessage(
        chatId,
        'Terjadi kesalahan saat memproses data. Silakan coba lagi.',
        getMainMenu()
      );
    } finally {
      resetSession(sessions, chatId);
    }
  }

  return {
    handleStart,
    handleCancel,
    handleCallbackQuery,
    handleMessage,
  };
}

module.exports = {
  createAdminFromMessageFlow,
  STATES,
};
