import { useEffect, useRef, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Upload, Power, Users, Send } from 'lucide-react';
import socket from '../api/socket';
import ShareLink from '../components/ShareLink';
import CountdownTimer from '../components/CountdownTimer';
import TransferProgress from '../components/TransferProgress';
import { createPeerConnection, sendFiles, cancelTransfer } from '../utils/peerTransfer';
import { formatBytes } from '../utils/formatBytes';

export default function HostRoom() {
  const { roomId } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();

  const [expiresAt] = useState(state?.expiresAt || Date.now() + 20 * 60 * 1000);
  const [peers, setPeers] = useState([]);
  const [files, setFiles] = useState([]);
  const [transfers, setTransfers] = useState({});

  const peerConnections = useRef({});

  useEffect(() => {
    if (!socket.connected) socket.connect();

    socket.on('peer-joined', ({ peerSocketId, peerUserId }) => {
      toast.success('A new device connected');
      setPeers((p) => [...p, { socketId: peerSocketId, userId: peerUserId }]);

      const peer = createPeerConnection({ initiator: true, socket, targetSocketId: peerSocketId });
      peerConnections.current[peerSocketId] = peer;

      peer.on('connect', () => toast.success('Direct connection established'));
      peer.on('error', () => toast.error('Connection to a peer failed'));
      peer.on('close', () => delete peerConnections.current[peerSocketId]);
    });

    socket.on('signal', ({ fromSocketId, signal }) => {
      peerConnections.current[fromSocketId]?.signal(signal);
    });

    socket.on('peer-left', ({ peerSocketId }) => {
      toast('A peer left the session', { icon: '👋' });
      setPeers((p) => p.filter((x) => x.socketId !== peerSocketId));
      setTransfers((t) => {
        const copy = { ...t };
        delete copy[peerSocketId];
        return copy;
      });
      peerConnections.current[peerSocketId]?.destroy();
      delete peerConnections.current[peerSocketId];
    });

    socket.on('file-response', ({ fromSocketId, accept }) => {
      if (!accept) {
        toast('A peer declined the transfer', { icon: 'ℹ️' });
        return;
      }
      const peer = peerConnections.current[fromSocketId];
      if (!peer) {
        toast.error('Lost connection to that peer');
        return;
      }
      toast.success('Sending files...');
      sendFiles({
        peer,
        files,
        onProgress: (p) => setTransfers((t) => ({ ...t, [fromSocketId]: p })),
        onDone: () => {
          toast.success('Transfer complete for one peer');
          setTransfers((t) => ({ ...t, [fromSocketId]: 1 }));
        },
        onCancel: () => toast('Peer cancelled the download', { icon: '🛑' }),
      });
    });

    socket.on('room-closed', ({ reason }) => {
      toast.error(reason === 'expired' ? 'Room expired' : 'Room closed');
      navigate('/');
    });

    socket.on('connect_error', () => toast.error('Could not reach the server'));
    socket.on('disconnect', () => toast.error('Disconnected from server'));

    return () => {
      socket.off('peer-joined');
      socket.off('signal');
      socket.off('peer-left');
      socket.off('file-response');
      socket.off('room-closed');
      socket.off('connect_error');
      socket.off('disconnect');
      Object.values(peerConnections.current).forEach((p) => p.destroy());
    };
  }, [files, navigate]);

  const onSelectFiles = (e) => {
    const list = Array.from(e.target.files).map((file) => ({
      id: crypto.randomUUID(),
      file,
      name: file.name,
      size: file.size,
    }));
    setFiles(list);
  };

  const totalSize = files.reduce((s, f) => s + f.size, 0);

  const submitOffer = () => {
    if (!files.length) {
      toast.error('Select at least one file first');
      return;
    }
    if (totalSize > 10 * 1024 * 1024 * 1024) {
      toast.error('Total size exceeds the 10GB limit');
      return;
    }
    socket.emit('file-offer', {
      files: files.map((f) => ({ id: f.id, name: f.name, size: f.size })),
      totalSize,
    });
    toast.success('Offer sent to connected peers');
  };

  const terminateRoom = () => {
    socket.emit('terminate-room');
    Object.values(peerConnections.current).forEach((p) => cancelTransfer(p));
    navigate('/');
  };

  return (
    <div className="min-h-screen p-4 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Hosting session</h1>
        <CountdownTimer expiresAt={expiresAt} onExpire={() => navigate('/')} />
      </div>

      <ShareLink roomId={roomId} />

      <div className="flex items-center gap-2 text-sm opacity-70">
        <Users size={16} /> {peers.length} connected
      </div>

      <div className="card bg-base-200">
        <div className="card-body">
          <h2 className="card-title text-base"><Upload size={18} /> Choose files to share</h2>
          <input type="file" multiple className="file-input file-input-bordered w-full" onChange={onSelectFiles} />
          {files.length > 0 && <p className="text-sm opacity-70">{files.length} file(s) · {formatBytes(totalSize)}</p>}
          <button className="btn btn-primary mt-2" onClick={submitOffer} disabled={!files.length || !peers.length}>
            <Send size={16} /> Send to connected peers
          </button>
        </div>
      </div>

      {Object.entries(transfers).map(([socketId, progress]) => (
        <TransferProgress key={socketId} label={`Peer ${socketId.slice(0, 6)}`} progress={progress} />
      ))}

      <button className="btn btn-error btn-outline w-full" onClick={terminateRoom}>
        <Power size={16} /> Terminate room
      </button>
    </div>
  );
}