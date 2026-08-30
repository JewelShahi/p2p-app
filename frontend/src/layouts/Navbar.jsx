// Navbar.jsx
import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Link } from 'react-router-dom';
import { Sun, Moon } from 'lucide-react';
import { toggleTheme } from '../features/theme/themeSlice';
import peerdropIcon from '../assets/peerdrop-icon.png';

/* ── Navbar-only styles, nb- prefixed, reduced-motion safe ── */
const CSS = `
  /* icon spins in fresh each time the theme flips */
  @keyframes nb-pop {
    from { opacity: 0; transform: rotate(-120deg) scale(.4); }
    to   { opacity: 1; transform: rotate(0deg)   scale(1); }
  }
  .nb-pop { animation: nb-pop .5s cubic-bezier(.22,1,.36,1) both; }

  @media (prefers-reduced-motion: reduce) { .nb-pop { animation: none; } }
`;

const Navbar = () => {
  const dispatch = useDispatch();
  const theme = useSelector((state) => state.theme.theme);

  // Syncs the Redux state to the DOM attribute so DaisyUI updates the theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <nav className="navbar sticky top-0 z-50 relative min-h-16 border-b border-base-300/60 bg-base-200/70 px-4 backdrop-blur-xl sm:px-8">
      <style>{CSS}</style>

      {/* hairline accent along the bottom edge — echoes the scan-light on the pages below */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/25 to-transparent" aria-hidden="true" />

      {/* Left: logo + name, links home */}
      <div className="flex-1">
        <Link
          to="/"
          className="group -ml-1.5 flex items-center gap-3 rounded-xl px-1.5 py-1 transition-colors hover:bg-base-100/60"
        >
          <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border border-base-300/60 bg-base-100 shadow-sm transition-all duration-300 group-hover:-rotate-6 group-hover:scale-105 group-hover:border-primary/40 group-hover:shadow-lg group-hover:shadow-primary/10">
            <img src={peerdropIcon} alt="" className="h-7 w-7 object-cover" />
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[16px] font-bold tracking-tight text-base-content">
              Peer<span className="text-primary">Drop</span>
            </span>
          </div>
        </Link>
      </div>

      {/* Right: theme toggle */}
      <div className="flex-none">
        <button
          className="btn btn-ghost btn-circle border border-transparent text-base-content/70 transition-all duration-200 hover:border-base-300/60 hover:bg-base-100 active:scale-90"
          onClick={() => dispatch(toggleTheme())}
          aria-label="Toggle theme"
          title="Toggle theme"
        >
          {/* keyed on theme so every flip replays the spin-in */}
          <span key={theme} className="nb-pop flex items-center justify-center">
            {theme === 'darkblue' ? <Sun size={18} /> : <Moon size={18} />}
          </span>
        </button>
      </div>

    </nav>
  );
};

export default Navbar;