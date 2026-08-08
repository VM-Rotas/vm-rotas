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

interface AutomaticUrgencyResponse {
  selectedVehicle: { id: string; name: string; plate: string };
  estimatedAddedDurationSeconds: number;
  warnings?: string[];
}

interface MissionGroup {
  key: string;
  orders: ServiceOrder[];
  representative: ServiceOrder;
}

function groupOrdersByMission(orders: ServiceOrder[]): MissionGroup[] {
  const groups = new Map<string, ServiceOrder[]>();
  for (const order of orders) {
    const key = order.externalReference?.startsWith('MIS-')
      ? order.externalReference
      : order.code;
    groups.set(key, [...(groups.get(key) ?? []), order]);
  }
  return [...groups.entries()].flatMap(([key, groupedOrders]) => {
    const representative = groupedOrders[0];
    return representative ? [{ key, orders: groupedOrders, representative }] : [];
  });
}

function missionDescription(mission: MissionGroup): string {
  const typeRank: Record<ServiceOrder['type'], number> = { PICKUP: 0, DELIVERY: 1 };
  return [...mission.orders]
    .sort((left, right) => typeRank[left.type] - typeRank[right.type])
    .map((order) => `${order.type === 'PICKUP' ? 'Coletar' : 'Entregar'} em ${order.recipientName}`)
    .join(' → ');
}

function stopIsLate(stop: RouteStop): boolean {
  if (!stop.plannedArrivalAt || !stop.serviceOrder?.timeWindowEnd) return false;
  return new Date(stop.plannedArrivalAt).getTime() > new Date(stop.serviceOrder.timeWindowEnd).getTime();
}

const finishedStatuses = ['COMPLETED', 'FAILED', 'SKIPPED'];
const activeRouteStatuses = ['OPTIMIZED', 'IN_PROGRESS'];

function validStopCoordinates(stop: RouteStop): { latitude: number; longitude: number } | null {
  const orderLatitude = Number(stop.serviceOrder?.latitude);
  const orderLongitude = Number(stop.serviceOrder?.longitude);
  if (Number.isFinite(orderLatitude) && Number.isFinite(orderLongitude)) {
    return { latitude: orderLatitude, longitude: orderLongitude };
  }

  const latitude = Number(stop.latitude);
  const longitude = Number(stop.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function serviceOrderFullAddress(stop: RouteStop): string {
  const order = stop.serviceOrder;
  if (!order) return stop.address || stop.label;

  const street = [order.addressLine, order.addressNumber].filter(Boolean).join(', ');
  const locality = [order.neighborhood, `${order.city} - ${order.state}`, order.postalCode]
    .filter(Boolean)
    .join(', ');
  return [street, order.addressComplement, locality].filter(Boolean).join(', ')
    || order.formattedAddress
    || stop.address
    || stop.label;
}

function stopNavigationDestination(stop: RouteStop): string {
  const coordinates = validStopCoordinates(stop);
  if (coordinates) return `${coordinates.latitude},${coordinates.longitude}`;
  return serviceOrderFullAddress(stop);
}

function googleMapsStopUrl(stop: RouteStop): string {
  return `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(stopNavigationDestination(stop))}`;
}

function wazeStopUrl(stop: RouteStop): string {
  const coordinates = validStopCoordinates(stop);
  if (coordinates) {
    return `https://www.waze.com/ul?ll=${encodeURIComponent(`${coordinates.latitude},${coordinates.longitude}`)}&navigate=yes`;
  }
  return `https://www.waze.com/ul?q=${encodeURIComponent(stopNavigationDestination(stop))}&navigate=yes`;
}

function remainingNavigationStops(route: RoutePlan): RouteStop[] {
  return route.stops.filter(
    (stop) => stop.type !== 'DEPOT_START' && !finishedStatuses.includes(stop.status),
  );
}

function googleMapsRouteUrl(route: RoutePlan): string | null {
  const remainingStops = remainingNavigationStops(route);
  const destination = remainingStops.at(-1);
  if (!destination) return null;

  const params = new URLSearchParams({
    api: '1',
    travelmode: 'driving',
    destination: stopNavigationDestination(destination),
  });
  const waypoints = remainingStops.slice(0, -1).map(stopNavigationDestination);
  if (waypoints.length > 0) params.set('waypoints', waypoints.join('|'));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

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
  const [busyStop, setBusyStop] = useState('');
  const [recalculating, setRecalculating] = useState('');
  const [autoUrgentId, setAutoUrgentId] = useState('');
  const [autoRecalculating, setAutoRecalculating] = useState(false);
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
      const routeData = await api<RoutePlan[]>(`/routes${queryString({ date })}`);
      const orderData = user?.role === 'DRIVER'
        ? { items: [] as ServiceOrder[], total: 0 }
        : await api<{ items: ServiceOrder[]; total: number }>(
            `/orders${queryString({ date, take: 200 })}`,
          );
      setRoutes(routeData);
      setOrders(orderData.items);
      setExpanded((current) => current ?? routeData[0]?.id ?? null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível carregar o planejamento.');
    } finally {
      setLoading(false);
    }
  }, [date, user?.role]);

  useEffect(() => {
    void load();
  }, [load]);

  const missionGroups = useMemo(() => groupOrdersByMission(orders), [orders]);
  const readyMissions = useMemo(
    () => missionGroups.filter((mission) => mission.orders.some((order) => ['PLANNED', 'READY'].includes(order.status))),
    [missionGroups],
  );
  const urgentMissions = useMemo(
    () => readyMissions.filter((mission) => mission.orders.some((order) => order.priority === 'URGENT')),
    [readyMissions],
  );
  const activeRoutes = useMemo(
    () => routes.filter((route) => activeRouteStatuses.includes(route.status)),
    [routes],
  );
  const routedOrderIds = useMemo(
    () => new Set(activeRoutes.flatMap((route) => route.stops.flatMap((stop) => stop.serviceOrder?.id ? [stop.serviceOrder.id] : []))),
    [activeRoutes],
  );
  const availableUrgencies = useMemo(
    () => urgentMissions.filter((mission) => mission.orders.every((order) => !routedOrderIds.has(order.id))),
    [urgentMissions, routedOrderIds],
  );

  useEffect(() => {
    if (autoUrgentId && availableUrgencies.some((mission) => mission.representative.id === autoUrgentId)) return;
    setAutoUrgentId(availableUrgencies[0]?.representative.id ?? '');
  }, [autoUrgentId, availableUrgencies]);

  async function optimize() {
    setOptimizing(true);
    setError('');
    setSuccess('');
    setWarnings([]);
    try {
      const result = await api<OptimizeResponse>('/routes/optimize', {
        method: 'POST',
        body: JSON.stringify({ routeDate: date, provider: 'local' }),
      });
      setSuccess(`${result.routes.length} rota(s) automática(s) gerada(s), considerando prioridade, horário desejado e tempo por estrada.`);
      setWarnings(result.warnings);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível gerar as rotas automáticas.');
    } finally {
      setOptimizing(false);
    }
  }

  async function recalculate(route: RoutePlan) {
    setRecalculating(route.id);
    setError('');
    setSuccess('');
    try {
      const result = await api<{ provider: string; warnings: string[] }>(`/routes/${route.id}/recalculate`, {
        method: 'POST',
        body: JSON.stringify({ provider: 'local' }),
      });
      setSuccess(`O trecho pendente de ${route.vehicle.name} foi reorganizado. Paradas já concluídas e a parada em andamento foram preservadas.`);
      setWarnings(result.warnings ?? []);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível recalcular a rota.');
    } finally {
      setRecalculating('');
    }
  }

  async function insertUrgency() {
    if (!autoUrgentId) return;
    setAutoRecalculating(true);
    setError('');
    setSuccess('');
    setWarnings([]);
    try {
      const result = await api<AutomaticUrgencyResponse>('/routes/recalculate-urgent', {
        method: 'POST',
        body: JSON.stringify({ urgentOrderId: autoUrgentId }),
      });
      setSuccess(`Urgência inserida automaticamente na rota de ${result.selectedVehicle.name} (${result.selectedVehicle.plate}). Acréscimo estimado: ${formatDuration(result.estimatedAddedDurationSeconds)}.`);
      setWarnings(result.warnings ?? []);
      setAutoUrgentId('');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível inserir a urgência automaticamente.');
    } finally {
      setAutoRecalculating(false);
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
        eyebrow="Planejamento automático"
        title="Rotas do dia"
        description="O VM Rotas distribui as missões entre os veículos e define a melhor sequência usando prioridade, horário desejado, tempo estimado por estrada e a regra coleta antes da entrega."
        actions={
          <div className="toolbar-group">
            <label className="compact-field"><span>Data</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
            {canPlan ? (
              <button className="button button-primary" onClick={() => void optimize()} disabled={optimizing}>
                {optimizing ? <><span className="spinner small" />Calculando...</> : <><Icon name="routes" />Gerar rotas automáticas</>}
              </button>
            ) : null}
          </div>
        }
      />
      {error ? <ErrorBanner message={error} /> : null}
      {success ? <SuccessBanner message={success} /> : null}
      {warnings.map((warning) => <div className="alert alert-warning" key={warning}><Icon name="warning" /><span>{warning}</span></div>)}

      <section className="planning-strip">
        <div><span>Missões prontas</span><strong>{readyMissions.length}</strong></div>
        <div><span>Rotas ativas</span><strong>{activeRoutes.length}</strong></div>
        <div><span>Urgências fora da rota</span><strong>{availableUrgencies.length}</strong></div>
        <div><span>Distância planejada</span><strong>{formatDistance(routes.reduce((sum, route) => sum + route.totalDistanceMeters, 0))}</strong></div>
      </section>

      <section className="route-decision-note">
        <Icon name="clock" />
        <div>
          <strong>Como a ordem é decidida</strong>
          <span>Urgente vem antes de alta, normal e baixa. Dentro da mesma prioridade, o sistema considera o horário desejado e o menor tempo de deslocamento por estrada.</span>
        </div>
      </section>

      {canPlan && availableUrgencies.length > 0 ? (
        <section className="urgent-routing-panel">
          <div className="urgent-routing-copy">
            <span className="urgent-routing-icon"><Icon name="warning" /></span>
            <div>
              <strong>Entrou uma urgência no meio do caminho?</strong>
              <small>Escolha a missão. O sistema compara os veículos, insere no que causar menor impacto e recalcula somente as paradas pendentes.</small>
            </div>
          </div>
          <div className="urgent-routing-actions">
            <select value={autoUrgentId} onChange={(event) => setAutoUrgentId(event.target.value)}>
              {availableUrgencies.map((mission) => (
                <option key={mission.key} value={mission.representative.id}>
                  {missionDescription(mission)}
                </option>
              ))}
            </select>
            <button className="button button-danger" disabled={!autoUrgentId || autoRecalculating || activeRoutes.length === 0} onClick={() => void insertUrgency()}>
              {autoRecalculating ? <><span className="spinner small" />Recalculando...</> : <><Icon name="refresh" />Inserir e recalcular</>}
            </button>
          </div>
          {activeRoutes.length === 0 ? <p>Gere as rotas do dia antes de inserir a urgência.</p> : null}
        </section>
      ) : null}

      {loading && routes.length === 0 ? <LoadingBlock label="Carregando planejamento..." /> : routes.length === 0 ? (
        <section className="panel"><EmptyState title="Ainda não existem rotas" description="Cadastre as missões do período e use “Gerar rotas automáticas”. O sistema fará a divisão entre os dois veículos." /></section>
      ) : (
        <section className="route-planner-list">
          {routes.map((route) => {
            const isExpanded = expanded === route.id;
            const serviceStops = route.stops.filter((stop) => stop.type === 'SERVICE');
            const completed = serviceStops.filter((stop) => stop.status === 'COMPLETED').length;
            const percent = serviceStops.length ? Math.round((completed / serviceStops.length) * 100) : 0;
            const routeNavigationUrl = googleMapsRouteUrl(route);
            const nextNavigationStop = remainingNavigationStops(route)[0] ?? null;
            return (
              <article className="route-planner-card" id={route.id} key={route.id}>
                <button className="route-planner-header" onClick={() => setExpanded(isExpanded ? null : route.id)}>
                  <div className="vehicle-symbol large"><Icon name="vehicles" /></div>
                  <div className="route-header-main">
                    <div className="route-title-line"><h2>{route.vehicle.name}</h2><span>{route.vehicle.plate}</span>{route.driver ? <span>Motorista: {route.driver.name}</span> : null}<StatusBadge value={route.status} compact /></div>
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
                      {canExecute && (routeNavigationUrl || nextNavigationStop) ? (
                        <div className="route-tools">
                          <div>
                            <strong>Navegação do motorista</strong>
                            <small>Abra o trajeto restante no Google Maps ou siga diretamente para a próxima parada pelo Waze.</small>
                          </div>
                          <div className="recalculate-controls">
                            {routeNavigationUrl ? (
                              <a className="button button-primary button-small" href={routeNavigationUrl} target="_blank" rel="noreferrer">
                                <Icon name="routes" />Abrir rota no Google Maps
                              </a>
                            ) : null}
                            {nextNavigationStop ? (
                              <a className="button button-secondary button-small" href={wazeStopUrl(nextNavigationStop)} target="_blank" rel="noreferrer">
                                <Icon name="arrow" />Próxima parada no Waze
                              </a>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                      {canPlan ? (
                        <div className="route-tools">
                          <div><strong>Recalcular somente o restante</strong><small>As paradas concluídas e a parada em andamento ficam travadas; apenas as próximas são reorganizadas.</small></div>
                          <button className="button button-secondary button-small" disabled={recalculating === route.id || route.status === 'COMPLETED'} onClick={() => void recalculate(route)}>
                            {recalculating === route.id ? <span className="spinner small" /> : <Icon name="refresh" />}Recalcular restante
                          </button>
                        </div>
                      ) : null}
                      <div className="stop-timeline">
                        {route.stops.map((stop, index) => {
                          const next = nextStopStatus(stop);
                          const late = stopIsLate(stop);
                          const actualCompletionAt = stop.actualDepartureAt ?? stop.actualArrivalAt;
                          const completedAt = stop.status === 'COMPLETED' && actualCompletionAt
                            ? formatTime(actualCompletionAt)
                            : '';
                          return (
                            <div className={`stop-item stop-${stop.status.toLowerCase().replaceAll('_', '-')}`} key={stop.id}>
                              <div className="stop-line"><span className="stop-number">{stop.type === 'SERVICE' ? index : stop.type === 'DEPOT_START' ? 'S' : 'F'}</span></div>
                              <div className={`stop-card${late ? ' is-late' : ''}`}>
                                <div className="stop-card-heading"><div><strong>{stop.label}</strong><small>{stop.address}</small></div><StatusBadge value={stop.status} compact /></div>
                                {stop.notes ? <p className="stop-notes">{stop.notes.split('\n')[0]}</p> : null}
                                <div className="stop-meta">
                                  <span><Icon name="clock" />Prevista {formatTime(stop.plannedArrivalAt)}</span>
                                  {stop.serviceOrder?.timeWindowStart ? <span className={late ? 'late-time' : ''}>Desejada {formatTime(stop.serviceOrder.timeWindowStart)}</span> : null}
                                  {stop.distanceFromPreviousM > 0 ? <span><Icon name="distance" />{formatDistance(stop.distanceFromPreviousM)}</span> : null}
                                  {stop.serviceOrder ? <StatusBadge value={stop.serviceOrder.priority} compact /> : null}
                                </div>
                                {completedAt ? <div className="stop-completed-time"><Icon name="check" />Concluída às {completedAt}</div> : null}
                                {['EN_ROUTE', 'ARRIVED'].includes(stop.status) ? <div className="stop-locked-note"><Icon name="pin" />Esta parada será preservada em um recálculo.</div> : null}
                                {canExecute && stop.type !== 'DEPOT_START' && !finishedStatuses.includes(stop.status) ? (
                                  <div className="mission-navigation-actions">
                                    <a className="button button-secondary button-small" href={googleMapsStopUrl(stop)} target="_blank" rel="noreferrer">
                                      <Icon name="routes" />Google Maps
                                    </a>
                                    <a className="button button-ghost button-small" href={wazeStopUrl(stop)} target="_blank" rel="noreferrer">
                                      <Icon name="arrow" />Waze
                                    </a>
                                  </div>
                                ) : null}
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
