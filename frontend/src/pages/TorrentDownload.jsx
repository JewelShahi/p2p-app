import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Download, FolderArchive, ArrowLeft, Hash, Shield, Server,
  File, FileText, Film, Music, Image, Archive, Disc,
  Settings, MessageSquare, FileCode, HardDrive
} from 'lucide-react';
import api from '../api/axios';
import { API_URL } from '../constants/config';
import { formatBytes } from '../utils/formatBytes';

const getFileIcon = (name) => {
  if (name.endsWith('.iso')) return Disc;
  if (/\.(zip|rar|7z|tar|gz)$/i.test(name)) return Archive;
  if (/\.(mp4|mkv|avi|mov|wmv|flv)$/i.test(name)) return Film;
  if (/\.(mp3|flac|wav|aac|ogg|wma)$/i.test(name)) return Music;
  if (name.endsWith('.pdf')) return FileText;
  if (/\.(exe|msi|dmg|app|deb|rpm)$/i.test(name)) return Settings;
  if (/\.(jpg|jpeg|png|webp|gif|bmp|svg)$/i.test(name)) return Image;
  if (/\.(txt|nfo|log|md)$/i.test(name)) return FileText;
  if (/\.(sub|srt|ass|ssa|vtt)$/i.test(name)) return MessageSquare;
  if (/\.(js|ts|py|html|css|json|xml|yml|yaml|sh|bat|c|cpp|java|rb|go|rs|php)$/i.test(name)) return FileCode;
  return File;
};

export default function TorrentDownload() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const magnet = state?.magnet;
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!magnet) {
      navigate('/');
      return;
    }
    setLoading(true);
    setError(null);

    api.get('/torrent/info', { params: { magnet } })
      .then((res) => {
        if (res.data.ok) {
          setInfo(res.data);
        } else {
          setError(res.data.error || 'Invalid torrent source');
        }
      })
      .catch((err) => {
        const msg = err.response?.data?.error || err.message || 'Network error or server crashed.';
        setError(msg);
      })
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
        <div className="flex flex-col items-center gap-4">
          <span className="loading loading-spinner loading-lg text-primary" />
          <p className="text-sm text-base-content/40 font-medium">Resolving torrent metadata...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4">
        <div className="card bg-base-100 border border-error/20 px-8 py-7 max-w-md w-full text-center">
          <div className="w-12 h-12 rounded-2xl bg-error/10 flex items-center justify-center mx-auto mb-4">
            <FolderArchive size={20} className="text-error" />
          </div>
          <p className="text-sm font-semibold mb-3">Could not resolve that link</p>
          <div className="bg-error/5 rounded-lg p-3 mb-4">
            <p className="text-xs text-error/70 font-mono break-words leading-relaxed">{error}</p>
          </div>
          <button onClick={() => navigate('/')} className="btn btn-ghost btn-sm">Return Home</button>
        </div>
      </div>
    );
  }

  if (!info) return null;

  const isSingleFile = info.files.length === 1;

  return (
    <div className="min-h-[calc(100vh-4rem)] p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto flex flex-col">

      {/* ── Header ── */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/')} className="btn btn-ghost btn-sm btn-square shrink-0">
          <ArrowLeft size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-base sm:text-lg font-bold truncate leading-tight">{info.name}</h1>
        </div>
      </div>

      {/* ── Stats + Download Row ── */}
      <div className="flex flex-wrap items-stretch gap-2.5 mb-5">
        <div className="flex items-center gap-2.5 bg-base-100 border border-base-300/50 rounded-xl px-4 py-2.5 flex-1 min-w-[130px]">
          <HardDrive size={15} className="text-primary/50 shrink-0" />
          <div className="min-w-0">
            <p className="text-[10px] text-base-content/35 uppercase tracking-wider leading-none mb-0.5">Size</p>
            <p className="text-sm font-bold leading-tight">{formatBytes(info.totalSize)}</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 bg-base-100 border border-base-300/50 rounded-xl px-4 py-2.5 flex-1 min-w-[110px]">
          <FolderArchive size={15} className="text-primary/50 shrink-0" />
          <div className="min-w-0">
            <p className="text-[10px] text-base-content/35 uppercase tracking-wider leading-none mb-0.5">Files</p>
            <p className="text-sm font-bold leading-tight">{info.files.length}</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 bg-base-100 border border-base-300/50 rounded-xl px-4 py-2.5 flex-[2] min-w-[220px]">
          <Hash size={15} className="text-primary/50 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] text-base-content/35 uppercase tracking-wider leading-none mb-0.5">Info Hash</p>
            <p className="text-xs font-mono text-base-content/50 truncate leading-tight">{info.infoHash}</p>
          </div>
        </div>

        <button
          className="btn btn-primary gap-2 shrink-0 w-full sm:w-auto"
          onClick={() => downloadFile(isSingleFile ? info.files[0].index : undefined)}
        >
          <Download size={15} />
          {isSingleFile ? 'Download' : 'Download All'}
        </button>
      </div>

      {/* ── File List ── */}
      <div className="bg-base-100 border border-base-300/50 rounded-xl overflow-hidden flex-1 flex flex-col mb-5">
        <div className="px-5 py-2.5 border-b border-base-300/40 bg-base-200/20">
          <h2 className="text-xs font-semibold text-base-content/50 uppercase tracking-wider">Included Files</h2>
        </div>
        <div className="divide-y divide-base-300/25 overflow-y-auto max-h-[52vh]">
          {info.files.map((f) => {
            const Icon = getFileIcon(f.name);
            return (
              <div
                key={f.index}
                className="flex items-center gap-3 px-5 py-2.5 hover:bg-primary/[0.03] group transition-colors"
              >
                <div className="w-8 h-8 rounded-lg bg-base-200/60 flex items-center justify-center shrink-0">
                  <Icon size={15} className="text-base-content/35" />
                </div>
                <span className="text-sm truncate flex-1 text-base-content/75 group-hover:text-base-content transition-colors">{f.name}</span>
                <span className="text-xs font-mono text-base-content/30 shrink-0 tabular-nums">{formatBytes(f.size)}</span>
                {info.files.length > 1 && (
                  <button
                    className="btn btn-ghost btn-xs btn-circle shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-base-content/30 hover:text-primary"
                    onClick={() => downloadFile(f.index)}
                    title="Download this file"
                  >
                    <Download size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="flex items-center justify-center gap-5 sm:gap-7 text-[11px] text-base-content/20 pb-2">
        <div className="flex items-center gap-1.5">
          <Server size={11} />
          <span>WebTorrent</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Shield size={11} />
          <span>No tracking</span>
        </div>
        <div className="flex items-center gap-1.5">
          <HardDrive size={11} />
          <span>P2P streaming</span>
        </div>
      </div>
    </div>
  );
}