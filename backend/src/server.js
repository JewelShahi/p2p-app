import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import http from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';

import { RoomManager } from './utils/roomManager.js';
import { registerSignaling } from './utils/signaling.js';
import routes from './routes/routes.js';
import errorHandler from './middlewares/errorHandler.middleware.js';
import { apiLimiter } from './middlewares/rateLimiter.middleware.js';

dotenv.config();

const PORT = Number.parseInt(process.env.PORT || '4000', 10);
const app = express();

// Trust one reverse proxy, adjust if you chain proxies
app.set('trust proxy', 1);

// CORS - parse to real origins, only wildcard preview hosts in non-prod
const normalize = (v) => { try { return new URL(v).origin; } catch { return null; } };
const allowList = (process.env.CLIENT_ORIGIN || '')
  .split(',').map((v) => normalize(v.trim())).filter(Boolean);

const isAllowed = (origin) => {
  if (!origin) return true; // curl / same-origin / health checks
  const o = normalize(origin);
  if (!o) return false;
  if (allowList.includes(o)) return true;
  if (process.env.NODE_ENV !== 'production' &&
      ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000'].includes(o)) {
    return true;
  }
  try {
    const { hostname, protocol } = new URL(o);
    return protocol === 'https:' && (hostname.endsWith('.vercel.app') || hostname.endsWith('.onrender.com'));
  } catch { return false; }
};
const corsOrigin = (origin, cb) => (isAllowed(origin) ? cb(null, true) : cb(new Error('Not allowed by CORS')));

app.use(cors({ origin: corsOrigin, credentials: true, methods: ['GET', 'POST', 'OPTIONS'] }));
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(express.json({ limit: '1mb' }));

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: corsOrigin, methods: ['GET', 'POST'], credentials: true },
  transports: ['websocket', 'polling'],
  // Give a backgrounded phone time to come back before the server declares it disconnected
  pingInterval: 25_000,
  pingTimeout: 60_000,
  maxHttpBufferSize: 1e6,
});

const roomManager = new RoomManager(io);
app.locals.roomManager = roomManager;

registerSignaling(io, roomManager);

// Safety-net sweep in case a room's expiry timer was ever lost
const sweep = setInterval(() => roomManager.sweep(), 30_000);
sweep.unref?.();

app.use('/api', apiLimiter, routes);

app.get('/', (req, res) => {
  res.status(200).json({ ok: true, message: 'Server is running' });
});

// Must be registered after all routes
app.use(errorHandler);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`P2P share backend listening on port ${PORT}`);
});
