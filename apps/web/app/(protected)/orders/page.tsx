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
  pickupState: '',
  pickupItem: '',
  pickupTime: '',
  hasDelivery: false,
  deliveryName: '',
  deliveryAddress: '',
  deliveryFormattedAddress: '',
  deliveryLatitude: undefined,
  deliveryLongitude: undefined,
  deliveryCity: '',
  deliveryState: '',
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

function MissionPoint({ order, emptyLabel }: { order?: ServiceOrder; emptyLabel: string }) {
  if (!order) return <span className="mission-empty">{emptyLabel}</span>;
  return (
    <div className="mission-point-summary">
      <strong>{order.recipientName}</strong>
      <span>{missionItem(order)}</span>
      <small>{order.formattedAddress || order.addressLine}</small>
      {order.timeWindowStart ? <em><Icon name="clock" />{formatTime(order.timeWindowStart)}</em> : null}
    </div>
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
  const [form, setForm] = useState<MissionForm>(initialForm);
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
    setForm(initialForm);
    setFormOpen(true);
  }

  function changePickupAddress(value: string) {
    setForm((current) => ({
      ...current,
      pickupAddress: value,
      pickupFormattedAddress: '',
      pickupLatitude: undefined,
      pickupLongitude: undefined,
      pickupCity: '',
      pickupState: '',
    }));
  }

  function selectPickupAddress(suggestion: AddressSuggestion) {
    setForm((current) => ({
      ...current,
      pickupAddress: suggestion.label,
      pickupFormattedAddress: suggestion.label,
      pickupLatitude: suggestion.latitude,
      pickupLongitude: suggestion.longitude,
      pickupCity: suggestion.city ?? '',
      pickupState: suggestion.state ?? '',
    }));
  }

  function changeDeliveryAddress(value: string) {
    setForm((current) => ({
      ...current,
      deliveryAddress: value,
      deliveryFormattedAddress: '',
      deliveryLatitude: undefined,
      deliveryLongitude: undefined,
      deliveryCity: '',
      deliveryState: '',
    }));
  }

  function selectDeliveryAddress(suggestion: AddressSuggestion) {
    setForm((current) => ({
      ...current,
      deliveryAddress: suggestion.label,
      deliveryFormattedAddress: suggestion.label,
      deliveryLatitude: suggestion.latitude,
      deliveryLongitude: suggestion.longitude,
      deliveryCity: suggestion.city ?? '',
      deliveryState: suggestion.state ?? '',
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
                pickupCity: form.pickupCity || undefined,
                pickupState: form.pickupState || undefined,
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
                deliveryCity: form.deliveryCity || undefined,
                deliveryState: form.deliveryState || undefined,
                deliveryItem: form.deliveryItem,
                deliveryTime: form.deliveryTime || undefined,
              }
            : {}),
          notes: form.notes || undefined,
        }),
      });
      setForm(initialForm);
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
        description="Cadastre rapidamente o que precisa buscar, levar ou comprar."
        actions={canManage ? <button className="button button-primary" onClick={openForm}><Icon name="plus" />Nova missão</button> : undefined}
      />
      {error ? <ErrorBanner message={error} /> : null}
      {success ? <SuccessBanner message={success} /> : null}

      <section className="panel filter-panel">
        <div className="filter-grid">
          <label className="field compact"><span>Data</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label className="field compact field-grow"><span>Buscar</span><input type="search" placeholder="Nome, endereço ou item" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <label className="field compact"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todos</option><option value="PLANNED">Planejada</option><option value="READY">Pronta</option><option value="ROUTED">Na rota</option><option value="IN_PROGRESS">Em andamento</option><option value="COMPLETED">Concluída</option><option value="FAILED">Com problema</option><option value="CANCELLED">Cancelada</option></select></label>
        </div>
        <div className="filter-summary"><strong>{missions.length}</strong> missão(ões) {urgentCount > 0 ? <span className="urgent-inline"><Icon name="warning" />{urgentCount} urgente(s)</span> : null}</div>
      </section>

      <section className="panel table-panel">
        {loading && missions.length === 0 ? <LoadingBlock /> : missions.length === 0 ? (
          <EmptyState title="Nenhuma missão nesta data" description="Cadastre o primeiro local que precisa ser visitado." />
        ) : (
          <div className="responsive-table-wrap">
            <table className="data-table mission-table">
              <thead><tr><th>Missão</th><th>Coleta</th><th>Entrega</th><th>Prioridade</th><th>Status</th><th>Mapa</th><th aria-label="Ações" /></tr></thead>
              <tbody>
                {missions.map((mission) => {
                  const coordinatesReady = mission.orders.every((order) => order.latitude != null && order.longitude != null);
                  return (
                    <tr key={mission.reference}>
                      <td data-label="Missão"><strong>{mission.reference}</strong><small>{mission.orders.length === 2 ? 'Coleta + entrega' : mission.pickup ? 'Somente coleta' : 'Somente entrega'}</small></td>
                      <td data-label="Coleta"><MissionPoint order={mission.pickup} emptyLabel="Sem coleta" /></td>
                      <td data-label="Entrega"><MissionPoint order={mission.delivery} emptyLabel="Sem entrega" /></td>
                      <td data-label="Prioridade"><StatusBadge value={mission.priority} compact /></td>
                      <td data-label="Status"><StatusBadge value={mission.status} compact /></td>
                      <td data-label="Mapa"><span className={coordinatesReady ? 'coordinate-ok' : 'coordinate-missing'}><Icon name={coordinatesReady ? 'check' : 'warning'} />{coordinatesReady ? 'Pronta' : 'Pendente'}</span></td>
                      <td className="table-actions">{canManage && !['IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(mission.status) ? <button className="button button-ghost button-small danger-text" onClick={() => void cancelMission(mission)}>Cancelar</button> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className={`drawer-backdrop${formOpen ? ' is-open' : ''}`} onClick={() => setFormOpen(false)} />
      <aside className={`drawer mission-drawer${formOpen ? ' is-open' : ''}`} aria-hidden={!formOpen}>
        <div className="drawer-header"><div><span className="eyebrow">Operação externa</span><h2>Nova missão</h2></div><button className="icon-button" onClick={() => setFormOpen(false)} aria-label="Fechar"><Icon name="close" /></button></div>
        <form className="drawer-form mission-form" onSubmit={createMission}>
          <div className="form-hint"><Icon name="check" />Preencha somente a coleta, somente a entrega ou as duas na mesma missão.</div>

          <div className="form-row two">
            <label className="field"><span>Data</span><input type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label>
            <label className="field"><span>Prioridade</span><select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as OrderPriority })}><option value="NORMAL">Normal</option><option value="HIGH">Alta</option><option value="URGENT">Urgente</option><option value="LOW">Baixa</option></select></label>
          </div>

          <section className={`mission-form-card${form.hasPickup ? ' is-active' : ''}`}>
            <label className="mission-toggle">
              <input type="checkbox" checked={form.hasPickup} onChange={(event) => setForm({ ...form, hasPickup: event.target.checked })} />
              <span className="mission-toggle-icon"><Icon name="pin" /></span>
              <span><strong>Coleta</strong><small>Buscar algo em um local</small></span>
            </label>
            {form.hasPickup ? (
              <div className="mission-form-fields">
                <label className="field"><span>Coleta em</span><input required value={form.pickupName} onChange={(event) => setForm({ ...form, pickupName: event.target.value })} placeholder="Ex.: Costureira Maria" /></label>
                <AddressAutocomplete
                  label="Endereço da coleta"
                  required
                  value={form.pickupAddress}
                  onValueChange={changePickupAddress}
                  onSelect={selectPickupAddress}
                  placeholder="Comece a digitar a rua, número ou local"
                />
                <label className="field"><span>O que coletar</span><textarea required rows={2} value={form.pickupItem} onChange={(event) => setForm({ ...form, pickupItem: event.target.value })} placeholder="Ex.: Buscar 30 jalecos prontos" /></label>
                <label className="field mission-time-field"><span>Horário desejado <small>(opcional)</small></span><input type="time" value={form.pickupTime} onChange={(event) => setForm({ ...form, pickupTime: event.target.value })} /></label>
              </div>
            ) : null}
          </section>

          <section className={`mission-form-card${form.hasDelivery ? ' is-active' : ''}`}>
            <label className="mission-toggle">
              <input type="checkbox" checked={form.hasDelivery} onChange={(event) => setForm({ ...form, hasDelivery: event.target.checked })} />
              <span className="mission-toggle-icon"><Icon name="routes" /></span>
              <span><strong>Entrega</strong><small>Levar algo para um local</small></span>
            </label>
            {form.hasDelivery ? (
              <div className="mission-form-fields">
                <label className="field"><span>Entrega em</span><input required value={form.deliveryName} onChange={(event) => setForm({ ...form, deliveryName: event.target.value })} placeholder="Ex.: Bordado Marialva" /></label>
                <AddressAutocomplete
                  label="Endereço da entrega"
                  required
                  value={form.deliveryAddress}
                  onValueChange={changeDeliveryAddress}
                  onSelect={selectDeliveryAddress}
                  placeholder="Comece a digitar a rua, número ou local"
                />
                <label className="field"><span>O que entregar</span><textarea required rows={2} value={form.deliveryItem} onChange={(event) => setForm({ ...form, deliveryItem: event.target.value })} placeholder="Ex.: Levar 30 jalecos para bordar" /></label>
                <label className="field mission-time-field"><span>Horário desejado <small>(opcional)</small></span><input type="time" value={form.deliveryTime} onChange={(event) => setForm({ ...form, deliveryTime: event.target.value })} /></label>
              </div>
            ) : null}
          </section>

          <label className="field"><span>Observação <small>(opcional)</small></span><textarea rows={2} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Ex.: Ligar antes de chegar" /></label>

          <div className="drawer-actions"><button type="button" className="button button-secondary" onClick={() => setFormOpen(false)}>Cancelar</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? <><span className="spinner small" />Salvando...</> : 'Salvar missão'}</button></div>
        </form>
      </aside>
    </>
  );
}
