// Manager untuk STOP: boolean flag (kompatibilitas) + cancel token (generation)
//
// - requestStop(chatId): men-set flag boolean dan menaikkan generation
// - clearStop(chatId): hanya menghapus flag boolean (TIDAK mengubah generation)
// - shouldStop(chatId): baca flag boolean (kompat)
// - snapshot(chatId): ambil generation saat proses mulai
// - shouldAbort(chatId, snap): true bila generation terkini != snapshot (indikasi harus berhenti)

const stopFlags = new Map();     // chatId -> true (optional, legacy)
const generations = new Map();   // chatId -> integer generation

function requestStop(chatId) {
  const current = generations.get(chatId) || 0;
  generations.set(chatId, current + 1); // bump token
  stopFlags.set(chatId, true);          // legacy flag
}

function clearStop(chatId) {
  // HANYA membersihkan flag legacy supaya tidak spam pesan.
  // Jangan sentuh generations agar proses lama tetap abort.
  stopFlags.delete(chatId);
}

function shouldStop(chatId) {
  return !!stopFlags.get(chatId);
}

function snapshot(chatId) {
  return generations.get(chatId) || 0;
}

function shouldAbort(chatId, snap) {
  const now = generations.get(chatId) || 0;
  return now !== snap;
}

module.exports = {
  requestStop,
  clearStop,
  shouldStop,
  snapshot,
  shouldAbort,
};
