import { io } from 'socket.io-client';
import { SOCKET_URL } from '../constants/config';
import { getClientId } from '../utils/clientId';

const socket = io(SOCKET_URL, {
  autoConnect: false, auth: { clientId: getClientId() }
});

export default socket;