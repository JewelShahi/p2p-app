import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Users, LogOut } from 'lucide-react';
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

    setProgress(0);
    const stallTimer = setTimeout(() => {
      toast.error('Download stalled — connection may have dropped');
      setProgress(null);
    }, 15000);

    receiveFiles({
      peer: hostPeer.current,
      mode,
      fileHandles,
      onProgress: (p) => {
        clearTimeout(stallTimer);
        setProgress(p);
        if (p >= 1) {
          setTimeout(() => setProgress(null), 1000);
        }
      },
      onDone: () => {
        clearTimeout(stallTimer);
        toast.success('Download complete');
        setProgress(null);
      },
      onError: () => {
        clearTimeout(stallTimer);
        toast.error('Something interrupted the download');
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
    <div className="min-h-screen p-4 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold flex items-center gap-2"><Users size={20} /> In session</h1>
        {expiresAt && <CountdownTimer expiresAt={expiresAt} onExpire={() => navigate('/')} />}
      </div>

      <p className="text-sm opacity-70">Waiting for the host to share files...</p>

      {progress !== null && <TransferProgress label="Downloading" progress={progress} />}

      <button className="btn btn-outline btn-error w-full" onClick={leaveSession}>
        <LogOut size={16} /> Leave session
      </button>

      <FileOfferModal offer={offer} onRespond={respond} />
    </div>
  );
}