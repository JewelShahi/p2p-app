import { useSelector, useDispatch } from 'react-redux';
import { toggleTheme } from './features/theme/themeSlice';
import { Sun, Moon } from 'lucide-react';
import AppRoutes from './routes/AppRoutes';
import useOnlineStatus from './hooks/useOnlineStatus';

const App = () => {
  const dispatch = useDispatch();
  const theme = useSelector((state) => state.theme.theme);
  useOnlineStatus();

  return (
    <div data-theme={theme} className="min-h-screen bg-base-100 text-base-content">
      <div className="navbar bg-base-200 px-4">
        <div className="flex-1 font-bold">P2P Share</div>
        <button className="btn btn-ghost btn-circle" onClick={() => dispatch(toggleTheme())}>
          {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
        </button>
      </div>
      <AppRoutes />
    </div>
  );
};

export default App;