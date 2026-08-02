import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Users, LogOut, Wifi, Clock, ArrowDownToLine, CheckCircle2 } from 'lucide-react';
import socket from '../api/socket';
import CountdownTimer from '../components/CountdownTimer';
import FileOfferModal from '../components/FileOfferModal';
import TransferProgress from '../components/TransferProgress';
import { createPeerConnection, receiveFiles } from '../utils/peerTransfer';

export default function JoinRoom() {
  const { roomId } = useParams();
  const navigate = useNavigate();

  const [expiresAt, setExpiresAt] = useState(null);
  const [offer, setOffer] = useState(null);
  const [progress, setProgress] = useState(null);
  const [downloadState, setDownloadState] = useState('idle'); // idle | downloading | complete
  const hostPeer = useRef(null);
  const downloadCallbacks = useRef(null);
  const hasReceivedData = useRef(false);

  // Keep a ref in sync with downloadState so event handlers created earlier
  // (e.g. the peer 'close' listener) always read the CURRENT value instead
  // of a stale value captured when the closure was first created.
  const downloadStateRef = useRef('idle');
  useEffect(() => {
    downloadStateRef.current = downloadState;
  }, [downloadState]);

  // Stable identity used to resume the SAME room after a socket drop
  // (backgrounded tab, phone lock, brief network blip) instead of being
  // treated as a brand new join. Filled in once join-room's ack returns.
  const myUserId = useRef(sessionStorage.getItem(`peerUserId:${roomId}`) || null);
  const hasConnectedOnce = useRef(false);

  useEffect(() => {
    if (!socket.connected) socket.connect();

    // Fires on the FIRST connection too, not just reconnects — only act on
    // subsequent ones (socket.io auto-reconnects after a drop, e.g. briefly
    // backgrounding the app to share the link).
    const handleConnect = () => {
      if (!hasConnectedOnce.current) {
        hasConnectedOnce.current = true;
        return;
      }
      if (!myUserId.current) return; // can't resume without our stable id

      socket.emit('rejoin-room', { roomId, userId: myUserId.current }, (res) => {
        if (!res?.ok) {
          toast.error(res?.error === 'room-not-found' ? 'That room no longer exists' : 'Could not resume the session');
          navigate('/');
          return;
        }
        toast.success('Back online');
        if (res.currentOffer) setOffer(res.currentOffer);
        if (res.expiresAt) setExpiresAt(res.expiresAt);
      });
    };
    socket.on('connect', handleConnect);

    socket.emit('join-room', { roomId }, (res) => {
      if (!res?.ok) {
        toast.error(res?.error === 'room-not-found' ? 'That room does not exist' : 'That room has expired');
        navigate('/');
        return;
      }
      myUserId.current = res.userId;
      sessionStorage.setItem(`peerUserId:${roomId}`, res.userId);
      setExpiresAt(res.expiresAt);
      if (res.currentOffer) setOffer(res.currentOffer);
      toast.success('Joined session');
    });

    socket.on('signal', ({ fromSocketId, signal }) => {
      if (!hostPeer.current) {
        hostPeer.current = createPeerConnection({
          initiator: false,
          socket,
          targetSocketId: fromSocketId,
          onFailed: (state) => {
            console.error('[peer onFailed - JoinRoom]', state);
            toast.error(`Connection to host ${state} — likely blocked by your network (try a different network or a TURN server)`);
          },
        });

        hostPeer.current.on('connect', () => toast.success('Direct connection established'));

        hostPeer.current.on('error', (err) => {
          console.error('[peer error - JoinRoom]', err);
          toast.error('Connection to host failed');
        });

        hostPeer.current.on('iceStateChange', (state) => {
          console.log('[ICE state - JoinRoom]', state);
        });

        // Fallback: If peer closes during download, mark as complete.
        // Uses downloadStateRef (not the closed-over downloadState) so this
        // always checks the CURRENT state, not the state at connection time.
        hostPeer.current.on('close', () => {
          console.log('[peer close - JoinRoom]', {
            downloadState: downloadStateRef.current,
            hasReceivedData: hasReceivedData.current,
          });
          if (downloadStateRef.current === 'downloading' || hasReceivedData.current) {
            handleDownloadComplete();
          }
        });
      }
      hostPeer.current.signal(signal);
    });

    socket.on('peer-reconnected', ({ isHost }) => {
      if (!isHost) return; // only the host reconnecting matters on this side
      toast.success('Host reconnected');
      if (hostPeer.current) {
        // The old connection is almost certainly dead after the host's
        // socket dropped and came back under a new id. Destroy it and null
        // it out so the next 'signal' event (which the host will send once
        // it re-initiates) builds a fresh peer connection instead of trying
        // to feed a new handshake into a stale, likely-closed one.
        hostPeer.current.destroy();
        hostPeer.current = null;
      }
    });

    socket.on('file-offer', (incomingOffer) => {
      toast.success('The host wants to send you files');
      setOffer(incomingOffer);
    });

    socket.on('room-closed', ({ reason }) => {
      toast.error(reason === 'expired' ? 'Room expired' : 'The host ended the session');
      navigate('/');
    });

    socket.on('connect_error', () => toast.error('Could not reach the server'));
    socket.on('disconnect', () => {
      console.log('[socket disconnect - JoinRoom] connection dropped, attempting to recover...');
    });

    return () => {
      socket.off('connect', handleConnect);
      socket.off('peer-reconnected');
      socket.off('signal');
      socket.off('file-offer');
      socket.off('room-closed');
      socket.off('connect_error');
      socket.off('disconnect');
      if (downloadCallbacks.current?.stallTimer) {
        clearTimeout(downloadCallbacks.current.stallTimer);
      }
      hostPeer.current?.destroy();
    };
    // IMPORTANT: only depend on roomId. Including `navigate` here was
    // causing this effect to re-run whenever the navigate function's
    // reference changed, which destroyed the peer connection right after
    // it connected — that's what caused "User-Initiated Abort, reason=Close
    // called" immediately after a successful connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const handleDownloadComplete = () => {
    if (downloadCallbacks.current?.stallTimer) {
      clearTimeout(downloadCallbacks.current.stallTimer);
      downloadCallbacks.current.stallTimer = null;
    }
    setProgress(1);
    setDownloadState('complete');
    hasReceivedData.current = false;
  };

  const respond = async (accept, mode) => {
    let fileHandles = null;

    if (accept && mode === 'individual' && 'showSaveFilePicker' in window) {
      fileHandles = new Map();
      try {
        for (const f of offer.files) {
          const handle = await window.showSaveFilePicker({ suggestedName: f.name });
          fileHandles.set(f.id, handle);
        }
      } catch (err) {
        // Only a genuine user-initiated cancel (AbortError) should actually
        // cancel the transfer. Any other failure here — the API being
        // unsupported, or (very common on mobile) losing "trusted" user
        // activation after the screen locked / tab went idle — should NOT
        // kill the download. Instead, fall back to the in-memory Blob +
        // <a download> path that receiveFiles() already supports when no
        // file handle is provided.
        if (err?.name === 'AbortError') {
          toast.error('No save location selected — download cancelled');
          socket.emit('file-response', { accept: false, mode, offerId: offer.offerId });
          setOffer(null);
          return;
        }
        console.warn('[respond] showSaveFilePicker unavailable/failed, falling back to blob download', err);
        fileHandles = null;
      }
    }

    socket.emit('file-response', { accept, mode, offerId: offer.offerId });
    setOffer(null);
    if (!accept || !hostPeer.current) return;

    setDownloadState('downloading');
    setProgress(0);
    hasReceivedData.current = false;

    const stallTimer = setTimeout(() => {
      if (!hasReceivedData.current) {
        console.error('[download stalled - JoinRoom] no data received within 30s');
        toast.error('Download stalled — connection may have dropped');
        setDownloadState('idle');
        setProgress(null);
      } else {
        handleDownloadComplete();
      }
    }, 30000);

    downloadCallbacks.current = { stallTimer };

    console.log('[respond] about to call receiveFiles, peer.connected =', hostPeer.current.connected, 'peer._channel exists =', !!hostPeer.current._channel);
    receiveFiles({
      peer: hostPeer.current,
      mode,
      fileHandles,
      onProgress: (p) => {
        hasReceivedData.current = true;
        if (stallTimer) clearTimeout(stallTimer);
        downloadCallbacks.current.stallTimer = null;

        setProgress(Math.min(Math.max(p, 0), 1));

        if (p >= 1) {
          handleDownloadComplete();
        }
      },
      onDone: () => {
        handleDownloadComplete();
        toast.success('Download complete');
      },
      onError: (err) => {
        console.error('[receiveFiles onError - JoinRoom]', err);
        if (downloadStateRef.current === 'complete') return; // already finished successfully — a later peer close/error is expected, not a failure
        if (downloadCallbacks.current?.stallTimer) {
          clearTimeout(downloadCallbacks.current.stallTimer);
          downloadCallbacks.current.stallTimer = null;
        }
        if (hasReceivedData.current) {
          handleDownloadComplete();
          toast.success('Files received');
        } else {
          toast.error('Something interrupted the download');
          setDownloadState('idle');
          setProgress(null);
        }
      },
    });
  };

  const leaveSession = () => {
    socket.emit('leave-room');
    toast('You left the session', { icon: '👋' });
    navigate('/');
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">

      {/* ── Top Bar ── */}
      <div className="navbar bg-base-100 rounded-2xl shadow-sm border border-base-300/50 px-4 sm:px-6 mb-6">
        <div className="flex-1 gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Users size={18} className="text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">Joined Session</p>
            <p className="text-xs text-base-content/40 font-mono">{roomId}</p>
          </div>
        </div>

        <div className="flex-none hidden sm:flex">
          {expiresAt && <CountdownTimer expiresAt={expiresAt} onExpire={() => navigate('/')} />}
        </div>

        <div className="flex-none ml-4">
          <button
            className="btn btn-ghost btn-sm gap-2 text-error hover:bg-error/10 hover:text-error"
            onClick={leaveSession}
          >
            <LogOut size={15} />
            <span className="hidden sm:inline">Leave</span>
          </button>
        </div>
      </div>

      {/* ── Mobile Timer ── */}
      <div className="sm:hidden mb-6">
        {expiresAt && <CountdownTimer expiresAt={expiresAt} onExpire={() => navigate('/')} />}
      </div>

      {/* ── Bento Grid Layout ── */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 lg:gap-5">

        {/* ── Main Status Area (Left / Large) ── */}
        <div className="md:col-span-8">
          <div className="card bg-base-100 shadow-sm border border-base-300/50 h-full">
            <div className="card-body p-5 gap-4">
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors duration-300 ${
                  downloadState === 'complete'
                    ? 'bg-success/10'
                    : downloadState === 'downloading'
                      ? 'bg-primary/10'
                      : 'bg-base-200/70'
                }`}>
                  {downloadState === 'complete' ? (
                    <CheckCircle2 size={16} className="text-success" />
                  ) : downloadState === 'downloading' ? (
                    <ArrowDownToLine size={16} className="text-primary" />
                  ) : (
                    <Wifi size={16} className="text-base-content/30" />
                  )}
                </div>
                <h2 className="card-title text-sm font-semibold">
                  {downloadState === 'complete'
                    ? 'Downloaded'
                    : downloadState === 'downloading'
                      ? 'Receiving Files'
                      : 'Waiting for Host'}
                </h2>
                {downloadState === 'downloading' && (
                  <span className="badge badge-primary badge-sm font-mono ml-auto">
                    {Math.round((progress ?? 0) * 100)}%
                  </span>
                )}
                {downloadState === 'complete' && (
                  <span className="badge badge-success badge-sm gap-1 ml-auto">
                    <CheckCircle2 size={10} /> Saved
                  </span>
                )}
              </div>

              {downloadState === 'downloading' && (
                <div className="py-2">
                  <TransferProgress label="Downloading" progress={progress ?? 0} />
                </div>
              )}

              {downloadState === 'complete' && (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <div className="relative mb-5">
                    <div className="w-20 h-20 rounded-full bg-success/10 flex items-center justify-center">
                      <CheckCircle2 size={36} className="text-success" />
                    </div>
                  </div>
                  <p className="text-lg font-semibold text-base-content/80">Files Downloaded</p>
                  <p className="text-xs text-base-content/30 mt-1.5 max-w-xs">
                    The host can send more files if needed — this card will update automatically.
                  </p>
                </div>
              )}

              {downloadState === 'idle' && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-base-200/70 flex items-center justify-center mb-4">
                    <Clock size={28} className="text-base-content/20" />
                  </div>
                  <p className="text-sm font-medium text-base-content/50">Stand by</p>
                  <p className="text-xs text-base-content/25 mt-1 max-w-xs">
                    The host will send a file offer once they are ready to share.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Side Panel (Right / Small) ── */}
        <div className="md:col-span-4 flex flex-col gap-4 lg:gap-5">

          {/* Session Info Card */}
          <div className="card bg-base-100 shadow-sm border border-base-300/50">
            <div className="card-body p-5 gap-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-secondary/10 flex items-center justify-center">
                  <Wifi size={16} className="text-secondary" />
                </div>
                <h2 className="card-title text-sm font-semibold">Session</h2>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-base-content/40">Status</span>
                  <span className={`badge badge-sm gap-1 ${
                    downloadState === 'downloading'
                      ? 'badge-primary'
                      : downloadState === 'complete'
                        ? 'badge-success'
                        : 'badge-success'
                  }`}>
                    {downloadState === 'downloading' ? 'Transferring' : 'Connected'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-base-content/40">Role</span>
                  <span className="text-base-content/70 font-medium">Receiver</span>
                </div>
                <div className="pt-2 mt-2 border-t border-base-300/50">
                  <p className="text-[11px] text-base-content/30 uppercase tracking-widest font-medium mb-1">Room ID</p>
                  <p className="text-sm font-mono font-semibold text-base-content/70 break-all">{roomId}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Leave Action Card */}
          <div className="card bg-base-100 shadow-sm border border-base-300/50 flex-1">
            <div className="card-body p-5 justify-center gap-4">
              <div>
                <h2 className="text-sm font-semibold mb-1">Done here?</h2>
                <p className="text-xs text-base-content/40 leading-relaxed">
                  Safely disconnect from the host and return to the home screen.
                </p>
              </div>
              <button
                className="btn btn-error btn-outline w-full gap-2"
                onClick={leaveSession}
              >
                <LogOut size={16} />
                Leave Session
              </button>
            </div>
          </div>

        </div>
      </div>

      {/* ── Modal Trigger (Rendered outside grid) ── */}
      <FileOfferModal offer={offer} onRespond={respond} />

    </div>
  );
}