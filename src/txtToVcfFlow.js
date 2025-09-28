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
  generateSequentialFilenames,
  stripVcfExtension,
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
    // Single-file legacy fields (kept for backward compatibility)
    txtContent: '',
    sourceFileName: '',
    outputFileName: '',
    // Multi-file support
    files: [], // array of { sourceFileName, txtContent }
    filenameChoice: '', // 'default' | 'custom'
    outputBaseName: '', // base for custom multi-file names (without .vcf)
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
    // Reset and prepare to collect multiple files
    session.state = STATES.WAITING_TXT_UPLOAD;
    session.txtContent = '';
    session.sourceFileName = '';
    session.outputFileName = '';
    session.files = [];
    session.filenameChoice = '';
    session.outputBaseName = '';
    session.contactName = '';

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

  async function acceptTxtDocument(chatId, session, doc) {
    if (!isTxtDocument(doc)) {
      await bot.sendMessage(
        chatId,
        'File tidak valid. Kirim file .txt.',
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

    // Download and read file
    ensureTmpDir();
    const filePath = await bot.downloadFile(doc.file_id, TMP_DIR);
    const content = await fs.promises.readFile(filePath, 'utf8').catch(() => '');
    // Clean up temp file
    fs.promises.unlink(filePath).catch(() => {});

    if (!content) {
      await bot.sendMessage(
        chatId,
        'Gagal membaca file .txt. Coba lagi.',
        getCancelMenu()
      );
      return false;
    }

    // Save in multi-file array
    session.files.push({
      sourceFileName: doc.file_name || `numbers_${session.files.length + 1}.txt`,
      txtContent: content,
    });

    // Also set legacy single-file fields for compatibility (first file)
    if (session.files.length === 1) {
      session.txtContent = content;
      session.sourceFileName = doc.file_name || 'numbers.txt';
    }

    return true;
  }

  async function handleCallbackQuery(query) {
    try {
      const chatId = query.message.chat.id;
      const data = query.data;
      const session = getSession(sessions, chatId);

      // Acknowledge callback to stop loading state
      await bot.answerCallbackQuery(query.id);

      // Hanya flow aktif yang merespon CANCEL (agar tidak spam)
      if (data === actions.CANCEL) {
        if (session.state !== STATES.IDLE) {
          return handleCancel(chatId);
        }
        return;
      }

      if (data === actions.START_TXT_TO_VCF) {
        return handleStart(chatId);
      }

      // Below requires an active flow
      if (session.state === STATES.WAITING_FILENAME_CHOICE) {
        if (data === actions.FILENAME_DEFAULT) {
          session.filenameChoice = 'default';
          // Preserve prior behavior for single-file case
          session.outputFileName = deriveDefaultVcfNameFromTxt(session.sourceFileName);
          session.state = STATES.WAITING_CONTACT_NAME;
          return bot.sendMessage(chatId, 'Ketik nama kontak yang akan digunakan', getCancelMenu());
        }
        if (data === actions.FILENAME_CUSTOM) {
          session.filenameChoice = 'custom';
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

      // If no active flow, only react to /start elsewhere
      if (session.state === STATES.IDLE) return;

      // Accept additional .txt at several stages (to allow multiple files)
      const canAcceptMoreFiles =
        session.state === STATES.WAITING_TXT_UPLOAD ||
        session.state === STATES.WAITING_FILENAME_CHOICE ||
        session.state === STATES.WAITING_CUSTOM_FILENAME ||
        session.state === STATES.WAITING_CONTACT_NAME;

      if (canAcceptMoreFiles && msg.document) {
        const ok = await acceptTxtDocument(chatId, session, msg.document);
        if (!ok) return;

        // If we were still waiting for first file, after first accepted, move to filename choice
        if (session.state === STATES.WAITING_TXT_UPLOAD) {
          session.state = STATES.WAITING_FILENAME_CHOICE;
          return bot.sendMessage(
            chatId,
            'Gunakan nama file default (sesuai nama txt) atau custom?',
            getFilenameChoiceMenu()
          );
        }

        // If already at/after filename choice, do nothing else (no new prompts to avoid changing texts)
        return;
      }

      // When waiting for TXT upload and user sends non-document
      if (session.state === STATES.WAITING_TXT_UPLOAD) {
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
        const base = sanitizeFilename(stripVcfExtension(raw));
        session.outputBaseName = base;
        // Also keep single-file legacy name
        session.outputFileName = ensureVcfExtension(base);
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

        // Process (support multi-file)
        try {
          const filesToProcess =
            (session.files && session.files.length > 0)
              ? session.files
              : (session.txtContent
                  ? [{ sourceFileName: session.sourceFileName || 'numbers.txt', txtContent: session.txtContent }]
                  : []);

          if (!filesToProcess.length) {
            await bot.sendMessage(
              chatId,
              'Gagal membaca file .txt. Coba lagi.',
              getMainMenu()
            );
            resetSession(sessions, chatId);
            return;
          }

          // Prepare filenames according to choice
          let finalFilenames = [];
          if (session.filenameChoice === 'custom' && session.outputBaseName) {
            finalFilenames = generateSequentialFilenames(session.outputBaseName, filesToProcess.length);
          } else if (session.filenameChoice === 'default' || !session.filenameChoice) {
            finalFilenames = filesToProcess.map(f => deriveDefaultVcfNameFromTxt(f.sourceFileName));
          }

          let producedCount = 0;

          for (let i = 0; i < filesToProcess.length; i++) {
            const f = filesToProcess[i];
            const tokens = parseNumbersFromTxt(f.txtContent);

            // Do not deduplicate to preserve exactly what user provided (order and duplicates)
            const normalized = normalizeNumbers(tokens, { deduplicate: false, minDigits: 6 });

            if (!normalized.length) {
              // Skip this file silently; if all skipped we'll inform later
              continue;
            }

            const vcfBuffer = buildVcf(normalized, session.contactName);

            // Filename per file
            let filename = finalFilenames[i];
            if (!filename) {
              // Fallbacks
              if (session.filenameChoice === 'custom' && session.outputBaseName) {
                filename = ensureVcfExtension(sanitizeFilename(session.outputBaseName));
              } else if (session.filenameChoice === 'default') {
                filename = deriveDefaultVcfNameFromTxt(f.sourceFileName);
              } else {
                // legacy single-file behavior
                filename =
                  session.outputFileName && session.outputFileName.toLowerCase().endsWith('.vcf')
                    ? session.outputFileName
                    : deriveDefaultVcfNameFromTxt(f.sourceFileName);
              }
            }

            // Send without caption using a temporary file path to avoid Buffer file-type issues
            ensureTmpDir();
            const outPath = path.join(TMP_DIR, filename);
            await fs.promises.writeFile(outPath, vcfBuffer);
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

          // Kirim pesan terpisah setelah semua file terkirim
          await bot.sendMessage(chatId, 'File berhasil dikonversi');
          // Hapus kembalikan otomatis ke menu
          await bot.sendMessage(chatId, 'Selesai.');
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
