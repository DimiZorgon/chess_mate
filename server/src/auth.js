import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import express from 'express';
import { findUserByUsername, findUserById, createUser, initDb } from './db.js';

const router = express.Router();
const sessions = new Map();

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    avatar: user.avatar
  };
}

function createSession(userId) {
  const token = randomUUID();
  sessions.set(token, { userId, createdAt: Date.now() });
  return token;
}

export async function verifyAuthToken(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  return findUserById(session.userId);
}

router.post('/register', async (req, res) => {
  const { username, password, avatar } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Pseudo et mot de passe requis.' });
  }

  const normalizedUsername = username.trim().toLowerCase();
  const existing = await findUserByUsername(normalizedUsername);
  if (existing) {
    return res.status(409).json({ error: 'Pseudo déjà utilisé.' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const user = await createUser(randomUUID(), normalizedUsername, passwordHash, avatar || '♟️');
  const token = createSession(user.id);

  return res.json({ user: sanitizeUser(user), token });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Pseudo et mot de passe requis.' });
  }

  const normalizedUsername = username.trim().toLowerCase();
  const user = await findUserByUsername(normalizedUsername);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Identifiants incorrects.' });
  }

  const token = createSession(user.id);
  return res.json({ user: sanitizeUser(user), token });
});

router.get('/me', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  const user = await verifyAuthToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Token invalide.' });
  }
  return res.json({ user: sanitizeUser(user) });
});

export async function initAuth() {
  await initDb();
}

export default router;
