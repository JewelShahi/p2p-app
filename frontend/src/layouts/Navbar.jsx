import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Shield, Sun, Moon } from 'lucide-react';
import { toggleTheme } from '../features/theme/themeSlice';
import peerdropIcon from '../assets/peerdrop-icon.png'; // Relative import

const Navbar = () => {
  const dispatch = useDispatch();
  const theme = useSelector((state) => state.theme.theme);

  // Syncs the Redux state to the DOM attribute so DaisyUI updates the theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <div className="navbar bg-base-200/80 backdrop-blur-xl sticky top-0 z-50 border-b border-base-300/50 px-4 sm:px-8 min-h-16">
      
      {/* Left side: Icon + Text + Badge */}
      <div className="flex-1 flex items-center gap-3">
        
        {/* Improved Icon Container */}
        <div className="w-10 h-10 rounded-xl bg-base-100 border border-base-300/60 shadow-sm flex items-center justify-center overflow-hidden">
          <img 
            src={peerdropIcon} 
            alt="PeerDrop Icon" 
            className="w-7 h-7 object-cover" 
          />
        </div>

        {/* Title & Status Grouping */}
        <div className="flex items-center gap-3">
          <span className="text-[16px] font-bold tracking-tight text-base-content">
            PeerDrop
          </span>
          
          {/* Pill Badge for E2E */}
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20">
            <Shield size={10} className="text-primary" />
            <span className="text-[10px] text-primary font-semibold tracking-wider uppercase leading-none">
              E2E Encrypted
            </span>
          </div>
        </div>
      </div>

      {/* Right side: Theme Changer */}
      <div className="flex-none">
        <button 
          className="btn btn-ghost btn-circle" 
          onClick={() => dispatch(toggleTheme())}
          aria-label="Toggle theme"
        >
          {theme === 'darkblue' ? <Sun size={20} /> : <Moon size={20} />}
        </button>
      </div>

    </div>
  );
};

export default Navbar;