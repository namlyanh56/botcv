// Flow state machine for 🧩XLSX to VCF🧩
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// Safe optional stop manager
let stop = { shouldStop: () => false, snapshot: () => 0, shouldAbort: () => false };
try { stop = require('./stopManager'); } catch (_) {}

const {
  actions,
  getCancelMenu,
  getFilenameChoiceMenu,
  getMainMenu,
} = require('./keyboards');

const {
  normalizeNumbers,
  buildVcf,
  sanitizeFilename,
  ensureVcfExtension,
  deriveDefaultVcfNameFromXlsx,
  generateSequentialFilenames,
  stripVcfExtension,
} = require('./format');

const TMP_DIR = path.join(process.cwd(), 'tmp');
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8MB

const STATES = {
  IDLE: 'idle',
  WAITING_XLSX_UPLOAD: 'waiting_xlsx_upload',
  WAITING_FILENAME_CHOICE: 'waiting_filename_choice',
  WAITING_CUSTOM_FILENAME: 'waiting_custom_filename',
  WAITING_CONTACT_NAME: 'waiting_contact_name',
  PROCESSING: 'processing',
};

function ensureTmpDir() {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
}

function initSession(sessions, chatId) {
  const session = {
    state: STATES.IDLE,
    files: [], // { sourceFileName, numbers: [] }
    filenameChoice: '',
    outputBaseName: '',
    contactName: '',
    createdAt: Date.now(),
  };
  sessions.set(chatId, session);
  return session;
}

function getSession(sessions, chatId) {
  if (!sessions.has(chatId)) return initSession(sessions, chatId);
  return sessions.get(chatId);
}

function resetSession(sessions, chatId) {
  sessions.delete(chatId);
}

function isXlsxDocument(doc) {
  if (!doc) return false;
  const name = (doc.file_name || '').toLowerCase();
  const mime = (doc.mime_type || '').toLowerCase();
  const byExt = name.endsWith('.xlsx') || name.endsWith('.xls');
  const byMime =
    mime.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') ||
    mime.includes('application/vnd.ms-excel');
  return byExt || byMime;
}

function humanizeBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Heuristik: deteksi “rumit” bila ditemukan >=2 kolom signifikan (masing2 >=5 nomor valid)
function extractNumbersFromWorkbook(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: false, cellNF: false, cellText: false });
  let best = { sheet: '', col: -1, numbers: [] };
  let significantColumns = 0;

  for (const sheetName of wb.SheetNames) {
    const sh = wb.Sheets[sheetName];
    const ref = sh['!ref'];
    if (!ref) continue;
    const range = XLSX.utils.decode_range(ref);

    for (let c = range.s.c; c <= range.e.c; c++) {
      const colTokens = [];
      for (let r = range.s.r; r <= range.e.r; r++) {
        const addr = XLSX.utils.encode_cell({ c, r });
        const cell = sh[addr];
        if (!cell) continue;

        let raw = '';
        if (cell.w != null && cell.w !== '') raw = String(cell.w).trim();
        else if (cell.v != null) raw = String(cell.v).trim();
        if (!raw) continue;

        colTokens.push(raw);
      }

      if (!colTokens.length) continue;

      const normalized = normalizeNumbers(colTokens, { deduplicate: false, minDigits: 6 });
      const valid = normalized.filter(Boolean);
      if (valid.length >= 5) significantColumns++;

      if (valid.length > (best.numbers?.length || 0)) {
        best = { sheet: sheetName, col: c, numbers: valid };
      }
    }
  }

  if (significantColumns >= 2) return { complex: true, numbers: [] };
  if (!best.numbers || best.numbers.length === 0) return { complex: false, numbers: [] };
  return { complex: false, numbers: best.numbers };
}

function createXlsxToVcfFlow(bot, sessions) {
  async function handleStart(chatId) {
    const session = getSession(sessions, chatId);
    session.state = STATES.WAITING_XLSX_UPLOAD;
    session.files = [];
    session.filenameChoice = '';
    session.outputBaseName = '';
    session.contactName = '';

    await bot.sendMessage(
      chatId,
      'Silahkan kirimkan file dengan format .xlsx (Excel)',
      getCancelMenu()
    );
  }

  async function handleCancel(chatId) {
    resetSession(sessions, chatId);
    await bot.sendMessage(chatId, `╭─❖ *SELAMAT DATANG* ❖─╮
📑 Convert All File ➝ VCF
🔹 Pilih menu untuk mulai

📢 Ads : @PanoramaaStoree
👑 Owner : @Jaehype
╰───────────────────╯`, { ...getMainMenu(), parse_mode: 'Markdown' });
  }

  async function acceptXlsxDocument(chatId, session, doc) {
    if (!isXlsxDocument(doc)) {
      await bot.sendMessage(chatId, 'File tidak valid. Kirim file .xlsx / .xls.', getCancelMenu());
      return false;
    }

    if (doc.file_size && doc.file_size > MAX_FILE_SIZE_BYTES) {
      await bot.sendMessage(
        chatId,
        `Ukuran file terlalu besar (${humanizeBytes(doc.file_size)}). Maksimal ${humanizeBytes(MAX_FILE_SIZE_BYTES)}.`,
        getCancelMenu()
      );
      return false;
    }

    ensureTmpDir();
    const filePath = await bot.downloadFile(doc.file_id, TMP_DIR);

    let result;
    try {
      result = extractNumbersFromWorkbook(filePath);
    } catch (e) {
      console.error('XLSX parse error:', e);
      result = { complex: false, numbers: [] };
    } finally {
      fs.promises.unlink(filePath).catch(() => {});
    }

    if (result.complex) {
      await bot.sendMessage(chatId, 'File excel mu rumit, pm @Jaehype untuk convert manual', getCancelMenu());
      return false;
    }

    if (!result.numbers || result.numbers.length === 0) {
      await bot.sendMessage(chatId, 'Tidak ditemukan nomor yang valid di file Excel.', getCancelMenu());
      return false;
    }

    session.files.push({
      sourceFileName: doc.file_name || `sheet_${session.files.length + 1}.xlsx`,
      numbers: result.numbers, // sudah dinormalisasi, urutan baris
    });

    return true;
  }

  async function handleCallbackQuery(query) {
    try {
      const chatId = query.message.chat.id;
      const data = query.data;
      const session = getSession(sessions, chatId);

      await bot.answerCallbackQuery(query.id);

      if (data === actions.CANCEL) {
        if (session.state !== STATES.IDLE) {
          // bersihkan inline keyboard dan pesan sebelumnya
          try { await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id }); } catch (_) {}
          try { await bot.deleteMessage(chatId, query.message.message_id); } catch (_) {}
          return handleCancel(chatId);
        }
        return;
      }

      if (data === actions.START_XLSX_TO_VCF) {
        return handleStart(chatId);
      }

      if (session.state === STATES.WAITING_FILENAME_CHOICE) {
        // hilangkan menu dan pesan pertanyaan pilihan nama
        try { await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id }); } catch (_) {}
        try { await bot.deleteMessage(chatId, query.message.message_id); } catch (_) {}
        if (data === actions.FILENAME_DEFAULT) {
          session.filenameChoice = 'default';
          session.state = STATES.WAITING_CONTACT_NAME;
          return bot.sendMessage(chatId, 'Ketik nama kontak yang akan digunakan', getCancelMenu());
        }
        if (data === actions.FILENAME_CUSTOM) {
          session.filenameChoice = 'custom';
          session.state = STATES.WAITING_CUSTOM_FILENAME;
          return bot.sendMessage(chatId, 'Apa nama file VCF anda?', getCancelMenu());
        }
      }
    } catch (err) {
      console.error('xlsxToVcf handleCallbackQuery error:', err);
    }
  }

  async function handleMessage(msg) {
    try {
      const chatId = msg.chat.id;
      const session = getSession(sessions, chatId);
      if (session.state === STATES.IDLE) return;

      const canAcceptMoreFiles =
        session.state === STATES.WAITING_XLSX_UPLOAD ||
        session.state === STATES.WAITING_FILENAME_CHOICE ||
        session.state === STATES.WAITING_CUSTOM_FILENAME ||
        session.state === STATES.WAITING_CONTACT_NAME;

      if (canAcceptMoreFiles && msg.document) {
        const ok = await acceptXlsxDocument(chatId, session, msg.document);
        if (!ok) return;

        if (session.state === STATES.WAITING_XLSX_UPLOAD) {
          session.state = STATES.WAITING_FILENAME_CHOICE;
          return bot.sendMessage(
            chatId,
            'Gunakan nama file default (sesuai nama xlsx) atau custom?',
            getFilenameChoiceMenu()
          );
        }
        return;
      }

      if (session.state === STATES.WAITING_XLSX_UPLOAD) {
        return bot.sendMessage(chatId, 'Silahkan kirimkan file dengan format .xlsx', getCancelMenu());
      }

      if (session.state === STATES.WAITING_CUSTOM_FILENAME) {
        if (!msg.text) {
          return bot.sendMessage(chatId, 'Silahkan ketik nama file tanpa lampiran.', getCancelMenu());
        }
        const raw = msg.text.trim();
        const base = sanitizeFilename(stripVcfExtension(raw));
        session.outputBaseName = base;
        session.state = STATES.WAITING_CONTACT_NAME;
        return bot.sendMessage(chatId, 'Ketik nama kontak yang akan digunakan', getCancelMenu());
      }

      if (session.state === STATES.WAITING_CONTACT_NAME) {
        if (!msg.text) {
          return bot.sendMessage(chatId, 'Silahkan ketik nama kontak.', getCancelMenu());
        }
        session.contactName = msg.text.trim() || 'Kontak';
        session.state = STATES.PROCESSING;

        try {
          const filesToProcess = session.files || [];
          if (!filesToProcess.length) {
            await bot.sendMessage(chatId, 'Gagal membaca file .xlsx. Coba lagi.', getMainMenu());
            resetSession(sessions, chatId);
            return;
          }

          const token = stop.snapshot ? stop.snapshot(chatId) : 0;
          let aborted = false;

          // Tentukan nama file output per file
          let finalFilenames = [];
          if (session.filenameChoice === 'custom' && session.outputBaseName) {
            finalFilenames = generateSequentialFilenames(session.outputBaseName, filesToProcess.length);
          } else {
            finalFilenames = filesToProcess.map(f => deriveDefaultVcfNameFromXlsx(f.sourceFileName));
          }

          let producedCount = 0;

          for (let i = 0; i < filesToProcess.length; i++) {
            if (stop.shouldAbort && stop.shouldAbort(chatId, token)) {
              aborted = true;
              await bot.sendMessage(chatId, 'Dihentikan.');
              break;
            }

            const f = filesToProcess[i];
            const numbers = f.numbers;
            if (!numbers || numbers.length === 0) continue;

            const vcfBuffer = buildVcf(numbers, session.contactName);

            const filename = finalFilenames[i] || deriveDefaultVcfNameFromXlsx(f.sourceFileName);

            ensureTmpDir();
            const outPath = path.join(TMP_DIR, filename);
            await fs.promises.writeFile(outPath, vcfBuffer);

            if (stop.shouldAbort && stop.shouldAbort(chatId, token)) {
              aborted = true;
              await fs.promises.unlink(outPath).catch(() => {});
              await bot.sendMessage(chatId, 'Dihentikan.');
              break;
            }

            await bot.sendDocument(chatId, outPath);
            await fs.promises.unlink(outPath).catch(() => {});
            producedCount++;
          }

          if (producedCount === 0 && !aborted) {
            await bot.sendMessage(
              chatId,
              'Tidak ditemukan nomor yang valid setelah pembersihan.',
              getMainMenu()
            );
            resetSession(sessions, chatId);
            return;
          }

          if (!aborted) {
            await bot.sendMessage(chatId, 'File berhasil dikonversi');
          }
        } catch (err) {
          console.error('XLSX processing error:', err);
          await bot.sendMessage(
            chatId,
            'Terjadi kesalahan saat memproses file. Silakan coba lagi.',
            getMainMenu()
          );
        } finally {
          resetSession(sessions, chatId);
        }
        return;
      }
    } catch (err) {
      console.error('xlsxToVcf handleMessage error:', err);
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
  createXlsxToVcfFlow,
  STATES,
};
