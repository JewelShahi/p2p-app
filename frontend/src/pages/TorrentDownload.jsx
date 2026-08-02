import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Download, FolderArchive, File } from 'lucide-react';
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
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <div className="card bg-base-100 shadow-sm border border-base-300/50 px-10 py-8 flex flex-col items-center gap-4">
          <span className="loading loading-spinner loading-lg text-primary" />
          <p className="text-sm text-base-content/50 font-medium">Resolving magnet link...</p>
        </div>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4">
        <div className="card bg-base-100 shadow-sm border border-error/30 px-10 py-8 flex flex-col items-center gap-4 max-w-sm text-center">
          <div className="w-14 h-14 rounded-2xl bg-error/10 flex items-center justify-center">
            <FolderArchive size={24} className="text-error" />
          </div>
          <p className="text-sm font-semibold text-base-content/80">Could not resolve that magnet link.</p>
          <p className="text-xs text-base-content/40">The tracker might be offline or the link is invalid.</p>
          <button onClick={() => navigate('/')} className="btn btn-ghost btn-sm mt-2">Return Home</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">

      {/* ── Top Bar ── */}
      <div className="navbar bg-base-100 rounded-2xl shadow-sm border border-base-300/50 px-4 sm:px-6 mb-6">
        <div className="flex-1 gap-3">
          <div className="w-10 h-10 rounded-xl bg-secondary/10 flex items-center justify-center">
            <FolderArchive size={18} className="text-secondary" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight truncate">Torrent Download</p>
            <p className="text-xs text-base-content/40 font-mono truncate max-w-xs">Magnet link active</p>
          </div>
        </div>
        
        {info.files.length > 1 && (
          <div className="flex-none">
            <button 
              className="btn btn-secondary btn-sm gap-2 hidden sm:inline-flex" 
              onClick={() => downloadFile(undefined)}
            >
              <FolderArchive size={15} />
              Download .zip
            </button>
          </div>
        )}
      </div>

      {/* ── Mobile Download All ── */}
      {info.files.length > 1 && (
        <div className="sm:hidden mb-6">
          <button 
            className="btn btn-secondary w-full gap-2" 
            onClick={() => downloadFile(undefined)}
          >
            <FolderArchive size={16} />
            Download all as .zip
          </button>
        </div>
      )}

      {/* ── Bento Grid Layout ── */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 lg:gap-5">

        {/* ── File List (Left / Large) ── */}
        <div className="md:col-span-8">
          <div className="card bg-base-100 shadow-sm border border-base-300/50">
            <div className="card-body p-5 gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                    <File size={16} className="text-primary" />
                  </div>
                  <h2 className="card-title text-sm font-semibold">Included Files</h2>
                </div>
                <span className="badge badge-ghost badge-sm font-mono">
                  {info.files.length} item{info.files.length > 1 ? 's' : ''}
                </span>
              </div>

              {/* Scrollable File List */}
              <div className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
                {info.files.map((f) => (
                  <div 
                    key={f.index} 
                    className="flex items-center justify-between px-3 py-3 rounded-xl bg-base-200/30 hover:bg-primary/5 group transition-colors border border-transparent hover:border-primary/20"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <File size={14} className="text-base-content/20 shrink-0" />
                      <span className="truncate text-sm text-base-content/70 group-hover:text-base-content transition-colors">{f.name}</span>
                    </div>
                    
                    <button 
                      className="btn btn-primary btn-xs gap-1.5 shrink-0 ml-4 opacity-80 group-hover:opacity-100 transition-opacity"
                      onClick={() => downloadFile(f.index)}
                    >
                      <Download size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Side Panel (Right / Small) ── */}
        <div className="md:col-span-4 flex flex-col gap-4 lg:gap-5">
          
          {/* Torrent Info Card */}
          <div className="card bg-base-100 shadow-sm border border-base-300/50">
            <div className="card-body p-5 gap-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center">
                  <FolderArchive size={16} className="text-accent" />
                </div>
                <h2 className="card-title text-sm font-semibold">Details</h2>
              </div>
              
              <div className="space-y-3">
                <div className="pt-1">
                  <p className="text-[11px] text-base-content/30 uppercase tracking-widest font-medium mb-1.5">Name</p>
                  <p className="text-sm text-base-content/80 font-medium leading-snug break-words">{info.name}</p>
                </div>
                
                <div className="border-t border-base-300/50 pt-3 space-y-2.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-base-content/40">Total Size</span>
                    <span className="font-mono text-base-content/70 font-medium">{formatBytes(info.totalSize)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-base-content/40">Files</span>
                    <span className="font-mono text-base-content/70 font-medium">{info.files.length}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Single File Download Action (Only shows if 1 file) */}
          {info.files.length === 1 && (
            <div className="card bg-base-100 shadow-sm border border-base-300/50 flex-1">
              <div className="card-body p-5 justify-center gap-4">
                <h2 className="text-sm font-semibold">Ready to download</h2>
                <button 
                  className="btn btn-primary w-full gap-2" 
                  onClick={() => downloadFile(info.files[0].index)}
                >
                  <Download size={16} />
                  Download File
                </button>
              </div>
            </div>
          )}

          {/* Multiple Files Info Action (Only shows if > 1 file) */}
          {info.files.length > 1 && (
            <div className="card bg-base-100 shadow-sm border border-base-300/50 flex-1 hidden md:flex">
              <div className="card-body p-5 justify-center gap-4">
                <div>
                  <h2 className="text-sm font-semibold mb-1">Individual or Bulk?</h2>
                  <p className="text-xs text-base-content/40 leading-relaxed">
                    Click the download icon next to any file above, or use the "Download .zip" button to get everything at once.
                  </p>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}