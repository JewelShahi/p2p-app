import { ShieldCheck, FileText, ServerCrash } from 'lucide-react';

// Standard GitHub SVG to avoid Lucide trademark export issues
const GithubIcon = ({ size = 18 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className="current-color">
    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
  </svg>
);

const Footer = () => {
  return (
    <footer className="bg-base-200/50 border-t border-base-300/50 mt-auto">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
        
        {/* Top Grid: Links & Info */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 mb-8">
          
          {/* Legal & Protection */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest text-base-content/40 mb-4">
              Legal & Protection
            </h3>
            <ul className="space-y-3">
              <li>
                <a href="#" className="text-sm text-base-content/60 hover:text-primary transition-colors flex items-center gap-2.5">
                  <ShieldCheck size={14} className="opacity-70" />
                  Privacy Policy
                </a>
              </li>
              <li>
                <a href="#" className="text-sm text-base-content/60 hover:text-primary transition-colors flex items-center gap-2.5">
                  <FileText size={14} className="opacity-70" />
                  Terms of Service
                </a>
              </li>
              <li>
                <a href="#" className="text-sm text-base-content/60 hover:text-primary transition-colors flex items-center gap-2.5">
                  <ServerCrash size={14} className="opacity-70" />
                  Strict No-Log Policy
                </a>
              </li>
            </ul>
          </div>

          {/* How it Works / Features */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest text-base-content/40 mb-4">
              Technology
            </h3>
            <ul className="space-y-3">
              <li className="text-sm text-base-content/60">WebRTC P2P Connections</li>
              <li className="text-sm text-base-content/60">End-to-End Encryption (E2EE)</li>
              <li className="text-sm text-base-content/60">WebTorrent Integration</li>
            </ul>
          </div>

          {/* Data Handling Notice */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest text-base-content/40 mb-4">
              Data Handling
            </h3>
            <p className="text-sm text-base-content/60 leading-relaxed">
              Your files never touch our servers. All transfers happen directly between browsers. Session metadata is temporarily held in RAM and wiped the moment the room closes.
            </p>
          </div>

        </div>

        {/* Divider */}
        <div className="divider my-0 before:bg-base-300/50 after:bg-base-300/50" />

        {/* Bottom Section: Copyright & Socials */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-6">
          <p className="text-xs text-base-content/40 text-center sm:text-left">
            © {new Date().getFullYear()} PeerDrop. Built by{' '}
            <span className="text-base-content/70 font-semibold">Jewel Shahi</span>
          </p>
          
          <a 
            href="https://github.com/JewelShahi" // Update this URL if your GitHub username is different
            target="_blank" 
            rel="noopener noreferrer" 
            className="btn btn-ghost btn-sm btn-circle text-base-content/50 hover:text-primary hover:bg-primary/10 transition-colors"
            aria-label="GitHub Profile"
          >
            <GithubIcon size={18} />
          </a>
        </div>

      </div>
    </footer>
  );
};

export default Footer;