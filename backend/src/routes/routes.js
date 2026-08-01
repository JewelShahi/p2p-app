import express from 'express';
import * as roomController from '../controllers/room.controller.js';

const router = express.Router();

router.get('/rooms/config', roomController.getConfig);
router.get('/rooms/:roomId', roomController.getRoom);

export default router;