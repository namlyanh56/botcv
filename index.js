require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const { getMainMenu } = require('./src/keyboards');
const { createTxtToVcfFlow } = require('./src/txtToVcfFlow');
const { createVcfToTxtFlow } = require('./src/vcfToTxtFlow');

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('Missing BOT_TOKEN in environment. Please set it in .env');
  process.exit(1);
}

async function main() {
  const bot = new TelegramBot(BOT_TOKEN, { polling: true });

  // In-memory session stores per flow
  const sessionsTxtToVcf = new Map();
  const sessionsVcfToTxt = new Map();

  // Init and mount feature flows here
  const txtToVcfFlow = createTxtToVcfFlow(bot, sessionsTxtToVcf);
  const vcfToTxtFlow = createVcfToTxtFlow(bot, sessionsVcfToTxt);

  // Global commands
  bot.onText(/^\/start$/, async (msg) => {
    await bot.sendMessage(
      msg.chat.id,
      'Selamat datang! Pilih menu di bawah ini:',
      getMainMenu()
    );
  });

  // Inline callbacks
  bot.on('callback_query', async (query) => {
    // Delegate to both flows; each will handle only its actions/states
    await txtToVcfFlow.handleCallbackQuery(query);
    await vcfToTxtFlow.handleCallbackQuery(query);
  });

  // Messages (documents/text)
  bot.on('message', async (msg) => {
    if (msg.text && /^\/start$/.test(msg.text)) return;
    await txtToVcfFlow.handleMessage(msg);
    await vcfToTxtFlow.handleMessage(msg);
  });

  console.log('Bot is running with index.js as entry point...');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
