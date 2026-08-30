import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Share2, Zap, Clock, ArrowRight, Shield, Globe } from 'lucide-react';
import toast from 'react-hot-toast';
import socket from '../api/socket';
import DurationSelector from '../components/DurationSelector';
import { useSelector } from 'react-redux';

export default function Home() {
  const navigate = useNavigate();
  const [duration, setDuration] = useState(20);
  const [creating, setCreating] = useState(false);

  const theme = useSelector((state) => state.theme.theme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

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

  return (
    <div data-theme={theme} className="min-h-screen flex flex-col">

      {/* ── Main content ── */}
      <main className="flex-1 flex items-center justify-center px-4 sm:px-6 pb-16 overflow-visible">
        <div className="w-full max-w-2xl">

          {/* Hero text */}
          <div className="text-center mb-10 sm:mb-14">
            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-[3.4rem] font-bold tracking-tight leading-[1.1] text-base-content">
              Share files,{' '}
              <span className="text-primary">peer to peer</span>
            </h1>
            <p className="mt-3 sm:mt-4 text-sm sm:text-base text-base-content/40 max-w-lg mx-auto leading-relaxed px-2">
              Create a room — no sign-up, no uploads to a server. Files go directly between devices.
            </p>
          </div>

          {/* P2P Card */}
          <div className="aura aura-rainbow h-full">
            <div className="card w-full h-full bg-base-100 shadow-sm">
              <div className="card-body p-6 sm:p-7 gap-5 h-full flex flex-col">

                <div className="flex items-start gap-4">
                  <div className="shrink-0 w-12 h-12 rounded-2xl bg-primary/10 border border-primary/10 flex items-center justify-center text-primary">
                    <Share2 size={20} strokeWidth={1.8} />
                  </div>
                  <div className="min-w-0 pt-0.5">
                    <h2 className="card-title text-[17px] sm:text-lg text-base-content">Share files P2P</h2>
                    <p className="text-[13px] text-base-content/40 mt-1 leading-relaxed">
                      Create a session, share the link, send files directly.
                    </p>
                  </div>
                </div>

                <div className="divider my-0 before:bg-base-300 after:bg-base-300" />

                <div className="space-y-2.5 flex-1">
                  <label className="label text-[12px] font-medium text-base-content/40 uppercase tracking-wider gap-1.5 py-0">
                    <Clock size={12} />
                    Room duration
                  </label>
                  <DurationSelector value={duration} onChange={setDuration} />
                </div>

                <button
                  className="btn btn-primary w-full mt-1 gap-2"
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
          </div>

          {/* Bottom trust indicators */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-6 mt-8 sm:mt-12 text-center">
            <div className="flex items-center gap-2 text-[12px] text-base-content/30">
              <Shield size={13} className="text-primary shrink-0" />
              <span>End-to-end encrypted</span>
            </div>
            <div className="hidden sm:block w-1 h-1 rounded-full bg-base-content/10" />
            <div className="flex items-center gap-2 text-[12px] text-base-content/30">
              <Globe size={13} className="text-secondary shrink-0" />
              <span>Nothing stored on any server</span>
            </div>
            <div className="hidden sm:block w-1 h-1 rounded-full bg-base-content/10" />
            <div className="flex items-center gap-2 text-[12px] text-base-content/30">
              <Zap size={13} className="text-accent shrink-0" />
              <span>Instant peer connections</span>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}