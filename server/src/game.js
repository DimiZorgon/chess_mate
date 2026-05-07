import { Chess } from 'chess.js';
import { verifyAuthToken } from './auth.js';
import { createGame, updateGameState, updateGamePlayers } from './db.js';

const rooms = new Map();
const socketRoom = new Map();
const matchmakingQueue = [];
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function emitRoomJoined(socket, roomId, color, timeControl) {
  socket.emit('room-joined', { roomId, color, timeControl });
}

function generateRoomId(length = 5) {
  let id = '';
  for (let i = 0; i < length; i += 1) {
    id += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return id;
}

function getTimeMs(timeControl) {
  return timeControl > 0 ? timeControl * 60 * 1000 : Infinity;
}

function sanitizePlayerPayload(payload) {
  return {
    id: payload.id || `guest_${Math.random().toString(36).slice(2, 10)}`,
    name: payload.name?.trim() || `invité_${Math.floor(1000 + Math.random() * 9000)}`,
    avatar: payload.avatar || '♟️',
    isGuest: !payload.authToken
  };
}

async function resolvePlayer(payload) {
  if (!payload?.authToken) {
    return sanitizePlayerPayload(payload || {});
  }

  const user = await verifyAuthToken(payload.authToken);
  if (!user) {
    return sanitizePlayerPayload(payload);
  }

  return {
    id: user.id,
    name: user.username,
    avatar: user.avatar || '♟️',
    isGuest: false
  };
}

function getGameStatePayload(room, message = '') {
  return {
    roomId: room.id,
    fen: room.chess.fen(),
    whiteTime: room.whiteTime,
    blackTime: room.blackTime,
    white: { name: room.whitePlayer.name, avatar: room.whitePlayer.avatar },
    black: room.blackPlayer
      ? { name: room.blackPlayer.name, avatar: room.blackPlayer.avatar }
      : null,
    timeControl: room.timeControl,
    currentTurn: room.chess.turn() === 'w' ? 'white' : 'black',
    gameOver: room.gameOver,
    status: room.status,
    message
  };
}

function sendRoomState(room, message = '') {
  const payload = getGameStatePayload(room, message);
  room.io.to(room.id).emit('game-state', payload);
}

function sendGameOver(room, message) {
  const payload = getGameStatePayload(room, message);
  room.io.to(room.id).emit('game-over', payload);
}

function stopRoomTimer(room) {
  if (room.intervalId) {
    clearInterval(room.intervalId);
    room.intervalId = null;
  }
}

async function persistRoomState(room) {
  await updateGameState(room.id, room.chess.fen(), room.status);
}

async function endRoom(room, message, status = 'finished') {
  if (room.gameOver) return;
  room.gameOver = true;
  room.status = status;
  stopRoomTimer(room);
  await persistRoomState(room);
  sendGameOver(room, message);
}

async function tryMatchRandom(socket, player) {
  const waiting = matchmakingQueue.shift();
  if (!waiting) {
    matchmakingQueue.push({ socket, player });
    socket.emit('waiting-for-opponent', { message: 'Recherche d’un adversaire...' });
    return null;
  }

  const timeControl = [3, 5, 10][Math.floor(Math.random() * 3)];
  const roomId = generateRoomId();
  const chess = new Chess();
  const whiteFirst = Math.random() < 0.5;
  const room = {
    id: roomId,
    io: socket.nsp,
    chess,
    timeControl,
    whiteTime: getTimeMs(timeControl),
    blackTime: getTimeMs(timeControl),
    whitePlayer: whiteFirst ? player : waiting.player,
    whiteSocketId: whiteFirst ? socket.id : waiting.socket.id,
    blackPlayer: whiteFirst ? waiting.player : player,
    blackSocketId: whiteFirst ? waiting.socket.id : socket.id,
    status: 'playing',
    gameOver: false,
    intervalId: null,
    createdAt: Date.now()
  };

  rooms.set(roomId, room);
  socketRoom.set(socket.id, roomId);
  socketRoom.set(waiting.socket.id, roomId);

  socket.join(roomId);
  waiting.socket.join(roomId);
  socket.data.player = player;
  waiting.socket.data.player = waiting.player;

  await createGame(roomId, room.whitePlayer.id, room.blackPlayer.id, chess.fen(), timeControl);
  sendRoomState(room, `Match trouvé (${timeControl} min).`);
  emitRoomJoined(socket, roomId, whiteFirst ? 'white' : 'black', timeControl);
  emitRoomJoined(waiting.socket, roomId, whiteFirst ? 'black' : 'white', timeControl);

  startRoomTimer(room);
  return room;
}

function removeFromMatchmaking(socket) {
  const index = matchmakingQueue.findIndex((entry) => entry.socket.id === socket.id);
  if (index !== -1) {
    matchmakingQueue.splice(index, 1);
  }
}

async function createPrivateRoom(socket, payload) {
  const player = await resolvePlayer(payload);
  const roomId = generateRoomId();
  const chess = new Chess();
  const timeControl = Number(payload.timeControl) || 5;
  const room = {
    id: roomId,
    io: socket.nsp,
    chess,
    timeControl,
    whiteTime: getTimeMs(timeControl),
    blackTime: getTimeMs(timeControl),
    whitePlayer: player,
    whiteSocketId: socket.id,
    blackPlayer: null,
    blackSocketId: null,
    status: 'waiting',
    gameOver: false,
    intervalId: null,
    createdAt: Date.now()
  };

  rooms.set(roomId, room);
  socketRoom.set(socket.id, roomId);
  socket.join(roomId);
  socket.data.player = player;

  await createGame(roomId, room.whitePlayer.id, null, chess.fen(), timeControl);
  socket.emit('room-created', { roomId, color: 'white', timeControl });
  sendRoomState(room, 'Salon créé. En attente d’un adversaire...');
  return room;
}

async function joinPrivateRoom(socket, payload) {
  const roomId = String(payload.roomId || '').trim().toUpperCase();
  if (!roomId) {
    socket.emit('error-message', 'Code de salon manquant.');
    return null;
  }

  const room = rooms.get(roomId);
  if (!room) {
    socket.emit('error-message', 'Salon introuvable.');
    return null;
  }

  if (room.status !== 'waiting' || room.blackPlayer) {
    socket.emit('error-message', 'Cette salle n’est pas disponible.');
    return null;
  }

  const player = await resolvePlayer(payload);
  room.blackPlayer = player;
  room.blackSocketId = socket.id;
  room.status = 'playing';
  socket.join(roomId);
  socketRoom.set(socket.id, roomId);
  socket.data.player = player;

  await updateGamePlayers(roomId, room.blackPlayer.id);
  await updateGameState(roomId, room.chess.fen(), room.status);
  emitRoomJoined(socket, roomId, 'black', room.timeControl);
  const creatorSocket = await room.io.in(roomId).fetchSockets().then((sockets) => sockets.find((s) => s.id === room.whiteSocketId));
  if (creatorSocket) {
    emitRoomJoined(creatorSocket, roomId, 'white', room.timeControl);
  }

  sendRoomState(room, 'Adversaire connecté. La partie commence.');
  startRoomTimer(room);
  return room;
}

async function handleMove(socket, payload) {
  const roomId = String(payload.roomId || '').trim().toUpperCase();
  const room = rooms.get(roomId);
  if (!room || room.status !== 'playing') {
    socket.emit('error-message', 'Aucune partie active trouvée.');
    return;
  }

  const playerColor = room.whiteSocketId === socket.id ? 'white' : room.blackSocketId === socket.id ? 'black' : null;
  if (!playerColor) {
    socket.emit('error-message', 'Tu n’es pas dans cette partie.');
    return;
  }

  const currentTurn = room.chess.turn() === 'w' ? 'white' : 'black';
  if (playerColor !== currentTurn) {
    socket.emit('error-message', 'Ce n’est pas ton tour.');
    return;
  }

  const move = room.chess.move({ from: payload.from, to: payload.to, promotion: payload.promotion || 'q' });
  if (!move) {
    socket.emit('error-message', 'Coup invalide.');
    return;
  }

  await updateGameState(roomId, room.chess.fen());

  if (room.chess.isGameOver()) {
    const winner = room.chess.isCheckmate() ? (playerColor === 'white' ? 'white' : 'black') : null;
    const statusMessage = room.chess.isCheckmate()
      ? `Échec et mat ! ${winner === 'white' ? room.whitePlayer.name : room.blackPlayer.name} gagne.`
      : room.chess.isStalemate()
      ? 'Pat. La partie est nulle.'
      : 'Partie terminée.';

    await endRoom(room, statusMessage, 'ended');
    return;
  }

  sendRoomState(room, 'Coup accepté.');
}

async function handleDisconnect(socket) {
  removeFromMatchmaking(socket);

  const roomId = socketRoom.get(socket.id);
  if (!roomId) {
    return;
  }

  const room = rooms.get(roomId);
  if (!room) {
    socketRoom.delete(socket.id);
    return;
  }

  if (room.status === 'waiting') {
    stopRoomTimer(room);
    rooms.delete(roomId);
    socketRoom.delete(socket.id);
    room.io.to(room.id).emit('error-message', 'Le créateur a quitté le salon.');
    return;
  }

  const opponentSocketId = room.whiteSocketId === socket.id ? room.blackSocketId : room.whiteSocketId;
  const opponent = room.whiteSocketId === socket.id ? room.blackPlayer : room.whitePlayer;
  const loserColor = room.whiteSocketId === socket.id ? 'white' : 'black';
  const winnerName = opponent?.name || 'Adversaire';

  room.status = 'ended';
  room.gameOver = true;
  stopRoomTimer(room);
  await persistRoomState(room);

  room.io.to(room.id).emit('game-over', getGameStatePayload(room, `${winnerName} gagne car l’adversaire s’est déconnecté.`));

  rooms.delete(roomId);
  socketRoom.delete(socket.id);
  if (opponentSocketId) {
    socketRoom.delete(opponentSocketId);
  }
}

function startRoomTimer(room) {
  if (room.timeControl === 0 || room.gameOver || room.intervalId) {
    return;
  }

  room.intervalId = setInterval(async () => {
    if (room.gameOver || room.status !== 'playing') {
      stopRoomTimer(room);
      return;
    }

    const activeColor = room.chess.turn() === 'w' ? 'white' : 'black';
    if (activeColor === 'white') {
      room.whiteTime -= 1000;
    } else {
      room.blackTime -= 1000;
    }

    if (room.whiteTime <= 0 || room.blackTime <= 0) {
      const winnerName = room.whiteTime <= 0 ? room.blackPlayer?.name || 'Noir' : room.whitePlayer?.name || 'Blanc';
      const losingColor = room.whiteTime <= 0 ? 'white' : 'black';
      await endRoom(room, `${winnerName} gagne au temps.`, 'ended');
      return;
    }

    sendRoomState(room);
  }, 1000);
}

export function setupGameHandlers(io) {
  io.on('connection', (socket) => {
    socket.on('create-room', async (payload) => {
      try {
        if (payload?.mode === 'random') {
          await tryMatchRandom(socket, await resolvePlayer(payload));
        } else {
          await createPrivateRoom(socket, payload);
        }
      } catch (error) {
        socket.emit('error-message', error.message || 'Erreur interne.');
      }
    });

    socket.on('join-room', async (payload) => {
      try {
        await joinPrivateRoom(socket, payload);
      } catch (error) {
        socket.emit('error-message', error.message || 'Erreur interne.');
      }
    });

    socket.on('make-move', async (payload) => {
      try {
        await handleMove(socket, payload);
      } catch (error) {
        socket.emit('error-message', error.message || 'Erreur lors du coup.');
      }
    });

    socket.on('disconnect', () => {
      handleDisconnect(socket).catch(() => {
        // silence
      });
    });
  });
}
