import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

export default function CountdownTimer({ expiresAt, onExpire }) {
  const [remaining, setRemaining] = useState(Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)));

  useEffect(() => {
    const id = setInterval(() => {
      const secs = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setRemaining(secs);
      if (secs <= 0) {
        clearInterval(id);
        onExpire?.();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt, onExpire]);

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');

  const urgent = remaining <= 60;
  const low = remaining <= 300;
  
  const tier = urgent
    ? 'border-error/30 bg-error/10 text-error'
    : low
      ? 'border-warning/30 bg-warning/10 text-warning'
      : 'border-base-300/60 bg-base-200/50 text-base-content/60';

  return (
    <div
      role="timer"
      aria-label={`Session ends in ${mm}:${ss}`}
      title={`Session ends in ${mm}:${ss}`}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-xs font-semibold tabular-nums transition-colors duration-300 ${tier}`}
    >
      <Clock size={13} className={urgent ? 'animate-pulse motion-reduce:animate-none' : ''} />
      <span>{mm}:{ss}</span>
    </div>
  );
}
