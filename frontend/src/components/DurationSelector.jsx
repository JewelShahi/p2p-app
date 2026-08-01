const OPTIONS = [];
for (let m = 10; m <= 60; m += 5) OPTIONS.push(m);

export default function DurationSelector({ value, onChange }) {
  return (
    <select className="select select-bordered w-full max-w-xs" value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {OPTIONS.map((m) => (
        <option key={m} value={m}>{m} minutes</option>
      ))}
    </select>
  );
}