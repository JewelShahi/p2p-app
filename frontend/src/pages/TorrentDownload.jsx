// TorrentDownload.jsx — CLIENT-SIDE torrenting (uses the phone/PC's resources)
import { useEffect, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Download, FolderArchive, ArrowLeft, Hash, HardDrive,
  File, FileText, Film, Music, Image, Archive, Disc,
  Settings, MessageSquare, FileCode, FolderOpen, Wifi, AlertTriangle, X
} from 'lucide-react';
import { formatBytes } from '../utils/formatBytes';
import {
  addTorrent, getTorrentInfo, downloadFileToDisk, downloadAllAsZip,
  removeTorrent, capabilities,
} from '../utils/clientTorrent';

const getFileIcon = (name) => {
  if (name.endsWith('.iso')) return Disc;
  if (/\.(zip|rar|7z|tar|gz|xz|bz2)$/i.test(name)) return Archive;
  if (/\.(mp4|mkv|avi|mov|wmv|flv|webm)$/i.test(name)) return Film;
  if (/\.(mp3|flac|wav|aac|ogg|wma|m4a)$/i.test(name)) return Music;
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

  const [dl, setDl] = useState('idle'); // idle | preparing | downloading | done | error
  const [progress, setProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState('');
  const [activeName, setActiveName] = useState('');

  const torrentRef = useRef(null);
  const controllerRef = useRef(null);
  const dlRef = useRef('idle');
  useEffect(() => { dlRef.current = dl; }, [dl]);

  // Resolve the torrent client-side (device does the work).
  useEffect(() => {
    if (!magnet) { navigate('/'); return; }
    if ((magnet.startsWith('http://') || magnet.startsWith('https://')) && !magnet.toLowerCase().endsWith('.torrent')) {
      setError('Direct file URLs are not supported. Paste a Magnet Link (magnet:?) or a .torrent URL.');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    addTorrent(magnet, { timeoutMs: 60000 })
      .then((torrent) => {
        if (cancelled) { removeTorrent(torrent); return; }
        torrentRef.current = torrent;
        setInfo(getTorrentInfo(torrent));
        // keep peer count fresh
        const iv = setInterval(() => {
          if (torrentRef.current) {
            setInfo((prev) => prev ? { ...prev, numPeers: torrentRef.current.numPeers } : prev);
          }
        }, 2000);
        torrent._peerIv = iv;
      })
      .catch((err) => { if (!cancelled) setError(err.message || 'Failed to resolve torrent.'); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => {
      cancelled = true;
      try { controllerRef.current?.cancel?.(); } catch {}
      if (torrentRef.current) {
        clearInterval(torrentRef.current._peerIv);
        removeTorrent(torrentRef.current);
        torrentRef.current = null;
      }
    };
  }, [magnet, navigate]);

  const commonHandlers = (name) => ({
    onStatus: (m) => setStatusMsg(m),
    onProgress: (frac) => { setProgress(frac); if (dlRef.current !== 'downloading') setDl('downloading'); },
    onDone: () => { setProgress(1); setDl('done'); setStatusMsg(''); toast.success(`${name} saved!`, { id: 'dl' }); },
    onError: (err) => {
      console.error('[torrent dl]', err);
      setDl('error');
      setStatusMsg(err?.message || 'Download failed');
      if (err?.code === 'NO_DISK_STREAM') {
        toast.error(err.message, { duration: 9000, id: 'dl' });
      } else {
        toast.error(err?.message || 'Download failed', { id: 'dl' });
      }
    },
  });

  const startFile = async (fileIndex, name) => {
    if (!torrentRef.current) return;
    setDl('preparing'); setProgress(0); setStatusMsg('Preparing…'); setActiveName(name);
    controllerRef.current = await downloadFileToDisk(torrentRef.current, fileIndex, commonHandlers(name));
  };

  const startZip = async () => {
    if (!torrentRef.current) return;
    const name = `${info.name}.zip`;
    setDl('preparing'); setProgress(0); setStatusMsg('Preparing zip…'); setActiveName(name);
    controllerRef.current = await downloadAllAsZip(torrentRef.current, commonHandlers(name));
  };

  const cancelDownload = () => {
    try { controllerRef.current?.cancel?.(); } catch {}
    controllerRef.current = null;
    setDl('idle'); setProgress(0); setStatusMsg(''); setActiveName('');
    toast('Download cancelled', { icon: '🛑', id: 'dl' });
  };

  const isBusy = dl === 'preparing' || dl === 'downloading';

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <span className="loading loading-spinner loading-lg text-primary" />
          </div>
          <p className="text-sm text-base-content/40 font-medium text-center">
            Resolving on your device…<br />
            <span className="text-xs text-base-content/30">(needs WebRTC/WSS seeders — can take 10–60s)</span>
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4">
        <div className="card bg-base-100 border border-error/20 px-8 py-7 max-w-lg w-full text-center">
          <div className="w-12 h-12 rounded-2xl bg-error/10 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={20} className="text-error" />
          </div>
          <p className="text-sm font-semibold mb-3">Could not resolve that link</p>
          <div className="bg-error/5 rounded-lg p-3 mb-5 text-left">
            <p className="text-xs text-error/70 font-mono break-words leading-relaxed">{error}</p>
          </div>
          <button onClick={() => navigate('/')} className="btn btn-primary btn-sm">Return Home</button>
        </div>
      </div>
    );
  }

  if (!info) return null;

  const isSingleFile = info.files.length === 1;

  return (
    <div className="min-h-[calc(100vh-4rem)] p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">

      {/* Top Bar */}
      <div className="navbar bg-base-100 rounded-2xl shadow-sm border border-base-300/50 px-4 sm:px-6 mb-6">
        <div className="flex-1 flex gap-3">
          <button onClick={() => navigate('/')} className="btn btn-ghost btn-sm btn-square shrink-0">
            <ArrowLeft size={16} />
          </button>
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <FolderArchive size={18} className="text-primary" />
          </div>
          <div className="flex flex-col justify-center min-w-0">
            <p className="text-sm font-semibold leading-tight truncate">{info.name}</p>
            <p className="text-[10px] text-base-content/30 font-mono">{info.infoHash?.slice(0, 16)}…</p>
          </div>
        </div>
        {typeof info.numPeers === 'number' && (
          <span className={`badge badge-sm gap-1 ${info.numPeers > 0 ? 'badge-success' : 'badge-warning'}`}>
            {info.numPeers} peer{info.numPeers === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {/* Device-mode banner */}
      <div className="alert bg-base-100 border border-base-300/50 mb-6 py-2.5">
        <Wifi size={16} className="text-primary" />
        <span className="text-xs text-base-content/60">
          Downloading on <b>your device</b> — files stream straight to disk to protect your memory.
          {capabilities.isIOS && ' On iPhone/iPad, very large files may be blocked (no disk-stream support).'}
        </span>
      </div>

      {/* Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 lg:gap-5">

        {/* Size */}
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

        {/* Files Count */}
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
                    <div key={f.index} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-base-200/40 text-sm group/item hover:bg-base-200/70 transition-colors">
                      <Icon size={14} className="text-base-content/20 shrink-0" />
                      <span className="truncate text-base-content/70 flex-1 min-w-0 group-hover/item:text-base-content transition-colors">
                        {f.path || f.name}
                      </span>
                      <span className="text-base-content/30 text-xs shrink-0 font-mono tabular-nums">
                        {formatBytes(f.size)}
                      </span>
                      {info.files.length > 1 && (
                        <button
                          className="btn btn-ghost btn-xs btn-circle shrink-0 opacity-0 group-hover/item:opacity-100 transition-opacity text-base-content/30 hover:text-primary"
                          onClick={() => startFile(f.index, f.name)}
                          title="Download this file to your device"
                          disabled={isBusy}
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

        {/* Download Actions */}
        <div className="md:col-span-4">
          <div className="card bg-base-100 shadow-sm border border-base-300/50 h-full">
            <div className="card-body p-5 gap-4 justify-between">
              <div>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-9 h-9 rounded-lg bg-success/10 flex items-center justify-center">
                    <Download size={16} className="text-success" />
                  </div>
                  <h2 className="text-sm font-semibold">Download to this device</h2>
                </div>

                {dl === 'done' ? (
                  <div className="bg-success/10 text-success rounded-lg p-3 text-xs">
                    ✓ {activeName} saved successfully!
                  </div>
                ) : dl === 'error' ? (
                  <div className="bg-error/10 text-error rounded-lg p-3 text-xs break-words">
                    {statusMsg || 'Download failed.'}
                  </div>
                ) : isBusy ? (
                  <div className="space-y-2">
                    <div className="bg-secondary/10 rounded-lg p-3">
                      <div className="flex justify-between text-xs mb-1.5">
                        <span className="text-secondary truncate pr-2">
                          {dl === 'preparing' ? (statusMsg || 'Preparing…') : (activeName || 'Downloading…')}
                        </span>
                        <span className="font-mono shrink-0">{Math.round(progress * 100)}%</span>
                      </div>
                      <progress className="progress progress-secondary w-full" value={progress} max="1" />
                    </div>
                    <p className="text-[10px] text-base-content/30 truncate">{statusMsg}</p>
                  </div>
                ) : (
                  <p className="text-xs text-base-content/40 leading-relaxed">
                    {isSingleFile
                      ? `${info.files[0].name} — ${formatBytes(info.files[0].size)}`
                      : `${info.files.length} files (${formatBytes(info.totalSize)}). Downloads as one .zip, streamed to disk.`}
                  </p>
                )}
              </div>

              <div className="w-full space-y-2">
                {isBusy ? (
                  <button className="btn btn-error btn-outline w-full gap-2" onClick={cancelDownload}>
                    <X size={16} /> Cancel
                  </button>
                ) : (
                  <button
                    className="btn btn-primary w-full gap-2"
                    onClick={() => (isSingleFile ? startFile(info.files[0].index, info.files[0].name) : startZip())}
                    disabled={dl === 'done'}
                  >
                    <Download size={16} />
                    {isSingleFile ? 'Download File' : 'Download All as .zip'}
                  </button>
                )}

                {dl === 'done' && (
                  <button className="btn btn-ghost btn-sm w-full" onClick={() => { setDl('idle'); setProgress(0); }}>
                    Download again
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
