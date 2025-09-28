require('dotenv').config();
const path = require('path');
const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');

const { TEMP_DIR = './temp' } = process.env;

// Ensure temp dir exists
fs.mkdirSync(path.resolve(TEMP_DIR), { recursive: true });

// Init bot
const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('Missing BOT_TOKEN in environment');
  process.exit(1);
}
const bot = new TelegramBot(token, { polling: true });

// Local imports (handlers and utilities)
const sessionStore = require('./services/sessionStore');
const registerStart = require('./bot/commands/start');
const registerCancel = require('./bot/commands/cancel');
const registerCallbacks = require('./bot/handlers/callbacks');
const registerDocuments = require('./bot/handlers/documents');
const registerMessages = require('./bot/handlers/messages');

// Register commands
bot.setMyCommands([
  { command: 'start', description: 'Mulai dan tampilkan menu' },
  { command: 'cancel', description: 'Batalkan proses dan kembali ke menu' },
  { command: 'help', description: 'Cara menggunakan bot' }
]);

// Simple /help
bot.onText(/^\/help$/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, [
    'Cara pakai (TXT → VCF):',
    '1) Tekan tombol "📒TXT to VCF📒".',
    '2) Kirim file .txt berisi nomor.',
    '3) Pilih nama file output (default/custom).',
    '4) Masukkan nama kontak.',
    '5) Tunggu, bot akan kirim file .vcf hasil konversi.',
    '',
    'Aturan nomor:',
    '- Otomatis tambah tanda +',
    '- 00 → +',
    '- 08xxxx → +62xxxx',
    '- Selain itu, cukup prefiks + (mis: 628xx → +628xx)'
  ].join('\n'));
});

// Wire handlers
registerStart(bot, sessionStore);
registerCancel(bot, sessionStore);
registerCallbacks(bot, sessionStore);
registerDocuments(bot, sessionStore);
registerMessages(bot, sessionStore);

console.log('Bot is running...');
