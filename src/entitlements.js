// Authorization + entitlement helpers for allowlist + roles.
// Ready for payment + trial.

const store = require('./accessStore');

const ACCESS_MODE = (process.env.ACCESS_MODE || 'open').toLowerCase(); // 'open' | 'allowlist'
const ADMIN_IDS = String(process.env.ADMIN_IDS || '')
  .split(',')
  .map(s => Number(s.trim()))
  .filter(n => Number.isFinite(n));
const STATIC_ALLOWLIST = String(process.env.ALLOWLIST_IDS || '')
  .split(',')
  .map(s => Number(s.trim()))
  .filter(n => Number.isFinite(n));

function init() {
  store.init();
}

function ensureUserFromMessage(msg) {
  const from = msg.from || {};
  return store.upsertUser({
    id: from.id,
    username: from.username,
    first_name: from.first_name,
    last_name: from.last_name,
  });
}

function getUser(userId) {
  return store.getUser(userId);
}

function isAdmin(userId) {
  if (ADMIN_IDS.includes(Number(userId))) return true;
  const u = store.getUser(userId);
  return !!u && u.role === 'admin';
}

function isTrialActive(u) {
  if (!u) return false;
  if (u.role !== 'trial') return false;
  if (!u.trial_expires_at) return false;
  return Date.now() <= Number(u.trial_expires_at);
}

function isProActive(u) {
  if (!u) return false;
  if (u.role !== 'pro') return false;
  // null/undefined = lifetime
  if (u.pro_expires_at == null) return true;
  return Date.now() <= Number(u.pro_expires_at);
}

function isAllowed(userId) {
  const id = Number(userId);
  if (isAdmin(id)) return true;
  if (ACCESS_MODE === 'open') return true;

  // allowlist mode
  if (STATIC_ALLOWLIST.includes(id)) return true;
  const u = store.getUser(id);
  if (!u) return false;
  if (u.status === 'blocked') return false;

  // allowed roles with validity check
  if (u.role === 'allowed') return true;
  if (isTrialActive(u)) return true;
  if (isProActive(u)) return true;
  return false;
}

// Trial management
function startTrial(userId, days = 3) {
  const now = Date.now();
  const u = store.getUser(userId) || store.upsertUser({ id: userId });
  // If already used once, reject
  const alreadyUsed = !!u.trial_used;
  if (alreadyUsed) {
    return { ok: false, reason: 'already_used', user: u };
  }
  // If currently active trial, keep it (don't extend)
  if (u.role === 'trial' && u.trial_expires_at && now <= Number(u.trial_expires_at)) {
    return { ok: true, already: true, expires_at: Number(u.trial_expires_at), user: u };
  }
  const expires = now + Number(days) * 24 * 60 * 60 * 1000;
  store.setFields(userId, { trial_expires_at: expires, trial_used: true });
  store.setRole(userId, 'trial');
  const nu = store.getUser(userId);
  return { ok: true, already: false, expires_at: expires, user: nu };
}

function allowUser(userId) {
  const u = store.getUser(userId) || store.upsertUser({ id: userId });
  if (!u) return null;
  return store.setRole(userId, 'allowed');
}

function blockUser(userId) {
  const u = store.getUser(userId) || store.upsertUser({ id: userId });
  if (!u) return null;
  store.setStatus(userId, 'blocked');
  return store.setRole(userId, 'blocked');
}

function grantPro(userId, days = null) {
  const u = store.getUser(userId) || store.upsertUser({ id: userId });
  const now = Date.now();
  const expires = days && Number.isFinite(Number(days))
    ? now + Number(days) * 24 * 60 * 60 * 1000
    : null; // null = lifetime
  store.setFields(userId, { pro_expires_at: expires });
  return store.setRole(userId, 'pro');
}

function revokePro(userId) {
  store.setFields(userId, { pro_expires_at: null });
  return store.setRole(userId, 'allowed'); // fallback to allowed
}

module.exports = {
  init,
  ensureUserFromMessage,
  getUser,
  isAdmin,
  isAllowed,
  startTrial,
  allowUser,
  blockUser,
  grantPro,
  revokePro,
};
