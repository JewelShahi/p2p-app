export default function TransferProgress({ label, progress }) {
  return (
    <div className="w-full max-w-xl">
      <div className="flex justify-between text-sm mb-1">
        <span className="truncate">{label}</span>
        <span>{Math.round(progress * 100)}%</span>
      </div>
      <progress className="progress progress-primary w-full" value={progress * 100} max="100" />
    </div>
  );
}