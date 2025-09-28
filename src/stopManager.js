// Sederhana: kelola bendera "stop" per chat agar loop pengiriman dokumen berhenti aman
const stops = new Map(); // chatId -> timestamp

function requestStop(chatId) {
  stops.set(chatId, Date.now());
}

function clearStop(chatId) {
  stops.delete(chatId);
}

function shouldStop(chatId) {
  return stops.has(chatId);
}

module.exports = {
  requestStop,
  clearStop,
  shouldStop,
};
