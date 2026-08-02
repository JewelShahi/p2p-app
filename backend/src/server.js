import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import http from 'http';
import { Server } from 'socket.io';

import { RoomManager } from './utils/roomManager.js';
import { registerSignaling } from './utils/signaling.js';
import routes from './routes/routes.js';
import torrentRoutes from './routes/torrent.route.js';
import errorHandler from './middlewares/errorHandler.middleware.js';
import { apiLimiter } from './middlewares/rateLimiter.middleware.js';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 4000;

const app = express();

// 1. Tell Express to trust reverse proxy headers (Cloudflare, Nginx, AWS)
// Needed so req.ip is accurate in rate limiters
app.set('trust proxy', 1);

// 2. Prevent accidental '*' wildcard CORS fallbacks in production environments
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN;
const allowedOrigin = (origin, callback) => {
  if (!origin || origin.endsWith(".vercel.app") || origin === "http://localhost:3000") {
    callback(null, true);
  } else {
    callback(new Error("Not allowed by CORS"));
  }
};

app.use(cors({ origin: allowedOrigin, credentials: true }));

app.use(
  helmet({
    // Default CORP (same-origin) blocks file streaming/zip downloads when the
    // frontend is on a different origin than this API — relax just that part.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin || origin.endsWith(".vercel.app") || origin === "http://localhost:3000") {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST"],
    credentials: true
  }
});

// RoomManager needs `io` to broadcast (room-closed, etc.), so it's built here
// and shared with REST controllers via app.locals rather than each requiring its own instance.
const roomManager = new RoomManager(io);
app.locals.roomManager = roomManager;

registerSignaling(io, roomManager);

// Safety-net sweep in case an individual room's expiry setTimeout was ever lost
setInterval(() => roomManager.sweep(), 30_000);

app.use('/api', apiLimiter, routes);
app.use('/api/torrent', torrentRoutes);

app.get('/', (req, res) => {
  res.status(200).json({ message: 'Server is running' });
});

// Must be registered after all routes
app.use(errorHandler);

server.listen(PORT, () => {
  console.log(`P2P share backend listening on port ${PORT}`);
});