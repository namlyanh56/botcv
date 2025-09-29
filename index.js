require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const { getMainMenu, menuLabels } = require('./src/keyboards');
const { createTxtToVcfFlow } = require('./src/txtToVcfFlow');
const { createVcfToTxtFlow } = require('./src/vcfToTxtFlow');
const { createSplitFlow } = require('./src/splitFlow');
const { createAdminFromMessageFlow } = require('./src/adminFromMessageFlow');
const { createMergeFlow } = require('./src/mergeFlow');
const { createXlsxToVcfFlow } = require('./src/xlsxToVcfFlow');
const { createRenameFlow } = require('./src/renameFlow');
const stop = require('./src/stopManager');
const ent = require('./src/entitlements');

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('Missing BOT_TOKEN in environment. Please set it in .env');
  process.exit(1);
}

async function main() {
  const bot = new TelegramBot(BOT_TOKEN, { polling: true });
  ent.init();

  // Separate sessions per flow
  const sessionsTxtToVcf = new Map();
  const sessionsVcfToTxt = new Map();
  const sessionsSplit = new Map();
  const sessionsAdmin = new Map();
  const sessionsMerge = new Map();
  const sessionsXlsx = new Map();
  const sessionsRename = new Map();

  const txtToVcfFlow = createTxtToVcfFlow(bot, sessionsTxtToVcf);
  const vcfToTxtFlow = createVcfToTxtFlow(bot, sessionsVcfToTxt);
  const splitFlow = createSplitFlow(bot, sessionsSplit);
  const adminFlow = createAdminFromMessageFlow(bot, sessionsAdmin);
  const mergeFlow = createMergeFlow(bot, sessionsMerge);
  const xlsxFlow = createXlsxToVcfFlow(bot, sessionsXlsx);
  const renameFlow = createRenameFlow(bot, sessionsRename);

  // Helpers: guard access
  function recordAndGuard(msgOrQuery) {
    try {
      if (msgOrQuery.from) ent.ensureUserFromMessage({ from: msgOrQuery.from });
    } catch (_) {}
    const uid = (msgOrQuery.from && msgOrQuery.from.id) || (msgOrQuery.message && msgOrQuery.message.from && msgOrQuery.message.from.id);
    if (!uid) return false;
    return ent.isAllowed(uid);
  }

  // Admin commands (only admins)
  bot.onText(/^\/whoami$/, async (msg) => {
    ent.ensureUserFromMessage(msg);
    const u = ent.getUser(msg.from.id);
    const isAdmin = ent.isAdmin(msg.from.id);
    await bot.sendMessage(msg.chat.id,
      `ID: ${msg.from.id}\nUsername: @${msg.from.username || '-'}\nRole: ${u?.role || '-'}\nStatus: ${u?.status || '-'}\nAdmin: ${isAdmin ? 'ya' : 'tidak'}`,
      { reply_markup: { remove_keyboard: false } }
    );
  });

  bot.onText(/^\/allow\s+(\d+)$/, async (msg, m) => {
    if (!ent.isAdmin(msg.from.id)) return;
    const target = Number(m[1]);
    ent.allowUser(target);
    await bot.sendMessage(msg.chat.id, `User ${target} diizinkan (allowed).`);
  });

  bot.onText(/^\/block\s+(\d+)$/, async (msg, m) => {
    if (!ent.isAdmin(msg.from.id)) return;
    const target = Number(m[1]);
    ent.blockUser(target);
    await bot.sendMessage(msg.chat.id, `User ${target} diblokir.`);
  });

  bot.onText(/^\/grantpro\s+(\d+)(?:\s+(\d+))?$/, async (msg, m) => {
    if (!ent.isAdmin(msg.from.id)) return;
    const target = Number(m[1]);
    const days = m[2] ? Number(m[2]) : null;
    ent.grantPro(target, days);
    await bot.sendMessage(msg.chat.id, `User ${target} dinaikkan ke PRO${days ? ` selama ${days} hari` : ' (lifetime)'}.`);
  });

  bot.onText(/^\/revokepro\s+(\d+)$/, async (msg, m) => {
    if (!ent.isAdmin(msg.from.id)) return;
    const target = Number(m[1]);
    ent.revokePro(target);
    await bot.sendMessage(msg.chat.id, `PRO user ${target} dicabut (kembali allowed).`);
  });

  // /start hanya untuk memunculkan Reply Keyboard utama (tanpa inline pesan menu)
  bot.onText(/^\/start$/, async (msg) => {
    ent.ensureUserFromMessage(msg);
    if (!recordAndGuard(msg)) {
      await bot.sendMessage(
        msg.chat.id,
        'Akses ditolak. Hubungi admin untuk mendapatkan izin.'
      );
      return;
    }
    await bot.sendMessage(
      msg.chat.id,
      'Pilih fitur melalui keyboard di bawah.',
      getMainMenu()
    );
  });

  // Callback queries untuk semua inline langkah lanjutan
  bot.on('callback_query', async (query) => {
    // Guard akses untuk callback juga
    if (!recordAndGuard(query)) {
      try {
        await bot.answerCallbackQuery(query.id, { text: 'Akses ditolak.', show_alert: true });
      } catch (_) {}
      return;
    }

    await txtToVcfFlow.handleCallbackQuery(query);
    await vcfToTxtFlow.handleCallbackQuery(query);
    await splitFlow.handleCallbackQuery(query);
    await adminFlow.handleCallbackQuery(query);
    await mergeFlow.handleCallbackQuery(query);
    await xlsxFlow.handleCallbackQuery(query);
    await renameFlow.handleCallbackQuery(query);
  });

  // Hentikan semua proses aman
  async function stopAll(chatId) {
    // bump cancel token
    stop.requestStop(chatId);
    // Reset semua sesi flow untuk chat ini
    sessionsTxtToVcf.delete(chatId);
    sessionsVcfToTxt.delete(chatId);
    sessionsSplit.delete(chatId);
    sessionsAdmin.delete(chatId);
    sessionsMerge.delete(chatId);
    sessionsXlsx.delete(chatId);
    sessionsRename.delete(chatId);

    try {
      await bot.sendMessage(chatId, 'Semua proses dihentikan.');
    } catch (_) {}
    // Jangan clearStop di sini; biarkan token tetap meningkat.
  }

  // Router tombol Reply Keyboard (MENU UTAMA)
  async function routeMainMenuByText(msg) {
    const t = (msg.text || '').trim();
    if (!t) return false;

    if (t === menuLabels.TXT_TO_VCF) {
      await txtToVcfFlow.handleStart(msg.chat.id);
      return true;
    }
    if (t === menuLabels.XLSX_TO_VCF) {
      await xlsxFlow.handleStart(msg.chat.id);
      return true;
    }
    if (t === menuLabels.VCF_TO_TXT) {
      await vcfToTxtFlow.handleStart(msg.chat.id);
      return true;
    }
    if (t === menuLabels.ADMIN_FROM_MSG) {
      await adminFlow.handleStart(msg.chat.id);
      return true;
    }
    if (t === menuLabels.SPLIT_FILE) {
      await splitFlow.handleStart(msg.chat.id);
      return true;
    }
    if (t === menuLabels.MERGE_FILES) {
      await mergeFlow.handleStart(msg.chat.id);
      return true;
    }
    if (t === menuLabels.RENAME) {
      await renameFlow.handleStart(msg.chat.id);
      return true;
    }
    if (t === menuLabels.STOP) {
      await stopAll(msg.chat.id);
      return true;
    }
    return false;
  }

  bot.on('message', async (msg) => {
    // Ignore /start (handled above)
    if (msg.text && /^\/start$/.test(msg.text)) return;

    // Record user + guard
    ent.ensureUserFromMessage(msg);
    if (!recordAndGuard(msg)) {
      await bot.sendMessage(
        msg.chat.id,
        '*Akses ditolak. Hubungi admin @JaeHype untuk mendapatkan izin Uji Coba*.'
      );
      return;
    }

    // Coba routing oleh Reply Keyboard (MENU UTAMA)
    const handledByMainMenu = await routeMainMenuByText(msg);
    if (handledByMainMenu) return;

    // Jika bukan tombol menu utama, teruskan ke semua flow aktif
    await txtToVcfFlow.handleMessage(msg);
    await vcfToTxtFlow.handleMessage(msg);
    await splitFlow.handleMessage(msg);
    await adminFlow.handleMessage(msg);
    await mergeFlow.handleMessage(msg);
    await xlsxFlow.handleMessage(msg);
    await renameFlow.handleMessage(msg);
  });

  console.log('Bot is running with index.js as entry point...');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
