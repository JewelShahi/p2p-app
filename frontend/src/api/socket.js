import { io } from 'socket.io-client';
import { SOCKET_URL } from '../constants/config';

const socket = io(SOCKET_URL, {
  autoConnect: false,
  transports: ['websocket'],
});

export default socket;