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

  useEffect(() => {
    if (!socket.connected) socket.connect();

    socket.emit('join-room', { roomId }, (res) => {
      if (!res?.ok) {
        toast.error(res?.error === 'room-not-found' ? 'That room does not exist' : 'That room has expired');
        navigate('/');
        return;
      }
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
          onFailed: (state) => toast.error(`Connection to host ${state} — likely blocked by your network (try a different network or a TURN server)`),
        });
        hostPeer.current.on('connect', () => toast.success('Direct connection established'));
        hostPeer.current.on('error', () => toast.error('Connection to host failed'));
      }
      hostPeer.current.signal(signal);
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
    socket.on('disconnect', () => toast.error('Disconnected from server'));

    return () => {
      socket.off('signal');
      socket.off('file-offer');
      socket.off('room-closed');
      socket.off('connect_error');
      socket.off('disconnect');
      hostPeer.current?.destroy();
    };
  }, [roomId, navigate]);

  const respond = async (accept, mode) => {
    let fileHandles = null;

    if (accept && mode === 'individual' && 'showSaveFilePicker' in window) {
      fileHandles = new Map();
      try {
        for (const f of offer.files) {
          const handle = await window.showSaveFilePicker({ suggestedName: f.name });
          fileHandles.set(f.id, handle);
        }
      } catch {
        toast.error('No save location selected — download cancelled');
        socket.emit('file-response', { accept: false, mode, offerId: offer.offerId });
        setOffer(null);
        return;
      }
    }

    socket.emit('file-response', { accept, mode, offerId: offer.offerId });
    setOffer(null);
    if (!accept || !hostPeer.current) return;

    setDownloadState('downloading');
    setProgress(0);

    const stallTimer = setTimeout(() => {
      toast.error('Download stalled — connection may have dropped');
      setDownloadState('idle');
      setProgress(null);
    }, 15000);

    receiveFiles({
      peer: hostPeer.current,
      mode,
      fileHandles,
      onProgress: (p) => {
        clearTimeout(stallTimer);
        setProgress(Math.min(p, 1));
      },
      onDone: () => {
        clearTimeout(stallTimer);
        setProgress(1);
        setDownloadState('complete');
        toast.success('Download complete');
      },
      onError: () => {
        clearTimeout(stallTimer);
        toast.error('Something interrupted the download');
        setDownloadState('idle');
        setProgress(null);
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
                    ? 'Download Complete' 
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
                    <CheckCircle2 size={10} /> Done
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
                    <div className="absolute -inset-2 rounded-full border-2 border-success/20 animate-ping" />
                  </div>
                  <p className="text-lg font-semibold text-base-content/80">All files saved</p>
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