// api/socket.js
import { io } from 'socket.io-client';
import { SOCKET_URL } from '../constants/config';

// aggressive reconnection so a phone that
// backgrounds comes back instead of dying
const socket = io(SOCKET_URL, {
  autoConnect: false,
  transports: ['websocket'],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 800,
  reconnectionDelayMax: 4000,
  timeout: 20000,
});

// Reconnect the instant a backgrounded tab returns to the foreground
export function wireVisibilityReconnect() {
  const kick = () => {
    if (document.visibilityState === 'visible' && socket.disconnected) {
      socket.connect();
    }
  };
  document.addEventListener('visibilitychange', kick);
  window.addEventListener('pageshow', kick);
  window.addEventListener('online', kick);
  return () => {
    document.removeEventListener('visibilitychange', kick);
    window.removeEventListener('pageshow', kick);
    window.removeEventListener('online', kick);
  };
}

export default socket;
