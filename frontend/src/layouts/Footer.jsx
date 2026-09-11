import { ShieldCheck, FileText, ServerCrash, Check } from 'lucide-react';
import peerdropIcon from '../assets/peerdrop-icon.png';

const GithubIcon = ({ size = 18 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
  </svg>
);

/* Footer-only styles */
const CSS = `
  @keyframes ft-bar {
    0%, 100% { transform: scaleY(.4); opacity: .55; }
    50%      { transform: scaleY(1);  opacity: 1; }
  }
  .ft-bar { transform-origin: bottom; animation: ft-bar 1.3s ease-in-out infinite; }

  @media (prefers-reduced-motion: reduce) { .ft-bar { animation: none; } }
`;

function SignalBars() {
  return (
    <span className="inline-flex h-3.5 shrink-0 items-end gap-[3px]" aria-hidden="true">
      {[5, 8, 11, 14].map((h, i) => (
        <span
          key={h}
          className="ft-bar w-[3px] rounded-full bg-gradient-to-t from-primary/60 to-success"
          style={{ height: h, animationDelay: `${i * 160}ms` }}
        />
      ))}
    </span>
  );
}

/* Section header with a small accent underline */
function SectionTitle({ children, accent }) {
  return (
    <div className="mb-5">
      <h3 className="text-xs font-bold uppercase tracking-widest text-base-content/40">
        {children}
      </h3>
      <span className={`mt-1.5 block h-0.5 w-6 rounded-full bg-gradient-to-r ${accent}`} aria-hidden="true" />
    </div>
  );
}

const LINK = 'group/link flex items-center gap-2.5 text-sm text-base-content/60 transition-all duration-200 hover:translate-x-0.5 hover:text-primary';
const LINK_ICON = 'shrink-0 opacity-70 transition-opacity duration-200 group-hover/link:opacity-100';

const Footer = () => {
  const year = new Date().getFullYear();

  return (
    <footer className="relative mt-auto overflow-hidden border-t border-base-300/60 bg-base-200/50">
      <style>{CSS}</style>

      {/* hairline accent on top + soft ambient orbs */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/25 to-transparent" aria-hidden="true" />
      <div className="pointer-events-none absolute -top-16 left-[8%] h-48 w-48 rounded-full bg-primary/[0.05] blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-20 right-[5%] h-56 w-56 rounded-full bg-secondary/[0.05] blur-3xl" aria-hidden="true" />

      <div className="relative mx-auto max-w-5xl px-4 pb-2 pt-12 sm:px-6">

        {/* ── Brand and the three original sections ── */}
        <div className="mb-10 grid grid-cols-1 gap-9 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">

          {/* Brand */}
          <div>
            <div className="mb-3 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border border-base-300/60 bg-base-100 shadow-sm">
                <img src={peerdropIcon} alt="" className="h-7 w-7 object-cover" />
              </div>
              <span className="text-[16px] font-bold tracking-tight text-base-content">
                Peer<span className="text-primary">Drop</span>
              </span>
            </div>
            <p className="text-sm leading-relaxed text-base-content/50">
              Straight from your device to theirs. No accounts, no uploads, no traces.
            </p>
          </div>

          {/* Legal and protection dummy section */}
          <div>
            <SectionTitle accent="from-primary/60 to-transparent">Legal &amp; Protection</SectionTitle>
            <ul className="space-y-3">
              <li>
                <a href="#" className={LINK}>
                  <ShieldCheck size={14} className={LINK_ICON} />
                  Privacy Policy
                </a>
              </li>
              <li>
                <a href="#" className={LINK}>
                  <FileText size={14} className={LINK_ICON} />
                  Terms of Service
                </a>
              </li>
              <li>
                <a href="#" className={LINK}>
                  <ServerCrash size={14} className={LINK_ICON} />
                  Strict No-Log Policy
                </a>
              </li>
            </ul>
          </div>

          {/* Technology */}
          <div>
            <SectionTitle accent="from-success/60 to-transparent">Technology</SectionTitle>
            <ul className="space-y-3">
              {[
                'WebRTC peer-to-peer connections',
                'End-to-end encryption (E2EE)',
                'Rooms that expire automatically',
              ].map((item) => (
                <li key={item} className="flex items-center gap-2.5 text-sm text-base-content/60">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
                    <Check size={10} strokeWidth={3} />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Data handling section */}
          <div>
            <SectionTitle accent="from-secondary/60 to-transparent">Data Handling</SectionTitle>
            <p className="text-sm leading-relaxed text-base-content/60">
              Your files never touch our servers. All transfers happen directly between browsers.
              Session metadata is temporarily held in RAM and wiped the moment the room closes.
            </p>
          </div>

        </div>

        {/* Divider */}
        <div className="h-px bg-gradient-to-r from-transparent via-base-300/80 to-transparent" aria-hidden="true" />

        {/* ── Copyright  ── */}
        <div className="flex flex-col items-center justify-between gap-4 pb-2 pt-6 sm:flex-row">
          <p className="text-center text-xs text-base-content/40 sm:text-left">
            © {year} PeerDrop. Built by{' '}
            <span className="font-semibold text-base-content/70">Jewel Shahi</span>
          </p>

          <a
            href="https://github.com/JewelShahi"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-outline btn-sm mt-4 gap-2 border-base-300/60 text-base-content/60 transition-all duration-200 hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
            aria-label="GitHub Profile"
          >
            <GithubIcon size={15} />
            GitHub
          </a>
        </div>

      </div>
    </footer>
  );
};

export default Footer;
