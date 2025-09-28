// Flow state machine for 📗VCF to TXT📗
const fs = require('fs');
const path = require('path');
const {
  actions,
  getCancelMenu,
  getFilenameChoiceMenu,
  getMainMenu,
} = require('./keyboards');
const {
  parseNumbersFromVcf,
  normalizeNumbers,
  sanitizeFilename,
  ensureTxtExtension,
  deriveDefaultTxtNameFromVcf,
  generateSequentialTextFilenames,
  stripTxtExtension,
} = require('./format');

const TMP_DIR = path.join(process.cwd(), 'tmp');
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8MB

const STATES = {
  IDLE: 'idle',
  WAITING_VCF_UPLOAD: 'waiting_vcf_upload',
  WAITING_FILENAME_CHOICE: 'waiting_filename_choice',
  WAITING_CUSTOM_FILENAME: 'waiting_custom_filename',
  PROCESSING: 'processing',
};

function ensureTmpDir() {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
}

function initSession(sessions, chatId) {
  const session = {
    state: STATES.IDLE,
    files: [], // { sourceFileName, vcfContent }
    filenameChoice: '',
    outputBaseName: '',
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

function isVcfDocument(doc) {
  if (!doc) return false;
  const name = (doc.file_name || '').toLowerCase();
  const mime = (doc.mime_type || '').toLowerCase();
  const isByExt = name.endsWith('.vcf');
  const isByMime = mime.includes('text/vcard') || mime.includes('text/x-vcard');
  return isByExt || isByMime;
}

function humanizeBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function createVcfToTxtFlow(bot, sessions) {
  async function handleStart(chatId) {
    const session = getSession(sessions, chatId);
    session.state = STATES.WAITING_VCF_UPLOAD;
    session.files = [];
    session.filenameChoice = '';
    session.outputBaseName = '';

    await bot.sendMessage(
      chatId,
      'Silahkan kirimkan file dengan format .vcf',
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

  async function acceptVcfDocument(chatId, session, doc) {
    if (!isVcfDocument(doc)) {
      await bot.sendMessage(
        chatId,
        'File tidak valid. Kirim file .vcf.',
        getCancelMenu()
      );
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
    const content = await fs.promises.readFile(filePath, 'utf8').catch(() => '');
    fs.promises.unlink(filePath).catch(() => {});

    if (!content) {
      await bot.sendMessage(
        chatId,
        'Gagal membaca file .vcf. Coba lagi.',
        getCancelMenu()
      );
      return false;
    }

    session.files.push({
      sourceFileName: doc.file_name || `contacts_${session.files.length + 1}.vcf`,
      vcfContent: content,
    });

    return true;
  }

  async function handleCallbackQuery(query) {
    try {
      const chatId = query.message.chat.id;
      const data = query.data;
      const session = getSession(sessions, chatId);

      await bot.answerCallbackQuery(query.id);

      // Hanya flow aktif yang merespon CANCEL (agar tidak spam)
      if (data === actions.CANCEL) {
        if (session.state !== STATES.IDLE) {
          return handleCancel(chatId);
        }
        return;
      }

      if (data === actions.START_VCF_TO_TXT) {
        return handleStart(chatId);
      }

      if (session.state === STATES.WAITING_FILENAME_CHOICE) {
        if (data === actions.FILENAME_DEFAULT) {
          session.filenameChoice = 'default';
          session.state = STATES.PROCESSING;
          // Trigger processing immediately (no extra input needed)
          return processNow(chatId, session);
        }
        if (data === actions.FILENAME_CUSTOM) {
          session.filenameChoice = 'custom';
          session.state = STATES.WAITING_CUSTOM_FILENAME;
          return bot.sendMessage(chatId, 'Apa nama file TXT anda?', getCancelMenu());
        }
      }
    } catch (err) {
      console.error('vcfToTxt handleCallbackQuery error:', err);
    }
  }

  async function handleMessage(msg) {
    try {
      const chatId = msg.chat.id;
      const session = getSession(sessions, chatId);

      if (session.state === STATES.IDLE) return;

      const canAcceptMoreFiles =
        session.state === STATES.WAITING_VCF_UPLOAD ||
        session.state === STATES.WAITING_FILENAME_CHOICE ||
        session.state === STATES.WAITING_CUSTOM_FILENAME;

      if (canAcceptMoreFiles && msg.document) {
        const ok = await acceptVcfDocument(chatId, session, msg.document);
        if (!ok) return;

        if (session.state === STATES.WAITING_VCF_UPLOAD) {
          session.state = STATES.WAITING_FILENAME_CHOICE;
          return bot.sendMessage(
            chatId,
            'Gunakan nama file default (sesuai nama vcf) atau custom?',
            getFilenameChoiceMenu()
          );
        }
        return;
      }

      if (session.state === STATES.WAITING_VCF_UPLOAD) {
        return bot.sendMessage(
          chatId,
          'Silahkan kirimkan file dengan format .vcf',
          getCancelMenu()
        );
      }

      if (session.state === STATES.WAITING_CUSTOM_FILENAME) {
        if (!msg.text) {
          return bot.sendMessage(chatId, 'Silahkan ketik nama file tanpa lampiran.', getCancelMenu());
        }
        const raw = msg.text.trim();
        const base = sanitizeFilename(stripTxtExtension(raw));
        session.outputBaseName = base;
        session.state = STATES.PROCESSING;
        return processNow(chatId, session);
      }
    } catch (err) {
      console.error('vcfToTxt handleMessage error:', err);
    }
  }

  async function processNow(chatId, session) {
    try {
      const filesToProcess = session.files && session.files.length > 0 ? session.files : [];

      if (!filesToProcess.length) {
        await bot.sendMessage(
          chatId,
          'Gagal membaca file .vcf. Coba lagi.',
          getMainMenu()
        );
        resetSession(sessions, chatId);
        return;
      }

      // Prepare filenames according to choice
      let finalFilenames = [];
      if (session.filenameChoice === 'custom' && session.outputBaseName) {
        finalFilenames = generateSequentialTextFilenames(session.outputBaseName, filesToProcess.length);
      } else {
        finalFilenames = filesToProcess.map(f => deriveDefaultTxtNameFromVcf(f.sourceFileName));
      }

      let producedCount = 0;

      for (let i = 0; i < filesToProcess.length; i++) {
        const f = filesToProcess[i];
        const rawNums = parseNumbersFromVcf(f.vcfContent);
        // Deduplicate per file
        const normalized = normalizeNumbers(rawNums, { deduplicate: true, minDigits: 6 });

        if (!normalized.length) continue;

        const content = normalized.join('\n') + '\n';
        const filename = finalFilenames[i] || deriveDefaultTxtNameFromVcf(f.sourceFileName);

        ensureTmpDir();
        const outPath = path.join(TMP_DIR, filename);
        await fs.promises.writeFile(outPath, content, 'utf8');
        await bot.sendDocument(chatId, outPath);
        await fs.promises.unlink(outPath).catch(() => {});

        producedCount++;
      }

      if (producedCount === 0) {
        await bot.sendMessage(
          chatId,
          'Tidak ditemukan nomor yang valid setelah pembersihan.',
          getMainMenu()
        );
        resetSession(sessions, chatId);
        return;
      }

      await bot.sendMessage(chatId, 'File berhasil dikonversi');
      await bot.sendMessage(chatId, 'Selesai.');
    } catch (err) {
      console.error('vcfToTxt processing error:', err);
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
  createVcfToTxtFlow,
  STATES,
};
