import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    // Tu remplaceras ça par l'URL que Cloudflare Pages te donnera
    origin: process.env.FRONTEND_URL, 
    methods: ["GET", "POST"]
  }
});

// Railway impose son propre port via process.env.PORT
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
});