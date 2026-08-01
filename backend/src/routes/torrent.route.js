import express from 'express';
import * as torrentController from '../controllers/torrent.controller.js';
import { torrentLimiter } from '../middlewares/rateLimiter.middleware.js';

const router = express.Router();

// Stricter than the general /api limiter — each request here can spin up a
// real BitTorrent swarm connection and stream large amounts of data.
router.use(torrentLimiter);

router.get('/info', torrentController.getInfo);
router.get('/download', torrentController.download);

export default router;