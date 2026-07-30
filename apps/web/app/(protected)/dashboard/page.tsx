'use client';

import { EmptyState, ErrorBanner, LoadingBlock } from '@/components/feedback';
import { Icon } from '@/components/icons';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { StatusBadge } from '@/components/status-badge';
import { api, ApiError, queryString } from '@/lib/api';
import { formatDistance, formatDuration, formatTime, todayDateInput } from '@/lib/format';
import type { DashboardSummary } from '@/lib/types';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

export default function DashboardPage() {
  const [date, setDate] = useState(todayDateInput());
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api<DashboardSummary>(`/dashboard/summary${queryString({ date })}`));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível carregar o painel.');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  const metrics = data?.metrics;
  return (
    <>
      <PageHeader
        eyebrow="Central operacional"
        title="Visão geral do dia"
        description="Acompanhe pedidos, urgências, veículos e o progresso das rotas em uma única tela."
        actions={
          <div className="toolbar-group">
            <label className="compact-field"><span>Data operacional</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
            <button className="button button-secondary button-icon-text" onClick={() => void load()} disabled={loading}><Icon name="refresh" />Atualizar</button>
          </div>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}
      {loading && !data ? <LoadingBlock label="Carregando indicadores..." /> : null}

      {metrics ? (
        <>
          <section className="stats-grid">
            <StatCard icon="orders" label="Ordens do dia" value={metrics.totalOrders} detail={`${metrics.pendingOrders} ainda pendentes`} />
            <StatCard icon="warning" label="Urgências abertas" value={metrics.urgentOrders} detail="Prioridade máxima" tone={metrics.urgentOrders > 0 ? 'danger' : 'default'} />
            <StatCard icon="routes" label="Rotas em operação" value={metrics.activeRoutes} detail={`${metrics.completedRoutes} concluídas`} tone="warning" />
            <StatCard icon="vehicles" label="Veículos disponíveis" value={metrics.availableVehicles} detail="Prontos para roteirizar" tone="success" />
          </section>

          <section className="dashboard-grid">
            <article className="panel progress-panel">
              <div className="panel-heading">
                <div><span className="eyebrow">Desempenho</span><h2>Conclusão das ordens</h2></div>
                <strong className="large-percentage">{metrics.completionRate}%</strong>
              </div>
              <div className="progress-track large"><span style={{ width: `${metrics.completionRate}%` }} /></div>
              <div className="progress-legend">
                <span><i className="legend-dot done" />{metrics.completedOrders} concluídas</span>
                <span><i className="legend-dot pending" />{metrics.pendingOrders} pendentes</span>
              </div>
              <div className="progress-insight">
                <Icon name={metrics.urgentOrders ? 'warning' : 'check'} />
                <p>{metrics.urgentOrders ? `Existem ${metrics.urgentOrders} urgência(s) que podem exigir reotimização.` : 'Nenhuma urgência aberta para esta data.'}</p>
              </div>
            </article>

            <article className="panel action-panel">
              <div className="panel-heading"><div><span className="eyebrow">Próximo passo</span><h2>Planejar operação</h2></div></div>
              <p>Organize as ordens prontas entre os veículos disponíveis e gere a sequência ideal de paradas.</p>
              <Link className="button button-primary" href={`/routes?date=${date}`}>Abrir planejamento <Icon name="arrow" /></Link>
              <Link className="text-link" href={`/orders?date=${date}`}>Revisar entregas e coletas</Link>
            </article>
          </section>

          <section className="panel routes-overview">
            <div className="panel-heading">
              <div><span className="eyebrow">Rotas atuais</span><h2>Andamento da frota</h2></div>
              <Link className="text-link" href={`/routes?date=${date}`}>Ver planejamento completo <Icon name="arrow" /></Link>
            </div>
            {data.routes.length === 0 ? (
              <EmptyState title="Nenhuma rota criada" description="Gere o planejamento para distribuir as ordens entre os veículos." />
            ) : (
              <div className="route-summary-list">
                {data.routes.map((route) => {
                  const serviceStops = route.stops.filter((stop) => stop.type === 'SERVICE');
                  const completed = serviceStops.filter((stop) => stop.status === 'COMPLETED').length;
                  const percentage = serviceStops.length ? Math.round((completed / serviceStops.length) * 100) : 0;
                  const nextStop = serviceStops.find((stop) => !['COMPLETED', 'FAILED', 'SKIPPED'].includes(stop.status));
                  return (
                    <Link className="route-summary-card" href={`/routes?date=${date}#${route.id}`} key={route.id}>
                      <div className="vehicle-symbol"><Icon name="vehicles" /></div>
                      <div className="route-summary-main">
                        <div className="route-summary-title"><strong>{route.vehicle.name}</strong><span>{route.vehicle.plate}</span><StatusBadge value={route.status} compact /></div>
                        <div className="route-summary-metrics">
                          <span><Icon name="pin" />{serviceStops.length} paradas</span>
                          <span><Icon name="distance" />{formatDistance(route.totalDistanceMeters)}</span>
                          <span><Icon name="clock" />{formatDuration(route.totalDurationSeconds)}</span>
                        </div>
                        <div className="progress-track"><span style={{ width: `${percentage}%` }} /></div>
                        <small>{nextStop ? `Próxima: ${nextStop.label} · ${formatTime(nextStop.plannedArrivalAt)}` : 'Todas as paradas finalizadas'}</small>
                      </div>
                      <strong className="route-percentage">{percentage}%</strong>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
        </>
      ) : null}
    </>
  );
}
