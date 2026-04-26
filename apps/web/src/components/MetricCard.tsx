interface MetricCardProps {
  label: string;
  value: string | number;
  accent: "blue" | "red" | "green" | "amber";
  icon: string;
}

export function MetricCard({ label, value, accent, icon }: MetricCardProps) {
  return (
    <div className={`metric-card ${accent}`}>
      <div className="metric-icon">{icon}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-label">{label}</div>
    </div>
  );
}
