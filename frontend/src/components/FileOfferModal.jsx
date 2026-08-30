// FileOfferModal.jsx
import { useState } from 'react';
import {
  X, Download, FolderArchive, Files, FileText, ShieldCheck,
} from 'lucide-react';
import { formatBytes } from '../utils/formatBytes';

/* ── Motion & effects — same visual language as the other screens.
     Uniquely prefixed (fom-) so it can never collide with page-level styles,
     self-contained (unmounts with the modal), and reduced-motion safe. ── */
const CSS = `
  @keyframes fom-fade {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  .fom-fade { animation: fom-fade .25s ease-out both; }

  @keyframes fom-pop {
    from { opacity: 0; transform: translateY(16px) scale(.96); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }
  .fom-pop { animation: fom-pop .45s cubic-bezier(.22,1,.36,1) both; }

  @keyframes fom-rise {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .fom-rise { animation: fom-rise .5s cubic-bezier(.22,1,.36,1) both; }

  @keyframes fom-ring {
    0%   { transform: scale(1);    opacity: .45; }
    100% { transform: scale(1.55); opacity: 0; }
  }
  .fom-ring { animation: fom-ring 2s ease-out infinite; }

  @keyframes fom-scan {
    0%        { transform: translateX(-110%); }
    55%, 100% { transform: translateX(430%); }
  }
  .fom-scan { animation: fom-scan 4.5s cubic-bezier(.4,0,.2,1) infinite; }

  .fom-shine { position: relative; overflow: hidden; }
  .fom-shine::after {
    content: '';
    position: absolute; inset: 0;
    background: linear-gradient(105deg, transparent 40%, rgb(255 255 255 / .28) 50%, transparent 60%);
    transform: translateX(-130%);
    transition: transform .7s ease;
    pointer-events: none;
  }
  .fom-shine:hover::after { transform: translateX(130%); }

  /* slim, unobtrusive scrollbar for the file list */
  .fom-list { scrollbar-width: thin; }
  .fom-list::-webkit-scrollbar { width: 4px; }
  .fom-list::-webkit-scrollbar-thumb { border-radius: 9999px; background-color: rgb(127 127 127 / 0.25); }
  .fom-list::-webkit-scrollbar-track { background: transparent; }

  @media (prefers-reduced-motion: reduce) {
    .fom-fade, .fom-pop, .fom-rise, .fom-ring, .fom-scan { animation: none !important; }
    .fom-shine::after { display: none; }
  }
`;

export default function FileOfferModal({ offer, onRespond }) {
  const [mode, setMode] = useState('individual');
  if (!offer) return null;

  const count = offer.files.length;
  const plural = count > 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Incoming file offer"
      className="modal modal-open fom-fade bg-black/50 backdrop-blur-sm"
    >
      <style>{CSS}</style>

      <div className="fom-pop modal-box relative w-11/12 max-w-md overflow-hidden border border-base-300/60 p-0 shadow-2xl">

        {/* live scan light along the top edge — the room's signature detail */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-[2px] overflow-hidden" aria-hidden="true">
          <div className="fom-scan absolute inset-y-0 w-1/4 bg-gradient-to-r from-transparent via-primary/80 to-transparent" />
        </div>

        {/* ── Header ── */}
        <div className="relative px-5 pt-6 pb-5 sm:px-6">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-primary/[0.08] to-transparent" aria-hidden="true" />
          <div className="relative flex items-center gap-4">
            <span className="relative flex h-12 w-12 shrink-0 items-center justify-center" aria-hidden="true">
              <span className="fom-ring absolute inset-0 rounded-2xl bg-primary/25" />
              <span className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Download size={20} />
              </span>
            </span>
            <div className="min-w-0">
              <h3 className="text-lg font-bold leading-tight">Incoming files</h3>
              <p className="mt-0.5 text-[13px] text-base-content/45">
                {count} file{plural ? 's' : ''} · {formatBytes(offer.totalSize)}
              </p>
            </div>
          </div>
        </div>

        {/* ── File list ── */}
        <div className="px-5 sm:px-6">
          <div className="flex items-center gap-3">
            <p className="whitespace-nowrap font-mono text-[11px] uppercase tracking-widest text-base-content/35">
              Contents
            </p>
            <span className="h-px flex-1 bg-base-300/60" />
            <span className="badge badge-ghost badge-sm font-mono">
              {count} item{plural ? 's' : ''}
            </span>
          </div>

          <ul className="fom-list mt-3 max-h-32 space-y-1.5 overflow-y-auto pr-1 sm:max-h-44">
            {offer.files.map((f, i) => (
              <li
                key={f.id}
                className="fom-rise flex items-center gap-3 rounded-lg bg-base-200/40 px-3 py-2.5 transition-colors duration-200 hover:bg-base-200/80"
                style={{ animationDelay: `${Math.min(i * 45, 400)}ms` }}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-base-300/40 text-base-content/30">
                  <FileText size={12} />
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-base-content/70" title={f.name}>
                  {f.name}
                </span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-base-content/30">
                  {formatBytes(f.size)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* ── Delivery mode ── */}
        {plural && (
          <div className="px-5 pt-4 sm:px-6">
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-base-300/50 bg-base-200/60 p-1">
              <button
                type="button"
                aria-pressed={mode === 'individual'}
                className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-medium transition-all duration-200 ${
                  mode === 'individual'
                    ? 'bg-base-100 text-primary shadow-sm'
                    : 'text-base-content/45 hover:text-base-content/75'
                }`}
                onClick={() => setMode('individual')}
              >
                <Files size={14} />
                One by one
              </button>
              <button
                type="button"
                aria-pressed={mode === 'zip'}
                className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-medium transition-all duration-200 ${
                  mode === 'zip'
                    ? 'bg-base-100 text-primary shadow-sm'
                    : 'text-base-content/45 hover:text-base-content/75'
                }`}
                onClick={() => setMode('zip')}
              >
                <FolderArchive size={14} />
                As .zip
              </button>
            </div>
            <p className="mt-2 text-center text-[11px] text-base-content/30">
              {mode === 'individual'
                ? 'Each file will be saved separately'
                : 'All files bundled into a single archive'}
            </p>
          </div>
        )}

        {/* ── Actions ── */}
        <div className="mt-5 border-t border-base-300/60 bg-base-200/30 px-5 py-4 sm:px-6">
          <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
            <button
              type="button"
              className="btn btn-ghost gap-2 border border-base-300/60"
              onClick={() => onRespond(false, mode)}
            >
              <X size={16} />
              Decline
            </button>
            <button
              type="button"
              className="fom-shine btn btn-primary gap-2 shadow-lg shadow-primary/25 transition-all duration-200 enabled:hover:-translate-y-0.5 enabled:hover:shadow-xl enabled:hover:shadow-primary/40 active:translate-y-0"
              onClick={() => onRespond(true, mode)}
            >
              <Download size={16} />
              Download
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}