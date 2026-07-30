const labels: Record<string, string> = {
  PLANNED: 'Planejada',
  READY: 'Pronta',
  ROUTED: 'Roteirizada',
  IN_PROGRESS: 'Em andamento',
  COMPLETED: 'Concluída',
  FAILED: 'Falhou',
  CANCELLED: 'Cancelada',
  DRAFT: 'Rascunho',
  OPTIMIZED: 'Otimizada',
  SUPERSEDED: 'Substituída',
  AVAILABLE: 'Disponível',
  IN_ROUTE: 'Em rota',
  MAINTENANCE: 'Manutenção',
  INACTIVE: 'Inativo',
  PENDING: 'Pendente',
  EN_ROUTE: 'A caminho',
  ARRIVED: 'No local',
  SKIPPED: 'Pulada',
  URGENT: 'Urgente',
  HIGH: 'Alta',
  NORMAL: 'Normal',
  LOW: 'Baixa',
  LOCAL: 'Local',
  GOOGLE: 'Google',
};

export function StatusBadge({ value, compact = false }: { value: string; compact?: boolean }) {
  const normalized = value.toLowerCase().replaceAll('_', '-');
  return (
    <span className={`badge badge-${normalized}${compact ? ' badge-compact' : ''}`}>
      {labels[value] ?? value}
    </span>
  );
}
