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
  const peerRetryCount = useRef({}); // peerSocketId -> failed-attempt count, so we self-heal instead of just erroring out
  const filesRef = useRef([]);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  // Stable identity used to resume the SAME room after a socket drop
  // (backgrounded tab, phone lock, brief network blip) instead of being
  // treated as a brand new connection. Assumes the page that called
  // 'create-room' passed hostUserId through navigate(..., { state }) —
  // falls back to sessionStorage so a refresh doesn't lose it either.
  const hostUserId = useRef(
    state?.hostUserId || sessionStorage.getItem(`hostUserId:${roomId}`) || null
  );
  useEffect(() => {
    if (hostUserId.current) {
      sessionStorage.setItem(`hostUserId:${roomId}`, hostUserId.current);
    }
  }, [roomId]);

  const hasConnectedOnce = useRef(false);

  // Mirror of `peers` readable inside socket handlers set up once at mount
  // (their closures would otherwise only ever see the initial empty array).
  const peersRef = useRef([]);
  useEffect(() => {
    peersRef.current = peers;
  }, [peers]);

  useEffect(() => {
    if (!socket.connected) socket.connect();

    // Creates (or re-creates) a WebRTC connection to a peer. Used for a
    // brand-new join, for rebuilding connections after the host itself
    // reconnects, and for redoing a specific peer's connection after THEY
    // reconnect under a new socket id.
    const connectToPeer = (peerSocketId) => {
      const peer = createPeerConnection({
        initiator: true,
        socket,
        targetSocketId: peerSocketId,
        onFailed: (state) => {
          console.error('[peer onFailed - HostRoom]', peerSocketId, state);

          // Tear down the dead connection either way.
          peerConnections.current[peerSocketId]?.destroy();
          delete peerConnections.current[peerSocketId];

          const attempts = (peerRetryCount.current[peerSocketId] || 0) + 1;
          peerRetryCount.current[peerSocketId] = attempts;

          // This is the actual fix for "backgrounded for 20s, comes back
          // dead": the WebRTC connection itself (not necessarily the
          // socket) often dies when a mobile tab is backgrounded. Instead
          // of just showing an alarming error and leaving it broken, we
          // (the initiator) automatically rebuild it — up to a few tries —
          // so both sides come back live with no manual action needed.
          if (attempts > 3) {
            toast.error(`Connection to a peer ${state} — likely blocked by their network`);
            return;
          }

          toast('Reconnecting to a device…', { icon: '🔄' });
          setTimeout(() => {
            // Only retry if that peer is still actually part of the room.
            if (peersRef.current.some((p) => p.socketId === peerSocketId)) {
              connectToPeer(peerSocketId);
            }
          }, 1000);
        },
      });

      peerConnections.current[peerSocketId] = peer;

      peer.on('connect', () => {
        toast.success('Direct connection established');
        peerRetryCount.current[peerSocketId] = 0; // reset — this attempt succeeded
      });

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

      return peer;
    };

    // Fires on the FIRST connection too, not just reconnects — we only act
    // on subsequent ones (socket.io auto-reconnects after a drop).
    const handleConnect = () => {
      if (!hasConnectedOnce.current) {
        hasConnectedOnce.current = true;
        return;
      }
      if (!hostUserId.current) return; // can't resume without our stable id

      socket.emit('rejoin-room', { roomId, userId: hostUserId.current }, (res) => {
        if (!res?.ok) {
          toast.error('This session could not be resumed');
          navigate('/');
          return;
        }
        toast.success('Back online');

        // The server's member list is the source of truth for who's still
        // actually in the room. Add anyone we don't already know about (or
        // don't already have a live connection object for) to our local
        // state and re-establish WebRTC with them — this is what fixes the
        // "peers.length is 0 / Send button disabled" bug after a host
        // reconnect wiped local React state.
        if (Array.isArray(res.members)) {
          setPeers((prev) => {
            const known = new Set(prev.map((p) => p.socketId));
            const additions = res.members.filter((m) => !known.has(m.socketId));
            if (additions.length) {
              // These peers joined while we were disconnected — the
              // server's 'peer-joined' notification for them was sent to
              // our old, already-dead socket id and lost. This is the only
              // place we ever find out about them, so toast it here.
              toast.success(
                additions.length === 1 ? 'A device connected while you were away' : `${additions.length} devices connected while you were away`
              );
            }
            return additions.length ? [...prev, ...additions] : prev;
          });
          res.members.forEach((m) => {
            if (!peerConnections.current[m.socketId]) {
              connectToPeer(m.socketId);
            }
          });
        }
      });
    };
    socket.on('connect', handleConnect);

    // A PEER (not us) reconnected under a new socket id. Their old
    // connection object, if any, is almost certainly dead — tear it down
    // and start a fresh WebRTC handshake targeting their new socket id.
    socket.on('peer-reconnected', ({ userId, socketId }) => {
      const stalePeer = peersRef.current.find((p) => p.userId === userId);
      if (stalePeer && stalePeer.socketId !== socketId) {
        peerConnections.current[stalePeer.socketId]?.destroy();
        delete peerConnections.current[stalePeer.socketId];
      }

      toast.success('A device reconnected');
      setPeers((prev) => {
        const filtered = prev.filter((p) => p.userId !== userId);
        return [...filtered, { socketId, userId }];
      });

      if (!peerConnections.current[socketId]) {
        connectToPeer(socketId);
      }
    });

    socket.on('peer-joined', ({ peerSocketId, peerUserId }) => {
      toast.success('A new device connected');
      setPeers((p) => [...p, { socketId: peerSocketId, userId: peerUserId }]);
      connectToPeer(peerSocketId);
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
        files: filesRef.current,
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
    socket.on('disconnect', () => {
      // Don't alarm the user for a brief drop — 'connect' will fire
      // 'Back online' automatically if/when it recovers. Only a real
      // failure to resume (handled in handleConnect's rejoin-room callback)
      // shows an error.
      console.log('[socket disconnect - HostRoom] connection dropped, attempting to recover...');
    });

    return () => {
      socket.off('connect', handleConnect);
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
    // A fresh file selection means whatever is currently shown under
    // "Transfers" (e.g. a previous round's 100% bars) no longer applies —
    // clear it so the new round doesn't render mixed with stale progress.
    setTransfers({});
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
    // Clear stale progress from a previous round before starting a new
    // offer, so the Transfers panel doesn't show old and new rounds mixed
    // together (e.g. a peer stuck at 100% from the last batch).
    setTransfers({});
    socket.emit('file-offer', {
      files: files.map((f) => ({ id: f.id, name: f.name, size: f.size })),
      totalSize,
    });
    toast.success('Offer sent to connected peers');
  };

  const terminateRoom = () => {
    socket.emit('terminate-room', null, (res) => {
      if (!res?.ok) {
        // Previously this failed silently server-side with no feedback,
        // leaving the room open and the peer still connected while the
        // host's UI navigated away as if it had worked. Now we actually
        // check and tell the user if it didn't work.
        toast.error("Couldn't end the session — please try again");
        console.error('[terminateRoom] failed', res);
        return;
      }
      Object.values(peerConnections.current).forEach((p) => cancelTransfer(p));
      navigate('/');
    });
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