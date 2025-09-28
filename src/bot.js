require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const { getMainMenu } = require('./keyboards');
const { createTxtToVcfFlow } = require('./txtToVcfFlow');

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('Missing BOT_TOKEN in environment. Please set it in .env');
  process.exit(1);
}

async function main() {
  const bot = new TelegramBot(BOT_TOKEN, { polling: true });

  // In-memory session store per chatId
  const sessions = new Map();

  // Init flow
  const txtToVcfFlow = createTxtToVcfFlow(bot, sessions);

  // Commands
  bot.onText(/^\/start$/, async (msg) => {
    await bot.sendMessage(
      msg.chat.id,
      'Selamat datang! Pilih menu di bawah ini:',
      getMainMenu()
    );
  });

  // Callback queries (inline keyboard)
  bot.on('callback_query', async (query) => {
    await txtToVcfFlow.handleCallbackQuery(query);
  });

  // Messages (documents/text) handled by active flow
  bot.on('message', async (msg) => {
    // Ignore service messages for flow
    if (msg.text && /^\/start$/.test(msg.text)) return; // handled above
    await txtToVcfFlow.handleMessage(msg);
  });

  console.log('Bot is running...');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
