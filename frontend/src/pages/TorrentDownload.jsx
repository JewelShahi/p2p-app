import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Download, FolderArchive } from 'lucide-react';
import api from '../api/axios';
import { API_URL } from '../constants/config';
import { formatBytes } from '../utils/formatBytes';

export default function TorrentDownload() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const magnet = state?.magnet;
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!magnet) {
      navigate('/');
      return;
    }
    setLoading(true);
    api.get('/torrent/info', { params: { magnet } })
      .then((res) => setInfo(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [magnet, navigate]);

  const downloadFile = (fileIndex) => {
    const url = `${API_URL}/torrent/download?magnet=${encodeURIComponent(magnet)}${fileIndex !== undefined ? `&fileIndex=${fileIndex}` : ''}`;
    window.location.href = url;
    toast.success('Download starting');
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><span className="loading loading-spinner loading-lg" /></div>;
  }
  if (!info) {
    return <div className="min-h-screen flex items-center justify-center"><p>Could not resolve that magnet link.</p></div>;
  }

  return (
    <div className="min-h-screen p-4 max-w-2xl mx-auto space-y-4">
      <h1 className="text-xl font-bold">{info.name}</h1>
      <p className="text-sm opacity-70">{info.files.length} file(s) · {formatBytes(info.totalSize)}</p>

      <ul className="space-y-2">
        {info.files.map((f) => (
          <li key={f.index} className="flex items-center justify-between bg-base-200 rounded-lg px-4 py-2">
            <span className="truncate">{f.name}</span>
            <button className="btn btn-sm btn-primary" onClick={() => downloadFile(f.index)}><Download size={14} /></button>
          </li>
        ))}
      </ul>

      {info.files.length > 1 && (
        <button className="btn btn-secondary w-full" onClick={() => downloadFile(undefined)}>
          <FolderArchive size={16} /> Download all as .zip
        </button>
      )}
    </div>
  );
}