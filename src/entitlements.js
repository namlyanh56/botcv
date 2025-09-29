// Authorization + entitlement helpers for allowlist + roles.
// Ready to be wired to payment webhooks later.

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

function isAllowed(userId) {
  const id = Number(userId);
  if (isAdmin(id)) return true;
  if (ACCESS_MODE === 'open') return true;

  // allowlist mode
  if (STATIC_ALLOWLIST.includes(id)) return true;
  const u = store.getUser(id);
  if (!u) return false;
  if (u.status === 'blocked') return false;

  // allowed roles
  if (['allowed', 'trial', 'pro'].includes(u.role)) {
    // Optional: check expiry for trial/pro if you want strict gating now
    return true;
  }
  return false;
}

// Admin ops
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
  return store.setRole(userId, 'allowed'); // fallback to allowed, not blocked
}

module.exports = {
  init,
  ensureUserFromMessage,
  getUser,
  isAdmin,
  isAllowed,
  allowUser,
  blockUser,
  grantPro,
  revokePro,
};
