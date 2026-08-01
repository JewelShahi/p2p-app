import { io } from 'socket.io-client';
import { SOCKET_URL } from '../constants/config';
import { getClientId } from '../utils/clientId';

const socket = io(API_URL, {
  transports: ['websocket'],
  autoConnect: false,
});

export default socket;