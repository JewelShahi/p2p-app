import { Copy, Check } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';

export default function ShareLink({ roomId }) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/join/${roomId}`;

  const copy = async () => {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    toast.success('Link copied');
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="join w-full max-w-xl">
      <input readOnly value={link} className="input input-bordered join-item w-full" />
      <button onClick={copy} className="btn btn-primary join-item">
        {copied ? <Check size={18} /> : <Copy size={18} />}
      </button>
    </div>
  );
}