// Flow state machine for 📂Pecah File📂
const fs = require('fs');
const path = require('path');
const {
  actions,
  getCancelMenu,
  getFilenameChoiceMenu,
  getMainMenu,
  getSplitModeMenu,
} = require('./keyboards');
const {
  splitVcfIntoBlocks,
  buildVcfFromBlocks,
  parseLinesFromTxtRaw,
  buildTxtFromLines,
  splitArrayByFixedSize,
  splitArrayIntoNParts,
  getLowerExt,
  generateDefaultSequentialNamesFromSource,
  generateCustomSequentialNames,
  sanitizeFilename,
  stripTxtExtension,
  stripVcfExtension,
} = require('./format');

const TMP_DIR = path.join(process.cwd(), 'tmp');
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8MB

const STATES = {
  IDLE: 'idle',
  WAITING_MODE: 'waiting_mode',
  WAITING_FILE_UPLOAD: 'waiting_file_upload',
  WAITING_FILENAME_CHOICE: 'waiting_filename_choice',
  WAITING_CUSTOM_FILENAME: 'waiting_custom_filename',
  WAITING_NUMBER_INPUT: 'waiting_number_input',
  PROCESSING: 'processing',
};

function ensureTmpDir() {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
}

function isAllowedDocument(doc) {
  if (!doc) return false;
  const name = (doc.file_name || '').toLowerCase();
  const mime = (doc.mime_type || '').toLowerCase();
  const isTxt = name.endsWith('.txt') || mime.includes('text/plain');
  const isVcf =
    name.endsWith('.vcf') || mime.includes('text/vcard') || mime.includes('text/x-vcard');
  return isTxt || isVcf;
}

function humanizeBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function initSession(sessions, chatId) {
  const s = {
    state: STATES.IDLE,
    mode: '', // 'contacts' or 'files'
    // One-file-only policy
    sourceFileName: '',
    fileExt: '',
    rawContent: '',
    filenameChoice: '', // 'default' | 'custom'
    outputBaseName: '',
    numberParam: 0, // contacts-per-file or files-count
    createdAt: Date.now(),
    lastPromptMsgId: null, // for message deletion
    fileLocked: false,      // lock to prevent multiple uploads race
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

function createSplitFlow(bot, sessions) {
  async function handleStart(chatId) {
    const s = getSession(sessions, chatId);
    s.state = STATES.WAITING_MODE;
    s.mode = '';
    s.sourceFileName = '';
    s.fileExt = '';
    s.rawContent = '';
    s.filenameChoice = '';
    s.outputBaseName = '';
    s.numberParam = 0;
    s.fileLocked = false;

    const sent = await bot.sendMessage(
      chatId,
      'Pilih mode pemecahan:',
      getSplitModeMenu()
    );
    s.lastPromptMsgId = sent.message_id;
  }

  async function handleCancel(chatId) {
    resetSession(sessions, chatId);
    await bot.sendMessage(chatId, 'Dibatalkan. Kembali ke Menu Awal.', getMainMenu());
  }

  async function handleCallbackQuery(query) {
    try {
      const chatId = query.message.chat.id;
      const data = query.data;
      const s = getSession(sessions, chatId);
      await bot.answerCallbackQuery(query.id);

      // Hanya flow aktif yang merespon CANCEL (agar tidak spam)
      if (data === actions.CANCEL) {
        if (s.state !== STATES.IDLE) {
          return handleCancel(chatId);
        }
        return;
      }

      if (data === actions.START_SPLIT_FILE) {
        return handleStart(chatId);
      }

      if (s.state === STATES.WAITING_MODE) {
        if (data === actions.SPLIT_MODE_CONTACTS || data === actions.SPLIT_MODE_FILES) {
          s.mode = data === actions.SPLIT_MODE_CONTACTS ? 'contacts' : 'files';
          s.state = STATES.WAITING_FILE_UPLOAD;

          // Hilangkan keyboard mode
          try {
            await bot.editMessageReplyMarkup(
              { inline_keyboard: [] },
              { chat_id: chatId, message_id: s.lastPromptMsgId }
            );
          } catch (_) {}

          // Hapus pesan "Pilih mode pemecahan:" agar chatnya ikut hilang
          try {
            await bot.deleteMessage(chatId, s.lastPromptMsgId);
          } catch (_) {}

          s.lastPromptMsgId = null;

          return bot.sendMessage(
            chatId,
            'Silahkan kirimkan file dengan format .vcf atau .txt',
            getCancelMenu()
          );
        }
      }

      if (s.state === STATES.WAITING_FILENAME_CHOICE) {
        if (data === actions.FILENAME_DEFAULT) {
          s.filenameChoice = 'default';
          s.state = STATES.WAITING_NUMBER_INPUT;
          return askNumberInput(chatId, s);
        }
        if (data === actions.FILENAME_CUSTOM) {
          s.filenameChoice = 'custom';
          s.state = STATES.WAITING_CUSTOM_FILENAME;
          return bot.sendMessage(chatId, 'Apa nama file output anda?', getCancelMenu());
        }
      }
    } catch (err) {
      console.error('splitFlow handleCallbackQuery error:', err);
    }
  }

  function askNumberInput(chatId, s) {
    const msg =
      s.mode === 'contacts'
        ? 'Masukkan jumlah kontak per file'
        : 'Masukkan jumlah file';
    return bot.sendMessage(chatId, msg, getCancelMenu());
  }

  async function handleMessage(msg) {
    try {
      const chatId = msg.chat.id;
      const s = getSession(sessions, chatId);
      if (s.state === STATES.IDLE) return;

      // One-file-only acceptance with hard lock
      if (s.state === STATES.WAITING_FILE_UPLOAD && msg.document) {
        const doc = msg.document;

        if (!isAllowedDocument(doc)) {
          return bot.sendMessage(
            chatId,
            'File tidak valid. Kirim file .vcf atau .txt.',
            getCancelMenu()
          );
        }
        if (doc.file_size && doc.file_size > MAX_FILE_SIZE_BYTES) {
          return bot.sendMessage(
            chatId,
            `Ukuran file terlalu besar (${humanizeBytes(doc.file_size)}). Maksimal ${humanizeBytes(
              MAX_FILE_SIZE_BYTES
            )}.`,
            getCancelMenu()
          );
        }

        // Jika sudah ada file atau sedang proses menerima file lain, tolak
        if (s.fileLocked || s.rawContent) {
          return bot.sendMessage(
            chatId,
            'Maaf,kirimkan file satu per sesi untuk mencegah eror dan spam',
            getCancelMenu()
          );
        }

        // Kunci sesi agar upload ganda ditolak
        s.fileLocked = true;

        ensureTmpDir();
        const filePath = await bot.downloadFile(doc.file_id, TMP_DIR);
        const content = await fs.promises.readFile(filePath, 'utf8').catch(() => '');
        fs.promises.unlink(filePath).catch(() => {});
        if (!content) {
          // Lepas kunci agar user bisa coba lagi
          s.fileLocked = false;
          return bot.sendMessage(
            chatId,
            'Gagal membaca file. Coba lagi.',
            getCancelMenu()
          );
        }

        s.sourceFileName = doc.file_name || 'input.txt';
        s.fileExt = getLowerExt(s.sourceFileName) || '.txt';
        s.rawContent = content;
        s.state = STATES.WAITING_FILENAME_CHOICE;

        return bot.sendMessage(
          chatId,
          'Gunakan nama file default (sesuai nama sumber) atau custom?',
          getFilenameChoiceMenu()
        );
      }

      if (s.state === STATES.WAITING_FILE_UPLOAD && !msg.document) {
        return bot.sendMessage(
          chatId,
          'Silahkan kirimkan file dengan format .vcf atau .txt',
          getCancelMenu()
        );
      }

      if (s.state === STATES.WAITING_CUSTOM_FILENAME) {
        if (!msg.text) {
          return bot.sendMessage(
            chatId,
            'Silahkan ketik nama file tanpa lampiran.',
            getCancelMenu()
          );
        }
        const raw = msg.text.trim();
        // Simpan base tanpa ekstensi; ext ditentukan dari input asal
        s.outputBaseName =
          s.fileExt === '.vcf'
            ? sanitizeFilename(stripVcfExtension(raw))
            : sanitizeFilename(stripTxtExtension(raw));
        s.state = STATES.WAITING_NUMBER_INPUT;
        return askNumberInput(chatId, s);
      }

      if (s.state === STATES.WAITING_NUMBER_INPUT) {
        if (!msg.text) {
          return askNumberInput(chatId, s);
        }
        const val = parseInt(String(msg.text).trim(), 10);
        if (!Number.isFinite(val) || val <= 0) {
          return askNumberInput(chatId, s);
        }
        s.numberParam = val;
        s.state = STATES.PROCESSING;
        return processNow(chatId, s);
      }
    } catch (err) {
      console.error('splitFlow handleMessage error:', err);
    }
  }

  async function processNow(chatId, s) {
    try {
      if (!s.rawContent || !s.fileExt) {
        await bot.sendMessage(chatId, 'Gagal memproses file.', getMainMenu());
        resetSession(sessions, chatId);
        return;
      }

      // Kumpulkan unit yang akan dipecah: vCard blocks atau lines dari txt
      let units = [];
      let buildBufferFromUnits = null;

      if (s.fileExt === '.vcf') {
        units = splitVcfIntoBlocks(s.rawContent);
        buildBufferFromUnits = (arr) => buildVcfFromBlocks(arr);
      } else {
        units = parseLinesFromTxtRaw(s.rawContent);
        buildBufferFromUnits = (arr) => buildTxtFromLines(arr);
      }

      if (!units.length) {
        await bot.sendMessage(
          chatId,
          'Tidak ditemukan kontak/nomor untuk dipecah.',
          getMainMenu()
        );
        resetSession(sessions, chatId);
        return;
      }

      // Tentukan pembagian
      let chunks = [];
      if (s.mode === 'contacts') {
        chunks = splitArrayByFixedSize(units, s.numberParam);
      } else {
        chunks = splitArrayIntoNParts(units, s.numberParam);
      }

      // Filter chunk kosong (jaga-jaga)
      chunks = chunks.filter((c) => c && c.length > 0);
      if (!chunks.length) {
        await bot.sendMessage(
          chatId,
          'Tidak ditemukan kontak/nomor untuk dipecah.',
          getMainMenu()
        );
        resetSession(sessions, chatId);
        return;
      }

      // Nama file output
      let filenames = [];
      if (s.filenameChoice === 'custom' && s.outputBaseName) {
        filenames = generateCustomSequentialNames(
          s.outputBaseName,
          chunks.length,
          s.fileExt
        );
      } else {
        filenames = generateDefaultSequentialNamesFromSource(
          s.sourceFileName,
          chunks.length
        );
      }

      // Jika hanya 1 hasil, pastikan tanpa penomoran (fungsi di atas sudah meng-handle)
      ensureTmpDir();
      for (let i = 0; i < chunks.length; i++) {
        const buf = buildBufferFromUnits(chunks[i]);
        const outPath = path.join(TMP_DIR, filenames[i] || `part_${i + 1}${s.fileExt}`);
        await fs.promises.writeFile(outPath, buf);
        await bot.sendDocument(chatId, outPath);
        await fs.promises.unlink(outPath).catch(() => {});
      }

      await bot.sendMessage(chatId, 'File berhasil dipecah');
      await bot.sendMessage(chatId, 'Selesai.');
    } catch (err) {
      console.error('splitFlow processing error:', err);
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
  createSplitFlow,
  STATES,
};
