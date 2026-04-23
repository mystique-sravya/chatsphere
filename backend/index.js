import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import cron from 'node-cron';
import postgres from 'postgres';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { v4 as uuidv4 } from 'uuid';
import { URL } from 'url';
import crypto from 'crypto';

dotenv.config();

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const app = express();
const server = createServer(app);

const PORT = Number(process.env.PORT || 8000);
const JWT_SECRET = requireEnv('JWT_SECRET');
const DATABASE_URL = requireEnv('DATABASE_URL').replace('postgresql+asyncpg://', 'postgresql://');
const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:5173').split(',');
const TABLE_PREFIX = process.env.TABLE_PREFIX || 'chatsphere';
const MESSAGE_DELETE_AFTER_DAYS = Number(process.env.MESSAGE_DELETE_AFTER_DAYS || 7);
const MESSAGE_DELETE_WINDOW_HOURS = Number(process.env.MESSAGE_DELETE_WINDOW_HOURS || 24);
const DEFAULT_AVATAR_STYLE = process.env.DEFAULT_AVATAR_STYLE || 'lorelei-neutral';
const DB_SSL_MODE = process.env.DB_SSL_MODE || 'require';
const DB_SSL_ROOT_CERT_PATH = process.env.DB_SSL_ROOT_CERT_PATH || '';
const DB_RETRY_INTERVAL_MS = Number(process.env.DB_RETRY_INTERVAL_MS || 30000);

const TABLES = {
  users: `${TABLE_PREFIX}_users`,
  userSettings: `${TABLE_PREFIX}_user_settings`,
  friendships: `${TABLE_PREFIX}_friendships`,
  friendRequests: `${TABLE_PREFIX}_friend_requests`,
  blocks: `${TABLE_PREFIX}_blocks`,
  rooms: `${TABLE_PREFIX}_rooms`,
  roomMembers: `${TABLE_PREFIX}_room_members`,
  messages: `${TABLE_PREFIX}_messages`,
  reactions: `${TABLE_PREFIX}_reactions`,
};

let dbStatus = 'starting';
let dbRetryTimer = null;

function asyncHandler(handler) {
  return function wrappedHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function isDatabaseConnectionError(error) {
  return [
    'CONNECT_TIMEOUT',
    'ECONNRESET',
    'EPIPE',
    'CONNECTION_CLOSED',
    'CONNECTION_ENDED',
    'CONNECTION_DESTROYED',
    '57P01',
  ].includes(error?.code);
}

function buildSslConfig() {
  if (DATABASE_URL.includes('localhost') || DATABASE_URL.includes('127.0.0.1')) {
    return false;
  }

  if (DB_SSL_MODE === 'disable') {
    return false;
  }

  const ssl = {
    rejectUnauthorized: DB_SSL_MODE === 'verify-ca' || DB_SSL_MODE === 'verify-full',
  };

  if (DB_SSL_ROOT_CERT_PATH) {
    ssl.ca = fs.readFileSync(DB_SSL_ROOT_CERT_PATH, 'utf8');
  }

  return ssl;
}

const sql = postgres(DATABASE_URL, {
  ssl: buildSslConfig() || undefined,
  connect_timeout: 10,
  idle_timeout: 20,
  max_lifetime: 60 * 30,
});

const activeSockets = new Map();
const socketRooms = new Map();
const roomPresence = new Map();
const voiceSessions = new Map();

function avatarUrl(seed, style = DEFAULT_AVATAR_STYLE) {
  return `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(seed)}`;
}

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      is_admin: user.is_admin,
      is_banned: user.is_banned,
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function normalizeUsername(username) {
  return username.trim().toLowerCase();
}

function serializeUser(row) {
  return {
    id: row.id,
    username: row.username,
    email: row.email || '',
    avatar_url: row.avatar_url,
    avatar_type: row.avatar_type,
    status: row.status,
    last_seen: row.last_seen,
    is_admin: row.is_admin,
    is_banned: row.is_banned,
    created_at: row.created_at,
  };
}

async function query(text, params = []) {
  if (dbStatus !== 'ready') {
    const error = new Error('Database unavailable');
    error.code = 'DB_UNAVAILABLE';
    throw error;
  }

  try {
    return await sql.unsafe(text, params);
  } catch (error) {
    if (isDatabaseConnectionError(error)) {
      dbStatus = 'degraded';
      scheduleDatabaseRetry();
    }
    throw error;
  }
}

async function queryOne(text, params = []) {
  const rows = await query(text, params);
  return rows[0] || null;
}

async function ensureUserSettings(userId) {
  await query(
    `INSERT INTO ${TABLES.userSettings} (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
}

async function getUserById(userId) {
  return queryOne(`SELECT * FROM ${TABLES.users} WHERE id = $1`, [userId]);
}

async function getUserByUsername(username) {
  return queryOne(`SELECT * FROM ${TABLES.users} WHERE username = $1`, [normalizeUsername(username)]);
}

async function areUsersBlocked(userId, otherUserId) {
  if (!userId || !otherUserId) {
    return false;
  }

  const row = await queryOne(
    `SELECT 1 FROM ${TABLES.blocks}
     WHERE (user_id = $1 AND blocked_user_id = $2)
        OR (user_id = $2 AND blocked_user_id = $1)
     LIMIT 1`,
    [userId, otherUserId]
  );

  return Boolean(row);
}

async function getRoomMembers(roomId) {
  return query(
    `SELECT rm.user_id, u.username, u.avatar_url, rm.role, u.status
     FROM ${TABLES.roomMembers} rm
     JOIN ${TABLES.users} u ON u.id = rm.user_id
     WHERE rm.room_id = $1
     ORDER BY u.username ASC`,
    [roomId]
  );
}

function generateInviteCode() {
  return crypto.randomBytes(6).toString('base64url'); // 8-char URL-safe code
}

// ── Encryption at rest: RSA + AES-256-GCM ──────────────────────────────────

let rsaPublicKey;
let rsaPrivateKey;

function initEncryptionKeys() {
  if (process.env.RSA_PRIVATE_KEY && process.env.RSA_PUBLIC_KEY) {
    rsaPrivateKey = process.env.RSA_PRIVATE_KEY.replace(/\\n/g, '\n');
    rsaPublicKey = process.env.RSA_PUBLIC_KEY.replace(/\\n/g, '\n');
  } else {
    // Auto-generate RSA keypair for development / first run
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    rsaPublicKey = publicKey;
    rsaPrivateKey = privateKey;
    console.log('⚠️  Auto-generated RSA keypair — set these env vars on your server for persistence:');
    console.log('RSA_PUBLIC_KEY=' + JSON.stringify(publicKey));
    console.log('RSA_PRIVATE_KEY=' + JSON.stringify(privateKey));
  }
}

function generateEncryptedRoomKey() {
  const aesKey = crypto.randomBytes(32); // AES-256
  const encrypted = crypto.publicEncrypt(
    { key: rsaPublicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    aesKey
  );
  return encrypted.toString('base64');
}

function decryptRoomKey(encryptedKeyB64) {
  try {
    const encrypted = Buffer.from(encryptedKeyB64, 'base64');
    return crypto.privateDecrypt(
      { key: rsaPrivateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      encrypted
    );
  } catch {
    return null; // Key was encrypted with a different RSA keypair
  }
}

function encryptContent(aesKeyBuf, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKeyBuf, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: base64(iv + authTag + ciphertext)
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

function decryptContent(aesKeyBuf, ciphertextB64, context = {}) {
  try {
    const buf = Buffer.from(ciphertextB64, 'base64');
    const iv = buf.subarray(0, 12);
    const authTag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', aesKeyBuf, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(ciphertext) + decipher.final('utf8');
  } catch (error) {
    // If decryption fails (e.g. old unencrypted message), return as-is
    console.error('Message decryption failed; returning stored value as fallback', {
      room_id: context.roomId || null,
      ciphertext_length: typeof ciphertextB64 === 'string' ? ciphertextB64.length : 0,
      ciphertext_preview: typeof ciphertextB64 === 'string' ? ciphertextB64.slice(0, 48) : null,
      aes_key_length: Buffer.isBuffer(aesKeyBuf) ? aesKeyBuf.length : null,
      looks_like_encrypted_payload: typeof ciphertextB64 === 'string' && ciphertextB64.length >= 40,
      error_message: error instanceof Error ? error.message : String(error),
      error_name: error instanceof Error ? error.name : 'UnknownError',
    });

    return ciphertextB64;
  }
}

// Cache decrypted AES keys in memory to avoid RSA decryption on every message
const roomKeyCache = new Map();

async function getRoomAesKey(roomId) {
  if (roomKeyCache.has(roomId)) return roomKeyCache.get(roomId);
  const room = await queryOne(`SELECT encryption_key FROM ${TABLES.rooms} WHERE id = $1`, [roomId]);
  if (!room?.encryption_key) return null;
  const aesKey = decryptRoomKey(room.encryption_key);
  if (!aesKey) {
    // RSA keypair changed — re-encrypt with current keypair
    const newEncKey = generateEncryptedRoomKey();
    await query(`UPDATE ${TABLES.rooms} SET encryption_key = $1 WHERE id = $2`, [newEncKey, roomId]);
    const freshKey = decryptRoomKey(newEncKey);
    roomKeyCache.set(roomId, freshKey);
    return freshKey;
  }
  roomKeyCache.set(roomId, aesKey);
  return aesKey;
}

async function encryptMessageContent(roomId, plaintext) {
  const aesKey = await getRoomAesKey(roomId);
  if (!aesKey) return plaintext; // No encryption key — store plain
  return encryptContent(aesKey, plaintext);
}

async function decryptMessageContent(roomId, ciphertext) {
  const aesKey = await getRoomAesKey(roomId);
  if (!aesKey) return ciphertext;
  return decryptContent(aesKey, ciphertext, { roomId });
}

async function buildRoomResponse(roomRow, includeMembers = false) {
  const memberCountRow = await queryOne(
    `SELECT COUNT(*)::int AS count FROM ${TABLES.roomMembers} WHERE room_id = $1`,
    [roomRow.id]
  );

  const room = {
    id: roomRow.id,
    name: roomRow.name,
    type: roomRow.type,
    created_by: roomRow.created_by,
    is_active: roomRow.is_active,
    invite_code: roomRow.invite_code || null,
    message_retention_hours: roomRow.message_retention_hours || null,
    created_at: roomRow.created_at,
    member_count: memberCountRow?.count || 0,
    members: [],
  };

  if (includeMembers) {
    room.members = await getRoomMembers(roomRow.id);
  }

  return room;
}

async function listAccessibleRooms(userId, mineOnly = false) {
  const rows = mineOnly
    ? await query(
        `SELECT DISTINCT r.*, rm.last_read_at AS my_last_read_at
         FROM ${TABLES.rooms} r
         JOIN ${TABLES.roomMembers} rm ON rm.room_id = r.id AND rm.user_id = $1
         WHERE r.is_active = TRUE
         ORDER BY r.created_at DESC`,
        [userId]
      )
    : await query(
        `SELECT DISTINCT r.*, rm.last_read_at AS my_last_read_at
         FROM ${TABLES.rooms} r
         LEFT JOIN ${TABLES.roomMembers} rm ON rm.room_id = r.id AND rm.user_id = $1
         WHERE r.is_active = TRUE AND (r.type = 'public' OR rm.user_id IS NOT NULL)
         ORDER BY r.created_at DESC`,
        [userId]
      );

  // Batch-fetch latest activity timestamp per room (only messages from OTHER users)
  const roomIds = rows.map((r) => r.id);
  let latestActivityMap = {};
  if (roomIds.length > 0) {
    const activityRows = await query(
      `SELECT room_id, MAX(created_at) AS latest_at
       FROM ${TABLES.messages} m
       WHERE m.room_id = ANY($1::text[]) AND m.sender_id != $2
       GROUP BY room_id`,
      [roomIds, userId]
    );
    for (const ar of activityRows) {
      latestActivityMap[ar.room_id] = ar.latest_at;
    }
  }

  const rooms = [];
  for (const row of rows) {
    const room = await buildRoomResponse(row, true);
    const latestAt = latestActivityMap[row.id];
    room.has_unread = !!(latestAt && row.my_last_read_at && new Date(latestAt) > new Date(row.my_last_read_at));
    rooms.push(room);
  }
  return rooms;
}

async function canAccessRoom(userId, roomId) {
  const room = await queryOne(`SELECT * FROM ${TABLES.rooms} WHERE id = $1 AND is_active = TRUE`, [roomId]);
  if (!room) {
    return null;
  }
  if (room.type === 'public') {
    return room;
  }
  const membership = await queryOne(
    `SELECT 1 FROM ${TABLES.roomMembers} WHERE room_id = $1 AND user_id = $2`,
    [roomId, userId]
  );
  return membership ? room : null;
}

async function findExistingDmRoom(userId, otherUserId) {
  return queryOne(
    `SELECT r.*
     FROM ${TABLES.rooms} r
     JOIN ${TABLES.roomMembers} rm1 ON rm1.room_id = r.id AND rm1.user_id = $1
     JOIN ${TABLES.roomMembers} rm2 ON rm2.room_id = r.id AND rm2.user_id = $2
     WHERE r.type = 'dm' AND r.is_active = TRUE
       AND (SELECT COUNT(*) FROM ${TABLES.roomMembers} x WHERE x.room_id = r.id) = 2
     LIMIT 1`,
    [userId, otherUserId]
  );
}

async function deleteRoomAndNotify(roomId) {
  const members = await query(
    `SELECT user_id FROM ${TABLES.roomMembers} WHERE room_id = $1`,
    [roomId]
  );

  voiceSessions.delete(roomId);
  await query(`DELETE FROM ${TABLES.rooms} WHERE id = $1`, [roomId]);

  for (const member of members) {
    const memberSockets = activeSockets.get(member.user_id);
    if (memberSockets) {
      for (const ws of memberSockets) {
        sendJson(ws, { type: 'room_deleted', room_id: roomId });
      }
    }
  }
}

async function updatePresence(userId, status) {
  await query(
    `UPDATE ${TABLES.users} SET status = $2, last_seen = NOW() WHERE id = $1`,
    [userId, status]
  );
}

async function broadcastPresenceToFriends(userId, status) {
  const friends = await query(
    `SELECT friend_id FROM ${TABLES.friendships} WHERE user_id = $1`,
    [userId]
  );
  const payload = JSON.stringify({ type: status === 'online' ? 'user_online' : 'user_offline', user_id: userId });
  for (const { friend_id } of friends) {
    const sockets = activeSockets.get(friend_id);
    if (!sockets) continue;
    for (const s of sockets) {
      if (s.readyState === 1) s.send(payload);
    }
  }
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ detail: 'Authentication required' });
  }

  try {
    req.auth = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ detail: 'Invalid token' });
  }
}

const requireUser = asyncHandler(async (req, res, next) => {
  const user = await getUserById(req.auth.id);
  if (!user) {
    return res.status(401).json({ detail: 'User not found' });
  }
  if (user.is_banned) {
    return res.status(403).json({ detail: 'Account banned' });
  }
  req.user = user;
  next();
});

function adminMiddleware(req, res, next) {
  if (!req.user?.is_admin) {
    return res.status(403).json({ detail: 'Admin access required' });
  }
  next();
}

app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
app.use(express.json());

app.post('/api/auth/signup', asyncHandler(async (req, res) => {
  try {
    const username = normalizeUsername(req.body.username || '');
    const password = String(req.body.password || '');

    if (!username.match(/^[a-z0-9_]{3,32}$/)) {
      return res.status(400).json({ detail: 'Username must be 3-32 chars using letters, numbers, or underscores' });
    }
    if (password.length < 6) {
      return res.status(400).json({ detail: 'Password must be at least 6 characters' });
    }

    const existing = await getUserByUsername(username);
    if (existing) {
      return res.status(409).json({ detail: 'Username already taken' });
    }

    const userId = uuidv4();
    const passwordHash = await bcrypt.hash(password, 10);
    const avatar = avatarUrl(username);

    const created = await queryOne(
      `INSERT INTO ${TABLES.users}
        (id, username, email, password_hash, avatar_url, avatar_type, avatar_style, avatar_seed)
       VALUES ($1, $2, $3, $4, $5, 'dicebear', $6, $7)
       RETURNING *`,
      [userId, username, '', passwordHash, avatar, DEFAULT_AVATAR_STYLE, username]
    );

    await ensureUserSettings(userId);

    const token = signToken(created);
    res.json({ token, user: serializeUser(created) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ detail: 'Signup failed' });
  }
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  try {
    const username = normalizeUsername(req.body.username || '');
    const password = String(req.body.password || '');
    const user = await getUserByUsername(username);

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ detail: 'Invalid credentials' });
    }
    if (user.is_banned) {
      return res.status(403).json({ detail: 'Account banned' });
    }

    const token = signToken(user);
    res.json({ token, user: serializeUser(user) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ detail: 'Login failed' });
  }
}));

app.get('/api/auth/me', authMiddleware, requireUser, asyncHandler(async (req, res) => {
  res.json(serializeUser(req.user));
}));

app.put('/api/auth/me', authMiddleware, requireUser, asyncHandler(async (req, res) => {
  try {
    const updates = [];
    const params = [];

    if (req.body.username && req.body.username !== req.user.username) {
      return res.status(400).json({ detail: 'Username cannot be changed once it is created' });
    }

    if (req.body.avatar_url || req.body.avatar_type || req.body.avatar_style) {
      const nextAvatarType = req.body.avatar_type === 'custom' ? 'custom' : 'dicebear';
      const nextAvatarStyle = nextAvatarType === 'dicebear'
        ? String(req.body.avatar_style || req.user.avatar_style || DEFAULT_AVATAR_STYLE)
        : 'custom';
      const nextAvatarSeed = req.user.username;
      const nextAvatarUrl = req.body.avatar_url
        ? String(req.body.avatar_url)
        : avatarUrl(nextAvatarSeed, nextAvatarStyle);

      updates.push(`avatar_url = $${updates.length + 1}`);
      params.push(nextAvatarUrl);
      updates.push(`avatar_type = $${updates.length + 1}`);
      params.push(nextAvatarType);
      updates.push(`avatar_style = $${updates.length + 1}`);
      params.push(nextAvatarStyle);
      updates.push(`avatar_seed = $${updates.length + 1}`);
      params.push(nextAvatarSeed);
    }

    if (!updates.length) {
      return res.json(serializeUser(req.user));
    }

    params.push(req.user.id);
    const updated = await queryOne(
      `UPDATE ${TABLES.users}
       SET ${updates.join(', ')}
       WHERE id = $${params.length}
       RETURNING *`,
      params
    );
    res.json(serializeUser(updated));
  } catch (error) {
    console.error(error);
    res.status(500).json({ detail: 'Profile update failed' });
  }
}));

app.put('/api/auth/password', authMiddleware, requireUser, asyncHandler(async (req, res) => {
  try {
    const currentPassword = String(req.body.current_password || '');
    const newPassword = String(req.body.new_password || '');

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ detail: 'Current password and new password are required' });
    }

    if (!(await bcrypt.compare(currentPassword, req.user.password_hash))) {
      return res.status(401).json({ detail: 'Current password is incorrect' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ detail: 'New password must be at least 6 characters' });
    }

    if (await bcrypt.compare(newPassword, req.user.password_hash)) {
      return res.status(400).json({ detail: 'New password must be different from the current password' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await query(
      `UPDATE ${TABLES.users}
       SET password_hash = $1
       WHERE id = $2`,
      [passwordHash, req.user.id]
    );

    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ detail: 'Password update failed' });
  }
}));

app.get('/api/users/search', authMiddleware, requireUser, asyncHandler(async (req, res) => {
  const term = String(req.query.q || '').trim().toLowerCase();
  if (term.length < 2) {
    return res.json([]);
  }
  const rows = await query(
    `SELECT * FROM ${TABLES.users}
     WHERE username ILIKE $1 AND id != $2 AND is_banned = FALSE
       AND NOT EXISTS (
         SELECT 1 FROM ${TABLES.blocks} b
         WHERE (b.user_id = $2 AND b.blocked_user_id = ${TABLES.users}.id)
            OR (b.user_id = ${TABLES.users}.id AND b.blocked_user_id = $2)
       )
     ORDER BY status DESC, username ASC
     LIMIT 20`,
    [`%${term}%`, req.user.id]
  );
  res.json(rows.map(serializeUser));
}));

app.get('/api/users/:id', authMiddleware, requireUser, asyncHandler(async (req, res) => {
  const user = await getUserById(req.params.id);
  if (!user) {
    return res.status(404).json({ detail: 'User not found' });
  }
  res.json(serializeUser(user));
}));

app.get('/api/blocks', authMiddleware, requireUser, asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT b.blocked_user_id AS user_id, b.created_at, u.username, u.avatar_url, u.status, u.last_seen
     FROM ${TABLES.blocks} b
     JOIN ${TABLES.users} u ON u.id = b.blocked_user_id
     WHERE b.user_id = $1
     ORDER BY b.created_at DESC`,
    [req.user.id]
  );

  res.json(rows);
}));

app.post('/api/users/:id/block', authMiddleware, requireUser, asyncHandler(async (req, res) => {
  const blockedUserId = req.params.id;
  if (!blockedUserId || blockedUserId === req.user.id) {
    return res.status(400).json({ detail: 'Invalid user' });
  }

  const blockedUser = await getUserById(blockedUserId);
  if (!blockedUser) {
    return res.status(404).json({ detail: 'User not found' });
  }

  await query(
    `INSERT INTO ${TABLES.blocks} (user_id, blocked_user_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id, blocked_user_id) DO NOTHING`,
    [req.user.id, blockedUserId]
  );

  await query(
    `DELETE FROM ${TABLES.friendships}
     WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)`,
    [req.user.id, blockedUserId]
  );

  await query(
    `DELETE FROM ${TABLES.friendRequests}
     WHERE (from_user_id = $1 AND to_user_id = $2) OR (from_user_id = $2 AND to_user_id = $1)`,
    [req.user.id, blockedUserId]
  );

  const existingDm = await findExistingDmRoom(req.user.id, blockedUserId);
  if (existingDm) {
    await deleteRoomAndNotify(existingDm.id);
  }

  const blockedSockets = activeSockets.get(blockedUserId);
  if (blockedSockets) {
    for (const ws of blockedSockets) {
      sendJson(ws, { type: 'friend_removed', user_id: req.user.id });
    }
  }

  res.json({ ok: true });
}));

app.delete('/api/users/:id/block', authMiddleware, requireUser, asyncHandler(async (req, res) => {
  await query(
    `DELETE FROM ${TABLES.blocks}
     WHERE user_id = $1 AND blocked_user_id = $2`,
    [req.user.id, req.params.id]
  );

  res.json({ ok: true });
}));

app.get('/api/settings', authMiddleware, requireUser, asyncHandler(async (req, res) => {
  await ensureUserSettings(req.user.id);
  const settings = await queryOne(`SELECT * FROM ${TABLES.userSettings} WHERE user_id = $1`, [req.user.id]);
  res.json({ theme: settings.theme, notifications_enabled: settings.notifications_enabled });
}));

app.put('/api/settings', authMiddleware, requireUser, asyncHandler(async (req, res) => {
  await ensureUserSettings(req.user.id);
  const theme = req.body.theme === 'light' ? 'light' : 'dark';
  const notificationsEnabled = req.body.notifications_enabled !== false;
  const settings = await queryOne(
    `UPDATE ${TABLES.userSettings}
     SET theme = $2, notifications_enabled = $3
     WHERE user_id = $1
     RETURNING *`,
    [req.user.id, theme, notificationsEnabled]
  );
  res.json({ theme: settings.theme, notifications_enabled: settings.notifications_enabled });
}));

app.post('/api/friends/request', authMiddleware, requireUser, asyncHandler(async (req, res) => {
  const toUserId = req.body.to_user_id;
  if (!toUserId || toUserId === req.user.id) {
    return res.status(400).json({ detail: 'Invalid user' });
  }

  if (await areUsersBlocked(req.user.id, toUserId)) {
    return res.status(403).json({ detail: 'You cannot send a friend request to this user' });
  }

  const existingFriendship = await queryOne(
    `SELECT 1 FROM ${TABLES.friendships} WHERE user_id = $1 AND friend_id = $2`,
    [req.user.id, toUserId]
  );
  if (existingFriendship) {
    return res.status(409).json({ detail: 'Already friends' });
  }

  await query(
    `INSERT INTO ${TABLES.friendRequests} (id, from_user_id, to_user_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (from_user_id, to_user_id) DO NOTHING`,
    [uuidv4(), req.user.id, toUserId]
  );

  // Notify the recipient in real time
  const recipientSockets = activeSockets.get(toUserId);
  if (recipientSockets) {
    for (const ws of recipientSockets) {
      sendJson(ws, {
        type: 'incoming_friend_request',
        from_user_id: req.user.id,
        from_username: req.user.username,
      });
    }
  }

  res.json({ ok: true });
}));

app.get('/api/friends/requests', authMiddleware, requireUser, asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT fr.id, fr.from_user_id, fr.to_user_id, fr.created_at, u.username AS from_username, u.avatar_url AS from_avatar
     FROM ${TABLES.friendRequests} fr
     JOIN ${TABLES.users} u ON u.id = fr.from_user_id
     WHERE fr.to_user_id = $1
     ORDER BY fr.created_at DESC`,
    [req.user.id]
  );

  res.json(rows.map((row) => ({
    id: row.id,
    from_user_id: row.from_user_id,
    from_username: row.from_username,
    from_avatar: row.from_avatar,
    to_user_id: row.to_user_id,
    to_username: req.user.username,
    status: 'pending',
    created_at: row.created_at,
  })));
}));

app.get('/api/friends/requests/sent', authMiddleware, requireUser, asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT fr.id, fr.from_user_id, fr.to_user_id, fr.created_at, u.username AS to_username, u.avatar_url AS to_avatar
     FROM ${TABLES.friendRequests} fr
     JOIN ${TABLES.users} u ON u.id = fr.to_user_id
     WHERE fr.from_user_id = $1
     ORDER BY fr.created_at DESC`,
    [req.user.id]
  );

  res.json(rows.map((row) => ({
    id: row.id,
    from_user_id: row.from_user_id,
    from_username: req.user.username,
    to_user_id: row.to_user_id,
    to_username: row.to_username,
    to_avatar: row.to_avatar,
    status: 'pending',
    created_at: row.created_at,
  })));
}));

app.post('/api/friends/requests/:id/accept', authMiddleware, requireUser, asyncHandler(async (req, res) => {
  const requestRow = await queryOne(
    `SELECT * FROM ${TABLES.friendRequests} WHERE id = $1 AND to_user_id = $2`,
    [req.params.id, req.user.id]
  );
  if (!requestRow) {
    return res.status(404).json({ detail: 'Request not found' });
  }

  await query(
    `INSERT INTO ${TABLES.friendships} (user_id, friend_id)
     VALUES ($1, $2), ($2, $1)
     ON CONFLICT (user_id, friend_id) DO NOTHING`,
    [requestRow.from_user_id, requestRow.to_user_id]
  );
  await query(`DELETE FROM ${TABLES.friendRequests} WHERE id = $1`, [req.params.id]);

  // Notify the sender that their request was accepted
  const senderSockets = activeSockets.get(requestRow.from_user_id);
  if (senderSockets) {
    for (const ws of senderSockets) {
      sendJson(ws, {
        type: 'friend_request_accepted',
        user_id: req.user.id,
        username: req.user.username,
      });
    }
  }

  res.json({ ok: true });
}));

app.post('/api/friends/requests/:id/reject', authMiddleware, requireUser, asyncHandler(async (req, res) => {
  await query(`DELETE FROM ${TABLES.friendRequests} WHERE id = $1 AND to_user_id = $2`, [req.params.id, req.user.id]);
  res.json({ ok: true });
}));

app.get('/api/friends', authMiddleware, requireUser, asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT f.friend_id AS user_id, f.is_favorite, u.username, u.avatar_url, u.status, u.last_seen
     FROM ${TABLES.friendships} f
     JOIN ${TABLES.users} u ON u.id = f.friend_id
     WHERE f.user_id = $1
     ORDER BY f.is_favorite DESC, u.status DESC, u.username ASC`,
    [req.user.id]
  );
  res.json(rows);
}));

app.get('/api/friends/suggestions', authMiddleware, requireUser, asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 8), 20);
  const rows = await query(
    `SELECT u.id, u.username, u.email, u.avatar_url, u.avatar_type, u.status, u.last_seen, u.is_admin, u.is_banned, u.created_at,
            COALESCE(shared_rooms.shared_room_count, 0) AS shared_room_count,
            COALESCE(mutual_friends.mutual_friend_count, 0) AS mutual_friend_count,
            COALESCE(shared_rooms.shared_room_count, 0) + COALESCE(mutual_friends.mutual_friend_count, 0) AS suggestion_score
     FROM ${TABLES.users} u
     LEFT JOIN (
       SELECT rm2.user_id, COUNT(DISTINCT rm1.room_id)::int AS shared_room_count
       FROM ${TABLES.roomMembers} rm1
       JOIN ${TABLES.roomMembers} rm2 ON rm1.room_id = rm2.room_id
       WHERE rm1.user_id = $1 AND rm2.user_id != $1
       GROUP BY rm2.user_id
     ) shared_rooms ON shared_rooms.user_id = u.id
     LEFT JOIN (
       SELECT f2.friend_id AS user_id, COUNT(*)::int AS mutual_friend_count
       FROM ${TABLES.friendships} f1
       JOIN ${TABLES.friendships} f2 ON f1.friend_id = f2.user_id
       WHERE f1.user_id = $1 AND f2.friend_id != $1
       GROUP BY f2.friend_id
     ) mutual_friends ON mutual_friends.user_id = u.id
     WHERE u.id != $1
       AND u.is_banned = FALSE
       AND NOT EXISTS (
         SELECT 1 FROM ${TABLES.friendships} f
         WHERE f.user_id = $1 AND f.friend_id = u.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM ${TABLES.friendRequests} fr
         WHERE (fr.from_user_id = $1 AND fr.to_user_id = u.id)
            OR (fr.from_user_id = u.id AND fr.to_user_id = $1)
       )
       AND NOT EXISTS (
         SELECT 1 FROM ${TABLES.blocks} b
         WHERE (b.user_id = $1 AND b.blocked_user_id = u.id)
            OR (b.user_id = u.id AND b.blocked_user_id = $1)
       )
       AND (
         COALESCE(shared_rooms.shared_room_count, 0) > 0
         OR COALESCE(mutual_friends.mutual_friend_count, 0) > 0
       )
     ORDER BY suggestion_score DESC, u.status DESC, u.username ASC
     LIMIT $2`,
    [req.user.id, limit]
  );

  res.json(rows.map(serializeUser));
}));

app.put('/api/friends/:id/favorite', authMiddleware, requireUser, asyncHandler(async (req, res) => {
  const row = await queryOne(
    `UPDATE ${TABLES.friendships}
     SET is_favorite = $3
     WHERE user_id = $1 AND friend_id = $2
     RETURNING *`,
    [req.user.id, req.params.id, Boolean(req.body.is_favorite)]
  );
  if (!row) {
    return res.status(404).json({ detail: 'Friendship not found' });
  }
  res.json({ ok: true });
}));

app.delete('/api/friends/:id', authMiddleware, requireUser, asyncHandler(async (req, res) => {
  await query(
    `DELETE FROM ${TABLES.friendships}
     WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)`,
    [req.user.id, req.params.id]
  );

  // Notify the other user in real time so their friends list updates
  const otherSockets = activeSockets.get(req.params.id);
  if (otherSockets) {
    for (const ws of otherSockets) {
      sendJson(ws, { type: 'friend_removed', user_id: req.user.id });
    }
  }

  res.json({ ok: true });
}));

app.post('/api/rooms', authMiddleware, requireUser, asyncHandler(async (req, res) => {
  try {
    const type = ['public', 'private', 'dm'].includes(req.body.type) ? req.body.type : 'public';
    const memberIds = Array.isArray(req.body.member_ids) ? [...new Set(req.body.member_ids.filter(Boolean))] : [];

    if (type === 'dm') {
      if (memberIds.length !== 1) {
        return res.status(400).json({ detail: 'Direct chats require exactly one other user' });
      }
      if (await areUsersBlocked(req.user.id, memberIds[0])) {
        return res.status(403).json({ detail: 'You cannot start a direct chat with this user' });
      }
      const existingDm = await findExistingDmRoom(req.user.id, memberIds[0]);
      if (existingDm) {
        return res.json(await buildRoomResponse(existingDm, true));
      }
    }

    const name = String(req.body.name || '').trim();
    if (!name) {
      return res.status(400).json({ detail: 'Chat name is required' });
    }

    const roomId = uuidv4();
    const inviteCode = generateInviteCode();
    const encryptionKey = generateEncryptedRoomKey();
    const room = await queryOne(
      `INSERT INTO ${TABLES.rooms} (id, name, type, created_by, is_private, invite_code, encryption_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [roomId, name, type, req.user.id, type !== 'public', inviteCode, encryptionKey]
    );

    await query(
      `INSERT INTO ${TABLES.roomMembers} (room_id, user_id, role)
       VALUES ($1, $2, 'admin')
       ON CONFLICT (room_id, user_id) DO NOTHING`,
      [room.id, req.user.id]
    );

    for (const memberId of memberIds) {
      await query(
        `INSERT INTO ${TABLES.roomMembers} (room_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (room_id, user_id) DO NOTHING`,
        [room.id, memberId]
      );
    }

    const roomResponse = await buildRoomResponse(room, true);

    // Notify added members via WebSocket so their sidebar updates
    for (const memberId of memberIds) {
      const memberSockets = activeSockets.get(memberId);
      if (memberSockets) {
        for (const ws of memberSockets) {
          sendJson(ws, { type: 'room_added', room: roomResponse });
        }
      }
    }

    res.json(roomResponse);
  } catch (error) {
    console.error(error);
    res.status(500).json({ detail: 'Chat creation failed' });
  }
}));

app.get('/api/rooms', authMiddleware, requireUser, asyncHandler(async (req, res) => {
  res.json(await listAccessibleRooms(req.user.id, false));
}));

app.get('/api/rooms/my', authMiddleware, requireUser, asyncHandler(async (req, res) => {
  res.json(await listAccessibleRooms(req.user.id, true));
}));

// Explore public chats: search + sort by member count descending
app.get('/api/rooms/explore', authMiddleware, requireUser, asyncHandler(async (req, res) => {
  const search = String(req.query.search || '').trim();
  const params = [];
  let whereClause = `WHERE r.type = 'public' AND r.is_active = TRUE`;

  if (search) {
    params.push(`%${search}%`);
    whereClause += ` AND r.name ILIKE $${params.length}`;
  }

  const rows = await query(
    `SELECT r.*, COUNT(rm2.user_id)::int AS total_members
     FROM ${TABLES.rooms} r
     LEFT JOIN ${TABLES.roomMembers} rm2 ON rm2.room_id = r.id
     ${whereClause}
     GROUP BY r.id
     ORDER BY total_members DESC, r.created_at DESC`,
    params
  );

  // Add membership flag for current user
  const memberRows = await query(
    `SELECT room_id FROM ${TABLES.roomMembers} WHERE user_id = $1`,
    [req.user.id]
  );
  const myRoomIds = new Set(memberRows.map((r) => r.room_id));

  const rooms = [];
  for (const row of rows) {
    const room = await buildRoomResponse(row);
    room.is_member = myRoomIds.has(row.id);
    rooms.push(room);
  }
  res.json(rooms);
}));

// Get room info by invite code
app.get('/api/rooms/invite/:code', authMiddleware, requireUser, asyncHandler(async (req, res) => {
  const room = await queryOne(
    `SELECT * FROM ${TABLES.rooms} WHERE invite_code = $1 AND is_active = TRUE`,
    [req.params.code]
  );
  if (!room) {
    return res.status(404).json({ detail: 'Invalid or expired invite link' });
  }
  const isMember = await queryOne(
    `SELECT 1 FROM ${TABLES.roomMembers} WHERE room_id = $1 AND user_id = $2`,
    [room.id, req.user.id]
  );
  const roomResponse = await buildRoomResponse(room);
  roomResponse.is_member = !!isMember;
  res.json(roomResponse);
}));

// Join room by invite code
app.post('/api/rooms/invite/:code/join', authMiddleware, requireUser, asyncHandler(async (req, res) => {
  const room = await queryOne(
    `SELECT * FROM ${TABLES.rooms} WHERE invite_code = $1 AND is_active = TRUE`,
    [req.params.code]
  );
  if (!room) {
    return res.status(404).json({ detail: 'Invalid or expired invite link' });
  }

  // Private chats: only friends of existing members can join via invite
  if (room.type === 'private') {
    const hasFriendInRoom = await queryOne(
      `SELECT 1 FROM ${TABLES.friendships} f
       JOIN ${TABLES.roomMembers} rm ON rm.user_id = f.friend_id AND rm.room_id = $1
       WHERE f.user_id = $2
       LIMIT 1`,
      [room.id, req.user.id]
    );
    if (!hasFriendInRoom) {
      return res.status(403).json({ detail: 'You must be friends with a participant to join this private chat' });
    }
  }

  await query(
    `INSERT INTO ${TABLES.roomMembers} (room_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (room_id, user_id) DO NOTHING`,
    [room.id, req.user.id]
  );
  res.json(await buildRoomResponse(room));
}));

app.get('/api/rooms/:id', authMiddleware, requireUser, asyncHandler(async (req, res) => {
  const room = await canAccessRoom(req.user.id, req.params.id);
  if (!room) {
    return res.status(404).json({ detail: 'Chat not found' });
  }
  res.json(await buildRoomResponse(room, true));
}));

app.post('/api/rooms/:id/join', authMiddleware, requireUser, asyncHandler(async (req, res) => {
  const room = await queryOne(`SELECT * FROM ${TABLES.rooms} WHERE id = $1 AND is_active = TRUE`, [req.params.id]);
  if (!room) {
    return res.status(404).json({ detail: 'Chat not found' });
  }
  if (room.type !== 'public') {
    return res.status(403).json({ detail: 'Only public chats can be joined directly' });
  }
  await query(
    `INSERT INTO ${TABLES.roomMembers} (room_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (room_id, user_id) DO NOTHING`,
    [room.id, req.user.id]
  );
  res.json(await buildRoomResponse(room));
}));

app.post('/api/rooms/:id/leave', authMiddleware, requireUser, asyncHandler(async (req, res) => {
  const room = await queryOne(`SELECT id, type FROM ${TABLES.rooms} WHERE id = $1`, [req.params.id]);
  if (room?.type === 'dm') {
    const members = await query(
      `SELECT user_id FROM ${TABLES.roomMembers} WHERE room_id = $1`,
      [req.params.id]
    );

    await query(`DELETE FROM ${TABLES.rooms} WHERE id = $1`, [req.params.id]);

    for (const member of members) {
      const memberSockets = activeSockets.get(member.user_id);
      if (memberSockets) {
        for (const ws of memberSockets) {
          sendJson(ws, { type: 'room_deleted', room_id: req.params.id });
        }
      }
    }

    return res.json({ ok: true });
  }

  await query(`DELETE FROM ${TABLES.roomMembers} WHERE room_id = $1 AND user_id = $2`, [req.params.id, req.user.id]);
  const remaining = await queryOne(`SELECT COUNT(*)::int AS count FROM ${TABLES.roomMembers} WHERE room_id = $1`, [req.params.id]);
  if (!remaining || remaining.count === 0) {
    await query(`UPDATE ${TABLES.rooms} SET is_active = FALSE WHERE id = $1`, [req.params.id]);
  }
  res.json({ ok: true });
}));

app.post('/api/rooms/:id/invite', authMiddleware, requireUser, asyncHandler(async (req, res) => {
  const room = await canAccessRoom(req.user.id, req.params.id);
  if (!room) {
    return res.status(404).json({ detail: 'Room not found' });
  }
  const userIds = Array.isArray(req.body.user_ids) ? req.body.user_ids : [];
  for (const userId of userIds) {
    await query(
      `INSERT INTO ${TABLES.roomMembers} (room_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (room_id, user_id) DO NOTHING`,
      [req.params.id, userId]
    );
  }

  // Notify invited users via WS
  const roomResponse = await buildRoomResponse(room);
  for (const userId of userIds) {
    const memberSockets = activeSockets.get(userId);
    if (memberSockets) {
      for (const ws of memberSockets) {
        sendJson(ws, { type: 'room_added', room: roomResponse });
      }
    }
  }

  res.json({ ok: true });
}));

// Update message retention setting for a room
app.put('/api/rooms/:id/retention', authMiddleware, requireUser, asyncHandler(async (req, res) => {
  const room = await canAccessRoom(req.user.id, req.params.id);
  if (!room) {
    return res.status(404).json({ detail: 'Room not found' });
  }
  // Only room members can change retention
  const membership = await queryOne(
    `SELECT 1 FROM ${TABLES.roomMembers} WHERE room_id = $1 AND user_id = $2`,
    [room.id, req.user.id]
  );
  if (!membership) {
    return res.status(403).json({ detail: 'Only room members can change settings' });
  }

  const hours = req.body.message_retention_hours;
  // Allow null (default 7 days) or a positive integer (e.g. 24)
  const retentionValue = hours === null ? null : Math.max(1, Math.floor(Number(hours)));

  await query(
    `UPDATE ${TABLES.rooms} SET message_retention_hours = $1 WHERE id = $2`,
    [retentionValue, room.id]
  );
  res.json({ ok: true, message_retention_hours: retentionValue });
}));

app.delete('/api/rooms/:id', authMiddleware, requireUser, asyncHandler(async (req, res) => {
  const room = await queryOne(`SELECT * FROM ${TABLES.rooms} WHERE id = $1`, [req.params.id]);
  if (!room) {
    return res.status(404).json({ detail: 'Room not found' });
  }
  if (room.type === 'dm') {
    const membership = await queryOne(
      `SELECT 1 FROM ${TABLES.roomMembers} WHERE room_id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!membership && !req.user.is_admin) {
      return res.status(403).json({ detail: 'Only chat participants or admins can delete this direct chat' });
    }
  } else if (room.created_by !== req.user.id && !req.user.is_admin) {
    return res.status(403).json({ detail: 'Only room creator or admin can delete' });
  }

  // Get all members before deactivating so we can notify them
  const members = await query(
    `SELECT user_id FROM ${TABLES.roomMembers} WHERE room_id = $1`,
    [req.params.id]
  );

  voiceSessions.delete(req.params.id);
  await query(`DELETE FROM ${TABLES.rooms} WHERE id = $1`, [req.params.id]);

  // Notify all room members via WS so their sidebar updates instantly
  for (const member of members) {
    const memberSockets = activeSockets.get(member.user_id);
    if (memberSockets) {
      for (const ws of memberSockets) {
        sendJson(ws, { type: 'room_deleted', room_id: req.params.id });
      }
    }
  }

  res.json({ ok: true });
}));

app.get('/api/messages/:roomId', authMiddleware, requireUser, asyncHandler(async (req, res) => {
  const room = await canAccessRoom(req.user.id, req.params.roomId);
  if (!room) {
    return res.status(404).json({ detail: 'Room not found' });
  }

  // Mark room as read for this user
  await query(
    `UPDATE ${TABLES.roomMembers} SET last_read_at = NOW() WHERE room_id = $1 AND user_id = $2`,
    [req.params.roomId, req.user.id]
  );

  const limit = Number(req.query.limit || 50);
  const rows = await query(
    `SELECT m.*, u.username AS sender_username, u.avatar_url AS sender_avatar,
            rm.content AS reply_content, rm.sender_id AS reply_sender_id,
            ru.username AS reply_sender_username
     FROM ${TABLES.messages} m
     JOIN ${TABLES.users} u ON u.id = m.sender_id
     LEFT JOIN ${TABLES.messages} rm ON rm.id = m.reply_to_id
     LEFT JOIN ${TABLES.users} ru ON ru.id = rm.sender_id
     WHERE m.room_id = $1
     ORDER BY m.created_at DESC
     LIMIT $2`,
    [req.params.roomId, limit]
  );

  // Fetch reactions for all these messages
  const messageIds = rows.map((r) => r.id);
  let reactionsByMsg = {};
  if (messageIds.length > 0) {
    const reactionRows = await query(
      `SELECT r.message_id, r.emoji, r.user_id, u.username
       FROM ${TABLES.reactions} r
       JOIN ${TABLES.users} u ON u.id = r.user_id
       WHERE r.message_id = ANY($1::text[])
       ORDER BY r.created_at ASC`,
      [messageIds]
    );
    reactionsByMsg = {};
    for (const r of reactionRows) {
      if (!reactionsByMsg[r.message_id]) reactionsByMsg[r.message_id] = [];
      reactionsByMsg[r.message_id].push({ emoji: r.emoji, user_id: r.user_id, username: r.username });
    }
  }

  const roomId = req.params.roomId;
  const decryptedRows = await Promise.all(rows.reverse().map(async (row) => ({
    id: row.id,
    room_id: row.room_id,
    sender_id: row.sender_id,
    sender_username: row.sender_username,
    sender_avatar: row.sender_avatar,
    content: await decryptMessageContent(roomId, row.content),
    reply_to_id: row.reply_to_id || null,
    reply_content: row.reply_content ? await decryptMessageContent(roomId, row.reply_content) : null,
    reply_sender_username: row.reply_sender_username || null,
    reactions: reactionsByMsg[row.id] || [],
    status: row.status,
    created_at: row.created_at,
  })));
  res.json(decryptedRows);
}));

app.get('/api/messages/:roomId/search', authMiddleware, requireUser, asyncHandler(async (req, res) => {
  const room = await canAccessRoom(req.user.id, req.params.roomId);
  if (!room) {
    return res.status(404).json({ detail: 'Room not found' });
  }

  const term = String(req.query.q || '').trim();
  if (term.length < 2) {
    return res.json([]);
  }

  const limit = Math.min(Number(req.query.limit || 50), 100);
  // Fetch recent messages and filter after decryption (ILIKE can't search ciphertext)
  const rows = await query(
    `SELECT m.*, u.username AS sender_username, u.avatar_url AS sender_avatar,
            rm.content AS reply_content, rm.sender_id AS reply_sender_id,
            ru.username AS reply_sender_username
     FROM ${TABLES.messages} m
     JOIN ${TABLES.users} u ON u.id = m.sender_id
     LEFT JOIN ${TABLES.messages} rm ON rm.id = m.reply_to_id
     LEFT JOIN ${TABLES.users} ru ON ru.id = rm.sender_id
     WHERE m.room_id = $1
     ORDER BY m.created_at DESC
     LIMIT 500`,
    [req.params.roomId]
  );

  // Decrypt and filter by search term
  const termLower = term.toLowerCase();
  const searchRoomId = req.params.roomId;
  const matched = [];
  for (const row of rows) {
    const plaintext = await decryptMessageContent(searchRoomId, row.content);
    if (plaintext.toLowerCase().includes(termLower)) {
      row._decryptedContent = plaintext;
      matched.push(row);
      if (matched.length >= limit) break;
    }
  }

  const messageIds = matched.map((row) => row.id);
  let reactionsByMsg = {};
  if (messageIds.length > 0) {
    const reactionRows = await query(
      `SELECT r.message_id, r.emoji, r.user_id, u.username
       FROM ${TABLES.reactions} r
       JOIN ${TABLES.users} u ON u.id = r.user_id
       WHERE r.message_id = ANY($1::text[])
       ORDER BY r.created_at ASC`,
      [messageIds]
    );

    reactionsByMsg = {};
    for (const reaction of reactionRows) {
      if (!reactionsByMsg[reaction.message_id]) reactionsByMsg[reaction.message_id] = [];
      reactionsByMsg[reaction.message_id].push({
        emoji: reaction.emoji,
        user_id: reaction.user_id,
        username: reaction.username,
      });
    }
  }

  const decryptedSearchResults = await Promise.all(matched.reverse().map(async (row) => ({
    id: row.id,
    room_id: row.room_id,
    sender_id: row.sender_id,
    sender_username: row.sender_username,
    sender_avatar: row.sender_avatar,
    content: row._decryptedContent,
    reply_to_id: row.reply_to_id || null,
    reply_content: row.reply_content ? await decryptMessageContent(searchRoomId, row.reply_content) : null,
    reply_sender_username: row.reply_sender_username || null,
    reactions: reactionsByMsg[row.id] || [],
    status: row.status,
    created_at: row.created_at,
  })));
  res.json(decryptedSearchResults);
}));

app.delete('/api/messages/:id', authMiddleware, requireUser, asyncHandler(async (req, res) => {
  const message = await queryOne(`SELECT * FROM ${TABLES.messages} WHERE id = $1`, [req.params.id]);
  if (!message) {
    return res.status(404).json({ detail: 'Message not found' });
  }
  const ageHours = (Date.now() - new Date(message.created_at).getTime()) / (1000 * 60 * 60);
  if (message.sender_id !== req.user.id && !req.user.is_admin) {
    return res.status(403).json({ detail: 'Only the sender can delete this message' });
  }
  if (!req.user.is_admin && ageHours > MESSAGE_DELETE_WINDOW_HOURS) {
    return res.status(403).json({ detail: `Messages can only be deleted within ${MESSAGE_DELETE_WINDOW_HOURS} hours` });
  }
  await query(`DELETE FROM ${TABLES.messages} WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
}));

// Toggle a reaction on a message (add if not present, remove if exists)
app.post('/api/messages/:id/react', authMiddleware, requireUser, asyncHandler(async (req, res) => {
  const message = await queryOne(`SELECT * FROM ${TABLES.messages} WHERE id = $1`, [req.params.id]);
  if (!message) {
    return res.status(404).json({ detail: 'Message not found' });
  }
  const emoji = String(req.body.emoji || '').trim();
  if (!emoji) {
    return res.status(400).json({ detail: 'Emoji is required' });
  }

  // Check if user already reacted with this emoji
  const existing = await queryOne(
    `SELECT id FROM ${TABLES.reactions} WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
    [req.params.id, req.user.id, emoji]
  );

  let action;
  if (existing) {
    await query(`DELETE FROM ${TABLES.reactions} WHERE id = $1`, [existing.id]);
    action = 'removed';
  } else {
    await query(
      `INSERT INTO ${TABLES.reactions} (id, message_id, user_id, emoji)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (message_id, user_id, emoji) DO NOTHING`,
      [uuidv4(), req.params.id, req.user.id, emoji]
    );
    action = 'added';
  }

  // Deliver reactions to every room member so inactive viewers can mark the chat unread.
  await sendToRoomMembers(message.room_id, {
    type: 'reaction',
    message_id: req.params.id,
    room_id: message.room_id,
    user_id: req.user.id,
    username: req.user.username,
    emoji,
    action,
  });

  res.json({ ok: true, action });
}));

app.get('/api/admin/stats', authMiddleware, requireUser, adminMiddleware, asyncHandler(async (_req, res) => {
  const [users, rooms, messages, online] = await Promise.all([
    queryOne(`SELECT COUNT(*)::int AS count FROM ${TABLES.users}`),
    queryOne(`SELECT COUNT(*)::int AS count FROM ${TABLES.rooms} WHERE is_active = TRUE`),
    queryOne(`SELECT COUNT(*)::int AS count FROM ${TABLES.messages}`),
    queryOne(`SELECT COUNT(*)::int AS count FROM ${TABLES.users} WHERE status = 'online'`),
  ]);
  res.json({
    total_users: users?.count || 0,
    active_rooms: rooms?.count || 0,
    total_messages: messages?.count || 0,
    online_users: online?.count || 0,
  });
}));

app.get('/api/admin/users', authMiddleware, requireUser, adminMiddleware, asyncHandler(async (_req, res) => {
  const rows = await query(`SELECT * FROM ${TABLES.users} ORDER BY created_at DESC`);
  res.json(rows.map(serializeUser));
}));

app.post('/api/admin/users/:id/ban', authMiddleware, requireUser, adminMiddleware, asyncHandler(async (req, res) => {
  await query(`UPDATE ${TABLES.users} SET is_banned = TRUE WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
}));

app.post('/api/admin/users/:id/unban', authMiddleware, requireUser, adminMiddleware, asyncHandler(async (req, res) => {
  await query(`UPDATE ${TABLES.users} SET is_banned = FALSE WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
}));

app.get('/api/admin/rooms', authMiddleware, requireUser, adminMiddleware, asyncHandler(async (_req, res) => {
  const rows = await query(`SELECT * FROM ${TABLES.rooms} WHERE is_active = TRUE ORDER BY created_at DESC`);
  const rooms = [];
  for (const row of rows) {
    rooms.push(await buildRoomResponse(row));
  }
  res.json(rooms);
}));

app.delete('/api/admin/rooms/:id', authMiddleware, requireUser, adminMiddleware, asyncHandler(async (req, res) => {
  const members = await query(
    `SELECT user_id FROM ${TABLES.roomMembers} WHERE room_id = $1`,
    [req.params.id]
  );

  voiceSessions.delete(req.params.id);
  await query(`DELETE FROM ${TABLES.rooms} WHERE id = $1`, [req.params.id]);

  for (const member of members) {
    const memberSockets = activeSockets.get(member.user_id);
    if (memberSockets) {
      for (const ws of memberSockets) {
        sendJson(ws, { type: 'room_deleted', room_id: req.params.id });
      }
    }
  }

  res.json({ ok: true });
}));

app.delete('/api/admin/messages/:id', authMiddleware, requireUser, adminMiddleware, asyncHandler(async (req, res) => {
  await query(`DELETE FROM ${TABLES.messages} WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
}));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, status: 'alive', database: dbStatus });
});

app.use((error, _req, res, _next) => {
  if (isDatabaseConnectionError(error)) {
    dbStatus = 'degraded';
    scheduleDatabaseRetry();
  }

  if (error?.code === 'DB_UNAVAILABLE' || isDatabaseConnectionError(error)) {
    return res.status(503).json({ detail: 'Database unavailable' });
  }

  console.error(error);
  res.status(500).json({ detail: 'Internal server error' });
});

function sendJson(ws, payload) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastToRoom(roomId, payload) {
  const roomSockets = roomPresence.get(roomId);
  if (!roomSockets) return;
  for (const ws of roomSockets.sockets) {
    sendJson(ws, payload);
  }
}

async function getRoomMemberIds(roomId) {
  const rows = await query(
    `SELECT user_id FROM ${TABLES.roomMembers} WHERE room_id = $1`,
    [roomId]
  );
  return rows.map((row) => row.user_id);
}

async function sendToRoomMembers(roomId, payload) {
  const memberIds = await getRoomMemberIds(roomId);
  for (const memberId of memberIds) {
    const sockets = activeSockets.get(memberId);
    if (!sockets) continue;
    for (const memberSocket of sockets) {
      sendJson(memberSocket, payload);
    }
  }
}

function serializeVoiceParticipants(roomId) {
  const session = voiceSessions.get(roomId);
  if (!session) {
    return [];
  }

  return [...session.entries()].map(([userId, state]) => ({
    user_id: userId,
    muted: Boolean(state?.muted),
  }));
}

async function broadcastVoiceState(roomId) {
  await sendToRoomMembers(roomId, {
    type: 'voice_state',
    room_id: roomId,
    participants: serializeVoiceParticipants(roomId),
  });
}

async function joinRoomSocket(ws, roomId, username) {
  const room = await canAccessRoom(ws.user.id, roomId);
  if (!room) return;

  if (!roomPresence.has(roomId)) {
    roomPresence.set(roomId, { users: new Set(), sockets: new Set() });
  }
  const state = roomPresence.get(roomId);
  state.users.add(ws.user.id);
  state.sockets.add(ws);

  if (!socketRooms.has(ws)) {
    socketRooms.set(ws, new Set());
  }
  socketRooms.get(ws).add(roomId);

  broadcastToRoom(roomId, {
    type: 'user_joined',
    user_id: ws.user.id,
    username,
    room_id: roomId,
    active_users: [...state.users],
  });

  if (voiceSessions.has(roomId)) {
    sendJson(ws, {
      type: 'voice_state',
      room_id: roomId,
      participants: serializeVoiceParticipants(roomId),
    });
  }
}

async function leaveVoiceSocket(ws, roomId) {
  const session = voiceSessions.get(roomId);
  if (!session || !session.has(ws.user.id)) return;

  session.delete(ws.user.id);
  if (session.size === 0) {
    voiceSessions.delete(roomId);
  }

  await broadcastVoiceState(roomId);
}

async function leaveRoomSocket(ws, roomId) {
  await leaveVoiceSocket(ws, roomId);

  const state = roomPresence.get(roomId);
  if (!state) return;

  state.sockets.delete(ws);
  let userStillInRoom = false;
  for (const socket of state.sockets) {
    if (socket.user?.id === ws.user.id) {
      userStillInRoom = true;
      break;
    }
  }
  if (!userStillInRoom) {
    state.users.delete(ws.user.id);
  }

  const activeUsers = [...state.users];
  for (const socket of state.sockets) {
    sendJson(socket, {
      type: 'user_left',
      user_id: ws.user.id,
      room_id: roomId,
      active_users: activeUsers,
    });
  }

  if (state.sockets.size === 0) {
    roomPresence.delete(roomId);
  }
}

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws) => {
  const sockets = activeSockets.get(ws.user.id) || new Set();
  sockets.add(ws);
  activeSockets.set(ws.user.id, sockets);
  updatePresence(ws.user.id, 'online').then(() => broadcastPresenceToFriends(ws.user.id, 'online')).catch(console.error);

  ws.on('message', async (raw) => {
    try {
      const data = JSON.parse(String(raw));

      if (data.type === 'join_room') {
        await joinRoomSocket(ws, data.room_id, data.username || ws.user.username);
        return;
      }

      if (data.type === 'leave_room') {
        await leaveRoomSocket(ws, data.room_id);
        return;
      }

      if (data.type === 'voice_join') {
        const room = await canAccessRoom(ws.user.id, data.room_id);
        if (!room || room.type !== 'dm') {
          sendJson(ws, { type: 'error', message: 'Voice calls are only available in direct chats' });
          return;
        }

        if (!voiceSessions.has(data.room_id)) {
          voiceSessions.set(data.room_id, new Map());
        }

        const session = voiceSessions.get(data.room_id);
        session.set(ws.user.id, { muted: false });
        await broadcastVoiceState(data.room_id);
        return;
      }

      if (data.type === 'voice_leave') {
        await leaveVoiceSocket(ws, data.room_id);
        return;
      }

      if (data.type === 'voice_mute') {
        const room = await canAccessRoom(ws.user.id, data.room_id);
        if (!room || room.type !== 'dm') {
          return;
        }

        if (!voiceSessions.has(data.room_id)) {
          voiceSessions.set(data.room_id, new Map());
        }

        const session = voiceSessions.get(data.room_id);
        if (session.has(ws.user.id)) {
          session.set(ws.user.id, { muted: Boolean(data.muted) });
          await broadcastVoiceState(data.room_id);
        }
        return;
      }

      if (['voice_offer', 'voice_answer', 'voice_ice_candidate'].includes(data.type)) {
        const room = await canAccessRoom(ws.user.id, data.room_id);
        if (!room || room.type !== 'dm' || !data.target_user_id) {
          return;
        }

        const membership = await queryOne(
          `SELECT 1 FROM ${TABLES.roomMembers} WHERE room_id = $1 AND user_id = $2`,
          [data.room_id, data.target_user_id]
        );
        if (!membership) {
          return;
        }

        const targetSockets = activeSockets.get(data.target_user_id);
        if (!targetSockets) {
          return;
        }

        const payload = {
          type: data.type,
          room_id: data.room_id,
          from_user_id: ws.user.id,
          ...(data.sdp ? { sdp: data.sdp } : {}),
          ...(data.candidate ? { candidate: data.candidate } : {}),
        };

        for (const targetSocket of targetSockets) {
          sendJson(targetSocket, payload);
        }
        return;
      }

      if (data.type === 'typing') {
        broadcastToRoom(data.room_id, {
          type: 'typing',
          user_id: ws.user.id,
          username: data.username || ws.user.username,
          room_id: data.room_id,
        });
        return;
      }

      if (data.type === 'stop_typing') {
        broadcastToRoom(data.room_id, {
          type: 'stop_typing',
          user_id: ws.user.id,
          room_id: data.room_id,
        });
        return;
      }

      if (data.type === 'mark_seen') {
        await query(
          `UPDATE ${TABLES.messages}
           SET status = 'seen'
           WHERE id = ANY($1::text[]) AND room_id = $2`,
          [data.message_ids, data.room_id]
        );
        broadcastToRoom(data.room_id, {
          type: 'messages_seen',
          user_id: ws.user.id,
          room_id: data.room_id,
          message_ids: data.message_ids,
        });
        return;
      }

      if (data.type === 'message') {
        const room = await canAccessRoom(ws.user.id, data.room_id);
        if (!room || !String(data.content || '').trim()) {
          return;
        }
        const freshUser = await getUserById(ws.user.id);
        const replyToId = data.reply_to_id || null;

        // If replying, fetch the reply info
        let replyContent = null;
        let replySenderUsername = null;
        if (replyToId) {
          const replyMsg = await queryOne(
            `SELECT m.content, u.username FROM ${TABLES.messages} m JOIN ${TABLES.users} u ON u.id = m.sender_id WHERE m.id = $1`,
            [replyToId]
          );
          if (replyMsg) {
            replyContent = await decryptMessageContent(data.room_id, replyMsg.content);
            replySenderUsername = replyMsg.username;
          }
        }

        const encryptedContent = await encryptMessageContent(data.room_id, String(data.content).trim());
        const message = await queryOne(
          `INSERT INTO ${TABLES.messages} (id, room_id, sender_id, content, reply_to_id, status)
           VALUES ($1, $2, $3, $4, $5, 'delivered')
           RETURNING *`,
          [uuidv4(), data.room_id, ws.user.id, encryptedContent, replyToId]
        );
        // Keep sender's last_read_at current so own messages don't trigger unread
        await query(
          `UPDATE ${TABLES.roomMembers} SET last_read_at = NOW() WHERE room_id = $1 AND user_id = $2`,
          [data.room_id, ws.user.id]
        );
        await sendToRoomMembers(data.room_id, {
          type: 'message',
          id: message.id,
          room_id: message.room_id,
          sender_id: message.sender_id,
          sender_username: freshUser.username,
          sender_avatar: freshUser.avatar_url,
          content: String(data.content).trim(), // Send plaintext over WSS (TLS-encrypted)
          reply_to_id: replyToId,
          reply_content: replyContent,
          reply_sender_username: replySenderUsername,
          reactions: [],
          status: message.status,
          created_at: message.created_at,
        });
      }
    } catch (error) {
      console.error(error);
    }
  });

  ws.on('close', async () => {
    const rooms = socketRooms.get(ws) || new Set();
    for (const roomId of rooms) {
      await leaveRoomSocket(ws, roomId);
    }
    socketRooms.delete(ws);

    const sockets = activeSockets.get(ws.user.id);
    if (sockets) {
      sockets.delete(ws);
      if (sockets.size === 0) {
        activeSockets.delete(ws.user.id);
        await updatePresence(ws.user.id, 'offline');
        broadcastPresenceToFriends(ws.user.id, 'offline').catch(console.error);
      }
    }
  });
});

server.on('upgrade', async (request, socket, head) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const token = url.pathname.split('/').filter(Boolean)[1];
    if (!token) {
      socket.destroy();
      return;
    }
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await getUserById(payload.id);
    if (!user || user.is_banned) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.user = { id: user.id, username: user.username };
      wss.emit('connection', ws, request);
    });
  } catch {
    socket.destroy();
  }
});

async function initDb() {
  await query(
    `CREATE TABLE IF NOT EXISTS ${TABLES.users} (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      avatar_url TEXT NOT NULL,
      avatar_type TEXT NOT NULL DEFAULT 'dicebear',
      avatar_style TEXT NOT NULL DEFAULT 'lorelei-neutral',
      avatar_seed TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'offline',
      last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      is_admin BOOLEAN NOT NULL DEFAULT FALSE,
      is_banned BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  );

  await query(
    `CREATE TABLE IF NOT EXISTS ${TABLES.userSettings} (
      user_id TEXT PRIMARY KEY REFERENCES ${TABLES.users}(id) ON DELETE CASCADE,
      theme TEXT NOT NULL DEFAULT 'dark',
      notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE
    )`
  );

  await query(
    `CREATE TABLE IF NOT EXISTS ${TABLES.friendRequests} (
      id TEXT PRIMARY KEY,
      from_user_id TEXT NOT NULL REFERENCES ${TABLES.users}(id) ON DELETE CASCADE,
      to_user_id TEXT NOT NULL REFERENCES ${TABLES.users}(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(from_user_id, to_user_id)
    )`
  );

  await query(
    `CREATE TABLE IF NOT EXISTS ${TABLES.friendships} (
      user_id TEXT NOT NULL REFERENCES ${TABLES.users}(id) ON DELETE CASCADE,
      friend_id TEXT NOT NULL REFERENCES ${TABLES.users}(id) ON DELETE CASCADE,
      is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(user_id, friend_id)
    )`
  );

  await query(
    `CREATE TABLE IF NOT EXISTS ${TABLES.blocks} (
      user_id TEXT NOT NULL REFERENCES ${TABLES.users}(id) ON DELETE CASCADE,
      blocked_user_id TEXT NOT NULL REFERENCES ${TABLES.users}(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(user_id, blocked_user_id)
    )`
  );

  await query(
    `CREATE TABLE IF NOT EXISTS ${TABLES.rooms} (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES ${TABLES.users}(id) ON DELETE CASCADE,
      is_private BOOLEAN NOT NULL DEFAULT FALSE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      invite_code TEXT UNIQUE,
      message_retention_hours INT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  );

  // Migrate legacy group chats into private chats.
  await query(
    `UPDATE ${TABLES.rooms}
     SET type = 'private', is_private = TRUE
     WHERE type = 'group'`
  );

  // Add invite_code column if it doesn't exist (migration for existing tables)
  await query(
    `ALTER TABLE ${TABLES.rooms} ADD COLUMN IF NOT EXISTS invite_code TEXT UNIQUE`
  );

  // Add message_retention_hours column if it doesn't exist
  await query(
    `ALTER TABLE ${TABLES.rooms} ADD COLUMN IF NOT EXISTS message_retention_hours INT`
  );

  // Add encryption_key column if it doesn't exist
  await query(
    `ALTER TABLE ${TABLES.rooms} ADD COLUMN IF NOT EXISTS encryption_key TEXT`
  );

  // Backfill encryption keys for existing rooms that don't have one
  const roomsWithoutKey = await query(
    `SELECT id FROM ${TABLES.rooms} WHERE encryption_key IS NULL`
  );
  for (const r of roomsWithoutKey) {
    const encKey = generateEncryptedRoomKey();
    await query(`UPDATE ${TABLES.rooms} SET encryption_key = $1 WHERE id = $2`, [encKey, r.id]);
  }

  await query(
    `CREATE TABLE IF NOT EXISTS ${TABLES.roomMembers} (
      room_id TEXT NOT NULL REFERENCES ${TABLES.rooms}(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES ${TABLES.users}(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(room_id, user_id)
    )`
  );

  // Add last_read_at column if table already exists
  await query(
    `ALTER TABLE ${TABLES.roomMembers} ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
  );

  await query(
    `CREATE TABLE IF NOT EXISTS ${TABLES.messages} (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES ${TABLES.rooms}(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL REFERENCES ${TABLES.users}(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      reply_to_id TEXT,
      status TEXT NOT NULL DEFAULT 'sent',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  );

  // Add reply_to_id column if it doesn't exist
  await query(
    `ALTER TABLE ${TABLES.messages} ADD COLUMN IF NOT EXISTS reply_to_id TEXT`
  );

  await query(
    `CREATE TABLE IF NOT EXISTS ${TABLES.reactions} (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES ${TABLES.messages}(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES ${TABLES.users}(id) ON DELETE CASCADE,
      emoji TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(message_id, user_id, emoji)
    )`
  );
}

async function connectDatabase() {
  try {
    dbStatus = 'starting';
    await sql.unsafe('SELECT 1');
    dbStatus = 'ready';
    await initDb();
    dbStatus = 'ready';
    console.log('Database connection established');
    if (dbRetryTimer) {
      clearTimeout(dbRetryTimer);
      dbRetryTimer = null;
    }
    return true;
  } catch (error) {
    dbStatus = 'degraded';
    console.error('Database connection failed:', error.message || error);
    return false;
  }
}

function scheduleDatabaseRetry() {
  if (dbRetryTimer) {
    return;
  }

  dbRetryTimer = setTimeout(async () => {
    dbRetryTimer = null;
    const connected = await connectDatabase();
    if (!connected) {
      scheduleDatabaseRetry();
    }
  }, DB_RETRY_INTERVAL_MS);
}

cron.schedule('0 * * * *', async () => {
  try {
    // Default cleanup: delete messages older than MESSAGE_DELETE_AFTER_DAYS
    // for rooms without a custom retention setting
    await query(
      `DELETE FROM ${TABLES.messages}
       WHERE created_at < NOW() - INTERVAL '1 day' * $1
       AND room_id IN (
         SELECT id FROM ${TABLES.rooms} WHERE message_retention_hours IS NULL
       )`,
      [MESSAGE_DELETE_AFTER_DAYS]
    );

    // Custom retention: delete messages from rooms with a custom retention setting
    await query(
      `DELETE FROM ${TABLES.messages}
       WHERE room_id IN (
         SELECT id FROM ${TABLES.rooms} WHERE message_retention_hours IS NOT NULL
       )
       AND created_at < NOW() - (
         SELECT INTERVAL '1 hour' * r.message_retention_hours
         FROM ${TABLES.rooms} r
         WHERE r.id = ${TABLES.messages}.room_id
       )`
    );
  } catch (error) {
    console.error('Cleanup failed:', error);
  }
});

server.listen(PORT, async () => {
  console.log(`ChatSphere Node API running on http://localhost:${PORT}`);
  initEncryptionKeys();
  const connected = await connectDatabase();
  if (!connected) {
    console.log(`Retrying database connection every ${DB_RETRY_INTERVAL_MS}ms`);
    scheduleDatabaseRetry();
  }
});