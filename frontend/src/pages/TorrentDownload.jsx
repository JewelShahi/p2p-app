import { useEffect, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Download, FolderArchive, ArrowLeft, Hash, Shield, Server,
  File, FileText, Film, Music, Image, Archive, Disc,
  Settings, MessageSquare, FileCode, HardDrive, FolderOpen, Wifi
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

  // --- NEW: WebSocket State ---
  const [wsStatus, setWsStatus] = useState('idle');
  const [wsProgress, setWsProgress] = useState(0);
  const wsRef = useRef(null);
  const writableRef = useRef(null);
  const isDownloading = wsStatus === 'connecting' || wsStatus === 'writing';

  useEffect(() => {
    return () => {
      wsRef.current?.close();
      writableRef.current?.abort();
    };
  }, []);
  // ----------------------------

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

  // --- NEW: WebSocket Stream Download Function ---
  const downloadFileWs = async (fileIndex) => {
    if (!window.showSaveFilePicker) {
      toast.error('Streaming requires a modern desktop browser (Chrome/Edge). Use the standard download for mobile.', { duration: 5000, id: 'ws-err' });
      return;
    }

    let fileHandle;
    try {
      const fileName = info.files.length === 1 ? info.files[0].name : `${info.name}.zip`;
      fileHandle = await window.showSaveFilePicker({ suggestedName: fileName });
    } catch (err) {
      if (err.name !== 'AbortError') toast.error('Could not get save location', { id: 'ws-err' });
      return;
    }

    setWsStatus('connecting');
    setWsProgress(0);

    const wsUrl = `${API_URL.replace(/^http/, 'ws')}/ws-download`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    let receivedBytes = 0;
    let totalBytes = 0;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'start', magnet, fileIndex }));
    };

    ws.onmessage = async (event) => {
      if (typeof event.data === 'string') {
        const msg = JSON.parse(event.data);
        
        if (msg.type === 'meta') {
          totalBytes = msg.size;
          try {
            writableRef.current = await fileHandle.createWritable();
            setWsStatus('writing');
            toast.success('Stream connected! Writing to disk...', { id: 'ws-status' });
          } catch (err) {
            toast.error('Failed to open file for writing', { id: 'ws-err' });
            ws.close();
          }
        } else if (msg.type === 'done') {
          await writableRef.current?.close();
          setWsStatus('done');
          setWsProgress(1);
          toast.success('Download complete!', { id: 'ws-status' });
          ws.close();
        } else if (msg.type === 'error') {
          await writableRef.current?.abort();
          setWsStatus('error');
          toast.error(msg.message, { id: 'ws-err' });
          ws.close();
        }
        return;
      }

      if (writableRef.current && ws.readyState === WebSocket.OPEN) {
        await writableRef.current.write(event.data);
        receivedBytes += event.data.byteLength;
        if (totalBytes > 0) {
          setWsProgress(Math.min(receivedBytes / totalBytes, 0.99));
        }
      }
    };

    ws.onerror = () => {
      setWsStatus('error');
      toast.error('WebSocket connection failed', { id: 'ws-err' });
      writableRef.current?.abort();
    };

    ws.onclose = () => {
      if (wsStatus !== 'done' && wsStatus !== 'error') {
        setWsStatus('error');
        toast.error('Connection closed unexpectedly', { id: 'ws-err' });
      }
      writableRef.current?.abort();
    };
  };
  // -------------------------------------------

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <span className="loading loading-spinner loading-lg text-primary" />
          </div>
          <p className="text-sm text-base-content/40 font-medium">Resolving torrent metadata…</p>
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
          <div className="bg-error/5 rounded-lg p-3 mb-5">
            <p className="text-xs text-error/70 font-mono break-words leading-relaxed">{error}</p>
          </div>
          <button onClick={() => navigate('/')} className="btn btn-primary btn-sm">Return Home</button>
        </div>
      </div>
    );
  }

  if (!info) return null;

  const isSingleFile = info.files.length === 1;
  const canStream = typeof window.showSaveFilePicker === 'function';

  return (
    <div className="min-h-[calc(100vh-4rem)] p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">

      {/* ── Top Bar ── */}
      <div className="navbar bg-base-100 rounded-2xl shadow-sm border border-base-300/50 px-4 sm:px-6 mb-6">
        <div className="flex-1 flex gap-3">
          <button onClick={() => navigate('/')} className="btn btn-ghost btn-sm btn-square shrink-0">
            <ArrowLeft size={16} />
          </button>
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <FolderArchive size={18} className="text-primary" />
          </div>
          <p className="text-sm flex justify-center items-center font-semibold leading-tight">Torrent Download</p>
        </div>

      </div>

      {/* ── Bento Grid ── */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 lg:gap-5">

        {/* Size Stat */}
        <div className="md:col-span-4">
          <div className="card bg-base-100 shadow-sm border border-base-300/50 h-full">
            <div className="card-body p-5 items-center text-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-1">
                <HardDrive size={18} className="text-primary" />
              </div>
              <p className="text-3xl font-bold leading-none">{formatBytes(info.totalSize)}</p>
              <p className="text-[11px] text-base-content/40 uppercase tracking-widest font-medium">Size</p>
            </div>
          </div>
        </div>

        {/* Files Stat */}
        <div className="md:col-span-4">
          <div className="card bg-base-100 shadow-sm border border-base-300/50 h-full">
            <div className="card-body p-5 items-center text-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center mb-1">
                <FolderOpen size={18} className="text-accent" />
              </div>
              <p className="text-3xl font-bold leading-none">{info.files.length}</p>
              <p className="text-[11px] text-base-content/40 uppercase tracking-widest font-medium">Files</p>
            </div>
          </div>
        </div>

        {/* Info Hash */}
        <div className="md:col-span-4">
          <div className="card bg-base-100 shadow-sm border border-base-300/50 h-full">
            <div className="card-body p-5 gap-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-secondary/10 flex items-center justify-center">
                  <Hash size={16} className="text-secondary" />
                </div>
                <h2 className="card-title text-sm font-semibold">Info Hash</h2>
              </div>
              <div className="bg-base-200/40 rounded-lg px-3 py-2.5">
                <p className="text-xs text-base-content/50 font-mono break-all leading-relaxed">{info.infoHash}</p>
              </div>
            </div>
          </div>
        </div>

        {/* File List */}
        <div className="md:col-span-8">
          <div className="card bg-base-100 shadow-sm border border-base-300/50 h-full">
            <div className="card-body p-5 gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                    <FolderOpen size={16} className="text-primary" />
                  </div>
                  <h2 className="card-title text-sm font-semibold">Included Files</h2>
                </div>
                <span className="badge badge-ghost badge-sm font-mono">
                  {info.files.length} item{info.files.length > 1 ? 's' : ''}
                </span>
              </div>

              <div className="space-y-1.5 max-h-[50vh] overflow-y-auto pr-1">
                {info.files.map((f) => {
                  const Icon = getFileIcon(f.name);
                  return (
                    <div
                      key={f.index}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-base-200/40 text-sm group/item hover:bg-base-200/70 transition-colors"
                    >
                      <Icon size={14} className="text-base-content/20 shrink-0" />
                      <span className="truncate text-base-content/70 flex-1 min-w-0 group-hover/item:text-base-content transition-colors">{f.name}</span>
                      <span className="text-base-content/30 text-xs shrink-0 font-mono tabular-nums">{formatBytes(f.size)}</span>
                      {info.files.length > 1 && (
                        <button
                          className="btn btn-ghost btn-xs btn-circle shrink-0 opacity-0 group-hover/item:opacity-100 transition-opacity text-base-content/30 hover:text-primary"
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
          </div>
        </div>

        {/* Download Action */}
        <div className="md:col-span-4">
          <div className="card bg-base-100 shadow-sm border border-base-300/50 h-full">
            <div className="card-body p-5 gap-4 justify-between">
              <div>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-9 h-9 rounded-lg bg-success/10 flex items-center justify-center">
                    <Download size={16} className="text-success" />
                  </div>
                  <h2 className="text-sm font-semibold">Ready to download?</h2>
                </div>
                <p className="text-xs text-base-content/40 leading-relaxed">
                  {wsStatus === 'done' 
                    ? 'File successfully saved to your disk.'
                    : isSingleFile
                      ? `${info.files[0].name} — ${formatBytes(info.files[0].size)}. Click below to start.`
                      : `${info.files.length} files totaling ${formatBytes(info.totalSize)}. Download everything as a zip, or hover individual files.`
                  }
                </p>
              </div>

              <div className="w-full space-y-2">
                {/* NEW: Stream Button (Desktop only) */}
                {canStream && (
                  <button
                    className={`btn btn-secondary w-full gap-2 ${isDownloading ? 'loading' : ''}`}
                    onClick={() => downloadFileWs(isSingleFile ? info.files[0].index : undefined)}
                    disabled={isDownloading}
                  >
                    <Wifi size={16} />
                    {isDownloading ? `Streaming ${Math.round(wsProgress * 100)}%` : 'Stream (No size limit)'}
                  </button>
                )}

                {/* Existing HTTP Button */}
                <button
                  className="btn btn-primary w-full gap-2"
                  onClick={() => downloadFile(isSingleFile ? info.files[0].index : undefined)}
                  disabled={isDownloading}
                >
                  <Download size={16} />
                  {isSingleFile ? 'Download File' : 'Download All as .zip'}
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}