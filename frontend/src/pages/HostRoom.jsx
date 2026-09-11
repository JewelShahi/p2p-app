import { useEffect, useRef, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Upload, Power, Users, Send, FolderOpen, Link, HardDrive,
  Radio, X, ShieldCheck, Check, Zap,
} from 'lucide-react';
import socket, { wireVisibilityReconnect } from '../api/socket';
import ShareLink from '../components/ShareLink';
import CountdownTimer from '../components/CountdownTimer';
import TransferProgress from '../components/TransferProgress';
import { createPeerConnection, sendFiles, cancelTransfer } from '../utils/peerTransfer';
import { formatBytes } from '../utils/formatBytes';

const SIZE_LIMIT = 10 * 1024 * 1024 * 1024;

const CSS = `
  @keyframes pd-rise {
    from { opacity: 0; transform: translateY(14px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .pd-rise { animation: pd-rise .7s cubic-bezier(.22,1,.36,1) both; }

  @keyframes pd-float {
    0%, 100% { transform: translateY(0); }
    50%      { transform: translateY(-18px); }
  }
  .pd-float { animation: pd-float 9s ease-in-out infinite; }

  @keyframes pd-bar {
    0%, 100% { transform: scaleY(.4); opacity: .55; }
    50%      { transform: scaleY(1);  opacity: 1; }
  }
  .pd-bar { transform-origin: bottom; animation: pd-bar 1.3s ease-in-out infinite; }

  @keyframes pd-scan {
    0%        { transform: translateX(-110%); }
    55%, 100% { transform: translateX(430%); }
  }
  .pd-scan { animation: pd-scan 4.5s cubic-bezier(.4,0,.2,1) infinite; }

  .pd-shine { position: relative; overflow: hidden; }
  .pd-shine::after {
    content: '';
    position: absolute; inset: 0;
    background: linear-gradient(105deg, transparent 40%, rgb(255 255 255 / .28) 50%, transparent 60%);
    transform: translateX(-130%);
    transition: transform .7s ease;
    pointer-events: none;
  }
  .pd-shine:hover::after { transform: translateX(130%); }

  .peerdrop-dotgrid {
    background-image: radial-gradient(currentColor 1px, transparent 1px);
    background-size: 18px 18px;
    -webkit-mask-image: radial-gradient(ellipse 60% 55% at 50% 20%, #000 0%, transparent 75%);
    mask-image: radial-gradient(ellipse 60% 55% at 50% 20%, #000 0%, transparent 75%);
  }

  @media (prefers-reduced-motion: reduce) {
    .pd-rise, .pd-float, .pd-bar, .pd-scan { animation: none !important; }
    .pd-shine::after { display: none; }
    .peerdrop-dotgrid { display: none; }
  }
`;

const CARD = 'card h-full overflow-hidden border border-base-300/60 bg-base-100/95 shadow-sm backdrop-blur-sm';

function SignalBars() {
  return (
    <span className="inline-flex items-end gap-[3px] h-4 shrink-0" aria-hidden="true">
      {[5, 8, 11, 14].map((h, i) => (
        <span
          key={h}
          className="w-[3px] rounded-full bg-gradient-to-t from-primary/60 to-success pd-bar"
          style={{ height: h, animationDelay: `${i * 160}ms` }}
        />
      ))}
    </span>
  );
}

/* Expanding radar rings while we wait for a device to join */
function WaitingRadar() {
  return (
    <span className="relative flex h-14 w-14 items-center justify-center" aria-hidden="true">
      <span className="absolute inset-0 animate-ping rounded-full bg-primary/10" style={{ animationDuration: '2.2s' }} />
      <span className="absolute inset-0 animate-ping rounded-full bg-primary/10" style={{ animationDuration: '2.2s', animationDelay: '0.7s' }} />
      <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Radio size={15} />
      </span>
    </span>
  );
}

/* Shared card header: icon tile + title + divider + optional right slot */
function CardHeader({ icon: Icon, tint, title, right }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tint}`}>
        <Icon size={16} />
      </div>
      <h2 className="text-sm font-semibold whitespace-nowrap">{title}</h2>
      <span className="h-px flex-1 bg-base-300/60" />
      {right}
    </div>
  );
}

export default function HostRoom() {
  const { roomId } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();

  // Made the timer stateful so it preserves the real expiry across remounts/refreshes instead of resetting to a fake 20-minute window and drifting from the server value
  const [expiresAt, setExpiresAt] = useState(state?.expiresAt || Date.now() + 20 * 60 * 1000);
  const [peers, setPeers] = useState([]);
  const [files, setFiles] = useState([]);
  const [transfers, setTransfers] = useState({});
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const peerConnections = useRef({});
  const peerRetryCount = useRef({});
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
  const hasJoinedOnce = useRef(false);

  // ghost user fix - dedupe the peer list by userId, keeping the newest socket
  const upsertPeer = (list, { socketId, userId }) => {
    const withoutDupes = list.filter((p) => p.userId !== userId && p.socketId !== socketId);
    return [...withoutDupes, { socketId, userId }];
  };

  useEffect(() => {
    const isPeerReady = (peer) => {
      return peer && !peer.destroyed && peer.connected &&
             peer._channel && peer._channel.readyState === 'open';
    };

    const connectToPeer = (peerSocketId) => {
      const peer = createPeerConnection({
        initiator: true,
        socket,
        targetSocketId: peerSocketId,
        onFailed: (failState) => {
          console.error('[peer onFailed]', peerSocketId, failState);
          peerConnections.current[peerSocketId]?.destroy();
          delete peerConnections.current[peerSocketId];

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
      });
      peer.on('error', (err) => {
        console.error('[peer error]', peerSocketId, err);
        toast.error('Connection to a device failed', { id: 'peer-error' });
      });
      peer.on('iceStateChange', (iceState) => {
        console.log('[ICE state]', peerSocketId, iceState);
      });
      peer.on('close', () => {
        delete peerConnections.current[peerSocketId];
      });

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

    // ──── REJOIN no ghosts ────
    const tryRejoin = () => {
      if (!hostUserId.current) return;
      const isFirstJoin = !hasJoinedOnce.current;
      if (!isFirstJoin) setIsReconnecting(true);

      socket.emit('rejoin-room', { roomId, userId: hostUserId.current }, (res) => {
        if (!isFirstJoin) setIsReconnecting(false);
        hasJoinedOnce.current = true;

        if (!res?.ok) {
          toast.error('This session could not be resumed', { id: 'rejoin-fail' });
          navigate('/');
          return;
        }
        if (!isFirstJoin) toast.success('Back online', { id: 'rejoin-success' });

        // always resync to the server's authoritative expiry on every (re)join, exactly like JoinRoom already does
        if (res.expiresAt) setExpiresAt(res.expiresAt);

        if (Array.isArray(res.members)) {
          // Dedupe the authoritative list by userId (server already does, but be safe)
          const byUser = new Map();
          for (const m of res.members) byUser.set(m.userId, m);
          const members = Array.from(byUser.values());

          const newSocketIds = new Set(members.map((m) => m.socketId));
          for (const oldSid of Object.keys(peerConnections.current)) {
            if (!newSocketIds.has(oldSid)) {
              peerConnections.current[oldSid]?.destroy();
              delete peerConnections.current[oldSid];
              delete peerRetryCount.current[oldSid];
            }
          }

          setPeers(members);

          members.forEach((m) => {
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

    socket.on('connect', tryRejoin);
    if (socket.connected) tryRejoin();
    else socket.connect();

    // ──── MOBILE - reconnect instantly when the host tab returns ────
    const unwireVisibility = wireVisibilityReconnect();

    socket.on('peer-reconnected', ({ userId, socketId }) => {
      const stalePeer = peersRef.current.find((p) => p.userId === userId);
      if (stalePeer && stalePeer.socketId !== socketId) {
        peerConnections.current[stalePeer.socketId]?.destroy();
        delete peerConnections.current[stalePeer.socketId];
        delete peerRetryCount.current[stalePeer.socketId];
      }

      toast.success('A device reconnected', { id: 'peer-reconnected' });
      setPeers((prev) => upsertPeer(prev, { socketId, userId }));

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
      setPeers((p) => upsertPeer(p, { socketId: peerSocketId, userId: peerUserId }));
      if (!isPeerReady(peerConnections.current[peerSocketId])) {
        toast.success('A new device connected', { id: 'peer-joined' });
        connectToPeer(peerSocketId);
      }
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
    });

    socket.on('file-response', ({ fromSocketId, accept }) => {
      if (!accept) {
        toast('A peer declined the transfer', { icon: 'ℹ️', id: 'transfer-declined' });
        return;
      }
      const peer = peerConnections.current[fromSocketId];
      if (!isPeerReady(peer)) {
        if (peer) {
          peer.destroy();
          delete peerConnections.current[fromSocketId];
          delete peerRetryCount.current[fromSocketId];
        }
        const newPeer = connectToPeer(fromSocketId);
        newPeer.once('connect', () => {
          doSendFiles(newPeer, fromSocketId, filesRef.current);
        });
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
      console.log('[socket disconnect] will auto-recover…');
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
      unwireVisibility();
      Object.values(peerConnections.current).forEach((p) => p.destroy());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Shared by the file input and drag and drop
  const addFiles = (fileList) => {
    const list = Array.from(fileList).map((file) => ({
      id: crypto.randomUUID(),
      file,
      name: file.name,
      size: file.size,
    }));
    if (!list.length) return;
    setFiles(list);
    setTransfers({});
    toast.success(
      `${list.length} file${list.length > 1 ? 's' : ''} · ${formatBytes(list.reduce((s, f) => s + f.size, 0))} selected`,
      { id: 'files-selected' }
    );
  };

  const onSelectFiles = (e) => {
    addFiles(e.target.files);
    // Reset so the host can re-pick the SAME file after the gallery round-trip
    e.target.value = '';
  };

  const onDropFiles = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  const removeFile = (id) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const clearFiles = () => setFiles([]);

  const totalSize = files.reduce((s, f) => s + f.size, 0);
  const usagePct = (totalSize / SIZE_LIMIT) * 100;
  const overLimit = totalSize > SIZE_LIMIT;
  const activeTransfers = Object.keys(transfers).length;
  const allReady = files.length > 0 && peers.length > 0 && socket.connected && !isReconnecting;

  const readySteps = [
    { label: 'Files selected', done: files.length > 0 },
    { label: 'Device connected', done: peers.length > 0 },
    { label: 'Server link stable', done: socket.connected && !isReconnecting },
  ];

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
    const hint = files.length > 1 ? ' (will arrive as a single .zip)' : '';
    toast.success('Offer sent to connected peers' + hint, { id: 'offer-sent' });
  };

  const terminateRoom = () => {
    if (!socket.connected || isReconnecting) {
      toast.error(!socket.connected ? 'No connection — please wait' : 'Still reconnecting — please wait', { id: 'terminate-blocked' });
      return;
    }
    socket.emit('terminate-room', { roomId, userId: hostUserId.current }, (res) => {
      if (!res?.ok) {
        toast.error("Couldn't end the session — please try again", { id: 'terminate-fail' });
        return;
      }
      sessionStorage.removeItem(`hostUserId:${roomId}`);
      Object.values(peerConnections.current).forEach((p) => cancelTransfer(p));
      navigate('/');
    });
  };

  return (
    <div className="relative min-h-[calc(100vh-4rem)] max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 overflow-hidden">
      <style>{CSS}</style>

      {/* backdrop */}
      <div className="peerdrop-dotgrid pointer-events-none absolute inset-0 text-base-content/[0.06]" aria-hidden="true" />
      <div className="pd-float pointer-events-none absolute -top-20 right-[4%] h-72 w-72 rounded-full bg-primary/[0.07] blur-3xl" aria-hidden="true" />
      <div className="pd-float pointer-events-none absolute bottom-10 left-[2%] h-72 w-72 rounded-full bg-secondary/[0.06] blur-3xl" style={{ animationDelay: '-4.5s' }} aria-hidden="true" />

      <div className="relative">

        {/* ── Top Bar ── */}
        <div className="pd-rise relative mb-6 overflow-hidden rounded-2xl border border-base-300/60 bg-base-100/95 shadow-sm backdrop-blur-xl">
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[2px] overflow-hidden">
            <div className="pd-scan absolute inset-y-0 w-1/4 bg-gradient-to-r from-transparent via-primary/70 to-transparent" />
          </div>

          <div className="flex items-center gap-3 px-4 py-3.5 sm:px-6">
            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <FolderOpen size={18} className="text-primary" />
              <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-base-100 bg-success" />
              </span>
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold leading-tight">Hosting Session</p>
                {isReconnecting ? (
                  <span className="badge badge-warning badge-sm gap-1 border-transparent bg-warning/10 text-warning">
                    <span className="loading loading-spinner loading-xs" /> Reconnecting…
                  </span>
                ) : (
                  <span className="badge badge-sm gap-1.5 border-transparent bg-success/10 text-success">
                    <span className="h-1.5 w-1.5 rounded-full bg-success" /> Live
                  </span>
                )}
              </div>
              <p className="truncate font-mono text-xs text-base-content/40">{roomId}</p>
            </div>

            <div className="hidden shrink-0 sm:block">
              <CountdownTimer expiresAt={expiresAt} onExpire={() => navigate('/')} />
            </div>

            <button
              className="btn btn-ghost btn-sm gap-2 border border-base-300/60 text-error hover:bg-error/10 hover:text-error disabled:opacity-40"
              onClick={terminateRoom}
              disabled={isReconnecting || !socket.connected}
              title="End session for everyone"
            >
              <Power size={15} />
              <span className="hidden sm:inline">End</span>
            </button>
          </div>
        </div>

        {/* Mobile Timer */}
        <div className="pd-rise mb-6 sm:hidden" style={{ animationDelay: '80ms' }}>
          <CountdownTimer expiresAt={expiresAt} onExpire={() => navigate('/')} />
        </div>

        {/* ── Bento Grid ── */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 lg:gap-5">

          {/* Share Link */}
          <div className="pd-rise md:col-span-5 lg:col-span-4" style={{ animationDelay: '160ms' }}>
            <div className={`${CARD} relative`}>
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-secondary/[0.07] via-transparent to-transparent" />
              <div className="card-body relative h-full gap-4 p-5">
                <CardHeader icon={Link} tint="bg-secondary/10 text-secondary" title="Share Invite" />
                <ShareLink roomId={roomId} />
                <p className="text-[11px] leading-relaxed text-base-content/35">
                  Anyone with this link can join and receive your files — no account needed.
                </p>
              </div>
            </div>
          </div>

          {/* Devices */}
          <div className="pd-rise md:col-span-7 lg:col-span-4" style={{ animationDelay: '240ms' }}>
            <div className={CARD}>
              <div className="card-body h-full gap-4 p-5">
                <CardHeader
                  icon={Users}
                  tint="bg-primary/10 text-primary"
                  title="Devices"
                  right={
                    <span className={`badge badge-sm border-transparent font-medium ${peers.length ? 'bg-success/10 text-success' : 'bg-base-200 text-base-content/40'}`}>
                      {peers.length} online
                    </span>
                  }
                />
                {peers.length > 0 ? (
                  <ul className="max-h-44 space-y-1.5 overflow-y-auto pr-1">
                    {peers.map((p) => (
                      <li
                        key={p.socketId}
                        className="flex items-center gap-2.5 rounded-lg border border-base-300/50 bg-base-200/40 px-3 py-2 transition-colors hover:border-primary/30 hover:bg-primary/[0.06]"
                      >
                        <span className="relative flex h-2 w-2 shrink-0">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
                        </span>
                        <span className="flex-1 text-xs font-medium text-base-content/75">Device</span>
                        <span className="font-mono text-[10px] text-base-content/30">{p.socketId.slice(0, 8)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center py-4 text-center">
                    <WaitingRadar />
                    <p className="mt-3 text-xs font-medium text-base-content/40">Waiting for devices…</p>
                    <p className="mt-0.5 text-[11px] text-base-content/25">Share the invite link to connect</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Transfers */}
          <div className="pd-rise md:col-span-12 lg:col-span-4" style={{ animationDelay: '320ms' }}>
            <div className={CARD}>
              <div className="card-body h-full gap-3 p-5">
                <CardHeader
                  icon={Send}
                  tint="bg-success/10 text-success"
                  title="Transfers"
                  right={activeTransfers > 0 && (
                    <span className="badge badge-sm border-transparent bg-success/10 font-medium text-success">
                      {activeTransfers} active
                    </span>
                  )}
                />
                {activeTransfers > 0 ? (
                  <div className="space-y-3">
                    {Object.entries(transfers).map(([socketId, progress]) => (
                      <TransferProgress key={socketId} label={`Peer ${socketId.slice(0, 6)}`} progress={progress} />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center py-6 text-center">
                    <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-base-200/70">
                      <SignalBars />
                    </div>
                    <p className="text-xs font-medium text-base-content/30">No active transfers</p>
                    <p className="mt-0.5 text-[11px] text-base-content/20">Select files and send to peers</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Files */}
          <div className="pd-rise md:col-span-8 lg:col-span-8" style={{ animationDelay: '400ms' }}>
            <div className={CARD}>
              <div className="card-body gap-4 p-5">
                <CardHeader
                  icon={Upload}
                  tint="bg-primary/10 text-primary"
                  title="Files"
                  right={files.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="badge badge-ghost badge-sm font-mono">
                        {files.length} file{files.length > 1 ? 's' : ''} · {formatBytes(totalSize)}
                      </span>
                      <button
                        className="btn btn-ghost btn-xs text-base-content/40 hover:bg-error/10 hover:text-error"
                        onClick={clearFiles}
                      >
                        Clear
                      </button>
                    </div>
                  )}
                />

                <label
                  className={`group flex h-44 w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition-all duration-200 ${
                    isDragging
                      ? 'scale-[1.01] border-primary bg-primary/10'
                      : 'border-base-300 bg-base-200/30 hover:border-primary/40 hover:bg-primary/5'
                  }`}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={(e) => {
                    if (e.currentTarget.contains(e.relatedTarget)) return;
                    setIsDragging(false);
                  }}
                  onDrop={onDropFiles}
                >
                  <input type="file" multiple className="hidden" onChange={onSelectFiles} />
                  <div className={`mb-3 flex h-12 w-12 items-center justify-center rounded-xl transition-all duration-200 ${isDragging ? 'scale-110 bg-primary/15' : 'bg-base-300/40 group-hover:bg-primary/10'}`}>
                    <Upload
                      size={22}
                      className={`transition-colors duration-200 ${isDragging ? 'text-primary' : 'text-base-content/25 group-hover:text-primary'}`}
                    />
                  </div>
                  <span className={`text-sm font-medium transition-colors ${isDragging ? 'text-primary' : 'text-base-content/50 group-hover:text-primary'}`}>
                    {isDragging ? 'Drop to attach' : 'Click to browse or drag files here'}
                  </span>
                  <span className="mt-1 text-[11px] text-base-content/25">Multiple files arrive as one .zip · up to 10GB</span>
                </label>

                {files.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="flex items-center gap-1.5 text-base-content/40">
                        <HardDrive size={11} /> Payload
                      </span>
                      <span className={`font-mono tabular-nums ${overLimit ? 'text-error' : 'text-base-content/50'}`}>
                        {formatBytes(totalSize)} / 10 GB
                      </span>
                    </div>
                    <progress
                      className={`progress h-1.5 w-full ${overLimit ? 'progress-error' : 'progress-primary'}`}
                      value={Math.min(usagePct, 100)}
                      max={100}
                    />
                    {overLimit && (
                      <p className="text-[11px] text-error">Exceeds the 10GB limit — remove some files</p>
                    )}
                  </div>
                )}

                {files.length > 0 && (
                  <div className="max-h-44 space-y-1.5 overflow-y-auto pr-1">
                    {files.map((f, i) => (
                      <div
                        key={f.id}
                        className="pd-rise group/item flex items-center gap-3 rounded-lg bg-base-200/40 px-3 py-2.5 text-sm transition-colors hover:bg-base-200/70"
                        style={{ animationDelay: `${i * 40}ms` }}
                      >
                        <FolderOpen size={14} className="shrink-0 text-base-content/20" />
                        <span className="min-w-0 flex-1 truncate text-base-content/70">{f.name}</span>
                        <span className="shrink-0 font-mono text-xs tabular-nums text-base-content/30">{formatBytes(f.size)}</span>
                        <button
                          onClick={() => removeFile(f.id)}
                          className="shrink-0 text-base-content/25 opacity-60 transition-all hover:text-error group-hover/item:opacity-100"
                          aria-label={`Remove ${f.name}`}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Send Action */}
          <div className="pd-rise md:col-span-4 lg:col-span-4" style={{ animationDelay: '480ms' }}>
            <div
              className={`card h-full overflow-hidden border bg-base-100/95 shadow-sm backdrop-blur-sm transition-all duration-500 ${
                allReady ? 'border-primary/40 shadow-lg shadow-primary/15' : 'border-base-300/60'
              }`}
            >
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-primary/[0.07] to-transparent" />

              <div className="card-body relative h-full justify-between gap-5 p-5">
                <div className="space-y-4">
                  <CardHeader icon={Zap} tint="bg-primary/10 text-primary" title="Ready to send?" />

                  <ul className="space-y-2">
                    {readySteps.map((s) => (
                      <li key={s.label} className="flex items-center gap-2.5">
                        <span
                          className={`flex h-5 w-5 items-center justify-center rounded-full border transition-all duration-300 ${
                            s.done
                              ? 'border-success/40 bg-success/15 text-success'
                              : 'border-base-300 bg-base-200/50 text-base-content/25'
                          }`}
                        >
                          {s.done ? <Check size={11} strokeWidth={3} /> : <span className="h-1 w-1 rounded-full bg-current" />}
                        </span>
                        <span className={`text-xs transition-colors ${s.done ? 'font-medium text-base-content/70' : 'text-base-content/35'}`}>
                          {s.label}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <p className="text-xs leading-relaxed text-base-content/40">
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

                <div className="space-y-3">
                  {files.length > 0 && (
                    <div className="flex items-center justify-between rounded-lg bg-base-200/50 px-3 py-2 text-[11px]">
                      <span className="text-base-content/40">Payload</span>
                      <span className="font-mono tabular-nums text-base-content/60">
                        {files.length} file{files.length > 1 ? 's' : ''} · {formatBytes(totalSize)}
                      </span>
                    </div>
                  )}

                  <button
                    className="pd-shine btn btn-primary group/btn w-full gap-2 shadow-lg shadow-primary/25 transition-all duration-200 enabled:hover:-translate-y-0.5 enabled:hover:shadow-xl enabled:hover:shadow-primary/40 active:translate-y-0"
                    onClick={submitOffer}
                    disabled={!files.length || !peers.length || isReconnecting || !socket.connected}
                  >
                    <Send size={16} className="transition-transform duration-200 group-hover/btn:-translate-y-0.5 group-hover/btn:translate-x-0.5" />
                    Send to {peers.length || '—'}
                  </button>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
