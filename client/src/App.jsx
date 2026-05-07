import { useEffect, useMemo, useState } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import { io } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const defaultAvatar = '♟️';

function randomGuestName() {
  return `invité_${Math.floor(1000 + Math.random() * 9000)}`;
}

export default function App() {
  const [socket, setSocket] = useState(null);
  const [page, setPage] = useState('home');
  const [user, setUser] = useState(null);
  const [authView, setAuthView] = useState('login');
  const [authForm, setAuthForm] = useState({ username: '', password: '', avatar: defaultAvatar });
  const [roomCode, setRoomCode] = useState('');
  const [status, setStatus] = useState('Chargement...');
  const [message, setMessage] = useState('');
  const [gameState, setGameState] = useState(null);
  const [fen, setFen] = useState('start');
  const [whiteTime, setWhiteTime] = useState(0);
  const [blackTime, setBlackTime] = useState(0);
  const [color, setColor] = useState('white');
  const [timeControl, setTimeControl] = useState('5');
  const [mode, setMode] = useState('private');
  const [waiting, setWaiting] = useState(false);

  const chess = useMemo(() => new Chess(), []);

  useEffect(() => {
    const token = localStorage.getItem('chessmate_token');

    async function loadUser() {
      if (!token) {
        setStatus('Prêt. Connecte-toi ou joue en invité.');
        return;
      }

      try {
        const response = await fetch(`${SERVER_URL}/auth/me`, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        if (!response.ok) throw new Error('Session expirée');
        const { user } = await response.json();
        setUser({ ...user, token });
        setStatus(`Connecté comme ${user.username}`);
      } catch (error) {
        localStorage.removeItem('chessmate_token');
        setStatus('Session expirée. Connecte-toi de nouveau.');
      }
    }

    loadUser();

    const client = io(SERVER_URL);
    setSocket(client);

    client.on('connect', () => setStatus((prev) => prev.includes('expirée') ? prev : 'Serveur prêt.'));
    client.on('disconnect', () => setStatus('Serveur déconnecté.'));
    client.on('room-created', (data) => {
      setRoomCode(data.roomId);
      setColor(data.color);
      setPage('game');
      setWaiting(false);
    });
    client.on('room-joined', (data) => {
      setRoomCode(data.roomId);
      setColor(data.color);
      setPage('game');
      setWaiting(false);
    });
    client.on('waiting-for-opponent', ({ message: waitingMessage }) => {
      setMessage(waitingMessage);
      setWaiting(true);
    });
    client.on('game-state', (data) => {
      setFen(data.fen);
      setWhiteTime(data.whiteTime);
      setBlackTime(data.blackTime);
      setMessage(data.message || '');
      setGameState(data);
      setWaiting(false);
    });
    client.on('game-over', (data) => {
      setMessage(data.message);
      setGameState(data);
      setWaiting(false);
    });
    client.on('error-message', (text) => setMessage(text));

    return () => client.disconnect();
  }, []);

  useEffect(() => {
    if (!gameState) return;
    chess.load(gameState.fen);
  }, [gameState, chess]);

  const authFetch = async (path, payload) => {
    const response = await fetch(`${SERVER_URL}/auth/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || 'Erreur d’authentification');
    }
    return result;
  };

  const handleLogin = async () => {
    try {
      const { user: loggedUser, token } = await authFetch('login', {
        username: authForm.username,
        password: authForm.password
      });
      localStorage.setItem('chessmate_token', token);
      setUser({ ...loggedUser, token });
      setMessage(`Bienvenue ${loggedUser.username}`);
      setAuthForm({ username: '', password: '', avatar: defaultAvatar });
    } catch (error) {
      setMessage(error.message);
    }
  };

  const handleRegister = async () => {
    try {
      const { user: registeredUser, token } = await authFetch('register', {
        username: authForm.username,
        password: authForm.password,
        avatar: authForm.avatar
      });
      localStorage.setItem('chessmate_token', token);
      setUser({ ...registeredUser, token });
      setMessage(`Compte créé: ${registeredUser.username}`);
      setAuthForm({ username: '', password: '', avatar: defaultAvatar });
    } catch (error) {
      setMessage(error.message);
    }
  };

  const handleGuest = () => {
    const guestUser = { username: randomGuestName(), avatar: defaultAvatar, guest: true };
    setUser(guestUser);
    setMessage('Mode invité activé');
  };

  const handleLogout = () => {
    localStorage.removeItem('chessmate_token');
    setUser(null);
    setMessage('Déconnecté.');
  };

  const playerData = () => ({
    name: user?.username || authForm.username || randomGuestName(),
    avatar: user?.avatar || authForm.avatar || defaultAvatar,
    authToken: user?.token || null
  });

  const handleCreate = () => {
    if (!socket) return;
    setWaiting(true);
    setMessage('Création du salon...');
    socket.emit('create-room', {
      ...playerData(),
      timeControl: Number(timeControl),
      mode,
      authToken: user?.token || null
    });
  };

  const handleJoin = () => {
    if (!socket || !roomCode.trim()) {
      setMessage('Saisis un code de salon valide.');
      return;
    }
    setMessage('Rejoindre le salon...');
    socket.emit('join-room', {
      roomId: roomCode.trim().toUpperCase(),
      ...playerData(),
      authToken: user?.token || null
    });
  };

  const onDrop = (source, target) => {
    if (!socket || !gameState || gameState.gameOver) return false;
    socket.emit('make-move', {
      roomId: roomCode,
      from: source,
      to: target,
      promotion: 'q'
    });
    return false;
  };

  const renderAuthPanel = () => (
    <div className="card card-panel">
      <div className="panel-header">
        <div>
          <span className="tag">Compte</span>
          <h2>{user ? 'Profil connecté' : 'Connexion rapide'}</h2>
        </div>
        {user && (
          <div className="profile-status">
            <span>{user.avatar}</span>
            <div>
              <strong>{user.username}</strong>
              <span>{user.guest ? 'Invité' : 'Compte persistant'}</span>
            </div>
          </div>
        )}
      </div>

      {!user && (
        <>
          <div className="tab-row">
            <button className={authView === 'login' ? 'tab active' : 'tab'} onClick={() => setAuthView('login')}>
              Connexion
            </button>
            <button className={authView === 'register' ? 'tab active' : 'tab'} onClick={() => setAuthView('register')}>
              Inscription
            </button>
          </div>

          <label className="field-label">Pseudo</label>
          <input
            className="input"
            placeholder="invité_1234"
            value={authForm.username}
            onChange={(e) => setAuthForm((prev) => ({ ...prev, username: e.target.value }))}
          />
          <label className="field-label">Mot de passe</label>
          <input
            className="input"
            type="password"
            placeholder="••••••••"
            value={authForm.password}
            onChange={(e) => setAuthForm((prev) => ({ ...prev, password: e.target.value }))}
          />
          <label className="field-label">Avatar</label>
          <input
            className="input"
            placeholder="♟️"
            value={authForm.avatar}
            maxLength={2}
            onChange={(e) => setAuthForm((prev) => ({ ...prev, avatar: e.target.value }))}
          />

          <div className="action-row">
            {authView === 'login' ? (
              <button className="btn primary" onClick={handleLogin}>
                Se connecter
              </button>
            ) : (
              <button className="btn primary" onClick={handleRegister}>
                Créer un compte
              </button>
            )}
            <button className="btn secondary" onClick={handleGuest}>
              Jouer en invité
            </button>
          </div>
        </>
      )}

      {user && (
        <button className="btn secondary" onClick={handleLogout}>
          Déconnexion
        </button>
      )}
    </div>
  );

  const renderHome = () => (
    <div className="page">
      <header className="hero">
        <div>
          <span className="eyebrow">Chess Mate · MVP</span>
          <h1>Joue aux échecs en ligne.</h1>
          <p>Parties privées ou matchmaking en direct. Ton compte Cloudflare garde ton pseudo, ton avatar et tes sessions.</p>
          <div className="hero-actions">
            <button className="btn primary" onClick={handleCreate}>Créer un salon</button>
            <button className="btn secondary" onClick={handleGuest}>Mode invité</button>
          </div>
        </div>
        <div className="hero-card">
          <div className="stats">
            <div>
              <strong>Matchmaking</strong>
              <span>Appariement instantané</span>
            </div>
          </div>
          <div className="stats">
            <div>
              <strong>Compte persistant</strong>
              <span>Cloudflare D1</span>
            </div>
          </div>
          <div className="stats">
            <div>
              <strong>Temps serveur</strong>
              <span>Chrono fiable</span>
            </div>
          </div>
        </div>
      </header>

      <section className="grid-two">
        {renderAuthPanel()}

        <div className="card card-panel">
          <div className="panel-header">
            <div>
              <span className="tag">Partie</span>
              <h2>Créer ou rejoindre</h2>
            </div>
          </div>

          <div className="field-block">
            <label className="field-label">Mode</label>
            <div className="radio-row">
              <button className={mode === 'private' ? 'pill active' : 'pill'} onClick={() => setMode('private')}>
                Privée
              </button>
              <button className={mode === 'random' ? 'pill active' : 'pill'} onClick={() => setMode('random')}>
                Matchmaking
              </button>
            </div>
          </div>

          <div className="field-block">
            <label className="field-label">Temps</label>
            <select className="input" value={timeControl} onChange={(e) => setTimeControl(e.target.value)} disabled={mode === 'random'}>
              <option value="3">3 minutes</option>
              <option value="5">5 minutes</option>
              <option value="10">10 minutes</option>
              <option value="0">Infini</option>
            </select>
          </div>

          <div className="action-row">
            <button className="btn primary" onClick={handleCreate}>
              Créer un salon
            </button>
          </div>

          <div className="field-block">
            <label className="field-label">Code de salon</label>
            <input
              className="input"
              placeholder="X7B9Q"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value)}
            />
            <button className="btn secondary" onClick={handleJoin}>
              Rejoindre
            </button>
          </div>
        </div>
      </section>

      <section className="features">
        <div className="feature-card">
          <h3>Simple et rapide</h3>
          <p>Joue en invité ou avec un compte Cloudflare. Pas de configuration compliquée.</p>
        </div>
        <div className="feature-card">
          <h3>Matchmaking sécurisé</h3>
          <p>Le serveur valide chaque mouvement et contrôle le chrono.</p>
        </div>
        <div className="feature-card">
          <h3>Design mobile</h3>
          <p>Interface épurée pensée pour smartphone et tablette.</p>
        </div>
      </section>

      <footer className="footer-note">{status}</footer>
      <div className="message-panel">{message}</div>
    </div>
  );

  const renderGame = () => (
    <div className="game-screen">
      <div className="game-header">
        <div>
          <strong>Salon</strong>
          <span>{roomCode}</span>
        </div>
        <div>
          <strong>Couleur</strong>
          <span>{color}</span>
        </div>
        <div>
          <strong>Mode</strong>
          <span>{gameState?.timeControl === 0 ? 'Infini' : `${gameState?.timeControl} min`}</span>
        </div>
      </div>

      <div className="board-row">
        <div className="player-panel">
          <div className="player-avatar">{gameState?.white?.avatar || '♟️'}</div>
          <div className="player-name">{gameState?.white?.name || 'Blanc'}</div>
          <div className="player-time">{Math.max(0, Math.ceil(whiteTime / 1000))} s</div>
        </div>

        <div className="board-wrapper">
          <Chessboard
            position={fen}
            onPieceDrop={(source, target) => onDrop(source, target)}
            boardOrientation={color === 'black' ? 'black' : 'white'}
            arePiecesDraggable={!gameState?.gameOver}
          />
        </div>

        <div className="player-panel">
          <div className="player-avatar">{gameState?.black?.avatar || '♟️'}</div>
          <div className="player-name">{gameState?.black?.name || 'Noir'}</div>
          <div className="player-time">{Math.max(0, Math.ceil(blackTime / 1000))} s</div>
        </div>
      </div>

      <div className="controls">
        <button className="btn secondary" onClick={() => setPage('home')}>
          Retour à l’accueil
        </button>
        <div className="message-panel">{message}</div>
      </div>
    </div>
  );

  return page === 'home' ? renderHome() : renderGame();
}
