'use client';

import { useAuth } from '@/components/auth-provider';
import { EmptyState, ErrorBanner, LoadingBlock, SuccessBanner } from '@/components/feedback';
import { Icon } from '@/components/icons';
import { PageHeader } from '@/components/page-header';
import { RouteMap } from '@/components/route-map';
import { StatusBadge } from '@/components/status-badge';
import { api, ApiError, queryString } from '@/lib/api';
import { formatDistance, formatDuration, formatTime, todayDateInput } from '@/lib/format';
import type { RoutePlan, RouteStop, ServiceOrder } from '@/lib/types';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface OptimizeResponse {
  provider: 'LOCAL' | 'GOOGLE';
  routes: RoutePlan[];
  skippedOrderIds: string[];
  warnings: string[];
}

const finishedStatuses = ['COMPLETED', 'FAILED', 'SKIPPED'];

export default function RoutesPage() {
  const { user } = useAuth();
  const [date, setDate] = useState(todayDateInput());
  const [routes, setRoutes] = useState<RoutePlan[]>([]);
  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [optimizing, setOptimizing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [urgentByRoute, setUrgentByRoute] = useState<Record<string, string>>({});
  const [busyStop, setBusyStop] = useState('');
  const [recalculating, setRecalculating] = useState('');
  const [provider, setProvider] = useState<'local' | 'google'>('local');
  const canPlan = Boolean(user && ['OWNER', 'ADMIN', 'DISPATCHER'].includes(user.role));
  const canExecute = Boolean(user && ['OWNER', 'ADMIN', 'DISPATCHER', 'DRIVER'].includes(user.role));

  useEffect(() => {
    const dateFromUrl = new URLSearchParams(window.location.search).get('date');
    if (dateFromUrl) setDate(dateFromUrl);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [routeData, orderData] = await Promise.all([
        api<RoutePlan[]>(`/routes${queryString({ date })}`),
        api<{ items: ServiceOrder[]; total: number }>(`/orders${queryString({ date, take: 100 })}`),
      ]);
      setRoutes(routeData);
      setOrders(orderData.items);
      if (!expanded && routeData[0]) setExpanded(routeData[0].id);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível carregar o planejamento.');
    } finally {
      setLoading(false);
    }
  }, [date, expanded]);

  useEffect(() => {
    void load();
    // A expansão atual não deve disparar uma nova consulta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const readyOrders = useMemo(
    () => orders.filter((order) => ['PLANNED', 'READY'].includes(order.status)),
    [orders],
  );
  const urgentOrders = useMemo(
    () => orders.filter((order) => order.priority === 'URGENT' && ['PLANNED', 'READY'].includes(order.status)),
    [orders],
  );

  async function optimize() {
    setOptimizing(true);
    setError('');
    setSuccess('');
    setWarnings([]);
    try {
      const result = await api<OptimizeResponse>('/routes/optimize', {
        method: 'POST',
        body: JSON.stringify({ routeDate: date, provider }),
      });
      setSuccess(`${result.routes.length} rota(s) gerada(s) pelo motor ${result.provider === 'GOOGLE' ? 'Google' : 'local'}.`);
      setWarnings(result.warnings);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível otimizar as rotas.');
    } finally {
      setOptimizing(false);
    }
  }

  async function recalculate(route: RoutePlan) {
    const urgentOrderId = urgentByRoute[route.id] || undefined;
    setRecalculating(route.id);
    setError('');
    setSuccess('');
    try {
      const result = await api<{ provider: string; warnings: string[] }>(`/routes/${route.id}/recalculate`, {
        method: 'POST',
        body: JSON.stringify({ urgentOrderId, provider }),
      });
      setSuccess(urgentOrderId ? 'Urgência inserida e trecho pendente recalculado.' : 'Trecho pendente recalculado.');
      setWarnings(result.warnings ?? []);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível recalcular a rota.');
    } finally {
      setRecalculating('');
    }
  }

  async function advanceStop(route: RoutePlan, stop: RouteStop) {
    const nextStatus = nextStopStatus(stop);
    if (!nextStatus) return;
    setBusyStop(stop.id);
    setError('');
    try {
      await api(`/routes/${route.id}/stops/${stop.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      setSuccess(`Parada atualizada para ${labelForStopStatus(nextStatus).toLowerCase()}.`);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível atualizar a parada.');
    } finally {
      setBusyStop('');
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Motor de decisão"
        title="Planejamento de rotas"
        description="Distribua a demanda, acompanhe a sequência de paradas e recalcule o restante do percurso quando surgir uma urgência."
        actions={
          <div className="toolbar-group">
            <label className="compact-field"><span>Data</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
            {canPlan ? <><label className="compact-field"><span>Motor</span><select value={provider} onChange={(event) => setProvider(event.target.value as 'local' | 'google')}><option value="local">Local</option><option value="google">Google</option></select></label>
            <button className="button button-primary" onClick={() => void optimize()} disabled={optimizing}>{optimizing ? <><span className="spinner small" />Otimizando...</> : <><Icon name="routes" />Gerar melhores rotas</>}</button></> : null}
          </div>
        }
      />
      {error ? <ErrorBanner message={error} /> : null}
      {success ? <SuccessBanner message={success} /> : null}
      {warnings.map((warning) => <div className="alert alert-warning" key={warning}><Icon name="warning" /><span>{warning}</span></div>)}

      <section className="planning-strip">
        <div><span>Ordens prontas</span><strong>{readyOrders.length}</strong></div>
        <div><span>Rotas ativas</span><strong>{routes.filter((route) => ['OPTIMIZED', 'IN_PROGRESS'].includes(route.status)).length}</strong></div>
        <div><span>Urgências abertas</span><strong>{urgentOrders.length}</strong></div>
        <div><span>Distância planejada</span><strong>{formatDistance(routes.reduce((sum, route) => sum + route.totalDistanceMeters, 0))}</strong></div>
      </section>

      {loading && routes.length === 0 ? <LoadingBlock label="Carregando planejamento..." /> : routes.length === 0 ? (
        <section className="panel"><EmptyState title="Ainda não existem rotas" description="Revise as ordens prontas e use “Gerar melhores rotas” para criar o planejamento do dia." /></section>
      ) : (
        <section className="route-planner-list">
          {routes.map((route) => {
            const isExpanded = expanded === route.id;
            const serviceStops = route.stops.filter((stop) => stop.type === 'SERVICE');
            const completed = serviceStops.filter((stop) => stop.status === 'COMPLETED').length;
            const percent = serviceStops.length ? Math.round((completed / serviceStops.length) * 100) : 0;
            const availableUrgencies = urgentOrders.filter(
              (order) => !route.stops.some((stop) => stop.serviceOrder?.id === order.id),
            );
            return (
              <article className="route-planner-card" id={route.id} key={route.id}>
                <button className="route-planner-header" onClick={() => setExpanded(isExpanded ? null : route.id)}>
                  <div className="vehicle-symbol large"><Icon name="vehicles" /></div>
                  <div className="route-header-main">
                    <div className="route-title-line"><h2>{route.vehicle.name}</h2><span>{route.vehicle.plate}</span><StatusBadge value={route.status} compact /><StatusBadge value={route.provider} compact /></div>
                    <div className="route-summary-metrics"><span><Icon name="pin" />{serviceStops.length} paradas</span><span><Icon name="distance" />{formatDistance(route.totalDistanceMeters)}</span><span><Icon name="clock" />{formatDuration(route.totalDurationSeconds)}</span><span>Revisão {route.revision}</span></div>
                    <div className="progress-track"><span style={{ width: `${percent}%` }} /></div>
                  </div>
                  <strong className="route-percentage">{percent}%</strong>
                  <span className={`chevron${isExpanded ? ' open' : ''}`}>⌄</span>
                </button>

                {isExpanded ? (
                  <div className="route-detail-grid">
                    <div className="route-map-column"><RouteMap stops={route.stops} encodedPolyline={route.encodedPolyline} /></div>
                    <div className="route-stops-column">
                      {canPlan ? <div className="route-tools">
                        <div><strong>Recalcular trecho pendente</strong><small>Inclua uma urgência ou apenas reorganize o restante da rota.</small></div>
                        <div className="recalculate-controls">
                          <select value={urgentByRoute[route.id] ?? ''} onChange={(event) => setUrgentByRoute({ ...urgentByRoute, [route.id]: event.target.value })}>
                            <option value="">Sem nova urgência</option>
                            {availableUrgencies.map((order) => <option key={order.id} value={order.id}>{order.code} · {order.recipientName}</option>)}
                          </select>
                          <button className="button button-secondary button-small" disabled={recalculating === route.id || route.status === 'COMPLETED'} onClick={() => void recalculate(route)}>{recalculating === route.id ? <span className="spinner small" /> : <Icon name="refresh" />}Recalcular</button>
                        </div>
                      </div> : null}
                      <div className="stop-timeline">
                        {route.stops.map((stop, index) => {
                          const next = nextStopStatus(stop);
                          return (
                            <div className={`stop-item stop-${stop.status.toLowerCase().replaceAll('_', '-')}`} key={stop.id}>
                              <div className="stop-line"><span className="stop-number">{stop.type === 'SERVICE' ? index : stop.type === 'DEPOT_START' ? 'S' : 'F'}</span></div>
                              <div className="stop-card">
                                <div className="stop-card-heading"><div><strong>{stop.label}</strong><small>{stop.address}</small></div><StatusBadge value={stop.status} compact /></div>
                                <div className="stop-meta"><span><Icon name="clock" />{formatTime(stop.plannedArrivalAt)}</span>{stop.distanceFromPreviousM > 0 ? <span><Icon name="distance" />{formatDistance(stop.distanceFromPreviousM)}</span> : null}{stop.serviceOrder ? <StatusBadge value={stop.serviceOrder.priority} compact /> : null}</div>
                                {canExecute && next ? <button className="button button-ghost button-small stop-action" disabled={busyStop === stop.id} onClick={() => void advanceStop(route, stop)}>{busyStop === stop.id ? <span className="spinner small" /> : <Icon name="check" />}{labelForAction(next)}</button> : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>
      )}
    </>
  );
}

function nextStopStatus(stop: RouteStop): UpdateStatus | null {
  if (finishedStatuses.includes(stop.status)) return null;
  if (stop.status === 'PENDING') return stop.type === 'DEPOT_START' ? 'COMPLETED' : 'EN_ROUTE';
  if (stop.status === 'EN_ROUTE') return 'ARRIVED';
  if (stop.status === 'ARRIVED') return 'COMPLETED';
  return null;
}

type UpdateStatus = 'EN_ROUTE' | 'ARRIVED' | 'COMPLETED' | 'FAILED' | 'SKIPPED';

function labelForStopStatus(status: UpdateStatus): string {
  return { EN_ROUTE: 'A caminho', ARRIVED: 'No local', COMPLETED: 'Concluída', FAILED: 'Falhou', SKIPPED: 'Pulada' }[status];
}

function labelForAction(status: UpdateStatus): string {
  return { EN_ROUTE: 'Iniciar deslocamento', ARRIVED: 'Marcar chegada', COMPLETED: 'Concluir parada', FAILED: 'Registrar falha', SKIPPED: 'Pular parada' }[status];
}
