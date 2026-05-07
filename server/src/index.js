import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import authRouter, { initAuth } from './auth.js';
import { setupGameHandlers } from './game.js';

dotenv.config();

const app = express();
const httpServer = createServer(app);

const FRONTEND_URL = process.env.FRONTEND_URL;
if (!FRONTEND_URL) {
  throw new Error('La variable d’environnement FRONTEND_URL est requise.');
}

app.use(express.json());
app.use(cors({ origin: FRONTEND_URL, methods: ['GET', 'POST'] }));
app.use('/auth', authRouter);

const io = new Server(httpServer, {
  cors: {
    origin: FRONTEND_URL,
    methods: ['GET', 'POST']
  }
});

setupGameHandlers(io);

// Railway impose son propre port via process.env.PORT
const PORT = process.env.PORT || 3000;
initAuth()
  .then(() => {
    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`Serveur démarré sur le port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Erreur lors de l’initialisation de la base de données :', error);
    process.exit(1);
  });