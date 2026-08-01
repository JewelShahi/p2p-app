import { useEffect } from 'react';
import toast from 'react-hot-toast';
import { WifiOff, Wifi } from 'lucide-react';

export default function useOnlineStatus() {
  useEffect(() => {
    const goOffline = () => toast.error('You are offline', { icon: <WifiOff size={18} />, id: 'net' });
    const goOnline = () => toast.success('Back online', { icon: <Wifi size={18} />, id: 'net' });
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);
}