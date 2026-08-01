import { useSelector, useDispatch } from 'react-redux';
import { toggleTheme } from './features/theme/themeSlice';
import { Sun, Moon } from 'lucide-react';
import AppRoutes from './routes/AppRoutes';
import Navbar from './layouts/Navbar';
import Footer from './layouts/Footer';
import useOnlineStatus from './hooks/useOnlineStatus';

const App = () => {
  const dispatch = useDispatch();
  const theme = useSelector((state) => state.theme.theme);
  useOnlineStatus();

  return (
    <div data-theme={theme} className="min-h-screen bg-base-100 text-base-content">
      <Navbar />
      <AppRoutes />
      <Footer />
    </div>
  );
};

export default App;