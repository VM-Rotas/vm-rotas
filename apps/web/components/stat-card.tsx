import { Icon, type IconName } from './icons';

export function StatCard({
  label,
  value,
  detail,
  icon,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  detail?: string;
  icon: IconName;
  tone?: 'default' | 'success' | 'warning' | 'danger';
}) {
  return (
    <article className={`stat-card stat-card-${tone}`}>
      <div className="stat-icon"><Icon name={icon} /></div>
      <div>
        <span className="stat-label">{label}</span>
        <strong className="stat-value">{value}</strong>
        {detail ? <small>{detail}</small> : null}
      </div>
    </article>
  );
}
