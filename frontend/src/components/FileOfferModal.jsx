import { useState } from 'react';
import { X, Download, FolderArchive, Files } from 'lucide-react';
import { formatBytes } from '../utils/formatBytes';

export default function FileOfferModal({ offer, onRespond }) {
  const [mode, setMode] = useState('individual');
  if (!offer) return null;

  return (
    <div className="modal modal-open">
      <div className="modal-box">
        <h3 className="font-bold text-lg flex items-center gap-2">
          <Download size={20} /> Incoming files
        </h3>
        <p className="py-2 text-sm opacity-70">
          {offer.files.length} file{offer.files.length > 1 ? 's' : ''} · {formatBytes(offer.totalSize)}
        </p>

        <ul className="max-h-40 overflow-y-auto text-sm mb-4 space-y-1">
          {offer.files.map((f) => (
            <li key={f.id} className="flex justify-between border-b border-base-300 py-1">
              <span className="truncate">{f.name}</span>
              <span className="opacity-60">{formatBytes(f.size)}</span>
            </li>
          ))}
        </ul>

        {offer.files.length > 1 && (
          <div className="flex gap-2 mb-4">
            <button className={`btn btn-sm flex-1 ${mode === 'individual' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setMode('individual')}>
              <Files size={16} /> One by one
            </button>
            <button className={`btn btn-sm flex-1 ${mode === 'zip' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setMode('zip')}>
              <FolderArchive size={16} /> As .zip
            </button>
          </div>
        )}

        <div className="modal-action">
          <button className="btn btn-ghost" onClick={() => onRespond(false, mode)}>
            <X size={16} /> Decline
          </button>
          <button className="btn btn-primary" onClick={() => onRespond(true, mode)}>
            <Download size={16} /> Download
          </button>
        </div>
      </div>
    </div>
  );
}