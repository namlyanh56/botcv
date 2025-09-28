require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const { getMainMenu } = require('./src/keyboards');
const { createTxtToVcfFlow } = require('./src/txtToVcfFlow');

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('Missing BOT_TOKEN in environment. Please set it in .env');
  process.exit(1);
}

async function main() {
  const bot = new TelegramBot(BOT_TOKEN, { polling: true });

  // In-memory session store per chatId
  const sessions = new Map();

  // Init and mount feature flows here
  const txtToVcfFlow = createTxtToVcfFlow(bot, sessions);

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
    await txtToVcfFlow.handleCallbackQuery(query);
    // Di masa depan, mount flow lain di sini juga
  });

  // Messages (documents/text)
  bot.on('message', async (msg) => {
    // /start sudah ditangani di atas
    if (msg.text && /^\/start$/.test(msg.text)) return;

    // Delegasikan ke flow aktif. Tambahkan flow lain di sini jika ada.
    await txtToVcfFlow.handleMessage(msg);
  });

  console.log('Bot is running with index.js as entry point...');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
