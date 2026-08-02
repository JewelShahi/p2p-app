import express from 'express';
import * as torrentController from '../controllers/torrent.controller.js';
import { torrentLimiter } from '../middlewares/rateLimiter.middleware.js';

const router = express.Router();

router.use(torrentLimiter);

router.get('/info', torrentController.getInfo);
router.get('/download', torrentController.download);

export default router;