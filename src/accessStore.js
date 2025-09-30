// Lightweight persistent user store using JSON file.
// Designed to be upgraded to a DB later without changing entitlements API.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), 'data');
const USERS_PATH = path.join(DATA_DIR, 'users.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function init() {
  ensureDataDir();
  if (!fs.existsSync(USERS_PATH)) {
    const initial = { users: {}, version: 1, updated_at: Date.now() };
    fs.writeFileSync(USERS_PATH, JSON.stringify(initial, null, 2), 'utf8');
  }
}

function load() {
  ensureDataDir();
  try {
    const raw = fs.readFileSync(USERS_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { users: {}, version: 1, updated_at: Date.now() };
  }
}

function save(db) {
  ensureDataDir();
  db.updated_at = Date.now();
  fs.writeFileSync(USERS_PATH, JSON.stringify(db, null, 2), 'utf8');
}

function getUser(userId) {
  const db = load();
  return db.users[String(userId)] || null;
}

function upsertUser(user) {
  const db = load();
  const id = String(user.id);
  const now = Date.now();
  const prev = db.users[id] || {};
  db.users[id] = {
    id: Number(id),
    username: user.username ?? prev.username ?? '',
    first_name: user.first_name ?? prev.first_name ?? '',
    last_name: user.last_name ?? prev.last_name ?? '',
    role: user.role ?? prev.role ?? 'free',         // admin | allowed | trial | pro | free | blocked
    status: user.status ?? prev.status ?? 'active', // active | blocked
    trial_expires_at: user.trial_expires_at ?? prev.trial_expires_at ?? null,
    pro_expires_at: user.pro_expires_at ?? prev.pro_expires_at ?? null,
    trial_used: user.trial_used ?? prev.trial_used ?? false, // mark if user has already taken trial once
    created_at: prev.created_at || now,
    updated_at: now,
  };
  save(db);
  return db.users[id];
}

function setRole(userId, role) {
  const db = load();
  const id = String(userId);
  if (!db.users[id]) return null;
  db.users[id].role = role;
  db.users[id].updated_at = Date.now();
  save(db);
  return db.users[id];
}

function setStatus(userId, status) {
  const db = load();
  const id = String(userId);
  if (!db.users[id]) return null;
  db.users[id].status = status;
  db.users[id].updated_at = Date.now();
  save(db);
  return db.users[id];
}

function setFields(userId, fields) {
  const db = load();
  const id = String(userId);
  if (!db.users[id]) return null;
  db.users[id] = { ...db.users[id], ...fields, updated_at: Date.now() };
  save(db);
  return db.users[id];
}

function listUsers(filter = {}) {
  const db = load();
  const out = [];
  for (const id of Object.keys(db.users)) {
    const u = db.users[id];
    let ok = true;
    for (const [k, v] of Object.entries(filter)) {
      if (u[k] !== v) { ok = false; break; }
    }
    if (ok) out.push(u);
  }
  return out;
}

module.exports = {
  init,
  getUser,
  upsertUser,
  setRole,
  setStatus,
  setFields,
  listUsers,
};
