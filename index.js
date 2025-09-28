require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const { getMainMenu, menuLabels } = require('./src/keyboards');
const { createTxtToVcfFlow } = require('./src/txtToVcfFlow');
const { createVcfToTxtFlow } = require('./src/vcfToTxtFlow');
const { createSplitFlow } = require('./src/splitFlow');
const { createAdminFromMessageFlow } = require('./src/adminFromMessageFlow');
const { createMergeFlow } = require('./src/mergeFlow');
const { createXlsxToVcfFlow } = require('./src/xlsxToVcfFlow');

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('Missing BOT_TOKEN in environment. Please set it in .env');
  process.exit(1);
}

async function main() {
  const bot = new TelegramBot(BOT_TOKEN, { polling: true });

  // Separate sessions per flow
  const sessionsTxtToVcf = new Map();
  const sessionsVcfToTxt = new Map();
  const sessionsSplit = new Map();
  const sessionsAdmin = new Map();
  const sessionsMerge = new Map();
  const sessionsXlsx = new Map();

  const txtToVcfFlow = createTxtToVcfFlow(bot, sessionsTxtToVcf);
  const vcfToTxtFlow = createVcfToTxtFlow(bot, sessionsVcfToTxt);
  const splitFlow = createSplitFlow(bot, sessionsSplit);
  const adminFlow = createAdminFromMessageFlow(bot, sessionsAdmin);
  const mergeFlow = createMergeFlow(bot, sessionsMerge);
  const xlsxFlow = createXlsxToVcfFlow(bot, sessionsXlsx);

  // /start hanya untuk memunculkan Reply Keyboard utama (tanpa inline pesan menu)
  bot.onText(/^\/start$/, async (msg) => {
    await bot.sendMessage(
      msg.chat.id,
      'Pilih fitur melalui keyboard di bawah.',
      getMainMenu()
    );
  });

  // Callback queries untuk semua inline langkah lanjutan
  bot.on('callback_query', async (query) => {
    await txtToVcfFlow.handleCallbackQuery(query);
    await vcfToTxtFlow.handleCallbackQuery(query);
    await splitFlow.handleCallbackQuery(query);
    await adminFlow.handleCallbackQuery(query);
    await mergeFlow.handleCallbackQuery(query);
    await xlsxFlow.handleCallbackQuery(query);
  });

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
    return false;
  }

  bot.on('message', async (msg) => {
    // Abaikan /start (sudah ditangani)
    if (msg.text && /^\/start$/.test(msg.text)) return;

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
  });

  console.log('Bot is running with index.js as entry point...');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
