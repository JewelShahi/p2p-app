import { Routes, Route } from 'react-router-dom';
import Home from '../pages/Home';
import HostRoom from '../pages/HostRoom';
import JoinRoom from '../pages/JoinRoom';
import TorrentDownload from '../pages/TorrentDownload';

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/host/:roomId" element={<HostRoom />} />
      <Route path="/join/:roomId" element={<JoinRoom />} />
      <Route path="/torrent" element={<TorrentDownload />} />
    </Routes>
  );
}