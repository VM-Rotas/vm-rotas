import { Icon } from './icons';

export function LoadingBlock({ label = 'Carregando dados...' }: { label?: string }) {
  return <div className="loading-block"><span className="spinner" />{label}</div>;
}

export function ErrorBanner({ message }: { message: string }) {
  return <div className="alert alert-error"><Icon name="warning" /> <span>{message}</span></div>;
}

export function SuccessBanner({ message }: { message: string }) {
  return <div className="alert alert-success"><Icon name="check" /> <span>{message}</span></div>;
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon"><Icon name="routes" /></div>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}
