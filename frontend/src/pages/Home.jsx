import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Share2, Magnet, Zap, Clock, ArrowRight, Shield, Globe } from 'lucide-react';
import toast from 'react-hot-toast';
import socket from '../api/socket';
import DurationSelector from '../components/DurationSelector';
import peerdropIcon from "../assets/peerdrop-icon.png";

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
    <div data-theme="dark" className="min-h-screen flex flex-col bg-base-300 relative overflow-hidden">

      {/* ── Header ── */}
      <header className="relative z-10 w-full px-6 sm:px-8 py-5 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-base-100 border border-base-content/10 flex items-center justify-center">
          <img src={peerdropIcon} alt="peerdrop-icon" width={28} />
        </div>
        <span className="text-[15px] font-semibold tracking-tight text-base-content/90">PeerDrop</span>
        <div className="ml-auto flex items-center gap-1.5">
          <Shield size={12} className="text-primary/50" />
          <span className="text-[11px] text-base-content/30 font-medium tracking-wide uppercase">E2E Encrypted</span>
        </div>
      </header>

      {/* ── Main content ── */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 sm:px-6 pb-16">
        <div className="w-full max-w-5xl">

          {/* Hero text */}
          <div className="text-center mb-10 sm:mb-14">
            <div className="badge badge-ghost badge-sm gap-1.5 mb-5 sm:mb-6 bg-base-100 border border-base-content/10 text-base-content/50 font-medium">
              <Zap size={11} className="text-primary" />
              No sign-up required
            </div>

            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-[3.4rem] font-bold tracking-tight leading-[1.1] text-base-content">
              Share files,{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-secondary to-accent">
                peer to peer
              </span>
            </h1>
            <p className="mt-3 sm:mt-4 text-sm sm:text-base text-base-content/40 max-w-lg mx-auto leading-relaxed">
              Create a room or fetch a torrent — no sign-up, no uploads to a server. Files go directly between devices.
            </p>
          </div>

          {/* Cards grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">

            {/* ── P2P Card ── */}
            <div className="card bg-base-100 border border-base-300/50 shadow-2xl aura aura-rainbow hover:-translate-y-1 transition-all duration-300">

              <div className="card-body p-6 sm:p-7 gap-5">

                {/* Icon + title row */}
                <div className="flex items-start gap-4">
                  <div className="shrink-0 w-12 h-12 rounded-2xl bg-primary/10 border border-primary/10
                                  flex items-center justify-center text-primary
                                  transition-all duration-500">
                    <Share2 size={20} strokeWidth={1.8} />
                  </div>
                  <div className="min-w-0 pt-0.5">
                    <h2 className="card-title text-[17px] sm:text-lg text-base-content/90">Share files P2P</h2>
                    <p className="text-[13px] text-base-content/40 mt-1 leading-relaxed">
                      Create a session, share the link, send files directly.
                    </p>
                  </div>
                </div>

                <div className="divider my-0 before:bg-base-300 after:bg-base-300" />

                {/* Duration selector */}
                <div className="space-y-2.5">
                  <label className="label text-[12px] font-medium text-base-content/40 uppercase tracking-wider gap-1.5 py-0">
                    <Clock size={12} />
                    Room duration
                  </label>
                  <DurationSelector value={duration} onChange={setDuration} />
                </div>

                {/* Action */}
                <button
                  className="btn btn-primary w-full mt-1 gap-2 shadow-xl aura aura-rainbow active:scale-[0.98] transition-all duration-300"
                  onClick={createSession}
                  disabled={creating}
                >
                  {creating
                    ? <span className="loading loading-spinner loading-sm" />
                    : 'Start session'}
                  {!creating && <ArrowRight size={15} className="ml-auto opacity-60" />}
                </button>
              </div>
            </div>

            {/* ── Torrent Card ── */}
            <div className="card bg-base-100 border border-base-300/50 shadow-2xl aura aura-rainbow hover:-translate-y-1 transition-all duration-300">

              <div className="card-body p-6 sm:p-7 gap-5">

                {/* Icon + title row */}
                <div className="flex items-start gap-4">
                  <div className="shrink-0 w-12 h-12 rounded-2xl bg-secondary/10 border border-secondary/10
                                  flex items-center justify-center text-secondary
                                  transition-all duration-500">
                    <Magnet size={20} strokeWidth={1.8} />
                  </div>
                  <div className="min-w-0 pt-0.5">
                    <h2 className="card-title text-[17px] sm:text-lg text-base-content/90">Download a torrent</h2>
                    <p className="text-[13px] text-base-content/40 mt-1 leading-relaxed">
                      Paste a magnet link to fetch it through the server.
                    </p>
                  </div>
                </div>

                <div className="divider my-0 before:bg-base-300 after:bg-base-300" />

                {/* Input */}
                <div className="space-y-2.5">
                  <label className="label text-[12px] font-medium text-base-content/40 uppercase tracking-wider py-0">
                    Magnet link
                  </label>
                  <textarea
                    className="textarea textarea-bordered w-full text-[13px] leading-relaxed resize-none bg-base-200 border-base-300 text-base-content/80 placeholder:text-base-content/25 focus:border-secondary focus:outline-none transition-colors duration-300"
                    rows={2}
                    placeholder="magnet:?xt=urn:btih:..."
                    value={magnet}
                    onChange={(e) => setMagnet(e.target.value)}
                  />
                </div>

                {/* Action */}
                <button
                  className="btn btn-secondary w-full mt-1 gap-2 shadow-xl aura aura-rainbow active:scale-[0.98] transition-all duration-300"
                  onClick={openMagnet}
                  disabled={!magnet.trim()}
                >
                  Fetch info
                  <ArrowRight size={15} className="ml-auto opacity-60" />
                </button>
              </div>
            </div>

          </div>

          {/* Bottom trust indicators */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-6 mt-8 sm:mt-12">
            <div className="flex items-center gap-2 text-[12px] text-base-content/30">
              <Shield size={13} className="text-primary/50" />
              <span>End-to-end encrypted</span>
            </div>
            <div className="hidden sm:block w-1 h-1 rounded-full bg-base-content/10" />
            <div className="flex items-center gap-2 text-[12px] text-base-content/30">
              <Globe size={13} className="text-secondary/50" />
              <span>Nothing stored on any server</span>
            </div>
            <div className="hidden sm:block w-1 h-1 rounded-full bg-base-content/10" />
            <div className="flex items-center gap-2 text-[12px] text-base-content/30">
              <Zap size={13} className="text-accent/50" />
              <span>Instant peer connections</span>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}