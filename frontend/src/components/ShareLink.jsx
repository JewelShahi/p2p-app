// ShareLink.jsx
import { useState } from 'react';
import { Copy, Check, Link2 } from 'lucide-react';
import toast from 'react-hot-toast';

const CSS = `
  @keyframes shl-pop {
    0%   { transform: scale(.6); opacity: 0; }
    60%  { transform: scale(1.15); }
    100% { transform: scale(1); opacity: 1; }
  }
  .shl-pop { animation: shl-pop .35s cubic-bezier(.22,1,.36,1) both; }
  @media (prefers-reduced-motion: reduce) { .shl-pop { animation: none; } }
`;

export default function ShareLink({ roomId }) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/join/${roomId}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success('Link copied');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // safety net only — the original had no handling if the clipboard is blocked
      toast.error('Could not copy — select the link manually');
    }
  };

  return (
    <div className="w-full max-w-xl">
      <style>{CSS}</style>

      <div className="group flex w-full items-center gap-2 rounded-xl border border-base-300/60 bg-base-200/40 p-1.5 pl-3 transition-colors duration-200 hover:border-primary/30 focus-within:border-primary/50">
        <Link2 size={14} className="shrink-0 text-base-content/30 transition-colors duration-200 group-hover:text-primary/60" />

        <input
          readOnly
          value={link}
          aria-label="Share link"
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 cursor-text bg-transparent font-mono text-xs text-base-content/60 outline-none"
        />

        <button
          onClick={copy}
          className={`btn btn-sm gap-1.5 rounded-lg border-transparent font-medium shadow-sm transition-all duration-300 active:scale-95 ${
            copied ? 'btn-success' : 'btn-primary'
          }`}
        >
          {copied ? (
            <>
              <Check size={15} className="shl-pop" />
              <span className="hidden sm:inline">Copied</span>
            </>
          ) : (
            <>
              <Copy size={15} />
              <span className="hidden sm:inline">Copy link</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}