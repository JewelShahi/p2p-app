import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Share2, Magnet, Zap, Clock, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';
import socket from '../api/socket';
import DurationSelector from '../components/DurationSelector';

export default function Home() {
  const navigate = useNavigate();
  const [duration, setDuration] = useState(20);
  const [magnet, setMagnet] = useState('');
  const [creating, setCreating] = useState(false);

  const createSession = () => {
    setCreating(true);
    if (!socket.connected) socket.connect();
    socket.emit('create-room', { durationMinutes: duration }, (res) => {
      setCreating(false);
      if (!res?.ok) {
        toast.error('Could not create session');
        return;
      }
      toast.success('Session created');
      navigate(`/host/${res.roomId}`, { state: res });
    });
  };

  const openMagnet = () => {
    if (!magnet.startsWith('magnet:')) {
      toast.error('That does not look like a valid magnet link');
      return;
    }
    navigate('/torrent', { state: { magnet } });
  };

  return (
    <div className="min-h-screen flex flex-col">

      {/* ── Header ── */}
      <header className="w-full px-5 sm:px-8 py-5 flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center text-primary-content">
          <Zap size={18} strokeWidth={2.5} />
        </div>
        <span className="text-lg font-bold tracking-tight">PeerDrop</span>
      </header>

      {/* ── Main content ── */}
      <main className="flex-1 flex items-center justify-center px-4 sm:px-6 pb-12">
        <div className="w-full max-w-4xl">

          {/* Hero text */}
          <div className="text-center mb-8 sm:mb-10">
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight leading-tight">
              Share files, <span className="text-primary">peer to peer</span>
            </h1>
            <p className="mt-2 sm:mt-3 text-sm sm:text-base opacity-60 max-w-md mx-auto">
              Create a room or fetch a torrent — no sign‑up, no uploads to a server.
            </p>
          </div>

          {/* Cards grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">

            {/* ── P2P Card ── */}
            <div className="group card bg-base-200 shadow-lg hover:shadow-xl transition-shadow duration-300 border border-base-300/50">
              <div className="card-body p-5 sm:p-6 gap-4">

                {/* Icon + title row */}
                <div className="flex items-start gap-3">
                  <div className="shrink-0 w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center
                                  group-hover:bg-primary group-hover:text-primary-content transition-colors duration-300">
                    <Share2 size={20} />
                  </div>
                  <div className="min-w-0">
                    <h2 className="card-title text-base sm:text-lg leading-snug">Share files P2P</h2>
                    <p className="text-xs sm:text-sm opacity-60 mt-0.5 leading-relaxed">
                      Create a session, share the link, send files directly.
                    </p>
                  </div>
                </div>

                {/* Duration selector */}
                <div className="space-y-1.5">
                  <label className="label text-xs font-medium gap-1.5 py-0">
                    <Clock size={13} className="opacity-50" />
                    Room stays open for
                  </label>
                  <DurationSelector value={duration} onChange={setDuration} />
                </div>

                {/* Action */}
                <button
                  className="btn btn-primary w-full mt-1 gap-2"
                  onClick={createSession}
                  disabled={creating}
                >
                  {creating
                    ? <span className="loading loading-spinner loading-sm" />
                    : 'Start session'}
                  {!creating && <ArrowRight size={16} className="ml-auto opacity-70" />}
                </button>
              </div>
            </div>

            {/* ── Torrent Card ── */}
            <div className="group card bg-base-200 shadow-lg hover:shadow-xl transition-shadow duration-300 border border-base-300/50">
              <div className="card-body p-5 sm:p-6 gap-4">

                {/* Icon + title row */}
                <div className="flex items-start gap-3">
                  <div className="shrink-0 w-11 h-11 rounded-xl bg-secondary/10 text-secondary flex items-center justify-center
                                  group-hover:bg-secondary group-hover:text-secondary-content transition-colors duration-300">
                    <Magnet size={20} />
                  </div>
                  <div className="min-w-0">
                    <h2 className="card-title text-base sm:text-lg leading-snug">Download a torrent</h2>
                    <p className="text-xs sm:text-sm opacity-60 mt-0.5 leading-relaxed">
                      Paste a magnet link to fetch it through the server.
                    </p>
                  </div>
                </div>

                {/* Input */}
                <div className="space-y-1.5">
                  <label className="label text-xs font-medium py-0">Magnet link</label>
                  <textarea
                    className="textarea textarea-bordered w-full text-sm leading-relaxed resize-none"
                    rows={2}
                    placeholder="magnet:?xt=urn:btih:..."
                    value={magnet}
                    onChange={(e) => setMagnet(e.target.value)}
                  />
                </div>

                {/* Action */}
                <button
                  className="btn btn-secondary w-full mt-1 gap-2"
                  onClick={openMagnet}
                  disabled={!magnet.trim()}
                >
                  Fetch info
                  <ArrowRight size={16} className="ml-auto opacity-70" />
                </button>
              </div>
            </div>

          </div>

          {/* Footer hint */}
          <p className="text-center text-xs opacity-40 mt-6 sm:mt-8">
            All transfers are end‑to‑end encrypted. Nothing is stored.
          </p>
        </div>
      </main>
    </div>
  );
}