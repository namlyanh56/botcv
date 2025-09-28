// Flow state machine for 📒TXT to VCF📒
const fs = require('fs');
const path = require('path');
const {
  actions,
  getCancelMenu,
  getFilenameChoiceMenu,
  getMainMenu,
} = require('./keyboards');
const {
  parseNumbersFromTxt,
  normalizeNumbers,
  buildVcf,
  sanitizeFilename,
  ensureVcfExtension,
  deriveDefaultVcfNameFromTxt,
} = require('./format');

const TMP_DIR = path.join(process.cwd(), 'tmp');
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8MB

const STATES = {
  IDLE: 'idle',
  WAITING_TXT_UPLOAD: 'waiting_txt_upload',
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
    txtContent: '',
    sourceFileName: '',
    outputFileName: '',
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

function isTxtDocument(doc) {
  if (!doc) return false;
  const name = (doc.file_name || '').toLowerCase();
  const mime = (doc.mime_type || '').toLowerCase();
  return name.endsWith('.txt') || mime.includes('text/plain');
}

function humanizeBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function createTxtToVcfFlow(bot, sessions) {
  async function handleStart(chatId) {
    const session = getSession(sessions, chatId);
    session.state = STATES.WAITING_TXT_UPLOAD;

    await bot.sendMessage(
      chatId,
      'Silahkan kirimkan file dengan format .txt',
      getCancelMenu()
    );
  }

  async function handleCancel(chatId) {
    resetSession(sessions, chatId);
    await bot.sendMessage(
      chatId,
      'Dibatalkan. Kembali ke Menu Awal.',
      getMainMenu()
    );
  }

  async function handleCallbackQuery(query) {
    try {
      const chatId = query.message.chat.id;
      const data = query.data;
      const session = getSession(sessions, chatId);

      // Acknowledge callback to stop loading state
      await bot.answerCallbackQuery(query.id);

      if (data === actions.CANCEL) {
        return handleCancel(chatId);
      }

      if (data === actions.START_TXT_TO_VCF) {
        return handleStart(chatId);
      }

      // Below requires an active flow
      if (session.state === STATES.WAITING_FILENAME_CHOICE) {
        if (data === actions.FILENAME_DEFAULT) {
          session.outputFileName = deriveDefaultVcfNameFromTxt(session.sourceFileName);
          session.state = STATES.WAITING_CONTACT_NAME;
          return bot.sendMessage(chatId, 'Ketik nama kontak yang akan digunakan', getCancelMenu());
        }
        if (data === actions.FILENAME_CUSTOM) {
          session.state = STATES.WAITING_CUSTOM_FILENAME;
          return bot.sendMessage(chatId, 'Apa nama file VCF anda?', getCancelMenu());
        }
      }

      // Ignore unexpected callbacks
    } catch (err) {
      console.error('handleCallbackQuery error:', err);
    }
  }

  async function handleMessage(msg) {
    try {
      const chatId = msg.chat.id;
      const session = getSession(sessions, chatId);

      // If no active flow, only react to /start elsewhere (handled in bot.js)
      if (session.state === STATES.IDLE) return;

      // When waiting for TXT upload
      if (session.state === STATES.WAITING_TXT_UPLOAD) {
        if (msg.document) {
          const doc = msg.document;

          if (!isTxtDocument(doc)) {
            return bot.sendMessage(
              chatId,
              'File tidak valid. Kirim file .txt.',
              getCancelMenu()
            );
          }

          if (doc.file_size && doc.file_size > MAX_FILE_SIZE_BYTES) {
            return bot.sendMessage(
              chatId,
              `Ukuran file terlalu besar (${humanizeBytes(doc.file_size)}). Maksimal ${humanizeBytes(MAX_FILE_SIZE_BYTES)}.`,
              getCancelMenu()
            );
          }

          // Download and read file
          ensureTmpDir();
          const filePath = await bot.downloadFile(doc.file_id, TMP_DIR);
          const content = await fs.promises.readFile(filePath, 'utf8').catch(() => '');
          // Clean up temp file
          fs.promises.unlink(filePath).catch(() => {});

          if (!content) {
            return bot.sendMessage(
              chatId,
              'Gagal membaca file .txt. Coba lagi.',
              getCancelMenu()
            );
          }

          session.txtContent = content;
          session.sourceFileName = doc.file_name || 'numbers.txt';
          session.state = STATES.WAITING_FILENAME_CHOICE;

          return bot.sendMessage(
            chatId,
            'Gunakan nama file default (sesuai nama txt) atau custom?',
            getFilenameChoiceMenu()
          );
        }

        // Not a document
        return bot.sendMessage(
          chatId,
          'Silahkan kirimkan file dengan format .txt',
          getCancelMenu()
        );
      }

      // When waiting for custom filename
      if (session.state === STATES.WAITING_CUSTOM_FILENAME) {
        if (!msg.text) {
          return bot.sendMessage(chatId, 'Silahkan ketik nama file tanpa lampiran.', getCancelMenu());
        }
        const raw = msg.text.trim();
        const clean = ensureVcfExtension(sanitizeFilename(raw));
        session.outputFileName = clean;
        session.state = STATES.WAITING_CONTACT_NAME;
        return bot.sendMessage(chatId, 'Ketik nama kontak yang akan digunakan', getCancelMenu());
      }

      // When waiting for contact name
      if (session.state === STATES.WAITING_CONTACT_NAME) {
        if (!msg.text) {
          return bot.sendMessage(chatId, 'Silahkan ketik nama kontak.', getCancelMenu());
        }
        session.contactName = msg.text.trim() || 'Kontak';
        session.state = STATES.PROCESSING;

        // Process
        try {
          const tokens = parseNumbersFromTxt(session.txtContent);
          const normalized = normalizeNumbers(tokens, { deduplicate: true, minDigits: 6 });

          if (!normalized.length) {
            await bot.sendMessage(
              chatId,
              'Tidak ditemukan nomor yang valid setelah pembersihan.',
              getMainMenu()
            );
            resetSession(sessions, chatId);
            return;
          }

          const vcfBuffer = buildVcf(normalized, session.contactName);

          // Ensure filename
          const filename =
            session.outputFileName && session.outputFileName.toLowerCase().endsWith('.vcf')
              ? session.outputFileName
              : deriveDefaultVcfNameFromTxt(session.sourceFileName);

          // Send document
          await bot.sendDocument(
            chatId,
            vcfBuffer,
            { caption: 'File berhasil dikonversi' },
            { filename, contentType: 'text/vcard' }
          );

          // Back to main menu
          await bot.sendMessage(chatId, 'Selesai. Kembali ke Menu Awal.', getMainMenu());
        } catch (err) {
          console.error('Processing error:', err);
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

      // For any other states, ignore or prompt
    } catch (err) {
      console.error('handleMessage error:', err);
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
  createTxtToVcfFlow,
  STATES,
};
