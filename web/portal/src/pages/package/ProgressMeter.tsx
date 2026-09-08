export function ProgressMeter({ percent, label }: { percent: number; label?: string }) {
  const safe = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  return (
    <div className="progress-meter" title={label ?? `${safe}%`}>
      <div className="progress-meter-track">
        <div className="progress-meter-fill" style={{ width: `${safe}%` }} />
      </div>
      <span className="progress-meter-label">{safe}%</span>
    </div>
  );
}
