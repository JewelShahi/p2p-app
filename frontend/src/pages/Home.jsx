import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Link2, Clock, ArrowRight, ShieldCheck, Radio, Lock, ServerOff, Timer,
} from 'lucide-react';
import toast from 'react-hot-toast';
import socket from '../api/socket';
import DurationSelector from '../components/DurationSelector';
import { useSelector } from 'react-redux';

const STEPS = [
  { label: 'Create a room', detail: 'Pick how long it stays open — 10 to 60 minutes.' },
  { label: 'Share the link', detail: 'Send it any way you like. No account needed either side.' },
  { label: 'Transfer directly', detail: 'Files move device-to-device the moment it connects.' },
];

const HUD = [
  { icon: Radio, label: 'Transport', value: 'WebRTC' },
  { icon: Lock, label: 'Encryption', value: 'End-to-end' },
  { icon: ServerOff, label: 'Storage', value: 'None' },
  { icon: Timer, label: 'Room TTL', value: '10–60 min' },
];

/* ── Motion & effects — all self-contained and reduced-motion safe ── */
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

  @keyframes pd-pan { to { background-position: 200% center; } }
  .pd-pan { animation: pd-pan 8s linear infinite; }

  /* a light that periodically sweeps along the card's top edge */
  @keyframes pd-scan {
    0%        { transform: translateX(-110%); }
    55%, 100% { transform: translateX(430%); }
  }
  .pd-scan { animation: pd-scan 4.5s cubic-bezier(.4,0,.2,1) infinite; }

  /* highlight sweep across the CTA on hover */
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
    .pd-rise, .pd-float, .pd-bar, .pd-pan, .pd-scan { animation: none !important; }
    .pd-shine::after { display: none; }
    .peerdrop-dotgrid { display: none; }
  }
`;

// Four bars of rising height, gently pulsing — a small stand-in for
// "live signal" that ties back to the transport/radio language in the HUD.
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

export default function Home() {
  const navigate = useNavigate();
  const [duration, setDuration] = useState(20);
  const [creating, setCreating] = useState(false);

  const theme = useSelector((state) => state.theme.theme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const createSession = () => {
    if (creating) return;
    setCreating(true);
    if (!socket.connected) socket.connect();

    // safety net: never leave the button spinning forever
    const fallback = setTimeout(() => setCreating(false), 10000);

    socket.emit('create-room', { durationMinutes: duration }, (res) => {
      clearTimeout(fallback);
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
    <div data-theme={theme} className="min-h-screen flex flex-col antialiased">
      <style>{CSS}</style>

      <main className="flex-1 relative overflow-hidden">
        {/* backdrop: dot grid + soft floating orbs */}
        <div className="peerdrop-dotgrid pointer-events-none absolute inset-0 text-base-content/[0.08]" aria-hidden="true" />
        <div className="pd-float pointer-events-none absolute -top-24 left-[6%] h-72 w-72 rounded-full bg-primary/[0.08] blur-3xl" aria-hidden="true" />
        <div className="pd-float pointer-events-none absolute top-64 right-[2%] h-80 w-80 rounded-full bg-secondary/[0.07] blur-3xl" style={{ animationDelay: '-4.5s' }} aria-hidden="true" />

        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 py-14 sm:py-20 lg:py-24">

          {/* ── Hero ── */}
          <div className="text-center">
            <h1 className="pd-rise text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.05] text-base-content text-balance" style={{ animationDelay: '80ms' }}>
              Share files,{' '}
              <span className="pd-pan bg-gradient-to-r from-primary via-secondary to-primary bg-[length:200%_auto] bg-clip-text text-transparent">
                peer to peer
              </span>
            </h1>

            <p className="pd-rise mt-5 text-base sm:text-lg text-base-content/50 max-w-lg mx-auto leading-relaxed" style={{ animationDelay: '160ms' }}>
              No sign-up, no upload to a server. Open a room, share the link, and your
              files travel straight from your device to theirs.
            </p>
          </div>

          {/* ── HUD strip ── */}
          <div className="pd-rise mt-10 sm:mt-12 grid grid-cols-2 sm:grid-cols-4 gap-px bg-base-300/60 rounded-xl overflow-hidden border border-base-300/60 max-w-2xl mx-auto shadow-sm" style={{ animationDelay: '240ms' }}>
            {HUD.map(({ icon: Icon, label, value }) => (
              <div key={label} className="group relative overflow-hidden bg-base-100 p-4 text-center">
                <span className="absolute inset-0 bg-primary/[0.05] opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                <span className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-primary/60 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                <div className="relative flex flex-col items-center justify-center">
                  <Icon size={14} className="mb-2 text-primary/60 transition-all duration-300 group-hover:scale-110 group-hover:text-primary" />
                  <p className="text-[10px] font-mono uppercase tracking-wider text-base-content/35">
                    {label}
                  </p>
                  <p className="text-[13px] font-semibold text-base-content/85 mt-0.5 whitespace-nowrap">
                    {value}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <div className="pd-rise mt-5 flex justify-center" style={{ animationDelay: '320ms' }}>
            <span className="inline-flex items-center gap-2.5 rounded-full border border-base-300/60 bg-base-200/40 px-4 py-1.5 text-[12px] text-base-content/40 backdrop-blur-sm">
              <SignalBars />
              Nothing is written to a server, ever.
            </span>
          </div>

          {/* ── Action console: stacked on mobile, two panes from md up ── */}
          <div className="pd-rise group relative mt-12 sm:mt-14 max-w-2xl mx-auto" style={{ animationDelay: '400ms' }}>
            {/* ambient glow behind the card */}
            <div className="pointer-events-none absolute -inset-8 rounded-full bg-gradient-to-r from-primary/15 via-secondary/10 to-primary/15 opacity-60 blur-3xl transition-opacity duration-700 group-hover:opacity-100" aria-hidden="true" />

            <div className="relative overflow-hidden rounded-2xl border border-base-300/60 bg-base-100/95 shadow-2xl shadow-base-content/10 backdrop-blur-xl transition-transform duration-500 group-hover:-translate-y-1">
              {/* scanning light along the top edge */}
              <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[2px] overflow-hidden">
                <div className="pd-scan absolute inset-y-0 w-1/4 bg-gradient-to-r from-transparent via-primary/80 to-transparent" />
              </div>

              <div className="flex flex-col md:flex-row">

                {/* Left pane: how it works */}
                <div className="flex-1 p-6 sm:p-7 border-b md:border-b-0 md:border-r border-base-300/60">
                  <div className="mb-6 flex items-center gap-3">
                    <p className="text-[11px] font-mono uppercase tracking-widest text-base-content/35 whitespace-nowrap">
                      How it works
                    </p>
                    <span className="h-px flex-1 bg-base-300/70" />
                  </div>

                  <ol className="relative space-y-6">
                    <span className="absolute left-[13px] top-4 bottom-4 w-px bg-gradient-to-b from-base-content/15 via-base-content/10 to-transparent" aria-hidden="true" />
                    {STEPS.map((step, i) => (
                      <li key={step.label} className="group/step relative flex items-start gap-3.5">
                        <span className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-base-300 bg-base-100 font-mono text-[11px] text-base-content/45 transition-all duration-300 group-hover/step:border-primary/50 group-hover/step:text-primary group-hover/step:ring-4 group-hover/step:ring-primary/10">
                          0{i + 1}
                        </span>
                        <div className="min-w-0 pt-0.5">
                          <p className="text-[13px] font-semibold text-base-content/85 leading-snug transition-colors duration-300 group-hover/step:text-base-content">
                            {step.label}
                          </p>
                          <p className="text-[12px] text-base-content/40 mt-0.5 leading-relaxed">
                            {step.detail}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>

                {/* Right pane: the form */}
                <div className="flex-1 p-6 sm:p-7 bg-base-200/30 flex flex-col justify-center gap-5">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Link2 size={14} />
                    </span>
                    <div>
                      <p className="text-[13px] font-semibold text-base-content/90 leading-tight">New session</p>
                      <p className="text-[11px] text-base-content/40">Pick a lifetime, then share the link</p>
                    </div>
                  </div>

                  <div className="space-y-2.5 flex flex-col items-start sm:flex-row sm:items-center sm:justify-between gap-4">
                    <label className="label text-[12px] font-medium text-base-content/40 uppercase tracking-wider gap-1.5 py-0 text-left sm:text-center">
                      <Clock size={12} />
                      Room duration
                    </label>
                    <DurationSelector value={duration} onChange={setDuration} />
                  </div>

                  <button
                    className="pd-shine btn btn-primary group/btn w-full gap-2 shadow-lg shadow-primary/25 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/40 active:translate-y-0"
                    onClick={createSession}
                    disabled={creating}
                  >
                    {creating ? (
                      <>
                        <span className="loading loading-spinner loading-sm" />
                        Creating room…
                      </>
                    ) : (
                      <>
                        <Link2 size={15} />
                        Start session
                        <ArrowRight size={15} className="ml-auto opacity-60 transition-transform duration-200 group-hover/btn:translate-x-1" />
                      </>
                    )}
                  </button>

                  <p className="flex items-center justify-center gap-1.5 text-[11px] text-base-content/35">
                    <ShieldCheck size={12} className="text-success/70" />
                    End-to-end encrypted — files never touch a server
                  </p>
                </div>

              </div>
            </div>
          </div>

        </div>

      </main>
    </div>
  );
}