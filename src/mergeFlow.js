// Flow state machine untuk 🗃️Gabung File🗃️
const fs = require('fs');
const path = require('path');

// Safe optional stop manager
let stop = { shouldStop: () => false, snapshot: () => 0, shouldAbort: () => false };
try { stop = require('./stopManager'); } catch (_) {}

const {
  actions,
  getMainMenu,
  getMergeCollectMenu,
  getCancelMenu,
} = require('./keyboards');

const {
  // TXT helpers
  parseLinesFromTxtRaw,
  // VCF helpers
  splitVcfIntoBlocks,
  parseNumbersFromVcf,
  buildVcfFromBlocks,
  // Common helpers
  sanitizeFilename,
  ensureVcfExtension,
  ensureTxtExtension,
  normalizeNumbers,
} = require('./format');

const TMP_DIR = path.join(process.cwd(), 'tmp');
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8MB

const STATES = {
  IDLE: 'idle',
  WAITING_FILES: 'waiting_files',
  WAITING_FILENAME: 'waiting_filename',
  PROCESSING: 'processing',
};

function ensureTmpDir() {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
}

function isTxtDocument(doc) {
  if (!doc) return false;
  const name = (doc.file_name || '').toLowerCase();
  const mime = (doc.mime_type || '').toLowerCase();
  return name.endsWith('.txt') || mime.includes('text/plain');
}

function isVcfDocument(doc) {
  if (!doc) return false;
  const name = (doc.file_name || '').toLowerCase();
  const mime = (doc.mime_type || '').toLowerCase();
  return name.endsWith('.vcf') || mime.includes('text/vcard') || mime.includes('text/x-vcard');
}

function statusText(count) {
  if (!count) {
    return (
`📚 <b>UPLOAD SEMUA FILE DALAM SATU FORMAT</b> 📚

⚠️ Belum ada file yang diunggah.

───────────────────

🔔 klik tombol 'Selesai' setelah mengunggah semua file.`
    );
  }
  return (
`📚 <b>UPLOAD SEMUA FILE DALAM SATU FORMAT</b> 📚

✔️ Total file diunggah: ${count}

───────────────────

🔔 klik tombol 'Selesai' setelah mengunggah semua file.`
  );
}

function initSession(sessions, chatId) {
  const s = {
    state: STATES.IDLE,
    expectedType: '', // '.txt' | '.vcf'
    files: [], // { name, content }
    uploadStatusMsgId: null,
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

function createMergeFlow(bot, sessions) {
  async function handleStart(chatId) {
    const s = getSession(sessions, chatId);
    s.state = STATES.WAITING_FILES;
    s.expectedType = '';
    s.files = [];
    s.uploadStatusMsgId = null;
    s.outputFileName = '';

    // Tampilkan status upload awal (pakai HTML karena statusText menggunakan <b>...</b>)
    const sent = await bot.sendMessage(
      chatId,
      statusText(0),
      { ...getMergeCollectMenu(), parse_mode: 'HTML' }
    );
    s.uploadStatusMsgId = sent.message_id;
  }

  async function handleCancel(chatId) {
    resetSession(sessions, chatId);
    // Pesan ini menggunakan tanda * untuk bold → pakai Markdown
    await bot.sendMessage(chatId, `╭─❖ *SELAMAT DATANG* ❖─╮
📑 Convert All File ➝ VCF
🔹 Pilih menu untuk mulai

📢 Ads : @PanoramaaStoree
👑 Owner : @Jaehype
╰───────────────────╯`, { ...getMainMenu(), parse_mode: 'Markdown' });
  }

  async function handleCallbackQuery(query) {
    try {
      const chatId = query.message.chat.id;
      const data = query.data;
      const s = getSession(sessions, chatId);

      await bot.answerCallbackQuery(query.id);

      // Hindari spam dari flow lain
      if (data === actions.CANCEL) {
        if (s.state !== STATES.IDLE) {
          return handleCancel(chatId);
        }
        return;
      }

      if (data === actions.START_MERGE_FILES) {
        return handleStart(chatId);
      }

      if (data === actions.MERGE_DONE && s.state === STATES.WAITING_FILES) {
        if (!s.files.length) {
          // Tidak ada file, minta user upload dulu
          try {
            await bot.editMessageText(statusText(0), {
              chat_id: chatId,
              message_id: s.uploadStatusMsgId,
              reply_markup: getMergeCollectMenu().reply_markup,
              parse_mode: 'HTML', // statusText pakai <b>...</b>
            });
          } catch (_) {}
          return;
        }
        // Tanya nama file custom sesuai tipe
        s.state = STATES.WAITING_FILENAME;
        const ask = s.expectedType === '.vcf' ? 'Apa nama file VCF anda?' : 'Apa nama file TXT anda?';
        return bot.sendMessage(chatId, ask, getCancelMenu());
      }
    } catch (err) {
      console.error('mergeFlow handleCallbackQuery error:', err);
    }
  }

  async function handleMessage(msg) {
    try {
      const chatId = msg.chat.id;
      const s = getSession(sessions, chatId);
      if (s.state === STATES.IDLE) return;

      if (s.state === STATES.WAITING_FILES && msg.document) {
        const doc = msg.document;

        // Validasi tipe
        const isTxt = isTxtDocument(doc);
        const isVcf = isVcfDocument(doc);
        if (!isTxt && !isVcf) {
          return bot.sendMessage(
            chatId,
            'File tidak valid. Kirim file .vcf atau .txt.',
            getMergeCollectMenu()
          );
        }

        // Batas ukuran
        if (doc.file_size && doc.file_size > MAX_FILE_SIZE_BYTES) {
          return bot.sendMessage(
            chatId,
            `Ukuran file terlalu besar. Maksimal ${(MAX_FILE_SIZE_BYTES / (1024 * 1024)).toFixed(0)}MB.`,
            getMergeCollectMenu()
          );
        }

        // Tetapkan expectedType pada file pertama
        const incomingType = isTxt ? '.txt' : '.vcf';
        if (!s.expectedType) {
          s.expectedType = incomingType;
        } else if (s.expectedType !== incomingType) {
          // Tolak format campuran
          return bot.sendMessage(
            chatId,
            'Format file berbeda-beda. Kirim ulang file-file dengan format yang sama.',
            getMergeCollectMenu()
          );
        }

        // Unduh dan simpan konten
        ensureTmpDir();
        const filePath = await bot.downloadFile(doc.file_id, TMP_DIR);
        const content = await fs.promises.readFile(filePath, 'utf8').catch(() => '');
        fs.promises.unlink(filePath).catch(() => {});
        if (!content) {
          return bot.sendMessage(
            chatId,
            'Gagal membaca file. Coba unggah kembali.',
            getMergeCollectMenu()
          );
        }

        s.files.push({ name: doc.file_name || `input_${s.files.length + 1}${incomingType}`, content });

        // Hapus pesan file yang diunggah (jika izin memungkinkan)
        try {
          await bot.deleteMessage(chatId, msg.message_id);
        } catch (_) {}

        // Perbarui status (pakai HTML karena statusText ada <b>...</b>)
        try {
          await bot.editMessageText(statusText(s.files.length), {
            chat_id: chatId,
            message_id: s.uploadStatusMsgId,
            reply_markup: getMergeCollectMenu().reply_markup,
            parse_mode: 'HTML',
          });
        } catch (_) {}

        return;
      }

      if (s.state === STATES.WAITING_FILES && !msg.document) {
        // Abaikan selain dokumen
        return;
      }

      if (s.state === STATES.WAITING_FILENAME) {
        if (!msg.text) {
          const ask = s.expectedType === '.vcf' ? 'Apa nama file VCF anda?' : 'Apa nama file TXT anda?';
          return bot.sendMessage(chatId, ask, getCancelMenu());
        }
        const raw = msg.text.trim();
        if (s.expectedType === '.vcf') {
          s.outputFileName = ensureVcfExtension(sanitizeFilename(raw));
        } else {
          s.outputFileName = ensureTxtExtension(sanitizeFilename(raw));
        }
        s.state = STATES.PROCESSING;
        return processNow(chatId, s);
      }
    } catch (err) {
      console.error('mergeFlow handleMessage error:', err);
    }
  }

  // Gabung TXT: dedup global berdasarkan normalisasi, tetapi tulis nomor "asli pertama"
  function mergeTxtFiles(files) {
    const seen = new Set(); // normalized
    const resultOriginals = [];
    for (const f of files) {
      const lines = parseLinesFromTxtRaw(f.content);
      const normalized = normalizeNumbers(lines, { deduplicate: false, minDigits: 6 });
      for (let i = 0; i < lines.length; i++) {
        const candidateNorm = normalized[i];
        const original = lines[i];
        if (!candidateNorm) continue;
        if (seen.has(candidateNorm)) continue;
        seen.add(candidateNorm);
        resultOriginals.push(original);
      }
    }
    const content = resultOriginals.join('\n') + (resultOriginals.length ? '\n' : '');
    return Buffer.from(content, 'utf8');
  }

  // Gabung VCF: ambil blok vCard, dedup berdasarkan nomor (semua TEL dalam blok harus belum pernah muncul)
  function mergeVcfFiles(files) {
    const seenNumbers = new Set(); // normalized numbers
    const keptBlocks = [];
    for (const f of files) {
      const blocks = splitVcfIntoBlocks(f.content);
      for (const b of blocks) {
        const numbers = normalizeNumbers(parseNumbersFromVcf(b), { deduplicate: true, minDigits: 6 });
        if (numbers.length === 0) continue;
        if (numbers.some(n => seenNumbers.has(n))) continue;
        numbers.forEach(n => seenNumbers.add(n));
        keptBlocks.push(b);
      }
    }
    return buildVcfFromBlocks(keptBlocks);
  }

  async function processNow(chatId, s) {
    try {
      if (!s.files.length || !s.expectedType) {
        await bot.sendMessage(chatId, 'Gagal memproses file.', getMainMenu());
        resetSession(sessions, chatId);
        return;
      }

      const buffer =
        s.expectedType === '.vcf'
          ? mergeVcfFiles(s.files)
          : mergeTxtFiles(s.files);

      const token = stop.snapshot ? stop.snapshot(chatId) : 0;
      let aborted = false;

      ensureTmpDir();
      const outPath = path.join(TMP_DIR, s.outputFileName || (s.expectedType === '.vcf' ? 'merged.vcf' : 'merged.txt'));
      await fs.promises.writeFile(outPath, buffer);

      if (stop.shouldAbort && stop.shouldAbort(chatId, token)) {
        aborted = true;
        await fs.promises.unlink(outPath).catch(() => {});
        await bot.sendMessage(chatId, 'Dihentikan.');
        return;
      }

      await bot.sendDocument(chatId, outPath);
      await fs.promises.unlink(outPath).catch(() => {});

      if (!aborted) {
        await bot.sendMessage(chatId, 'File berhasil digabung');
      }
    } catch (err) {
      console.error('mergeFlow processing error:', err);
      await bot.sendMessage(
        chatId,
        'Terjadi kesalahan saat memproses file. Silakan coba lagi.',
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
  createMergeFlow,
  STATES,
};
