require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const { getMainMenu } = require('./src/keyboards');
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

  bot.onText(/^\/start$/, async (msg) => {
    await bot.sendMessage(
      msg.chat.id,
      'Selamat datang! Pilih menu di bawah ini:',
      getMainMenu()
    );
  });

  bot.on('callback_query', async (query) => {
    await txtToVcfFlow.handleCallbackQuery(query);
    await vcfToTxtFlow.handleCallbackQuery(query);
    await splitFlow.handleCallbackQuery(query);
    await adminFlow.handleCallbackQuery(query);
    await mergeFlow.handleCallbackQuery(query);
    await xlsxFlow.handleCallbackQuery(query);
  });

  bot.on('message', async (msg) => {
    if (msg.text && /^\/start$/.test(msg.text)) return;
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
