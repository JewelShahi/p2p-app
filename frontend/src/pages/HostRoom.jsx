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

      const peer = createPeerConnection({
        initiator: true,
        socket,
        targetSocketId: peerSocketId,
        onFailed: (state) => toast.error(`Connection to a peer ${state} — likely blocked by their network`),
      });

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
        onError: () => {
          toast.error('Send failed — connection to that peer was not ready');
          setTransfers((t) => {
            const copy = { ...t };
            delete copy[fromSocketId];
            return copy;
          });
        },
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
    <div className="min-h-[calc(100vh-4rem)] p-4 sm:p-8 max-w-6xl mx-auto">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-base-content tracking-tight">Hosting Session</h1>
          <p className="text-sm text-base-content/40 mt-1 font-mono">ID: {roomId}</p>
        </div>
        <CountdownTimer expiresAt={expiresAt} onExpire={() => navigate('/')} />
      </div>

      {/* ── Main Grid Layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* ── Left Column: Upload Actions ── */}
        <div className="lg:col-span-3 space-y-6">
          <div className="card bg-base-100 shadow-sm border border-base-300/50">
            <div className="card-body p-6 gap-5">
              <h2 className="card-title text-base text-base-content">Choose files to share</h2>

              {/* Modern Dropzone */}
              <label className="flex flex-col items-center justify-center w-full h-52 border-2 border-dashed rounded-2xl border-base-300 bg-base-200/50 hover:bg-primary/5 hover:border-primary/50 cursor-pointer transition-all duration-300 group">
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={onSelectFiles}
                />
                <div className="w-14 h-14 rounded-2xl bg-base-300/50 group-hover:bg-primary/10 flex items-center justify-center transition-colors duration-300 mb-4">
                  <Upload size={24} className="text-base-content/30 group-hover:text-primary transition-colors" />
                </div>
                <span className="text-sm font-medium text-base-content/60 group-hover:text-primary transition-colors">
                  Click to browse files
                </span>
                <span className="text-xs text-base-content/30 mt-1">
                  Select one or multiple files
                </span>
              </label>

              {/* File List UI */}
              {files.length > 0 && (
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  <div className="flex items-center justify-between text-xs font-medium text-base-content/40 uppercase tracking-wider px-1">
                    <span>Selected Files ({files.length})</span>
                    <span>{formatBytes(totalSize)}</span>
                  </div>
                  {files.map((f) => (
                    <div key={f.id} className="flex items-center justify-between p-3 rounded-xl bg-base-200/50 border border-base-300/30 text-sm group hover:border-primary/30 transition-colors">
                      <span className="truncate text-base-content/80 pr-4">{f.name}</span>
                      <span className="text-base-content/40 text-xs shrink-0 font-mono">{formatBytes(f.size)}</span>
                    </div>
                  ))}
                </div>
              )}

              <button
                className="btn btn-primary w-full"
                onClick={submitOffer}
                disabled={!files.length || !peers.length}
              >
                <Send size={16} />
                Send to {peers.length} {peers.length === 1 ? 'peer' : 'peers'}
              </button>
            </div>
          </div>
        </div>

        {/* ── Right Column: Status & Info ── */}
        <div className="lg:col-span-2 space-y-6">

          {/* Share Link Component */}
          <ShareLink roomId={roomId} />

          {/* Connected Peers Stat */}
          <div className="flex items-center gap-4 p-5 rounded-2xl bg-base-100 shadow-sm border border-base-300/50">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
              <Users size={20} />
            </div>
            <div>
              <p className="text-3xl font-bold text-base-content leading-none">{peers.length}</p>
              <p className="text-xs text-base-content/40 uppercase tracking-widest mt-1">
                {peers.length === 1 ? 'Device' : 'Devices'} Connected
              </p>
            </div>
          </div>

          {/* Active Transfers */}
          {Object.entries(transfers).length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-widest text-base-content/40 px-1">
                Active Transfers
              </h3>
              {Object.entries(transfers).map(([socketId, progress]) => (
                <TransferProgress
                  key={socketId}
                  label={`Peer ${socketId.slice(0, 6)}`}
                  progress={progress}
                />
              ))}
            </div>
          )}

          {/* Fallback UI if no peers */}
          {peers.length === 0 && (
            <div className="p-5 rounded-2xl bg-base-200/30 border border-dashed border-base-300/50 text-center">
              <p className="text-sm text-base-content/30">Waiting for devices to join...</p>
            </div>
          )}

        </div>
      </div>

      {/* ── Footer: Terminate ── */}
      <div className="mt-10 pt-6 border-t border-base-300/50 flex justify-end">
        <button className="btn btn-error btn-outline btn-sm gap-2" onClick={terminateRoom}>
          <Power size={14} /> Terminate Room
        </button>
      </div>

    </div>
  );
}