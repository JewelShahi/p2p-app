// TransferProgress.jsx
import { Check } from 'lucide-react';

const CSS = `
  /* travelling highlight over the bar while a transfer is in flight */
  @keyframes tp-shimmer {
    from { background-position: -200% 0; }
    to   { background-position: 200% 0; }
  }
  .tp-shimmer { position: relative; overflow: hidden; }
  .tp-shimmer::after {
    content: '';
    position: absolute; inset: 0;
    background: linear-gradient(90deg, transparent 0%, rgb(255 255 255 / .35) 50%, transparent 100%);
    background-size: 200% 100%;
    animation: tp-shimmer 1.5s linear infinite;
  }

  @keyframes tp-pulse {
    0%, 100% { opacity: .4; transform: scale(.85); }
    50%      { opacity: 1;  transform: scale(1); }
  }
  .tp-pulse { animation: tp-pulse 1.4s ease-in-out infinite; }

  @media (prefers-reduced-motion: reduce) {
    .tp-shimmer::after, .tp-pulse { animation: none; }
  }
`;

export default function TransferProgress({ label, progress, className = '' }) {
  const clamped = Math.min(Math.max(progress ?? 0, 0), 1);
  const pct = Math.min(100, Math.round(clamped * 100));
  const done = pct >= 100;

  return (
    <div className={`w-full ${className}`}>
      <style>{CSS}</style>

      <div className="mb-1.5 flex items-center gap-2">
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-colors duration-300 ${
            done ? 'bg-success/15 text-success' : 'bg-primary/10 text-primary'
          }`}
          aria-hidden="true"
        >
          {done
            ? <Check size={10} strokeWidth={3} />
            : <span className="tp-pulse h-1.5 w-1.5 rounded-full bg-primary" />}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-base-content/70">{label}</span>
        <span className={`shrink-0 font-mono text-xs font-semibold tabular-nums ${done ? 'text-success' : 'text-base-content/50'}`}>
          {pct}%
        </span>
      </div>

      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 w-full shrink-0 overflow-hidden rounded-full bg-base-300/50"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-300 ease-out ${
            done
              ? 'bg-success shadow-[0_0_8px] shadow-success/40'
              : 'tp-shimmer bg-gradient-to-r from-primary via-primary to-secondary'
          }`}
          style={{ width: `${clamped * 100}%` }}
        />
      </div>
    </div>
  );
}