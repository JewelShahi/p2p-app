// JoinRoom.jsx
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
  const [downloadState, setDownloadState] = useState('idle');
  const [isReconnecting, setIsReconnecting] = useState(false);

  const hostPeer = useRef(null);
  const hostRetryCount = useRef(0);
  const downloadCallbacks = useRef(null);
  const hasReceivedData = useRef(false);
  const isReceivingRef = useRef(false);
  const waitingForPeerRef = useRef(false);
  const pendingDownloadConfig = useRef(null);
  const lastOfferIdRef = useRef(null);

  const downloadStateRef = useRef('idle');
  useEffect(() => { downloadStateRef.current = downloadState; }, [downloadState]);

  // Keep offer in a ref so the effect-internal respond implementation
  // always reads the current value, not a stale closure capture.
  const offerRef = useRef(null);
  useEffect(() => { offerRef.current = offer; }, [offer]);

  const myUserId = useRef(sessionStorage.getItem(`peerUserId:${roomId}`) || null);
  const hasJoinedOnce = useRef(false);

  // Ref that holds the actual respond logic — populated inside useEffect
  // so it has direct access to startReceiveFiles without going through
  // another ref indirection that can be null at the wrong time.
  const respondImplRef = useRef(null);

  useEffect(() => {
    const clearDownloadState = () => {
      if (downloadCallbacks.current?.stallTimer) {
        clearTimeout(downloadCallbacks.current.stallTimer);
        downloadCallbacks.current = null;
      }
      setDownloadState('idle');
      setProgress(null);
      hasReceivedData.current = false;
      isReceivingRef.current = false;
      waitingForPeerRef.current = false;
      pendingDownloadConfig.current = null;
    };

    const handleDownloadComplete = () => {
      if (downloadCallbacks.current?.stallTimer) {
        clearTimeout(downloadCallbacks.current.stallTimer);
        downloadCallbacks.current = null;
      }
      setProgress(1);
      setDownloadState('complete');
      hasReceivedData.current = false;
      isReceivingRef.current = false;

      // Destroy peer after each download so the next batch gets a fresh
      // connection — prevents stale data channel listeners from stacking
      // and causing the doubled-toast bug on the 2nd/3rd batch.
      if (hostPeer.current) {
        const oldPeer = hostPeer.current;
        hostPeer.current = null;
        oldPeer.destroy();
      }
    };

    const startReceiveFiles = (mode, fileHandles) => {
      if (!hostPeer.current) {
        console.error('[startReceiveFiles] no peer — should not happen on direct path');
        clearDownloadState();
        toast.error('Connection lost unexpectedly', { id: 'no-peer-receive' });
        return;
      }

      const stallTimer = setTimeout(() => {
        if (!hasReceivedData.current) {
          toast.error('Download stalled — connection may have dropped', { id: 'download-stalled' });
          clearDownloadState();
        } else {
          handleDownloadComplete();
        }
      }, 30000);

      downloadCallbacks.current = { stallTimer };

      console.log('[startReceiveFiles] calling receiveFiles, peer.connected =', hostPeer.current.connected);

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
          if (p >= 1) handleDownloadComplete();
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
          isReceivingRef.current = false;
          waitingForPeerRef.current = false;
          if (hasReceivedData.current) {
            handleDownloadComplete();
            toast.success('Files received', { id: 'files-received-fallback' });
          } else {
            toast.error('Something interrupted the download', { id: 'download-error' });
            setDownloadState('idle');
            setProgress(null);
          }
        },
      });
    };

    // ──── REJOIN ────
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

    if (socket.connected) {
      tryRejoin();
    } else {
      socket.connect();
    }

    // ──── Initial join ────
    socket.emit('join-room', { roomId }, (res) => {
      if (!res?.ok) {
        toast.error(res?.error === 'room-not-found' ? 'That room does not exist' : 'That room has expired', { id: 'join-fail' });
        navigate('/');
        return;
      }
      myUserId.current = res.userId;
      sessionStorage.setItem(`peerUserId:${roomId}`, res.userId);
      setExpiresAt(res.expiresAt);
      if (res.currentOffer) {
        setOffer(res.currentOffer);
        lastOfferIdRef.current = res.currentOffer.offerId;
      }
      toast.success('Joined session', { id: 'join-success' });
    });

    // ──── WebRTC signaling ────
    socket.on('signal', ({ fromSocketId, signal }) => {
      // If signal comes from a different socketId than our current peer,
      // the host reconnected. Destroy old peer so we create a fresh one.
      if (hostPeer.current && hostPeer.current._options?.targetSocketId !== fromSocketId) {
        console.log('[signal] from new socketId', fromSocketId, '— destroying old peer');
        hostPeer.current.destroy();
        hostPeer.current = null;
      }

      if (!hostPeer.current) {
        hostPeer.current = createPeerConnection({
          initiator: false,
          socket,
          targetSocketId: fromSocketId,
          onFailed: (failState) => {
            console.error('[peer onFailed]', failState);
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

          // If we accepted a file offer and are waiting for a fresh peer
          // connection (because we destroyed the old one after the previous
          // download), now's the time to start receiving.
          if (waitingForPeerRef.current && pendingDownloadConfig.current) {
            waitingForPeerRef.current = false;
            const { mode, fileHandles } = pendingDownloadConfig.current;
            pendingDownloadConfig.current = null;
            startReceiveFiles(mode, fileHandles);
          }
        });

        hostPeer.current.on('error', (err) => {
          console.error('[peer error]', err);
          toast.error('Connection to host failed', { id: 'peer-error' });
        });

        hostPeer.current.on('iceStateChange', (iceState) => {
          console.log('[ICE state]', iceState);
        });

        hostPeer.current.on('close', () => {
          console.log('[peer close]', {
            downloadState: downloadStateRef.current,
            hasReceivedData: hasReceivedData.current,
            waitingForPeer: waitingForPeerRef.current,
          });
          if (downloadStateRef.current === 'downloading' && hasReceivedData.current) {
            handleDownloadComplete();
          }
          hostPeer.current = null;
        });
      }
      hostPeer.current.signal(signal);
    });

    socket.on('peer-reconnected', ({ isHost }) => {
      if (!isHost) return;
      toast.success('Host reconnected', { id: 'host-reconnected' });
      if (hostPeer.current) {
        hostPeer.current.destroy();
        hostPeer.current = null;
      }
    });

    socket.on('file-offer', (incomingOffer) => {
      if (incomingOffer.offerId === lastOfferIdRef.current) return;
      lastOfferIdRef.current = incomingOffer.offerId;

      // Full reset for a fresh offer — clears leftover state from any
      // previous download so the new one starts clean.
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
      console.log('[socket disconnect] connection dropped, will auto-recover…');
    });

    // ──── Store the respond implementation INSIDE the effect ────
    // This is the key structural fix: respond needs direct access to
    // startReceiveFiles (which is also in this effect). Using a ref
    // indirection (respondRef.current?.startReceiveFiles) was fragile
    // and could be null at the exact moment the user clicked download.
    respondImplRef.current = async (accept, mode) => {
      const currentOffer = offerRef.current;
      if (!currentOffer) return;

      if (accept && isReceivingRef.current) {
        toast('Download already in progress', { icon: '⚠️', id: 'already-receiving' });
        return;
      }

      let fileHandles = null;

      if (accept && mode === 'individual' && 'showSaveFilePicker' in window) {
        fileHandles = new Map();
        try {
          for (const f of currentOffer.files) {
            const handle = await window.showSaveFilePicker({ suggestedName: f.name });
            fileHandles.set(f.id, handle);
          }
        } catch (err) {
          if (err?.name === 'AbortError') {
            toast.error('No save location selected — download cancelled', { id: 'save-cancelled' });
            socket.emit('file-response', { accept: false, mode, offerId: currentOffer.offerId });
            setOffer(null);
            lastOfferIdRef.current = null;
            return;
          }
          console.warn('[respond] showSaveFilePicker unavailable, falling back to blob download', err);
          fileHandles = null;
        }
      }

      socket.emit('file-response', { accept, mode, offerId: currentOffer.offerId });
      setOffer(null);
      lastOfferIdRef.current = null;

      if (!accept) return;

      isReceivingRef.current = true;
      setDownloadState('downloading');
      setProgress(0);
      hasReceivedData.current = false;

      // ──── THE CRITICAL FIX ────
      // Use simple-peer's PUBLIC `connected` property (a getter that
      // internally checks both the RTCPeerConnection state AND the data
      // channel readyState). The previous code reached into the private
      // `_channel` property which either doesn't exist in some versions
      // or returns unexpected values, causing this check to ALWAYS fail.
      // That made every download — even the first one — fall into the
      // "wait for peer" path and hit the 30-second timeout error.
      if (hostPeer.current && !hostPeer.current.destroyed && hostPeer.current.connected) {
        console.log('[respond] peer is ready — receiving directly');
        startReceiveFiles(mode, fileHandles);
        return;
      }

      // Peer doesn't exist (we destroyed it after the previous download)
      // or isn't connected yet. Store the config and wait for the host
      // to re-initiate signaling — the peer's 'connect' handler above
      // will pick up pendingDownloadConfig and call startReceiveFiles.
      console.log('[respond] peer NOT ready — waiting for host to re-initiate', {
        exists: !!hostPeer.current,
        destroyed: hostPeer.current?.destroyed,
        connected: hostPeer.current?.connected,
      });
      waitingForPeerRef.current = true;
      pendingDownloadConfig.current = { mode, fileHandles };

      const stallTimer = setTimeout(() => {
        if (waitingForPeerRef.current) {
          console.error('[respond] timed out waiting for peer connection');
          toast.error('Connection to host lost — the host may need to re-send the files', { id: 'peer-timeout' });
          isReceivingRef.current = false;
          waitingForPeerRef.current = false;
          pendingDownloadConfig.current = null;
          setDownloadState('idle');
          setProgress(null);
        }
      }, 30000);
      downloadCallbacks.current = { stallTimer };
    };

    return () => {
      socket.off('connect', tryRejoin);
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
      respondImplRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // Public respond function — thin wrapper that delegates to the
  // implementation stored inside the effect. This is what FileOfferModal
  // calls when the user clicks Download or Decline.
  const respond = async (accept, mode) => {
    if (respondImplRef.current) {
      return respondImplRef.current(accept, mode);
    }
    toast.error('Not connected yet — please wait', { id: 'not-ready' });
  };

  const leaveSession = () => {
    if (!socket.connected) {
      toast.error('No connection — please wait', { id: 'leave-blocked' });
      return;
    }
    socket.emit('leave-room');
    toast('You left the session', { icon: '👋', id: 'left-session' });
    navigate('/');
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">

      {/* Top Bar */}
      <div className="navbar bg-base-100 rounded-2xl shadow-sm border border-base-300/50 px-4 sm:px-6 mb-6">
        <div className="flex-1 gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Users size={18} className="text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">Joined Session</p>
            <p className="text-xs text-base-content/40 font-mono">{roomId}</p>
          </div>
          {isReconnecting && (
            <span className="badge badge-warning badge-sm gap-1">
              <span className="loading loading-spinner loading-xs" /> Reconnecting…
            </span>
          )}
        </div>

        <div className="flex-none hidden sm:flex">
          {expiresAt && <CountdownTimer expiresAt={expiresAt} onExpire={() => navigate('/')} />}
        </div>

        <div className="flex-none ml-4">
          <button
            className="btn btn-ghost btn-sm gap-2 text-error hover:bg-error/10 hover:text-error disabled:opacity-40"
            onClick={leaveSession}
            disabled={isReconnecting || !socket.connected}
          >
            <LogOut size={15} />
            <span className="hidden sm:inline">Leave</span>
          </button>
        </div>
      </div>

      {/* Mobile Timer */}
      <div className="sm:hidden mb-6">
        {expiresAt && <CountdownTimer expiresAt={expiresAt} onExpire={() => navigate('/')} />}
      </div>

      {/* Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 lg:gap-5">

        {/* Main Status */}
        <div className="md:col-span-8">
          <div className="card bg-base-100 shadow-sm border border-base-300/50 h-full">
            <div className="card-body p-5 gap-4">
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors duration-300 ${
                  downloadState === 'complete' ? 'bg-success/10'
                    : downloadState === 'downloading' ? 'bg-primary/10'
                    : 'bg-base-200/70'
                }`}>
                  {downloadState === 'complete' ? <CheckCircle2 size={16} className="text-success" />
                    : downloadState === 'downloading' ? <ArrowDownToLine size={16} className="text-primary" />
                    : <Wifi size={16} className="text-base-content/30" />}
                </div>
                <h2 className="card-title text-sm font-semibold">
                  {downloadState === 'complete' ? 'Downloaded'
                    : downloadState === 'downloading' ? 'Receiving Files'
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
                    The host can send more files — a new offer will appear automatically.
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

        {/* Side Panel */}
        <div className="md:col-span-4 flex flex-col gap-4 lg:gap-5">

          {/* Session Info */}
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
                    !socket.connected ? 'badge-error'
                      : isReconnecting ? 'badge-warning'
                      : downloadState === 'downloading' ? 'badge-primary'
                      : 'badge-success'
                  }`}>
                    {!socket.connected ? 'Disconnected'
                      : isReconnecting ? 'Reconnecting'
                      : downloadState === 'downloading' ? 'Transferring'
                      : 'Connected'}
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

          {/* Leave */}
          <div className="card bg-base-100 shadow-sm border border-base-300/50 flex-1">
            <div className="card-body p-5 justify-center gap-4">
              <div>
                <h2 className="text-sm font-semibold mb-1">Done here?</h2>
                <p className="text-xs text-base-content/40 leading-relaxed">
                  Safely disconnect from the host and return to the home screen.
                </p>
              </div>
              <button
                className="btn btn-error btn-outline w-full gap-2 disabled:opacity-40"
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

      <FileOfferModal offer={offer} onRespond={respond} />
    </div>
  );
}