import { env } from 'process';

const accountId = env.CLOUDFLARE_ACCOUNT_ID;
// 1. CORRECTION ICI : On utilise bien l'ID et non le nom
const databaseId = env.CLOUDFLARE_D1_DATABASE_ID; 
const apiToken = env.CLOUDFLARE_API_TOKEN;

if (!accountId || !databaseId || !apiToken) {
  throw new Error('Missing Cloudflare D1 environment variables. See .env');
}

// 2. CORRECTION ICI : "database" au singulier
const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

async function runQuery(sql, params = []) {
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sql, params })
  });

  const json = await response.json();
  if (!response.ok || json.success === false) {
    throw new Error(json.errors?.[0]?.message || 'Cloudflare D1 query failed');
  }

  // 3. CORRECTION ICI : L'API Cloudflare renvoie les résultats dans json.result[0].results
  return json.result?.[0]?.results || [];
}

export async function initDb() {
  // --- TABLE DES JOUEURS ---
  await runQuery(`CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE,
    password_hash TEXT,
    avatar TEXT
  );`);

  // --- TABLE DES PARTIES (NOUVEAU) ---
  // FEN est la chaîne de texte qui représente l'échiquier (fournie par chess.js)
  await runQuery(`CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY, 
    white_player_id TEXT,
    black_player_id TEXT,
    fen TEXT NOT NULL,
    status TEXT DEFAULT 'ongoing',
    time_mode TEXT
  );`);
}

// --- FONCTIONS JOUEURS ---
export async function findUserByUsername(username) {
  const rows = await runQuery('SELECT * FROM players WHERE username = ? LIMIT 1;', [username]);
  return rows[0] || null;
}

export async function findUserById(id) {
  const rows = await runQuery('SELECT * FROM players WHERE id = ? LIMIT 1;', [id]);
  return rows[0] || null;
}

export async function createUser(id, username, passwordHash, avatar) {
  await runQuery(
    'INSERT INTO players (id, username, password_hash, avatar) VALUES (?, ?, ?, ?);',
    [id, username, passwordHash, avatar]
  );
  return { id, username, avatar };
}

// --- FONCTIONS PARTIES (NOUVEAU) ---

// Créer une nouvelle partie
export async function createGame(gameId, whiteId, blackId, initialFen, timeMode) {
  await runQuery(
    'INSERT INTO games (id, white_player_id, black_player_id, fen, time_mode) VALUES (?, ?, ?, ?, ?);',
    [gameId, whiteId, blackId, initialFen, timeMode]
  );
}

// Mettre à jour l'échiquier à chaque coup joué
export async function updateGameState(gameId, fen, status) {
  if (status) {
    await runQuery('UPDATE games SET fen = ?, status = ? WHERE id = ?;', [fen, status, gameId]);
  } else {
    await runQuery('UPDATE games SET fen = ? WHERE id = ?;', [fen, gameId]);
  }
}

export async function updateGamePlayers(gameId, blackPlayerId) {
  await runQuery('UPDATE games SET black_player_id = ? WHERE id = ?;', [blackPlayerId, gameId]);
}

// Récupérer la partie (utile en cas de reconnexion)
export async function getGame(gameId) {
  const rows = await runQuery('SELECT * FROM games WHERE id = ? LIMIT 1;', [gameId]);
  return rows[0] || null;
}