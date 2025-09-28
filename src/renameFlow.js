// Flow state machine untuk ⚡ Rename ⚡ (Rename File & Rename CTC)
const fs = require('fs');
const path = require('path');

const {
  actions,
  getMainMenu,
  getCancelMenu,
  getRenameModeMenu,
} = require('./keyboards');

const {
  splitVcfIntoBlocks,
  buildVcfFromBlocks,
  sanitizeFilename,
  getLowerExt,
} = require('./format');

const TMP_DIR = path.join(process.cwd(), 'tmp');
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8MB

const STATES = {
  IDLE: 'idle',
  WAITING_MODE: 'waiting_mode',
  WAITING_FILE_UPLOAD: 'waiting_file_upload',
  WAITING_NEW_FILENAME: 'waiting_new_filename',
  WAITING_NEW_CONTACT_NAME: 'waiting_new_contact_name',
  PROCESSING: 'processing',
};

function ensureTmpDir() {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
}

function initSession(sessions, chatId) {
  const s = {
    state: STATES.IDLE,
    mode: '', // 'file' | 'ctc'
    sourceFileName: '',
    fileExt: '',
    // buffer untuk file binary (rename file)
    fileBuffer: null,
    // text untuk vcf (rename ctc)
    vcfText: '',
    outputFileName: '',
    createdAt: Date.now(),
    lastPromptMsgId: null,
    fileLocked: false,
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

function isVcfDocument(doc) {
  const name = (doc.file_name || '').toLowerCase();
  const mime = (doc.mime_type || '').toLowerCase();
  return name.endsWith('.vcf') || mime.includes('text/vcard') || mime.includes('text/x-vcard');
}

function humanizeBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renameVcfContacts(vcfText, baseName) {
  const blocks = splitVcfIntoBlocks(vcfText);
  if (!blocks.length) return '';

  const updated = blocks.map((block, idx) => {
    const name = blocks.length > 1 ? `${baseName} ${idx + 1}` : baseName;

    // Perbarui FN: baris (dengan parameter apapun)
    const lines = block.replace(/\r\n/g, '\n').split('\n');
    let hasFN = false;
    const newLines = lines.map((line) => {
      if (/^FN(?:;[^:]*)?:/i.test(line)) {
        hasFN = true;
        return line.replace(/^FN(?:;[^:]*)?:.*$/i, (m) => {
          const head = m.match(/^FN(?:;[^:]*)?:/i)[0];
          return `${head}${name}`;
        });
      }
      return line;
    });

    if (!hasFN) {
      // Sisipkan FN setelah BEGIN:VCARD
      const insertIdx = newLines.findIndex((l) => /^BEGIN:VCARD/i.test(l));
      if (insertIdx >= 0) {
        newLines.splice(insertIdx + 1, 0, `FN:${name}`);
      } else {
        newLines.unshift('BEGIN:VCARD', `FN:${name}`);
      }
    }

    return newLines.join('\n');
  });

  return buildVcfFromBlocks(updated).toString('utf8');
}

function createRenameFlow(bot, sessions) {
  async function handleStart(chatId) {
    const s = getSession(sessions, chatId);
    s.state = STATES.WAITING_MODE;
    s.mode = '';
    s.sourceFileName = '';
    s.fileExt = '';
    s.fileBuffer = null;
    s.vcfText = '';
    s.outputFileName = '';
    s.fileLocked = false;

    const sent = await bot.sendMessage(chatId, 'Pilih mode rename:', getRenameModeMenu());
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

      if (data === actions.CANCEL) {
        if (s.state !== STATES.IDLE) {
          return handleCancel(chatId);
        }
        return;
      }

      if (data === actions.START_RENAME) {
        return handleStart(chatId);
      }

      if (s.state === STATES.WAITING_MODE) {
        if (data === actions.RENAME_MODE_FILE || data === actions.RENAME_MODE_CTC) {
          s.mode = data === actions.RENAME_MODE_FILE ? 'file' : 'ctc';
          s.state = STATES.WAITING_FILE_UPLOAD;

          try {
            await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: s.lastPromptMsgId });
          } catch (_) {}
          try {
            await bot.deleteMessage(chatId, s.lastPromptMsgId);
          } catch (_) {}
          s.lastPromptMsgId = null;

          const hint = s.mode === 'file'
            ? 'Kirim 1 file yang akan di-rename (txt/vcf/xlsx dll). Maks 1 file per sesi.'
            : 'Kirim 1 file .vcf untuk rename kontak. Maks 1 file per sesi.';
          return bot.sendMessage(chatId, hint, getCancelMenu());
        }
      }
    } catch (err) {
      console.error('renameFlow handleCallbackQuery error:', err);
    }
  }

  async function handleMessage(msg) {
    try {
      const chatId = msg.chat.id;
      const s = getSession(sessions, chatId);
      if (s.state === STATES.IDLE) return;

      if (s.state === STATES.WAITING_FILE_UPLOAD && msg.document) {
        const doc = msg.document;

        if (doc.file_size && doc.file_size > MAX_FILE_SIZE_BYTES) {
          return bot.sendMessage(
            chatId,
            `Ukuran file terlalu besar (${humanizeBytes(doc.file_size)}). Maksimal ${humanizeBytes(MAX_FILE_SIZE_BYTES)}.`,
            getCancelMenu()
          );
        }

        // Satu file per sesi
        if (s.fileLocked || s.sourceFileName) {
          return bot.sendMessage(chatId, 'Hanya boleh 1 file per sesi.', getCancelMenu());
        }
        s.fileLocked = true;

        ensureTmpDir();
        const tempPath = await bot.downloadFile(doc.file_id, TMP_DIR);

        const ext = getLowerExt(doc.file_name || '');
        s.sourceFileName = doc.file_name || `file_${Date.now()}${ext || ''}`;
        s.fileExt = ext || '';

        if (s.mode === 'ctc') {
          if (!isVcfDocument(doc)) {
            s.fileLocked = false;
            try { fs.promises.unlink(tempPath).catch(() => {}); } catch (_) {}
            return bot.sendMessage(chatId, 'Hanya menerima .vcf untuk Rename CTC.', getCancelMenu());
          }
          // Baca teks VCF
          s.vcfText = await fs.promises.readFile(tempPath, 'utf8').catch(() => '');
          await fs.promises.unlink(tempPath).catch(() => {});
          if (!s.vcfText) {
            s.fileLocked = false;
            return bot.sendMessage(chatId, 'Gagal membaca file .vcf.', getCancelMenu());
          }
          s.state = STATES.WAITING_NEW_CONTACT_NAME;
          return bot.sendMessage(chatId, 'Masukkan nama kontak yang baru', getCancelMenu());
        } else {
          // mode file: buffer binary, tidak ubah isi
          s.fileBuffer = await fs.promises.readFile(tempPath).catch(() => null);
          await fs.promises.unlink(tempPath).catch(() => {});
          if (!s.fileBuffer) {
            s.fileLocked = false;
            return bot.sendMessage(chatId, 'Gagal membaca file. Coba lagi.', getCancelMenu());
          }
          s.state = STATES.WAITING_NEW_FILENAME;
          return bot.sendMessage(chatId, 'Masukkan nama file baru (dengan/atau tanpa ekstensi)', getCancelMenu());
        }
      }

      if (s.state === STATES.WAITING_FILE_UPLOAD && !msg.document) {
        return bot.sendMessage(chatId, 'Silakan kirim file sesuai mode yang dipilih.', getCancelMenu());
      }

      if (s.state === STATES.WAITING_NEW_FILENAME) {
        if (!msg.text) {
          return bot.sendMessage(chatId, 'Ketik nama file baru.', getCancelMenu());
        }
        const raw = sanitizeFilename(String(msg.text || '').trim());
        s.outputFileName = raw || 'file';
        s.state = STATES.PROCESSING;

        try {
          ensureTmpDir();
          const outPath = path.join(TMP_DIR, s.outputFileName);
          await fs.promises.writeFile(outPath, s.fileBuffer);
          await bot.sendDocument(chatId, outPath);
          await fs.promises.unlink(outPath).catch(() => {});
          await bot.sendMessage(chatId, 'File berhasil di-rename');
          await bot.sendMessage(chatId, 'Selesai.');
        } catch (err) {
          console.error('rename file error:', err);
          await bot.sendMessage(chatId, 'Terjadi kesalahan saat rename file.', getMainMenu());
        } finally {
          resetSession(sessions, chatId);
        }
      }

      if (s.state === STATES.WAITING_NEW_CONTACT_NAME) {
        if (!msg.text) {
          return bot.sendMessage(chatId, 'Ketik nama kontak yang baru.', getCancelMenu());
        }
        const base = sanitizeFilename(String(msg.text || '').trim()) || 'Kontak';
        s.state = STATES.PROCESSING;

        try {
          const updatedText = renameVcfContacts(s.vcfText, base);
          if (!updatedText) {
            await bot.sendMessage(chatId, 'Tidak ada kontak yang dapat diubah.', getMainMenu());
            resetSession(sessions, chatId);
            return;
          }

          ensureTmpDir();
          // Nama file TETAP sama seperti sumber (syarat)
          const outPath = path.join(TMP_DIR, s.sourceFileName || 'contacts.vcf');
          await fs.promises.writeFile(outPath, Buffer.from(updatedText, 'utf8'));
          await bot.sendDocument(chatId, outPath);
          await fs.promises.unlink(outPath).catch(() => {});
          await bot.sendMessage(chatId, 'Kontak berhasil di-rename');
          await bot.sendMessage(chatId, 'Selesai.');
        } catch (err) {
          console.error('rename ctc error:', err);
          await bot.sendMessage(chatId, 'Terjadi kesalahan saat rename kontak.', getMainMenu());
        } finally {
          resetSession(sessions, chatId);
        }
      }
    } catch (err) {
      console.error('renameFlow handleMessage error:', err);
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
  createRenameFlow,
  STATES,
};
