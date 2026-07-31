'use client';

import { AddressAutocomplete } from '@/components/address-autocomplete';
import { useAuth } from '@/components/auth-provider';
import { EmptyState, ErrorBanner, LoadingBlock, SuccessBanner } from '@/components/feedback';
import { Icon } from '@/components/icons';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { api, ApiError, queryString } from '@/lib/api';
import { formatTime, todayDateInput } from '@/lib/format';
import type { AddressSuggestion, OrderPriority, OrderStatus, ServiceOrder } from '@/lib/types';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

interface MissionForm {
  priority: OrderPriority;
  hasPickup: boolean;
  pickupName: string;
  pickupAddress: string;
  pickupFormattedAddress: string;
  pickupLatitude?: number;
  pickupLongitude?: number;
  pickupCity: string;
  pickupNeighborhood: string;
  pickupState: string;
  pickupItem: string;
  pickupTime: string;
  hasDelivery: boolean;
  deliveryName: string;
  deliveryAddress: string;
  deliveryFormattedAddress: string;
  deliveryLatitude?: number;
  deliveryLongitude?: number;
  deliveryCity: string;
  deliveryNeighborhood: string;
  deliveryState: string;
  deliveryItem: string;
  deliveryTime: string;
  notes: string;
}

interface MissionView {
  reference: string;
  orders: ServiceOrder[];
  pickup?: ServiceOrder;
  delivery?: ServiceOrder;
  priority: OrderPriority;
  status: OrderStatus;
  bundled: boolean;
}

const initialForm: MissionForm = {
  priority: 'NORMAL',
  hasPickup: true,
  pickupName: '',
  pickupAddress: '',
  pickupFormattedAddress: '',
  pickupLatitude: undefined,
  pickupLongitude: undefined,
  pickupCity: '',
  pickupNeighborhood: '',
  pickupState: 'PR',
  pickupItem: '',
  pickupTime: '',
  hasDelivery: false,
  deliveryName: '',
  deliveryAddress: '',
  deliveryFormattedAddress: '',
  deliveryLatitude: undefined,
  deliveryLongitude: undefined,
  deliveryCity: '',
  deliveryNeighborhood: '',
  deliveryState: 'PR',
  deliveryItem: '',
  deliveryTime: '',
  notes: '',
};

const STATUS_ORDER: OrderStatus[] = [
  'IN_PROGRESS',
  'ROUTED',
  'READY',
  'PLANNED',
  'FAILED',
  'COMPLETED',
  'CANCELLED',
];

const PRIORITY_OPTIONS: Array<{ value: OrderPriority; label: string; helper: string }> = [
  { value: 'NORMAL', label: 'Normal', helper: 'Pode entrar na melhor sequência' },
  { value: 'HIGH', label: 'Alta', helper: 'Precisa de atenção no dia' },
  { value: 'URGENT', label: 'Urgente', helper: 'Deve ser atendida primeiro' },
];

function missionStatus(orders: ServiceOrder[]): OrderStatus {
  if (orders.every((order) => order.status === 'CANCELLED')) return 'CANCELLED';
  if (orders.every((order) => order.status === 'COMPLETED')) return 'COMPLETED';
  return STATUS_ORDER.find((status) => orders.some((order) => order.status === status)) ?? 'READY';
}

function groupMissions(orders: ServiceOrder[]): MissionView[] {
  const groups = new Map<string, ServiceOrder[]>();

  for (const order of orders) {
    const bundled = Boolean(order.externalReference?.startsWith('MIS-'));
    const key = bundled ? order.externalReference! : order.code;
    groups.set(key, [...(groups.get(key) ?? []), order]);
  }

  return [...groups.entries()].map(([reference, groupedOrders]) => ({
    reference,
    orders: groupedOrders,
    pickup: groupedOrders.find((order) => order.type === 'PICKUP'),
    delivery: groupedOrders.find((order) => order.type === 'DELIVERY'),
    priority: groupedOrders[0]?.priority ?? 'NORMAL',
    status: missionStatus(groupedOrders),
    bundled: reference.startsWith('MIS-'),
  }));
}

function missionItem(order?: ServiceOrder): string {
  return order?.notes?.split('\n')[0]?.trim() || 'Item não informado';
}

function missionTypeLabel(mission: MissionView): string {
  if (mission.pickup && mission.delivery) return 'Coleta + entrega';
  if (mission.pickup) return 'Somente coleta';
  return 'Somente entrega';
}

function missionTitle(mission: MissionView): string {
  if (mission.pickup && mission.delivery) {
    return `${mission.pickup.recipientName} → ${mission.delivery.recipientName}`;
  }
  return mission.pickup?.recipientName ?? mission.delivery?.recipientName ?? mission.reference;
}

function validCoordinates(order: ServiceOrder): { latitude: number; longitude: number } | null {
  if (order.latitude == null || order.longitude == null) return null;
  const latitude = Number(order.latitude);
  const longitude = Number(order.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function navigationDestination(order: ServiceOrder): string {
  const coordinates = validCoordinates(order);
  if (coordinates) return `${coordinates.latitude},${coordinates.longitude}`;
  return [
    order.formattedAddress || order.addressLine,
    order.neighborhood,
    order.city,
    order.state,
  ]
    .filter(Boolean)
    .join(', ');
}

function googleMapsUrl(order: ServiceOrder): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(navigationDestination(order))}`;
}

function wazeUrl(order: ServiceOrder): string {
  const coordinates = validCoordinates(order);
  if (coordinates) {
    return `https://www.waze.com/ul?ll=${encodeURIComponent(`${coordinates.latitude},${coordinates.longitude}`)}&navigate=yes`;
  }
  return `https://www.waze.com/ul?q=${encodeURIComponent(navigationDestination(order))}&navigate=yes`;
}

function MissionStop({ order, type }: { order: ServiceOrder; type: 'pickup' | 'delivery' }) {
  const locationLine = [order.neighborhood, `${order.city} - ${order.state}`]
    .filter(Boolean)
    .join(' • ');

  return (
    <section className={`mission-stop mission-stop-${type}`}>
      <div className="mission-stop-kicker">
        <span><Icon name={type === 'pickup' ? 'pin' : 'routes'} /></span>
        {type === 'pickup' ? 'Coleta' : 'Entrega'}
      </div>
      <h3>{order.recipientName}</h3>
      <p className="mission-stop-item">{missionItem(order)}</p>
      <div className="mission-stop-address">
        <Icon name="pin" />
        <span>
          {order.addressLine}
          <small>{locationLine}</small>
        </span>
      </div>
      {order.timeWindowStart ? (
        <div className="mission-stop-time"><Icon name="clock" />{formatTime(order.timeWindowStart)}</div>
      ) : null}
      <div className="mission-navigation-actions">
        <a className="button button-secondary button-small" href={googleMapsUrl(order)} target="_blank" rel="noreferrer">
          <Icon name="routes" />Google Maps
        </a>
        <a className="button button-ghost button-small" href={wazeUrl(order)} target="_blank" rel="noreferrer">
          <Icon name="arrow" />Waze
        </a>
      </div>
    </section>
  );
}

export default function OrdersPage() {
  const { user } = useAuth();
  const [date, setDate] = useState(todayDateInput());
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<MissionForm>({ ...initialForm });
  const [saving, setSaving] = useState(false);
  const canManage = Boolean(user && ['OWNER', 'ADMIN', 'DISPATCHER'].includes(user.role));

  useEffect(() => {
    const dateFromUrl = new URLSearchParams(window.location.search).get('date');
    if (dateFromUrl) setDate(dateFromUrl);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api<{ items: ServiceOrder[]; total: number }>(
        `/orders${queryString({ date, search, status, take: 200 })}`,
      );
      setOrders(result.items);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível carregar as missões.');
    } finally {
      setLoading(false);
    }
  }, [date, search, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  const missions = useMemo(() => groupMissions(orders), [orders]);
  const urgentCount = useMemo(
    () => missions.filter((mission) => mission.priority === 'URGENT' && !['COMPLETED', 'CANCELLED'].includes(mission.status)).length,
    [missions],
  );

  function openForm() {
    setError('');
    setSuccess('');
    setForm({ ...initialForm });
    setFormOpen(true);
  }

  function closeForm() {
    if (saving) return;
    setFormOpen(false);
  }

  function changePickupAddress(value: string) {
    setForm((current) => ({
      ...current,
      pickupAddress: value,
      pickupFormattedAddress: '',
      pickupLatitude: undefined,
      pickupLongitude: undefined,
    }));
  }

  function selectPickupAddress(suggestion: AddressSuggestion) {
    setForm((current) => ({
      ...current,
      pickupAddress: suggestion.label,
      pickupFormattedAddress: suggestion.label,
      pickupLatitude: suggestion.latitude,
      pickupLongitude: suggestion.longitude,
      pickupCity: suggestion.city ?? current.pickupCity,
      pickupNeighborhood: suggestion.neighborhood ?? current.pickupNeighborhood,
      pickupState: suggestion.state ?? current.pickupState,
    }));
  }

  function changeDeliveryAddress(value: string) {
    setForm((current) => ({
      ...current,
      deliveryAddress: value,
      deliveryFormattedAddress: '',
      deliveryLatitude: undefined,
      deliveryLongitude: undefined,
    }));
  }

  function selectDeliveryAddress(suggestion: AddressSuggestion) {
    setForm((current) => ({
      ...current,
      deliveryAddress: suggestion.label,
      deliveryFormattedAddress: suggestion.label,
      deliveryLatitude: suggestion.latitude,
      deliveryLongitude: suggestion.longitude,
      deliveryCity: suggestion.city ?? current.deliveryCity,
      deliveryNeighborhood: suggestion.neighborhood ?? current.deliveryNeighborhood,
      deliveryState: suggestion.state ?? current.deliveryState,
    }));
  }

  async function createMission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.hasPickup && !form.hasDelivery) {
      setError('Marque uma coleta, uma entrega ou as duas.');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await api('/orders/missions', {
        method: 'POST',
        body: JSON.stringify({
          plannedDate: date,
          priority: form.priority,
          ...(form.hasPickup
            ? {
                pickupName: form.pickupName,
                pickupAddress: form.pickupAddress,
                pickupFormattedAddress: form.pickupFormattedAddress || undefined,
                pickupLatitude: form.pickupLatitude,
                pickupLongitude: form.pickupLongitude,
                pickupCity: form.pickupCity,
                pickupNeighborhood: form.pickupNeighborhood || undefined,
                pickupState: form.pickupState || 'PR',
                pickupItem: form.pickupItem,
                pickupTime: form.pickupTime || undefined,
              }
            : {}),
          ...(form.hasDelivery
            ? {
                deliveryName: form.deliveryName,
                deliveryAddress: form.deliveryAddress,
                deliveryFormattedAddress: form.deliveryFormattedAddress || undefined,
                deliveryLatitude: form.deliveryLatitude,
                deliveryLongitude: form.deliveryLongitude,
                deliveryCity: form.deliveryCity,
                deliveryNeighborhood: form.deliveryNeighborhood || undefined,
                deliveryState: form.deliveryState || 'PR',
                deliveryItem: form.deliveryItem,
                deliveryTime: form.deliveryTime || undefined,
              }
            : {}),
          notes: form.notes || undefined,
        }),
      });
      setForm({ ...initialForm });
      setFormOpen(false);
      setSuccess('Missão cadastrada e pronta para entrar na rota.');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível cadastrar a missão.');
    } finally {
      setSaving(false);
    }
  }

  async function cancelMission(mission: MissionView) {
    if (!window.confirm(`Cancelar a missão ${mission.reference}?`)) return;
    try {
      if (mission.bundled) {
        await api(`/orders/missions/${encodeURIComponent(mission.reference)}`, { method: 'DELETE' });
      } else {
        await api(`/orders/${mission.orders[0]?.id}`, { method: 'DELETE' });
      }
      setSuccess(`Missão ${mission.reference} cancelada.`);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível cancelar a missão.');
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Operação externa"
        title="Missões do dia"
        description="Cadastre o que precisa buscar, levar ou comprar — sem formulário complicado."
        actions={canManage ? <button className="button button-primary" onClick={openForm}><Icon name="plus" />Nova missão</button> : undefined}
      />
      {error ? <ErrorBanner message={error} /> : null}
      {success ? <SuccessBanner message={success} /> : null}

      <section className="panel filter-panel">
        <div className="filter-grid">
          <label className="field compact"><span>Data</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label className="field compact field-grow"><span>Buscar</span><input type="search" placeholder="Nome, cidade, endereço ou item" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <label className="field compact"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todos</option><option value="PLANNED">Planejada</option><option value="READY">Pronta</option><option value="ROUTED">Na rota</option><option value="IN_PROGRESS">Em andamento</option><option value="COMPLETED">Concluída</option><option value="FAILED">Com problema</option><option value="CANCELLED">Cancelada</option></select></label>
        </div>
        <div className="filter-summary"><strong>{missions.length}</strong> missão(ões) {urgentCount > 0 ? <span className="urgent-inline"><Icon name="warning" />{urgentCount} urgente(s)</span> : null}</div>
      </section>

      {loading && missions.length === 0 ? (
        <section className="panel"><LoadingBlock /></section>
      ) : missions.length === 0 ? (
        <section className="panel"><EmptyState title="Nenhuma missão nesta data" description="Cadastre o primeiro local que precisa ser visitado." /></section>
      ) : (
        <section className="mission-grid">
          {missions.map((mission) => (
            <article className={`mission-card priority-${mission.priority.toLowerCase()}`} key={mission.reference}>
              <header className="mission-card-header">
                <div className="mission-card-title">
                  <span>{missionTypeLabel(mission)}</span>
                  <h2>{missionTitle(mission)}</h2>
                  <small>{mission.reference}</small>
                </div>
                <div className="mission-card-badges">
                  <StatusBadge value={mission.priority} compact />
                  <StatusBadge value={mission.status} compact />
                </div>
              </header>

              <div className={`mission-card-flow${mission.pickup && mission.delivery ? ' has-two-stops' : ''}`}>
                {mission.pickup ? <MissionStop order={mission.pickup} type="pickup" /> : null}
                {mission.pickup && mission.delivery ? <span className="mission-flow-arrow"><Icon name="arrow" /></span> : null}
                {mission.delivery ? <MissionStop order={mission.delivery} type="delivery" /> : null}
              </div>

              {canManage && !['IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(mission.status) ? (
                <footer className="mission-card-footer">
                  <button className="button button-ghost button-small danger-text" onClick={() => void cancelMission(mission)}>Cancelar missão</button>
                </footer>
              ) : null}
            </article>
          ))}
        </section>
      )}

      <div className={`drawer-backdrop${formOpen ? ' is-open' : ''}`} onClick={closeForm} />
      <aside className={`drawer mission-drawer${formOpen ? ' is-open' : ''}`} aria-hidden={!formOpen}>
        <div className="drawer-header"><div><span className="eyebrow">Operação externa</span><h2>Nova missão</h2></div><button className="icon-button" onClick={closeForm} aria-label="Fechar"><Icon name="close" /></button></div>
        <form className="drawer-form mission-form" onSubmit={createMission}>
          <label className="field mission-date-field"><span>Data</span><input type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label>

          <fieldset className="priority-fieldset">
            <legend>Prioridade</legend>
            <div className="priority-selector">
              {PRIORITY_OPTIONS.map((option) => (
                <label className={`priority-option priority-option-${option.value.toLowerCase()}${form.priority === option.value ? ' is-selected' : ''}`} key={option.value}>
                  <input
                    type="radio"
                    name="priority"
                    value={option.value}
                    checked={form.priority === option.value}
                    onChange={() => setForm((current) => ({ ...current, priority: option.value }))}
                  />
                  <span><strong>{option.label}</strong><small>{option.helper}</small></span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="form-hint"><Icon name="check" />Use somente coleta, somente entrega ou as duas na mesma missão.</div>

          <section className={`mission-form-card${form.hasPickup ? ' is-active' : ''}`}>
            <label className="mission-toggle">
              <input type="checkbox" checked={form.hasPickup} onChange={(event) => setForm((current) => ({ ...current, hasPickup: event.target.checked }))} />
              <span className="mission-toggle-icon"><Icon name="pin" /></span>
              <span><strong>Coleta</strong><small>Buscar algo em um local</small></span>
            </label>
            {form.hasPickup ? (
              <div className="mission-form-fields">
                <label className="field"><span>Nome ou local</span><input required value={form.pickupName} onChange={(event) => setForm((current) => ({ ...current, pickupName: event.target.value }))} placeholder="Ex.: Costureira Maria" /></label>
                <AddressAutocomplete
                  label="Endereço da coleta"
                  required
                  selected={form.pickupLatitude != null && form.pickupLongitude != null}
                  value={form.pickupAddress}
                  onValueChange={changePickupAddress}
                  onSelect={selectPickupAddress}
                  placeholder="Rua, número ou nome do local"
                />
                <div className="form-row mission-location-row">
                  <label className="field"><span>Cidade</span><input required value={form.pickupCity} onChange={(event) => setForm((current) => ({ ...current, pickupCity: event.target.value }))} placeholder="Ex.: Marialva" /></label>
                  <label className="field"><span>Bairro <small>(opcional)</small></span><input value={form.pickupNeighborhood} onChange={(event) => setForm((current) => ({ ...current, pickupNeighborhood: event.target.value }))} placeholder="Ex.: Centro" /></label>
                </div>
                <label className="field"><span>O que coletar</span><input required value={form.pickupItem} onChange={(event) => setForm((current) => ({ ...current, pickupItem: event.target.value }))} placeholder="Ex.: 30 jalecos prontos" /></label>
                <label className="field mission-time-field"><span>Horário desejado <small>(opcional)</small></span><input type="time" value={form.pickupTime} onChange={(event) => setForm((current) => ({ ...current, pickupTime: event.target.value }))} /></label>
              </div>
            ) : null}
          </section>

          <section className={`mission-form-card${form.hasDelivery ? ' is-active' : ''}`}>
            <label className="mission-toggle">
              <input type="checkbox" checked={form.hasDelivery} onChange={(event) => setForm((current) => ({ ...current, hasDelivery: event.target.checked }))} />
              <span className="mission-toggle-icon"><Icon name="routes" /></span>
              <span><strong>Entrega</strong><small>Levar algo para um local</small></span>
            </label>
            {form.hasDelivery ? (
              <div className="mission-form-fields">
                <label className="field"><span>Nome ou local</span><input required value={form.deliveryName} onChange={(event) => setForm((current) => ({ ...current, deliveryName: event.target.value }))} placeholder="Ex.: Bordado Marialva" /></label>
                <AddressAutocomplete
                  label="Endereço da entrega"
                  required
                  selected={form.deliveryLatitude != null && form.deliveryLongitude != null}
                  value={form.deliveryAddress}
                  onValueChange={changeDeliveryAddress}
                  onSelect={selectDeliveryAddress}
                  placeholder="Rua, número ou nome do local"
                />
                <div className="form-row mission-location-row">
                  <label className="field"><span>Cidade</span><input required value={form.deliveryCity} onChange={(event) => setForm((current) => ({ ...current, deliveryCity: event.target.value }))} placeholder="Ex.: Maringá" /></label>
                  <label className="field"><span>Bairro <small>(opcional)</small></span><input value={form.deliveryNeighborhood} onChange={(event) => setForm((current) => ({ ...current, deliveryNeighborhood: event.target.value }))} placeholder="Ex.: Centro" /></label>
                </div>
                <label className="field"><span>O que entregar</span><input required value={form.deliveryItem} onChange={(event) => setForm((current) => ({ ...current, deliveryItem: event.target.value }))} placeholder="Ex.: 30 jalecos para bordar" /></label>
                <label className="field mission-time-field"><span>Horário desejado <small>(opcional)</small></span><input type="time" value={form.deliveryTime} onChange={(event) => setForm((current) => ({ ...current, deliveryTime: event.target.value }))} /></label>
              </div>
            ) : null}
          </section>

          <label className="field"><span>Observação <small>(opcional)</small></span><textarea rows={2} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Ex.: Ligar antes de chegar" /></label>

          <div className="drawer-actions"><button type="button" className="button button-secondary" onClick={closeForm}>Cancelar</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? <><span className="spinner small" />Salvando...</> : 'Salvar missão'}</button></div>
        </form>
      </aside>
    </>
  );
}
