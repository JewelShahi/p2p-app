// JoinRoom.jsx
import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Users, LogOut, Wifi, ArrowDownToLine, CheckCircle2, Radio, ShieldCheck, Copy,
} from 'lucide-react';
import socket, { wireVisibilityReconnect } from '../api/socket';
import CountdownTimer from '../components/CountdownTimer';
import FileOfferModal from '../components/FileOfferModal';
import TransferProgress from '../components/TransferProgress';
import { createPeerConnection, receiveFiles, cleanupReceiveListener } from '../utils/peerTransfer';

/* ── Motion & effects — same design system as Home/HostRoom, reduced-motion safe ── */
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

  @keyframes pd-scan {
    0%        { transform: translateX(-110%); }
    55%, 100% { transform: translateX(430%); }
  }
  .pd-scan { animation: pd-scan 4.5s cubic-bezier(.4,0,.2,1) infinite; }

  .peerdrop-dotgrid {
    background-image: radial-gradient(currentColor 1px, transparent 1px);
    background-size: 18px 18px;
    -webkit-mask-image: radial-gradient(ellipse 60% 55% at 50% 20%, #000 0%, transparent 75%);
    mask-image: radial-gradient(ellipse 60% 55% at 50% 20%, #000 0%, transparent 75%);
  }

  @media (prefers-reduced-motion: reduce) {
    .pd-rise, .pd-float, .pd-scan { animation: none !important; }
    .animate-ping, .animate-pulse { animation: none !important; }
    .peerdrop-dotgrid { display: none; }
  }
`;

const CARD = 'card h-full overflow-hidden border border-base-300/60 bg-base-100/95 shadow-sm backdrop-blur-sm';

/* Radar rings while the receiver waits for the host — mirrors HostRoom's "waiting for devices". */
function WaitingRadar({ icon: Icon = Radio }) {
  return (
    <span className="relative flex h-16 w-16 items-center justify-center" aria-hidden="true">
      <span className="absolute inset-0 animate-ping rounded-full bg-primary/10" style={{ animationDuration: '2.2s' }} />
      <span className="absolute inset-0 animate-ping rounded-full bg-primary/10" style={{ animationDuration: '2.2s', animationDelay: '0.7s' }} />
      <span className="relative flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon size={18} />
      </span>
    </span>
  );
}

/* Shared card header: icon tile + title + divider + optional right slot. */
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

export default function JoinRoom() {
  const { roomId } = useParams();
  const navigate = useNavigate();

  const [expiresAt, setExpiresAt] = useState(null);
  const [offer, setOffer] = useState(null);
  const [progress, setProgress] = useState(null);
  const [downloadState, setDownloadState] = useState('idle');
  const [isReconnecting, setIsReconnecting] = useState(false);

  const hostPeer = useRef(null);
  const hostSocketIdRef = useRef(null);
  const hostRetryCount = useRef(0);
  const downloadCallbacks = useRef(null);
  const hasReceivedData = useRef(false);
  const isReceivingRef = useRef(false);
  const lastOfferIdRef = useRef(null);
  const transferDoneRef = useRef(false); // true ONLY when integrity-checked done

  const downloadStateRef = useRef('idle');
  useEffect(() => { downloadStateRef.current = downloadState; }, [downloadState]);

  const offerRef = useRef(null);
  useEffect(() => { offerRef.current = offer; }, [offer]);

  const myUserId = useRef(sessionStorage.getItem(`peerUserId:${roomId}`) || null);
  const hasJoinedOnce = useRef(false);
  const respondImplRef = useRef(null);

  useEffect(() => {
    const clearDownloadState = () => {
      if (downloadCallbacks.current?.stallTimer) {
        clearTimeout(downloadCallbacks.current.stallTimer);
        downloadCallbacks.current = null;
      }
      cleanupReceiveListener();
      setDownloadState('idle');
      setProgress(null);
      hasReceivedData.current = false;
      isReceivingRef.current = false;
      transferDoneRef.current = false;
    };

    const handleDownloadComplete = () => {
      if (downloadStateRef.current === 'complete') return;
      if (downloadCallbacks.current?.stallTimer) {
        clearTimeout(downloadCallbacks.current.stallTimer);
        downloadCallbacks.current = null;
      }
      transferDoneRef.current = true;
      setProgress(1);
      setDownloadState('complete');
      hasReceivedData.current = false;
      isReceivingRef.current = false;
    };

    const startReceiveFiles = (mode, fileHandles) => {
      if (!hostPeer.current) {
        clearDownloadState();
        toast.error('Connection lost unexpectedly', { id: 'no-peer-receive' });
        return;
      }
      transferDoneRef.current = false;

      const stallTimer = setTimeout(() => {
        // FIX (corruption): a stall is NOT a success. Never mark complete here.
        toast.error('Download stalled — please ask the host to re-send', { id: 'download-stalled' });
        clearDownloadState();
      }, 30000);

      downloadCallbacks.current = { stallTimer };

      receiveFiles({
        peer: hostPeer.current,
        mode,
        fileHandles,
        onProgress: (p) => {
          hasReceivedData.current = true;
          if (downloadCallbacks.current?.stallTimer) {
            clearTimeout(downloadCallbacks.current.stallTimer);
            downloadCallbacks.current.stallTimer = null;
          }
          setProgress(Math.min(Math.max(p, 0), 1));
        },
        onDone: () => {
          handleDownloadComplete();
          toast.success('Download complete', { id: 'download-complete' });
        },
        onError: (err) => {
          console.error('[receiveFiles onError]', err);
          if (downloadStateRef.current === 'complete') return;
          if (downloadCallbacks.current?.stallTimer) {
            clearTimeout(downloadCallbacks.current.stallTimer);
            downloadCallbacks.current = null;
          }
          cleanupReceiveListener();
          isReceivingRef.current = false;
          // FIX (corruption): integrity errors must NOT fall back to "received".
          const msg = err === 'incomplete-file' || err === 'incomplete-transfer'
            ? 'The file arrived incomplete — please ask the host to re-send'
            : 'Something interrupted the download — please try again';
          toast.error(msg, { id: 'download-error' });
          setDownloadState('idle');
          setProgress(null);
        },
      });
    };

    // ──── REJOIN (reuses the SAME identity — no ghosts) ────
    const tryRejoin = () => {
      if (!myUserId.current) return;
      const isFirstJoin = !hasJoinedOnce.current;
      if (!isFirstJoin) setIsReconnecting(true);

      socket.emit('rejoin-room', { roomId, userId: myUserId.current }, (res) => {
        if (!isFirstJoin) setIsReconnecting(false);
        hasJoinedOnce.current = true;

        if (!res?.ok) {
          toast.error(res?.error === 'room-not-found' ? 'That room no longer exists' : 'Could not resume the session', { id: 'rejoin-fail' });
          navigate('/');
          return;
        }
        if (!isFirstJoin) toast.success('Back online', { id: 'rejoin-success' });

        if (res.currentOffer && res.currentOffer.offerId !== lastOfferIdRef.current) {
          setOffer(res.currentOffer);
          lastOfferIdRef.current = res.currentOffer.offerId;
        }
        if (res.expiresAt) setExpiresAt(res.expiresAt);
      });
    };

    socket.on('connect', tryRejoin);

    // ──── FIX (ghost users): only ONE of rejoin OR fresh-join, never both. ────
    if (myUserId.current) {
      if (socket.connected) tryRejoin();
      else socket.connect();
    } else {
      if (!socket.connected) socket.connect();
      socket.emit('join-room', { roomId }, (res) => {
        if (!res?.ok) {
          toast.error(res?.error === 'room-not-found' ? 'That room does not exist' : 'That room has expired', { id: 'join-fail' });
          navigate('/');
          return;
        }
        myUserId.current = res.userId;
        hasJoinedOnce.current = true;
        sessionStorage.setItem(`peerUserId:${roomId}`, res.userId);
        setExpiresAt(res.expiresAt);
        if (res.currentOffer) {
          setOffer(res.currentOffer);
          lastOfferIdRef.current = res.currentOffer.offerId;
        }
        toast.success('Joined session', { id: 'join-success' });
      });
    }

    // ──── MOBILE: reconnect instantly when the tab returns from the gallery ────
    const unwireVisibility = wireVisibilityReconnect();

    // ──── WebRTC signaling ────
    socket.on('signal', ({ fromSocketId, signal }) => {
      const isFromDifferentHost = hostSocketIdRef.current !== null &&
                                  hostSocketIdRef.current !== fromSocketId;

      if (hostPeer.current && isFromDifferentHost) {
        cleanupReceiveListener();
        hostPeer.current.destroy();
        hostPeer.current = null;
      }

      if (!hostPeer.current) {
        hostSocketIdRef.current = fromSocketId;
        hostPeer.current = createPeerConnection({
          initiator: false,
          socket,
          targetSocketId: fromSocketId,
          onFailed: (failState) => {
            console.error('[peer onFailed]', failState);
            cleanupReceiveListener();
            hostPeer.current?.destroy();
            hostPeer.current = null;
            const attempts = hostRetryCount.current + 1;
            hostRetryCount.current = attempts;
            if (attempts > 3) {
              toast.error('Connection to host failed — try a different network', { id: 'host-fail-final' });
              return;
            }
            toast('Reconnecting to host…', { icon: '🔄', id: 'host-retrying' });
          },
        });

        hostPeer.current.on('connect', () => {
          toast.success('Direct connection established', { id: 'peer-connected' });
          hostRetryCount.current = 0;
        });
        hostPeer.current.on('error', (err) => {
          console.error('[peer error]', err);
          toast.error('Connection to host failed', { id: 'peer-error' });
        });
        hostPeer.current.on('iceStateChange', (iceState) => {
          console.log('[ICE state]', iceState);
        });
        hostPeer.current.on('close', () => {
          cleanupReceiveListener();
          // FIX (corruption): only the integrity-checked onDone marks complete.
          // A close during download WITHOUT a real 'done' is an interruption.
          if (downloadStateRef.current === 'downloading' && !transferDoneRef.current) {
            isReceivingRef.current = false;
            setDownloadState('idle');
            setProgress(null);
            toast.error('Connection dropped mid-transfer — please retry', { id: 'mid-drop' });
          }
          hostPeer.current = null;
        });
      }
      hostPeer.current.signal(signal);
    });

    // ──── FIX (mobile corruption): keep a LIVE channel; only rebuild a dead one ────
    socket.on('peer-reconnected', ({ isHost, socketId }) => {
      if (!isHost) return;
      hostSocketIdRef.current = socketId;

      const alive = hostPeer.current && !hostPeer.current.destroyed && hostPeer.current.connected;
      if (alive) return; // in-flight transfer keeps going

      toast.success('Host reconnected', { id: 'host-reconnected' });
      cleanupReceiveListener();
      if (hostPeer.current) {
        hostPeer.current.destroy();
        hostPeer.current = null;
      }
    });

    socket.on('file-offer', (incomingOffer) => {
      if (incomingOffer.offerId === lastOfferIdRef.current) return;
      lastOfferIdRef.current = incomingOffer.offerId;
      clearDownloadState();
      toast.success('The host wants to send you files', { id: 'file-offer-toast' });
      setOffer(incomingOffer);
    });

    socket.on('room-closed', ({ reason }) => {
      toast.error(reason === 'expired' ? 'Room expired' : 'The host ended the session', { id: 'room-closed' });
      clearDownloadState();
      navigate('/');
    });

    socket.on('connect_error', () => {
      toast.error('Could not reach the server', { id: 'connect-error' });
    });

    socket.on('disconnect', () => {
      console.log('[socket disconnect] will auto-recover…');
    });

    // ──── Respond implementation ────
    respondImplRef.current = async (accept, mode) => {
      const currentOffer = offerRef.current;
      if (!currentOffer) return;
      if (accept && isReceivingRef.current) {
        toast('Download already in progress', { icon: '⚠️', id: 'already-receiving' });
        return;
      }

      // ──── FIX (always-zip): more than one file → force a single .zip ────
      const effectiveMode = currentOffer.forceZip || (currentOffer.files?.length > 1)
        ? 'zip'
        : (mode || 'individual');

      let fileHandles = null;

      // Only the single-file path uses the native save picker.
      if (accept && effectiveMode === 'individual' && 'showSaveFilePicker' in window) {
        fileHandles = new Map();
        try {
          for (const f of currentOffer.files) {
            const handle = await window.showSaveFilePicker({ suggestedName: f.name });
            fileHandles.set(f.id, handle);
          }
        } catch (err) {
          if (err?.name === 'AbortError') {
            toast.error('No save location selected — download cancelled', { id: 'save-cancelled' });
            socket.emit('file-response', { accept: false, mode: effectiveMode, offerId: currentOffer.offerId });
            setOffer(null);
            lastOfferIdRef.current = null;
            return;
          }
          fileHandles = null; // fall back to blob download
        }
      }

      socket.emit('file-response', { accept, mode: effectiveMode, offerId: currentOffer.offerId });
      setOffer(null);
      lastOfferIdRef.current = null;
      if (!accept) return;

      isReceivingRef.current = true;
      transferDoneRef.current = false;
      setDownloadState('downloading');
      setProgress(0);
      hasReceivedData.current = false;

      if (hostPeer.current && !hostPeer.current.destroyed && hostPeer.current.connected) {
        startReceiveFiles(effectiveMode, fileHandles);
        return;
      }

      toast.error('Connection to host was lost — please wait for the host to re-send', { id: 'peer-dead' });
      isReceivingRef.current = false;
      setDownloadState('idle');
      setProgress(null);
    };

    return () => {
      socket.off('connect', tryRejoin);
      socket.off('peer-reconnected');
      socket.off('signal');
      socket.off('file-offer');
      socket.off('room-closed');
      socket.off('connect_error');
      socket.off('disconnect');
      unwireVisibility();
      if (downloadCallbacks.current?.stallTimer) {
        clearTimeout(downloadCallbacks.current.stallTimer);
      }
      cleanupReceiveListener();
      hostPeer.current?.destroy();
      respondImplRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const respond = async (accept, mode) => {
    if (respondImplRef.current) return respondImplRef.current(accept, mode);
    toast.error('Not connected yet — please wait', { id: 'not-ready' });
  };

  const leaveSession = () => {
    if (!socket.connected) {
      toast.error('No connection — please wait', { id: 'leave-blocked' });
      return;
    }
    // Clear identity so we don't auto-rejoin a room we intentionally left.
    sessionStorage.removeItem(`peerUserId:${roomId}`);
    socket.emit('leave-room');
    toast('You left the session', { icon: '👋', id: 'left-session' });
    navigate('/');
  };

  // Additive, logic-free convenience.
  const copyRoomId = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      toast.success('Room ID copied', { id: 'copy-room' });
    } catch {
      toast.error('Could not copy the room ID', { id: 'copy-fail' });
    }
  };

  const statusBadge = !socket.connected
    ? { cls: 'bg-error/10 text-error', dot: 'bg-error', label: 'Disconnected' }
    : isReconnecting
      ? { cls: 'bg-warning/10 text-warning', dot: 'bg-warning', label: 'Reconnecting' }
      : downloadState === 'downloading'
        ? { cls: 'bg-primary/10 text-primary', dot: 'bg-primary', label: 'Transferring' }
        : { cls: 'bg-success/10 text-success', dot: 'bg-success', label: 'Connected' };

  return (
    <div className="relative min-h-[calc(100vh-4rem)] max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 overflow-hidden">
      <style>{CSS}</style>

      {/* backdrop */}
      <div className="peerdrop-dotgrid pointer-events-none absolute inset-0 text-base-content/[0.06]" aria-hidden="true" />
      <div className="pd-float pointer-events-none absolute -top-20 left-[4%] h-72 w-72 rounded-full bg-primary/[0.07] blur-3xl" aria-hidden="true" />
      <div className="pd-float pointer-events-none absolute bottom-10 right-[2%] h-72 w-72 rounded-full bg-secondary/[0.06] blur-3xl" style={{ animationDelay: '-4.5s' }} aria-hidden="true" />

      <div className="relative">

        {/* ── Top Bar ── */}
        <div className="pd-rise relative mb-6 overflow-hidden rounded-2xl border border-base-300/60 bg-base-100/95 shadow-sm backdrop-blur-xl">
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[2px] overflow-hidden">
            <div className="pd-scan absolute inset-y-0 w-1/4 bg-gradient-to-r from-transparent via-primary/70 to-transparent" />
          </div>

          <div className="flex items-center gap-3 px-4 py-3.5 sm:px-6">
            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <Users size={18} className="text-primary" />
              <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-base-100 bg-success" />
              </span>
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold leading-tight">Joined Session</p>
                {isReconnecting ? (
                  <span className="badge badge-warning badge-sm gap-1 border-transparent bg-warning/10 text-warning">
                    <span className="loading loading-spinner loading-xs" /> Reconnecting…
                  </span>
                ) : (
                  <span className="badge badge-sm gap-1.5 border-transparent bg-success/10 text-success">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" /> Live
                  </span>
                )}
              </div>
              <p className="truncate font-mono text-xs text-base-content/40">{roomId}</p>
            </div>

            <div className="hidden shrink-0 sm:block">
              {expiresAt && <CountdownTimer expiresAt={expiresAt} onExpire={() => navigate('/')} />}
            </div>

            <button
              className="btn btn-ghost btn-sm gap-2 border border-base-300/60 text-error hover:bg-error/10 hover:text-error disabled:opacity-40"
              onClick={leaveSession}
              disabled={isReconnecting || !socket.connected}
              title="Disconnect and return home"
            >
              <LogOut size={15} />
              <span className="hidden sm:inline">Leave</span>
            </button>
          </div>
        </div>

        {/* Mobile Timer */}
        <div className="pd-rise mb-6 sm:hidden" style={{ animationDelay: '80ms' }}>
          {expiresAt && <CountdownTimer expiresAt={expiresAt} onExpire={() => navigate('/')} />}
        </div>

        {/* ── Bento Grid ── */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 lg:gap-5">

          {/* Main Status */}
          <div className="pd-rise md:col-span-8" style={{ animationDelay: '160ms' }}>
            <div
              className={`card relative h-full overflow-hidden border bg-base-100/95 shadow-sm backdrop-blur-sm transition-all duration-500 ${
                downloadState === 'downloading'
                  ? 'border-primary/40 shadow-lg shadow-primary/15'
                  : downloadState === 'complete'
                    ? 'border-success/40 shadow-lg shadow-success/10'
                    : 'border-base-300/60'
              }`}
            >
              {/* scanning light while a transfer is in flight */}
              {downloadState === 'downloading' && (
                <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[2px] overflow-hidden">
                  <div className="pd-scan absolute inset-y-0 w-1/4 bg-gradient-to-r from-transparent via-primary/80 to-transparent" />
                </div>
              )}

              <div className="card-body relative h-full gap-4 p-5">
                <CardHeader
                  icon={
                    downloadState === 'complete' ? CheckCircle2
                      : downloadState === 'downloading' ? ArrowDownToLine
                      : Wifi
                  }
                  tint={
                    downloadState === 'complete' ? 'bg-success/10 text-success'
                      : downloadState === 'downloading' ? 'bg-primary/10 text-primary'
                      : 'bg-base-200/70 text-base-content/30'
                  }
                  title={
                    downloadState === 'complete' ? 'Downloaded'
                      : downloadState === 'downloading' ? 'Receiving Files'
                      : 'Waiting for Host'
                  }
                  right={
                    downloadState === 'downloading' ? (
                      <span className="badge badge-sm border-transparent bg-primary/10 font-mono text-primary">
                        {Math.round((progress ?? 0) * 100)}%
                      </span>
                    ) : downloadState === 'complete' ? (
                      <span className="badge badge-sm gap-1 border-transparent bg-success/10 text-success">
                        <CheckCircle2 size={10} /> Saved
                      </span>
                    ) : undefined
                  }
                />

                {downloadState === 'downloading' && (
                  <>
                    <div className="py-2">
                      <TransferProgress label="Downloading" progress={progress ?? 0} />
                    </div>
                    <div className="mt-auto flex items-center justify-center gap-1.5 text-[11px] text-base-content/35">
                      <ShieldCheck size={12} className="text-success/70" />
                      Transferring directly from the host — keep this tab open
                    </div>
                  </>
                )}

                {downloadState === 'complete' && (
                  <div className="flex flex-1 flex-col items-center justify-center py-8 text-center">
                    <span className="relative flex h-20 w-20 items-center justify-center" aria-hidden="true">
                      <span className="absolute inset-0 animate-ping rounded-full bg-success/15" style={{ animationDuration: '2.4s' }} />
                      <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
                        <CheckCircle2 size={32} className="text-success" />
                      </span>
                    </span>
                    <p className="mt-5 text-lg font-semibold text-base-content/80">Files Downloaded</p>
                    <p className="mt-1.5 max-w-xs text-xs text-base-content/30">
                      The host can send more files — a new offer will appear automatically.
                    </p>
                  </div>
                )}

                {downloadState === 'idle' && (
                  <div className="flex flex-1 flex-col items-center justify-center py-8 text-center">
                    <WaitingRadar icon={Wifi} />
                    <p className="mt-4 text-sm font-medium text-base-content/50">Standing by</p>
                    <p className="mt-1 max-w-xs text-xs text-base-content/25">
                      The host will send a file offer once they are ready to share.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Side Panel */}
          <div className="md:col-span-4 flex flex-col gap-4 lg:gap-5">

            {/* Session info */}
            <div className="pd-rise" style={{ animationDelay: '240ms' }}>
              <div className={`${CARD} relative`}>
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-secondary/[0.07] via-transparent to-transparent" />
                <div className="card-body relative gap-4 p-5">
                  <CardHeader icon={Radio} tint="bg-secondary/10 text-secondary" title="Session" />

                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-base-content/40">Status</span>
                      <span className={`badge badge-sm gap-1.5 border-transparent font-medium ${statusBadge.cls}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${statusBadge.dot} ${socket.connected ? 'animate-pulse' : ''}`} />
                        {statusBadge.label}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-base-content/40">Role</span>
                      <span className="font-medium text-base-content/70">Receiver</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-base-content/40">Encryption</span>
                      <span className="flex items-center gap-1.5 font-medium text-base-content/70">
                        <ShieldCheck size={13} className="text-success/70" /> End-to-end
                      </span>
                    </div>
                    <div className="mt-1 border-t border-base-300/50 pt-3">
                      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-widest text-base-content/30">Room ID</p>
                      <div className="flex items-center gap-2">
                        <p className="min-w-0 flex-1 break-all font-mono text-sm font-semibold text-base-content/70">{roomId}</p>
                        <button
                          className="btn btn-ghost btn-xs shrink-0 text-base-content/40 hover:bg-base-200 hover:text-base-content/70"
                          onClick={copyRoomId}
                          aria-label="Copy room ID"
                        >
                          <Copy size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Leave */}
            <div className="pd-rise flex-1" style={{ animationDelay: '320ms' }}>
              <div className={`${CARD} relative`}>
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-error/[0.04] to-transparent" />
                <div className="card-body relative h-full justify-center gap-4 p-5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-error/10 text-error">
                      <LogOut size={16} />
                    </div>
                    <h2 className="text-sm font-semibold">Done here?</h2>
                  </div>
                  <p className="text-xs leading-relaxed text-base-content/40">
                    Safely disconnect from the host and return to the home screen.
                  </p>
                  <button
                    className="btn btn-error btn-outline w-full gap-2 transition-all duration-200 enabled:hover:-translate-y-0.5 disabled:opacity-40"
                    onClick={leaveSession}
                    disabled={isReconnecting || !socket.connected}
                  >
                    <LogOut size={16} />
                    Leave Session
                  </button>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>

      <FileOfferModal offer={offer} onRespond={respond} />
    </div>
  );
}