// HostRoom.jsx
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
  const [isReconnecting, setIsReconnecting] = useState(false);

  const peerConnections = useRef({});
  const peerRetryCount = useRef({});
  const pendingSends = useRef({});
  const filesRef = useRef([]);
  useEffect(() => { filesRef.current = files; }, [files]);

  const hostUserId = useRef(
    state?.hostUserId || sessionStorage.getItem(`hostUserId:${roomId}`) || null
  );
  useEffect(() => {
    if (hostUserId.current) {
      sessionStorage.setItem(`hostUserId:${roomId}`, hostUserId.current);
    }
  }, [roomId]);

  const peersRef = useRef([]);
  useEffect(() => { peersRef.current = peers; }, [peers]);

  // Tracks whether we've completed at least one successful rejoin so we can
  // show the "Reconnecting…" badge only on ACTUAL reconnects, not on the
  // harmless initial rejoin that fires on mount.
  const hasJoinedOnce = useRef(false);

  useEffect(() => {
    const isPeerReady = (peer) => {
      return peer && !peer.destroyed && peer.connected &&
             peer._channel && peer._channel.readyState === 'open';
    };

    const connectToPeer = (peerSocketId) => {
      const existingPending = pendingSends.current[peerSocketId];

      const peer = createPeerConnection({
        initiator: true,
        socket,
        targetSocketId: peerSocketId,
        onFailed: (failState) => {
          console.error('[peer onFailed]', peerSocketId, failState);
          peerConnections.current[peerSocketId]?.destroy();
          delete peerConnections.current[peerSocketId];
          delete pendingSends.current[peerSocketId];

          const attempts = (peerRetryCount.current[peerSocketId] || 0) + 1;
          peerRetryCount.current[peerSocketId] = attempts;

          if (attempts > 3) {
            toast.error('Connection to a device failed — likely blocked by their network', { id: 'peer-fail-final' });
            setTransfers((t) => { const c = { ...t }; delete c[peerSocketId]; return c; });
            return;
          }

          toast('Reconnecting to a device…', { icon: '🔄', id: 'peer-retrying' });
          setTimeout(() => {
            if (peersRef.current.some((p) => p.socketId === peerSocketId)) {
              connectToPeer(peerSocketId);
            }
          }, 1000);
        },
      });

      peerConnections.current[peerSocketId] = peer;

      peer.on('connect', () => {
        toast.success('Direct connection established', { id: 'peer-connected' });
        peerRetryCount.current[peerSocketId] = 0;

        const pending = pendingSends.current[peerSocketId];
        if (pending) {
          delete pendingSends.current[peerSocketId];
          doSendFiles(peer, peerSocketId, pending.files);
        }
      });

      peer.on('error', (err) => {
        console.error('[peer error]', peerSocketId, err);
        toast.error('Connection to a device failed', { id: 'peer-error' });
      });

      peer.on('iceStateChange', (iceState) => {
        console.log('[ICE state]', peerSocketId, iceState);
      });

      peer.on('close', () => {
        console.log('[peer close]', peerSocketId);
        delete peerConnections.current[peerSocketId];
        delete pendingSends.current[peerSocketId];
      });

      if (existingPending) {
        pendingSends.current[peerSocketId] = existingPending;
      }

      return peer;
    };

    const doSendFiles = (peer, socketId, filesToSend) => {
      toast.success('Sending files…', { id: 'sending-files' });
      sendFiles({
        peer,
        files: filesToSend,
        onProgress: (p) => setTransfers((t) => ({ ...t, [socketId]: p })),
        onDone: () => {
          toast.success('Transfer complete', { id: 'transfer-done' });
          setTransfers((t) => ({ ...t, [socketId]: 1 }));
        },
        onCancel: () => {
          toast('Peer cancelled the download', { icon: '🛑', id: 'transfer-cancelled' });
          setTransfers((t) => { const c = { ...t }; delete c[socketId]; return c; });
        },
        onError: (err) => {
          console.error('[sendFiles onError]', socketId, err);
          toast.error('Send failed — connection dropped', { id: 'send-failed' });
          setTransfers((t) => { const c = { ...t }; delete c[socketId]; return c; });
        },
      });
    };

    // ──── REJOIN — the single function that syncs host state with server ────
    // Called on EVERY connect event AND once on mount if already connected.
    // The server handles duplicate rejoins gracefully (idempotent), so
    // calling this "too many times" is harmless — calling it TOO FEW times
    // (the old hasConnectedOnce bug) is what caused the empty-room bug.
    const tryRejoin = () => {
      if (!hostUserId.current) return;

      // Only show the "Reconnecting…" badge on actual reconnects, not on
      // the first mount where we're just doing a harmless sync.
      const isFirstJoin = !hasJoinedOnce.current;
      if (!isFirstJoin) {
        setIsReconnecting(true);
      }

      socket.emit('rejoin-room', { roomId, userId: hostUserId.current }, (res) => {
        if (!isFirstJoin) {
          setIsReconnecting(false);
        }
        hasJoinedOnce.current = true;

        if (!res?.ok) {
          // On the very first join, a failure means the room genuinely
          // doesn't exist (expired, server restarted, etc). Navigate away.
          // On a reconnect, same thing — session can't be recovered.
          toast.error('This session could not be resumed', { id: 'rejoin-fail' });
          navigate('/');
          return;
        }

        // Only toast "Back online" on actual reconnects
        if (!isFirstJoin) {
          toast.success('Back online', { id: 'rejoin-success' });
        }

        if (Array.isArray(res.members)) {
          const newSocketIds = new Set(res.members.map((m) => m.socketId));

          // Destroy connections to peers no longer in the room
          for (const oldSid of Object.keys(peerConnections.current)) {
            if (!newSocketIds.has(oldSid)) {
              peerConnections.current[oldSid]?.destroy();
              delete peerConnections.current[oldSid];
              delete peerRetryCount.current[oldSid];
              delete pendingSends.current[oldSid];
            }
          }

          // REPLACE peers entirely — don't merge with stale entries.
          // The server only returns live, connected members.
          setPeers(res.members);

          // Re-establish WebRTC with anyone we don't have a live connection to
          res.members.forEach((m) => {
            if (!isPeerReady(peerConnections.current[m.socketId])) {
              if (peerConnections.current[m.socketId]) {
                peerConnections.current[m.socketId].destroy();
                delete peerConnections.current[m.socketId];
                delete peerRetryCount.current[m.socketId];
              }
              connectToPeer(m.socketId);
            }
          });
        }
      });
    };

    // Register the connect handler BEFORE checking socket.connected, so
    // we catch reconnects that happen between this line and the check below.
    socket.on('connect', tryRejoin);

    // If the socket is already connected (normal case: we just created the
    // room on the home page and navigated here), the 'connect' event won't
    // fire again. We MUST call tryRejoin manually or we'll never sync.
    // This is harmless on first mount — the server returns an empty member
    // list and we set peers to [] (which it already is).
    if (socket.connected) {
      tryRejoin();
    } else {
      socket.connect();
    }

    // ──── Other socket handlers ────

    socket.on('peer-reconnected', ({ userId, socketId }) => {
      const stalePeer = peersRef.current.find((p) => p.userId === userId);
      if (stalePeer && stalePeer.socketId !== socketId) {
        peerConnections.current[stalePeer.socketId]?.destroy();
        delete peerConnections.current[stalePeer.socketId];
        delete peerRetryCount.current[stalePeer.socketId];
        delete pendingSends.current[stalePeer.socketId];
      }

      toast.success('A device reconnected', { id: 'peer-reconnected' });
      setPeers((prev) => {
        const filtered = prev.filter((p) => p.userId !== userId);
        return [...filtered, { socketId, userId }];
      });

      if (!isPeerReady(peerConnections.current[socketId])) {
        if (peerConnections.current[socketId]) {
          peerConnections.current[socketId].destroy();
          delete peerConnections.current[socketId];
          delete peerRetryCount.current[socketId];
        }
        connectToPeer(socketId);
      }
    });

    socket.on('peer-joined', ({ peerSocketId, peerUserId }) => {
      toast.success('A new device connected', { id: 'peer-joined' });
      setPeers((p) => [...p, { socketId: peerSocketId, userId: peerUserId }]);
      connectToPeer(peerSocketId);
    });

    socket.on('signal', ({ fromSocketId, signal }) => {
      peerConnections.current[fromSocketId]?.signal(signal);
    });

    socket.on('peer-left', ({ peerSocketId }) => {
      toast('A peer left the session', { icon: '👋', id: 'peer-left' });
      setPeers((p) => p.filter((x) => x.socketId !== peerSocketId));
      setTransfers((t) => { const c = { ...t }; delete c[peerSocketId]; return c; });
      peerConnections.current[peerSocketId]?.destroy();
      delete peerConnections.current[peerSocketId];
      delete peerRetryCount.current[peerSocketId];
      delete pendingSends.current[peerSocketId];
    });

    socket.on('file-response', ({ fromSocketId, accept }) => {
      if (!accept) {
        toast('A peer declined the transfer', { icon: 'ℹ️', id: 'transfer-declined' });
        return;
      }

      const peer = peerConnections.current[fromSocketId];

      if (!isPeerReady(peer)) {
        console.log('[file-response] peer not ready, recreating connection to', fromSocketId);
        if (peer) {
          peer.destroy();
          delete peerConnections.current[fromSocketId];
          delete peerRetryCount.current[fromSocketId];
        }
        pendingSends.current[fromSocketId] = { files: filesRef.current };
        connectToPeer(fromSocketId);
        return;
      }

      doSendFiles(peer, fromSocketId, filesRef.current);
    });

    socket.on('room-closed', ({ reason }) => {
      toast.error(reason === 'expired' ? 'Room expired' : 'Room closed', { id: 'room-closed' });
      navigate('/');
    });

    socket.on('connect_error', () => {
      toast.error('Could not reach the server', { id: 'connect-error' });
    });

    socket.on('disconnect', () => {
      console.log('[socket disconnect] connection dropped, will auto-recover…');
    });

    return () => {
      socket.off('connect', tryRejoin);
      socket.off('peer-reconnected');
      socket.off('peer-joined');
      socket.off('signal');
      socket.off('peer-left');
      socket.off('file-response');
      socket.off('room-closed');
      socket.off('connect_error');
      socket.off('disconnect');
      Object.values(peerConnections.current).forEach((p) => p.destroy());
    };
  }, []);

  const onSelectFiles = (e) => {
    const list = Array.from(e.target.files).map((file) => ({
      id: crypto.randomUUID(),
      file,
      name: file.name,
      size: file.size,
    }));
    setFiles(list);
    setTransfers({});
  };

  const totalSize = files.reduce((s, f) => s + f.size, 0);

  const submitOffer = () => {
    if (!files.length) {
      toast.error('Select at least one file first', { id: 'no-files' });
      return;
    }
    if (totalSize > 10 * 1024 * 1024 * 1024) {
      toast.error('Total size exceeds the 10GB limit', { id: 'too-large' });
      return;
    }
    setTransfers({});
    socket.emit('file-offer', {
      files: files.map((f) => ({ id: f.id, name: f.name, size: f.size })),
      totalSize,
    });
    toast.success('Offer sent to connected peers', { id: 'offer-sent' });
  };

  const terminateRoom = () => {
    // Block if we're not actually connected or still waiting for rejoin to
    // complete — prevents the race where terminate-room arrives at the
    // server before rejoin-room and fails because socket.data is empty.
    if (!socket.connected || isReconnecting) {
      toast.error(!socket.connected ? 'No connection — please wait' : 'Still reconnecting — please wait', { id: 'terminate-blocked' });
      return;
    }
    socket.emit('terminate-room', {
      roomId,
      userId: hostUserId.current,
    }, (res) => {
      if (!res?.ok) {
        toast.error("Couldn't end the session — please try again", { id: 'terminate-fail' });
        console.error('[terminateRoom] failed', res);
        return;
      }
      Object.values(peerConnections.current).forEach((p) => cancelTransfer(p));
      navigate('/');
    });
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">

      {/* Top Bar */}
      <div className="navbar bg-base-100 rounded-2xl shadow-sm border border-base-300/50 px-4 sm:px-6 mb-6">
        <div className="flex-1 gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <FolderOpen size={18} className="text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">Hosting Session</p>
            <p className="text-xs text-base-content/40 font-mono">{roomId}</p>
          </div>
          {isReconnecting && (
            <span className="badge badge-warning badge-sm gap-1">
              <span className="loading loading-spinner loading-xs" /> Reconnecting…
            </span>
          )}
        </div>

        <div className="flex-none hidden sm:flex">
          <CountdownTimer expiresAt={expiresAt} onExpire={() => navigate('/')} />
        </div>

        <div className="flex-none ml-4">
          <button
            className="btn btn-ghost btn-sm gap-2 text-error hover:bg-error/10 hover:text-error disabled:opacity-40"
            onClick={terminateRoom}
            disabled={isReconnecting || !socket.connected}
          >
            <Power size={15} />
            <span className="hidden sm:inline">End</span>
          </button>
        </div>
      </div>

      {/* Mobile Timer */}
      <div className="sm:hidden mb-6">
        <CountdownTimer expiresAt={expiresAt} onExpire={() => navigate('/')} />
      </div>

      {/* Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 lg:gap-5">

        {/* Share Link */}
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

        {/* Stats */}
        <div className="md:col-span-7 lg:col-span-4 grid grid-cols-2 gap-4 lg:gap-5">
          <div className="card bg-base-100 shadow-sm border border-base-300/50">
            <div className="card-body p-5 items-center text-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-1">
                <Users size={18} className="text-primary" />
              </div>
              <p className="text-3xl font-bold leading-none">{peers.length}</p>
              <p className="text-[11px] text-base-content/40 uppercase tracking-widest font-medium">Connected</p>
            </div>
          </div>
          <div className="card bg-base-100 shadow-sm border border-base-300/50">
            <div className="card-body p-5 items-center text-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center mb-1">
                <HardDrive size={18} className="text-accent" />
              </div>
              <p className="text-2xl font-bold leading-none">{files.length ? formatBytes(totalSize) : '—'}</p>
              <p className="text-[11px] text-base-content/40 uppercase tracking-widest font-medium">Payload</p>
            </div>
          </div>
        </div>

        {/* Transfers */}
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
                    <TransferProgress key={socketId} label={`Peer ${socketId.slice(0, 6)}`} progress={progress} />
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

        {/* File Upload */}
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
              <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-xl border-base-300 bg-base-200/30 hover:bg-primary/5 hover:border-primary/40 cursor-pointer transition-all duration-200 group">
                <input type="file" multiple className="hidden" onChange={onSelectFiles} />
                <div className="w-12 h-12 rounded-xl bg-base-300/40 group-hover:bg-primary/10 flex items-center justify-center transition-colors duration-200 mb-3">
                  <Upload size={22} className="text-base-content/25 group-hover:text-primary transition-colors" />
                </div>
                <span className="text-sm font-medium text-base-content/50 group-hover:text-primary transition-colors">Click to browse</span>
                <span className="text-[11px] text-base-content/25 mt-1">Supports multiple files up to 10GB</span>
              </label>
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

        {/* Send Action */}
        <div className="md:col-span-4 lg:col-span-4">
          <div className="card bg-base-100 shadow-sm border border-base-300/50 h-full">
            <div className="card-body p-5 gap-4 justify-between">
              <div>
                <h2 className="text-sm font-semibold mb-1">Ready to send?</h2>
                <p className="text-xs text-base-content/40 leading-relaxed">
                  {!socket.connected
                    ? 'No server connection — waiting…'
                    : isReconnecting
                      ? 'Reconnecting to the server…'
                      : peers.length === 0
                        ? 'Share the room link and wait for devices to connect.'
                        : `${peers.length} device${peers.length > 1 ? 's are' : ' is'} waiting. ${files.length === 0 ? 'Add files to begin.' : 'Hit send to start.'}`
                  }
                </p>
              </div>
              <button
                className="btn btn-primary w-full gap-2"
                onClick={submitOffer}
                disabled={!files.length || !peers.length || isReconnecting || !socket.connected}
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