import { useEffect, useRef, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Upload, Power, Users, Send, FolderOpen, Link, Clock, HardDrive } from 'lucide-react';
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
        onFailed: (state) => {
          console.error('[peer onFailed - HostRoom]', peerSocketId, state);
          toast.error(`Connection to a peer ${state} — likely blocked by their network`);
        },
      });

      peerConnections.current[peerSocketId] = peer;

      peer.on('connect', () => toast.success('Direct connection established'));

      peer.on('error', (err) => {
        console.error('[peer error - HostRoom]', peerSocketId, err);
        toast.error('Connection to a peer failed');
      });

      peer.on('iceStateChange', (state) => {
        console.log('[ICE state - HostRoom]', peerSocketId, state);
      });

      peer.on('close', () => {
        console.log('[peer close - HostRoom]', peerSocketId);
        delete peerConnections.current[peerSocketId];
      });
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
        onError: (err) => {
          console.error('[sendFiles onError - HostRoom]', fromSocketId, err);
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
    <div className="min-h-[calc(100vh-4rem)] p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">

      {/* ── Top Bar: Identity, Timer, Terminate ── */}
      <div className="navbar bg-base-100 rounded-2xl shadow-sm border border-base-300/50 px-4 sm:px-6 mb-6">
        <div className="flex-1 gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <FolderOpen size={18} className="text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">Hosting Session</p>
            <p className="text-xs text-base-content/40 font-mono">{roomId}</p>
          </div>
        </div>

        <div className="flex-none hidden sm:flex">
          <CountdownTimer expiresAt={expiresAt} onExpire={() => navigate('/')} />
        </div>

        <div className="flex-none ml-4">
          <button
            className="btn btn-ghost btn-sm gap-2 text-error hover:bg-error/10 hover:text-error"
            onClick={terminateRoom}
          >
            <Power size={15} />
            <span className="hidden sm:inline">End</span>
          </button>
        </div>
      </div>

      {/* ── Mobile Timer (visible only on small screens) ── */}
      <div className="sm:hidden mb-6">
        <CountdownTimer expiresAt={expiresAt} onExpire={() => navigate('/')} />
      </div>

      {/* ── Bento Grid Layout ── */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 lg:gap-5">

        {/* ── Share Link Card (Spans full width on md, left side on lg) ── */}
        <div className="md:col-span-5 lg:col-span-4">
          <div className="card bg-base-100 shadow-sm border border-base-300/50 h-full">
            <div className="card-body p-5 gap-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-secondary/10 flex items-center justify-center">
                  <Link size={16} className="text-secondary" />
                </div>
                <h2 className="card-title text-sm font-semibold">Share Invite</h2>
              </div>
              <ShareLink roomId={roomId} />
            </div>
          </div>
        </div>

        {/* ── Stats Cluster (2 mini cards) ── */}
        <div className="md:col-span-7 lg:col-span-4 grid grid-cols-2 gap-4 lg:gap-5">

          {/* Connected Devices */}
          <div className="card bg-base-100 shadow-sm border border-base-300/50">
            <div className="card-body p-5 items-center text-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-1">
                <Users size={18} className="text-primary" />
              </div>
              <p className="text-3xl font-bold leading-none">{peers.length}</p>
              <p className="text-[11px] text-base-content/40 uppercase tracking-widest font-medium">
                Connected
              </p>
            </div>
          </div>

          {/* Payload Size */}
          <div className="card bg-base-100 shadow-sm border border-base-300/50">
            <div className="card-body p-5 items-center text-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center mb-1">
                <HardDrive size={18} className="text-accent" />
              </div>
              <p className="text-2xl font-bold leading-none">{files.length ? formatBytes(totalSize) : '—'}</p>
              <p className="text-[11px] text-base-content/40 uppercase tracking-widest font-medium">
                Payload
              </p>
            </div>
          </div>

        </div>

        {/* ── Transfers Status (Right side) ── */}
        <div className="md:col-span-12 lg:col-span-4">
          <div className="card bg-base-100 shadow-sm border border-base-300/50 h-full">
            <div className="card-body p-5 gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-success/10 flex items-center justify-center">
                  <Send size={16} className="text-success" />
                </div>
                <h2 className="card-title text-sm font-semibold">Transfers</h2>
              </div>

              {Object.entries(transfers).length > 0 ? (
                <div className="space-y-3">
                  {Object.entries(transfers).map(([socketId, progress]) => (
                    <TransferProgress
                      key={socketId}
                      label={`Peer ${socketId.slice(0, 6)}`}
                      progress={progress}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-base-200/70 flex items-center justify-center mb-3">
                    <Clock size={20} className="text-base-content/20" />
                  </div>
                  <p className="text-xs text-base-content/30 font-medium">No active transfers</p>
                  <p className="text-[11px] text-base-content/20 mt-0.5">Select files and send to peers</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── File Upload Zone (Bottom Left - Spans large) ── */}
        <div className="md:col-span-8 lg:col-span-8">
          <div className="card bg-base-100 shadow-sm border border-base-300/50">
            <div className="card-body p-5 gap-4">

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Upload size={16} className="text-primary" />
                  </div>
                  <h2 className="card-title text-sm font-semibold">Files</h2>
                </div>
                {files.length > 0 && (
                  <span className="badge badge-ghost badge-sm font-mono">
                    {files.length} file{files.length > 1 ? 's' : ''} · {formatBytes(totalSize)}
                  </span>
                )}
              </div>

              {/* Dropzone */}
              <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-xl border-base-300 bg-base-200/30 hover:bg-primary/5 hover:border-primary/40 cursor-pointer transition-all duration-200 group">
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={onSelectFiles}
                />
                <div className="w-12 h-12 rounded-xl bg-base-300/40 group-hover:bg-primary/10 flex items-center justify-center transition-colors duration-200 mb-3">
                  <Upload size={22} className="text-base-content/25 group-hover:text-primary transition-colors" />
                </div>
                <span className="text-sm font-medium text-base-content/50 group-hover:text-primary transition-colors">
                  Click to browse
                </span>
                <span className="text-[11px] text-base-content/25 mt-1">
                  Supports multiple files up to 10GB
                </span>
              </label>

              {/* File List */}
              {files.length > 0 && (
                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  {files.map((f) => (
                    <div key={f.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-base-200/40 text-sm group/item hover:bg-base-200/70 transition-colors">
                      <FolderOpen size={14} className="text-base-content/20 shrink-0" />
                      <span className="truncate text-base-content/70 flex-1 min-w-0">{f.name}</span>
                      <span className="text-base-content/30 text-xs shrink-0 font-mono tabular-nums">{formatBytes(f.size)}</span>
                    </div>
                  ))}
                </div>
              )}

            </div>
          </div>
        </div>

        {/* ── Send Action Card (Bottom Right) ── */}
        <div className="md:col-span-4 lg:col-span-4">
          <div className="card bg-base-100 shadow-sm border border-base-300/50 h-full">
            <div className="card-body p-5 gap-4 justify-between">

              <div>
                <h2 className="text-sm font-semibold mb-1">Ready to send?</h2>
                <p className="text-xs text-base-content/40 leading-relaxed">
                  {peers.length === 0
                    ? 'Share the room link and wait for devices to connect.'
                    : `${peers.length} device${peers.length > 1 ? 's are' : ' is'} waiting. ${files.length === 0 ? 'Add files to begin.' : 'Hit send to start.'}`
                  }
                </p>
              </div>

              <button
                className="btn btn-primary w-full gap-2"
                onClick={submitOffer}
                disabled={!files.length || !peers.length}
              >
                <Send size={16} />
                Send to {peers.length || '—'}
              </button>

            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
