'use client';

import { AddressAutocomplete } from '@/components/address-autocomplete';
import { useAuth } from '@/components/auth-provider';
import { EmptyState, ErrorBanner, LoadingBlock, SuccessBanner } from '@/components/feedback';
import { Icon } from '@/components/icons';
import { PageHeader } from '@/components/page-header';
import {
  PreciseLocationPicker,
  type ConfirmedLocationUpdate,
} from '@/components/precise-location-picker';
import { StatusBadge } from '@/components/status-badge';
import { api, ApiError, queryString } from '@/lib/api';
import { formatDuration, formatTime, todayDateInput } from '@/lib/format';
import type { AddressSuggestion, OrderPriority, OrderStatus, ServiceOrder, Vehicle } from '@/lib/types';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

interface MissionForm {
  priority: OrderPriority;
  assignedVehicleId: string;
  hasPickup: boolean;
  pickupName: string;
  pickupAddress: string;
  pickupFormattedAddress: string;
  pickupAddressNumber: string;
  pickupAddressComplement: string;
  pickupPostalCode: string;
  pickupLatitude?: number;
  pickupLongitude?: number;
  pickupLocationConfirmed: boolean;
  pickupCity: string;
  pickupNeighborhood: string;
  pickupState: string;
  pickupItem: string;
  pickupTime: string;
  hasDelivery: boolean;
  deliveryName: string;
  deliveryAddress: string;
  deliveryFormattedAddress: string;
  deliveryAddressNumber: string;
  deliveryAddressComplement: string;
  deliveryPostalCode: string;
  deliveryLatitude?: number;
  deliveryLongitude?: number;
  deliveryLocationConfirmed: boolean;
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
  assignedVehicleId?: string;
  assignedVehicle?: NonNullable<ServiceOrder['assignedVehicle']>;
}

interface CreateMissionResponse {
  reference: string;
  orders: ServiceOrder[];
}

interface AutomaticUrgencyResponse {
  selectedVehicle: { id: string; name: string; plate: string };
  estimatedAddedDurationSeconds: number;
  warnings?: string[];
}

type MissionTab = 'AVAILABLE' | 'COMPLETED' | 'CANCELLED';

const initialForm: MissionForm = {
  priority: 'NORMAL',
  assignedVehicleId: '',
  hasPickup: true,
  pickupName: '',
  pickupAddress: '',
  pickupFormattedAddress: '',
  pickupAddressNumber: '',
  pickupAddressComplement: '',
  pickupPostalCode: '',
  pickupLatitude: undefined,
  pickupLongitude: undefined,
  pickupLocationConfirmed: false,
  pickupCity: '',
  pickupNeighborhood: '',
  pickupState: 'PR',
  pickupItem: '',
  pickupTime: '',
  hasDelivery: false,
  deliveryName: '',
  deliveryAddress: '',
  deliveryFormattedAddress: '',
  deliveryAddressNumber: '',
  deliveryAddressComplement: '',
  deliveryPostalCode: '',
  deliveryLatitude: undefined,
  deliveryLongitude: undefined,
  deliveryLocationConfirmed: false,
  deliveryCity: '',
  deliveryNeighborhood: '',
  deliveryState: 'PR',
  deliveryItem: '',
  deliveryTime: '',
  notes: '',
};

const PRIORITY_RANK: Record<OrderPriority, number> = {
  URGENT: 4,
  HIGH: 3,
  NORMAL: 2,
  LOW: 1,
};

const PRIORITY_OPTIONS: Array<{ value: OrderPriority; label: string; helper: string }> = [
  { value: 'NORMAL', label: 'Normal', helper: 'Pode entrar na melhor sequência' },
  { value: 'HIGH', label: 'Alta', helper: 'Precisa de atenção no dia' },
  { value: 'URGENT', label: 'Urgente', helper: 'Deve ser atendida primeiro' },
];

function missionStatus(orders: ServiceOrder[]): OrderStatus {
  if (orders.every((order) => order.status === 'CANCELLED')) return 'CANCELLED';
  if (orders.every((order) => order.status === 'COMPLETED')) return 'COMPLETED';
  if (orders.some((order) => order.status === 'FAILED')) return 'FAILED';
  if (orders.some((order) => order.status === 'COMPLETED')) return 'IN_PROGRESS';
  if (orders.some((order) => order.status === 'IN_PROGRESS')) return 'IN_PROGRESS';
  if (orders.some((order) => order.status === 'ROUTED')) return 'ROUTED';
  if (orders.some((order) => order.status === 'READY')) return 'READY';
  return 'PLANNED';
}

function groupMissions(orders: ServiceOrder[]): MissionView[] {
  const groups = new Map<string, ServiceOrder[]>();

  for (const order of orders) {
    const bundled = Boolean(order.externalReference?.startsWith('MIS-'));
    const key = bundled ? order.externalReference! : order.code;
    groups.set(key, [...(groups.get(key) ?? []), order]);
  }

  return [...groups.entries()].map(([reference, groupedOrders]) => {
    const orderWithVehicle = groupedOrders.find((order) => order.assignedVehicleId);

    return {
      reference,
      orders: groupedOrders,
      pickup: groupedOrders.find((order) => order.type === 'PICKUP'),
      delivery: groupedOrders.find((order) => order.type === 'DELIVERY'),
      priority: groupedOrders[0]?.priority ?? 'NORMAL',
      status: missionStatus(groupedOrders),
      bundled: reference.startsWith('MIS-'),
      assignedVehicleId: orderWithVehicle?.assignedVehicleId ?? undefined,
      assignedVehicle: orderWithVehicle?.assignedVehicle ?? undefined,
    };
  });
}

function vehicleStatusLabel(vehicle: Pick<Vehicle, 'active' | 'status'>): string {
  if (!vehicle.active) return 'Indisponível';
  return {
    AVAILABLE: 'Disponível',
    IN_ROUTE: 'Em rota',
    MAINTENANCE: 'Manutenção',
    INACTIVE: 'Ocupado',
  }[vehicle.status];
}

function vehicleOptionDisabled(vehicle: Pick<Vehicle, 'active' | 'status'>): boolean {
  return !vehicle.active || vehicle.status === 'MAINTENANCE';
}

function missionTimeValue(mission: MissionView): number {
  const pendingTimes = mission.orders
    .filter((order) => order.status !== 'COMPLETED' && order.timeWindowStart)
    .map((order) => new Date(order.timeWindowStart!).getTime())
    .filter(Number.isFinite);
  return pendingTimes.length > 0 ? Math.min(...pendingTimes) : Number.MAX_SAFE_INTEGER;
}

function missionCreatedValue(mission: MissionView): number {
  const values = mission.orders
    .map((order) => new Date(order.createdAt).getTime())
    .filter(Number.isFinite);
  return values.length > 0 ? Math.min(...values) : 0;
}

function missionUpdatedValue(mission: MissionView): number {
  const values = mission.orders
    .map((order) => new Date(order.completedAt ?? order.updatedAt).getTime())
    .filter(Number.isFinite);
  return values.length > 0 ? Math.max(...values) : 0;
}

function sortAvailableMissions(left: MissionView, right: MissionView): number {
  const priorityDifference = PRIORITY_RANK[right.priority] - PRIORITY_RANK[left.priority];
  if (priorityDifference !== 0) return priorityDifference;

  const timeDifference = missionTimeValue(left) - missionTimeValue(right);
  if (timeDifference !== 0) return timeDifference;

  return missionCreatedValue(left) - missionCreatedValue(right);
}

function completionTimeLabel(mission: MissionView): string {
  const timestamp = missionUpdatedValue(mission);
  return timestamp ? formatTime(new Date(timestamp).toISOString()) : '';
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
  const fullAddress = [
    [order.addressLine, order.addressNumber].filter(Boolean).join(', '),
    order.addressComplement,
    order.neighborhood,
    order.city,
    order.state,
    order.postalCode,
  ]
    .filter(Boolean)
    .join(', ');

  // As missões novas exigem a confirmação do pino no mapa. Por isso,
  // quando existem coordenadas, Google Maps e Waze recebem exatamente o ponto
  // confirmado pelo usuário, inclusive a entrada correta do imóvel.
  const coordinates = validCoordinates(order);
  if (coordinates) return `${coordinates.latitude},${coordinates.longitude}`;
  return fullAddress || order.formattedAddress || order.addressLine;
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

function MissionStop({
  order,
  type,
  canComplete,
  completionBlocked = false,
  completing = false,
  onComplete,
}: {
  order: ServiceOrder;
  type: 'pickup' | 'delivery';
  canComplete: boolean;
  completionBlocked?: boolean;
  completing?: boolean;
  onComplete: (order: ServiceOrder) => void;
}) {
  const locationLine = [order.neighborhood, `${order.city} - ${order.state}`]
    .filter(Boolean)
    .join(' • ');
  const completed = order.status === 'COMPLETED';
  const completedLabel = type === 'pickup' ? 'Coletado' : 'Entregue';
  const completedAt = completed ? formatTime(order.completedAt ?? order.updatedAt) : '';
  const actionLabel = type === 'pickup' ? 'Marcar como coletado' : 'Marcar como entregue';

  return (
    <section className={`mission-stop mission-stop-${type}${completed ? ' is-completed' : ''}`}>
      <div className="mission-stop-kicker">
        <span><Icon name={completed ? 'check' : type === 'pickup' ? 'pin' : 'routes'} /></span>
        {type === 'pickup' ? 'Coleta' : 'Entrega'}
        {completed ? <strong className="mission-stop-done-label">{completedLabel} às {completedAt}</strong> : null}
      </div>
      <h3>{order.recipientName}</h3>
      <p className="mission-stop-item">{missionItem(order)}</p>
      <div className="mission-stop-address">
        <Icon name="pin" />
        <span>
          {[order.addressLine, order.addressNumber].filter(Boolean).join(', ')}
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
      {completed ? (
        <div className="mission-stop-completed"><Icon name="check" />{completedLabel} às {completedAt}</div>
      ) : canComplete ? (
        <button
          className="button button-primary button-small mission-complete-button"
          type="button"
          disabled={completionBlocked || completing}
          onClick={() => onComplete(order)}
          title={completionBlocked ? 'Conclua a coleta antes da entrega.' : undefined}
        >
          {completing ? <><span className="spinner small" />Salvando...</> : completionBlocked ? 'Aguardando coleta' : <><Icon name="check" />{actionLabel}</>}
        </button>
      ) : null}
    </section>
  );
}

export default function OrdersPage() {
  const { user } = useAuth();
  const [date, setDate] = useState(todayDateInput());
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<MissionTab>('AVAILABLE');
  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<MissionForm>({ ...initialForm });
  const [saving, setSaving] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [assigningReference, setAssigningReference] = useState<string | null>(null);
  const canManage = Boolean(user && ['OWNER', 'ADMIN', 'DISPATCHER'].includes(user.role));
  const canComplete = Boolean(user && ['OWNER', 'ADMIN', 'DISPATCHER', 'DRIVER'].includes(user.role));

  useEffect(() => {
    const dateFromUrl = new URLSearchParams(window.location.search).get('date');
    if (dateFromUrl) setDate(dateFromUrl);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api<{ items: ServiceOrder[]; total: number }>(
        `/orders${queryString({ date, search, take: 200 })}`,
      );
      setOrders(result.items);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível carregar as missões.');
    } finally {
      setLoading(false);
    }
  }, [date, search]);

  const loadVehicles = useCallback(async () => {
    if (!canManage) return;
    try {
      setVehicles(await api<Vehicle[]>('/vehicles'));
    } catch {
      setVehicles([]);
    }
  }, [canManage]);

  useEffect(() => {
    void loadVehicles();
  }, [loadVehicles]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  const missions = useMemo(() => groupMissions(orders), [orders]);
  const availableMissions = useMemo(
    () => missions
      .filter((mission) => !['COMPLETED', 'CANCELLED'].includes(mission.status))
      .sort(sortAvailableMissions),
    [missions],
  );
  const completedMissions = useMemo(
    () => missions
      .filter((mission) => mission.status === 'COMPLETED')
      .sort((left, right) => missionUpdatedValue(right) - missionUpdatedValue(left)),
    [missions],
  );
  const cancelledMissions = useMemo(
    () => missions
      .filter((mission) => mission.status === 'CANCELLED')
      .sort((left, right) => missionUpdatedValue(right) - missionUpdatedValue(left)),
    [missions],
  );
  const visibleMissions =
    activeTab === 'AVAILABLE'
      ? availableMissions
      : activeTab === 'COMPLETED'
        ? completedMissions
        : cancelledMissions;
  const urgentCount = availableMissions.filter((mission) => mission.priority === 'URGENT').length;

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
      pickupAddressNumber: '',
      pickupAddressComplement: '',
      pickupPostalCode: '',
      pickupLatitude: undefined,
      pickupLongitude: undefined,
      pickupLocationConfirmed: false,
    }));
  }

  function selectPickupAddress(suggestion: AddressSuggestion) {
    setForm((current) => ({
      ...current,
      pickupAddress: suggestion.addressLine || suggestion.label,
      pickupFormattedAddress: suggestion.formattedAddress || suggestion.label,
      pickupAddressNumber: suggestion.addressNumber ?? '',
      pickupLatitude: suggestion.latitude,
      pickupLongitude: suggestion.longitude,
      pickupLocationConfirmed: false,
      pickupCity: suggestion.city ?? current.pickupCity,
      pickupNeighborhood: suggestion.neighborhood ?? current.pickupNeighborhood,
      pickupState: suggestion.state ?? current.pickupState,
      pickupPostalCode: suggestion.postalCode ?? '',
    }));
  }

  function updatePickupLocation(update: ConfirmedLocationUpdate) {
    setForm((current) => ({
      ...current,
      pickupLatitude: update.latitude,
      pickupLongitude: update.longitude,
      pickupLocationConfirmed: update.confirmed,
      pickupFormattedAddress: update.formattedAddress ?? current.pickupFormattedAddress,
      pickupCity: current.pickupCity || update.city || '',
      pickupNeighborhood: current.pickupNeighborhood || update.neighborhood || '',
      pickupState: current.pickupState || update.state || 'PR',
      pickupPostalCode: current.pickupPostalCode || update.postalCode || '',
    }));
  }

  function changeDeliveryAddress(value: string) {
    setForm((current) => ({
      ...current,
      deliveryAddress: value,
      deliveryFormattedAddress: '',
      deliveryAddressNumber: '',
      deliveryAddressComplement: '',
      deliveryPostalCode: '',
      deliveryLatitude: undefined,
      deliveryLongitude: undefined,
      deliveryLocationConfirmed: false,
    }));
  }

  function selectDeliveryAddress(suggestion: AddressSuggestion) {
    setForm((current) => ({
      ...current,
      deliveryAddress: suggestion.addressLine || suggestion.label,
      deliveryFormattedAddress: suggestion.formattedAddress || suggestion.label,
      deliveryAddressNumber: suggestion.addressNumber ?? '',
      deliveryLatitude: suggestion.latitude,
      deliveryLongitude: suggestion.longitude,
      deliveryLocationConfirmed: false,
      deliveryCity: suggestion.city ?? current.deliveryCity,
      deliveryNeighborhood: suggestion.neighborhood ?? current.deliveryNeighborhood,
      deliveryState: suggestion.state ?? current.deliveryState,
      deliveryPostalCode: suggestion.postalCode ?? '',
    }));
  }

  function updateDeliveryLocation(update: ConfirmedLocationUpdate) {
    setForm((current) => ({
      ...current,
      deliveryLatitude: update.latitude,
      deliveryLongitude: update.longitude,
      deliveryLocationConfirmed: update.confirmed,
      deliveryFormattedAddress: update.formattedAddress ?? current.deliveryFormattedAddress,
      deliveryCity: current.deliveryCity || update.city || '',
      deliveryNeighborhood: current.deliveryNeighborhood || update.neighborhood || '',
      deliveryState: current.deliveryState || update.state || 'PR',
      deliveryPostalCode: current.deliveryPostalCode || update.postalCode || '',
    }));
  }

  async function createMission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.hasPickup && !form.hasDelivery) {
      setError('Marque uma coleta, uma entrega ou as duas.');
      return;
    }
    if (form.hasPickup && !form.pickupLocationConfirmed) {
      setError('Confirme no mapa o ponto exato do GPS da coleta.');
      return;
    }
    if (form.hasDelivery && !form.deliveryLocationConfirmed) {
      setError('Confirme no mapa o ponto exato do GPS da entrega.');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const created = await api<CreateMissionResponse>('/orders/missions', {
        method: 'POST',
        body: JSON.stringify({
          plannedDate: date,
          priority: form.priority,
          assignedVehicleId: form.assignedVehicleId || undefined,
          ...(form.hasPickup
            ? {
                pickupName: form.pickupName,
                pickupAddress: form.pickupAddress,
                pickupFormattedAddress: form.pickupFormattedAddress || undefined,
                pickupAddressNumber: form.pickupAddressNumber,
                pickupAddressComplement: form.pickupAddressComplement || undefined,
                pickupPostalCode: form.pickupPostalCode || undefined,
                pickupLatitude: form.pickupLatitude,
                pickupLongitude: form.pickupLongitude,
                pickupLocationConfirmed: form.pickupLocationConfirmed,
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
                deliveryAddressNumber: form.deliveryAddressNumber,
                deliveryAddressComplement: form.deliveryAddressComplement || undefined,
                deliveryPostalCode: form.deliveryPostalCode || undefined,
                deliveryLatitude: form.deliveryLatitude,
                deliveryLongitude: form.deliveryLongitude,
                deliveryLocationConfirmed: form.deliveryLocationConfirmed,
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
      let successMessage = 'Missão cadastrada e pronta para entrar na rota.';
      const urgentOrder = created.orders[0];

      if (form.priority === 'URGENT' && urgentOrder) {
        try {
          const recalculated = await api<AutomaticUrgencyResponse>('/routes/recalculate-urgent', {
            method: 'POST',
            body: JSON.stringify({ urgentOrderId: urgentOrder.id }),
          });
          successMessage = `Urgência incluída automaticamente na rota de ${recalculated.selectedVehicle.name} (${recalculated.selectedVehicle.plate}). Acréscimo estimado: ${formatDuration(recalculated.estimatedAddedDurationSeconds)}.`;
        } catch (urgencyError) {
          const reason = urgencyError instanceof ApiError
            ? urgencyError.message
            : 'A rota ainda não pôde ser recalculada.';
          successMessage = `Missão urgente cadastrada. ${reason}`;
        }
      }

      setForm({ ...initialForm });
      setFormOpen(false);
      setActiveTab('AVAILABLE');
      setSuccess(successMessage);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível cadastrar a missão.');
    } finally {
      setSaving(false);
    }
  }

  async function assignMissionVehicle(mission: MissionView, assignedVehicleId: string) {
    setAssigningReference(mission.reference);
    setError('');
    setSuccess('');
    try {
      await api(`/orders/missions/${encodeURIComponent(mission.reference)}/vehicle`, {
        method: 'PATCH',
        body: JSON.stringify({ assignedVehicleId: assignedVehicleId || null }),
      });
      const vehicle = vehicles.find((item) => item.id === assignedVehicleId);
      setSuccess(
        vehicle
          ? `Missão ${mission.reference} designada para ${vehicle.name}.`
          : `Missão ${mission.reference} voltou para a escolha automática.`,
      );
      await load();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'Não foi possível alterar o veículo da missão.',
      );
    } finally {
      setAssigningReference(null);
    }
  }

  async function completeOrder(order: ServiceOrder) {
    const action = order.type === 'PICKUP' ? 'coleta' : 'entrega';
    const result = order.type === 'PICKUP' ? 'coletado' : 'entregue';
    if (!window.confirm(`Confirmar que a ${action} foi realizada?`)) return;

    setCompletingId(order.id);
    setError('');
    setSuccess('');
    try {
      await api(`/orders/${order.id}/complete`, { method: 'PATCH' });
      setSuccess(`Item marcado como ${result}.`);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : `Não foi possível concluir a ${action}.`);
    } finally {
      setCompletingId(null);
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

      <section className="panel filter-panel mission-filter-panel">
        <div className="filter-grid">
          <label className="field compact"><span>Data</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label className="field compact field-grow"><span>Buscar</span><input type="search" placeholder="Nome, cidade, endereço ou item" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        </div>
        <div className="filter-summary"><strong>{missions.length}</strong> missão(ões) no dia {urgentCount > 0 ? <span className="urgent-inline"><Icon name="warning" />{urgentCount} urgente(s)</span> : null}</div>
      </section>

      <section className="mission-list-toolbar" aria-label="Organização das missões">
        <div className="mission-tabs" role="tablist" aria-label="Situação das missões">
          <button
            className={`mission-tab${activeTab === 'AVAILABLE' ? ' is-active' : ''}`}
            type="button"
            role="tab"
            aria-selected={activeTab === 'AVAILABLE'}
            onClick={() => setActiveTab('AVAILABLE')}
          >
            Disponíveis <span>{availableMissions.length}</span>
          </button>
          <button
            className={`mission-tab${activeTab === 'COMPLETED' ? ' is-active' : ''}`}
            type="button"
            role="tab"
            aria-selected={activeTab === 'COMPLETED'}
            onClick={() => setActiveTab('COMPLETED')}
          >
            Finalizadas <span>{completedMissions.length}</span>
          </button>
          <button
            className={`mission-tab mission-tab-muted${activeTab === 'CANCELLED' ? ' is-active' : ''}`}
            type="button"
            role="tab"
            aria-selected={activeTab === 'CANCELLED'}
            onClick={() => setActiveTab('CANCELLED')}
          >
            Canceladas <span>{cancelledMissions.length}</span>
          </button>
        </div>
        {activeTab === 'AVAILABLE' ? (
          <p className="mission-priority-note"><Icon name="warning" />Ordem: Urgente → Alta → Normal → Baixa. No mesmo nível, o horário mais cedo aparece primeiro.</p>
        ) : null}
      </section>

      <div className="mission-section-heading">
        <div>
          <span className="eyebrow">{activeTab === 'AVAILABLE' ? 'Para executar' : activeTab === 'COMPLETED' ? 'Histórico do dia' : 'Fora da operação'}</span>
          <h2>{activeTab === 'AVAILABLE' ? 'Missões disponíveis' : activeTab === 'COMPLETED' ? 'Missões finalizadas' : 'Missões canceladas'}</h2>
        </div>
        <strong>{visibleMissions.length}</strong>
      </div>

      {loading && missions.length === 0 ? (
        <section className="panel"><LoadingBlock /></section>
      ) : visibleMissions.length === 0 ? (
        <section className="panel"><EmptyState
          title={activeTab === 'AVAILABLE' ? 'Nenhuma missão disponível' : activeTab === 'COMPLETED' ? 'Nenhuma missão finalizada' : 'Nenhuma missão cancelada'}
          description={activeTab === 'AVAILABLE' ? 'Cadastre uma missão ou escolha outra data.' : activeTab === 'COMPLETED' ? 'As coletas e entregas concluídas aparecerão aqui automaticamente.' : 'As missões canceladas aparecerão aqui.'}
        /></section>
      ) : (
        <section className="mission-grid">
          {visibleMissions.map((mission) => {
            const pickupCompleted = mission.pickup?.status === 'COMPLETED';
            const deliveryBlocked = Boolean(mission.pickup && mission.delivery && !pickupCompleted);
            const completedAt = mission.status === 'COMPLETED' ? completionTimeLabel(mission) : '';
            const assignmentEditable = mission.orders.every((order) =>
              ['PLANNED', 'READY'].includes(order.status),
            );

            return (
              <article className={`mission-card priority-${mission.priority.toLowerCase()}${mission.status === 'COMPLETED' ? ' is-completed' : ''}`} key={mission.reference}>
                <header className="mission-card-header">
                  <div className="mission-card-title">
                    <span>{missionTypeLabel(mission)}</span>
                    <h2>{missionTitle(mission)}</h2>
                    <small>{mission.reference}{completedAt ? ` • Finalizada às ${completedAt}` : ''}</small>
                  </div>
                  <div className="mission-card-badges">
                    <StatusBadge value={mission.priority} compact />
                    <StatusBadge value={mission.status} compact />
                  </div>
                </header>

                <div className={`mission-card-flow${mission.pickup && mission.delivery ? ' has-two-stops' : ''}`}>
                  {mission.pickup ? (
                    <MissionStop
                      order={mission.pickup}
                      type="pickup"
                      canComplete={canComplete && activeTab === 'AVAILABLE'}
                      completing={completingId === mission.pickup.id}
                      onComplete={(order) => void completeOrder(order)}
                    />
                  ) : null}
                  {mission.pickup && mission.delivery ? <span className="mission-flow-arrow"><Icon name="arrow" /></span> : null}
                  {mission.delivery ? (
                    <MissionStop
                      order={mission.delivery}
                      type="delivery"
                      canComplete={canComplete && activeTab === 'AVAILABLE'}
                      completionBlocked={deliveryBlocked}
                      completing={completingId === mission.delivery.id}
                      onComplete={(order) => void completeOrder(order)}
                    />
                  ) : null}
                </div>

                <div className="mission-vehicle-assignment">
                  <div className="mission-vehicle-current">
                    <span className="mission-vehicle-icon"><Icon name="vehicles" /></span>
                    <span>
                      <small>Veículo da missão</small>
                      <strong>
                        {mission.assignedVehicle
                          ? `${mission.assignedVehicle.name} • ${mission.assignedVehicle.plate}`
                          : 'Automático na roteirização'}
                      </strong>
                    </span>
                  </div>
                  {canManage && activeTab === 'AVAILABLE' && assignmentEditable ? (
                    <label className="mission-vehicle-select">
                      <span>Designar</span>
                      <select
                        value={mission.assignedVehicleId ?? ''}
                        disabled={assigningReference === mission.reference}
                        onChange={(event) =>
                          void assignMissionVehicle(mission, event.target.value)
                        }
                      >
                        <option value="">Automático — sistema escolhe</option>
                        {mission.assignedVehicleId &&
                        !vehicles.some((vehicle) => vehicle.id === mission.assignedVehicleId) ? (
                          <option value={mission.assignedVehicleId}>Veículo atual não disponível</option>
                        ) : null}
                        {vehicles.map((vehicle) => (
                          <option
                            key={vehicle.id}
                            value={vehicle.id}
                            disabled={vehicleOptionDisabled(vehicle)}
                          >
                            {vehicle.name} ({vehicle.plate}) — {vehicleStatusLabel(vehicle)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : mission.assignedVehicle ? (
                    <span className="mission-vehicle-locked">
                      {assignmentEditable ? vehicleStatusLabel(mission.assignedVehicle) : 'Definido antes da rota'}
                    </span>
                  ) : null}
                </div>

                {canManage && activeTab === 'AVAILABLE' && !['IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(mission.status) ? (
                  <footer className="mission-card-footer">
                    <button className="button button-ghost button-small danger-text" onClick={() => void cancelMission(mission)}>Cancelar missão</button>
                  </footer>
                ) : null}
              </article>
            );
          })}
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

          <label className="field mission-vehicle-field">
            <span>Veículo <small>(opcional)</small></span>
            <select
              value={form.assignedVehicleId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  assignedVehicleId: event.target.value,
                }))
              }
            >
              <option value="">Automático — o sistema escolhe na roteirização</option>
              {vehicles.map((vehicle) => (
                <option
                  key={vehicle.id}
                  value={vehicle.id}
                  disabled={vehicleOptionDisabled(vehicle)}
                >
                  {vehicle.name} ({vehicle.plate}) — {vehicleStatusLabel(vehicle)}
                </option>
              ))}
            </select>
            <small className="mission-vehicle-help">
              Escolha Fiorino ou Van para fixar a missão nesse veículo. Sem escolha, o sistema decide pela melhor rota.
            </small>
          </label>

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
                  selected={Boolean(form.pickupFormattedAddress)}
                  value={form.pickupAddress}
                  onValueChange={changePickupAddress}
                  onSelect={selectPickupAddress}
                  placeholder="Rua ou nome do local"
                />
                <div className="form-row mission-location-row">
                  <label className="field"><span>Número</span><input required value={form.pickupAddressNumber} onChange={(event) => setForm((current) => ({ ...current, pickupAddressNumber: event.target.value, pickupLocationConfirmed: false }))} placeholder="Ex.: 350 ou s/n" /></label>
                  <label className="field"><span>Complemento <small>(opcional)</small></span><input value={form.pickupAddressComplement} onChange={(event) => setForm((current) => ({ ...current, pickupAddressComplement: event.target.value }))} placeholder="Ex.: Fundos, portão azul" /></label>
                </div>
                <div className="form-hint compact"><Icon name="pin" />Depois do número, confirme no mapa a entrada exata do local.</div>
                <div className="form-row mission-location-row">
                  <label className="field"><span>Cidade</span><input required value={form.pickupCity} onChange={(event) => setForm((current) => ({ ...current, pickupCity: event.target.value, pickupLocationConfirmed: false }))} placeholder="Ex.: Marialva" /></label>
                  <label className="field"><span>Bairro <small>(opcional)</small></span><input value={form.pickupNeighborhood} onChange={(event) => setForm((current) => ({ ...current, pickupNeighborhood: event.target.value, pickupLocationConfirmed: false }))} placeholder="Ex.: Centro" /></label>
                </div>
                <PreciseLocationPicker
                  kind="pickup"
                  address={form.pickupAddress}
                  addressNumber={form.pickupAddressNumber}
                  neighborhood={form.pickupNeighborhood}
                  city={form.pickupCity}
                  state={form.pickupState}
                  postalCode={form.pickupPostalCode}
                  latitude={form.pickupLatitude}
                  longitude={form.pickupLongitude}
                  confirmed={form.pickupLocationConfirmed}
                  onChange={updatePickupLocation}
                />
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
                  selected={Boolean(form.deliveryFormattedAddress)}
                  value={form.deliveryAddress}
                  onValueChange={changeDeliveryAddress}
                  onSelect={selectDeliveryAddress}
                  placeholder="Rua ou nome do local"
                />
                <div className="form-row mission-location-row">
                  <label className="field"><span>Número</span><input required value={form.deliveryAddressNumber} onChange={(event) => setForm((current) => ({ ...current, deliveryAddressNumber: event.target.value, deliveryLocationConfirmed: false }))} placeholder="Ex.: 120 ou s/n" /></label>
                  <label className="field"><span>Complemento <small>(opcional)</small></span><input value={form.deliveryAddressComplement} onChange={(event) => setForm((current) => ({ ...current, deliveryAddressComplement: event.target.value }))} placeholder="Ex.: Barracão dos fundos" /></label>
                </div>
                <div className="form-hint compact"><Icon name="pin" />Depois do número, confirme no mapa a entrada exata do local.</div>
                <div className="form-row mission-location-row">
                  <label className="field"><span>Cidade</span><input required value={form.deliveryCity} onChange={(event) => setForm((current) => ({ ...current, deliveryCity: event.target.value, deliveryLocationConfirmed: false }))} placeholder="Ex.: Maringá" /></label>
                  <label className="field"><span>Bairro <small>(opcional)</small></span><input value={form.deliveryNeighborhood} onChange={(event) => setForm((current) => ({ ...current, deliveryNeighborhood: event.target.value, deliveryLocationConfirmed: false }))} placeholder="Ex.: Centro" /></label>
                </div>
                <PreciseLocationPicker
                  kind="delivery"
                  address={form.deliveryAddress}
                  addressNumber={form.deliveryAddressNumber}
                  neighborhood={form.deliveryNeighborhood}
                  city={form.deliveryCity}
                  state={form.deliveryState}
                  postalCode={form.deliveryPostalCode}
                  latitude={form.deliveryLatitude}
                  longitude={form.deliveryLongitude}
                  confirmed={form.deliveryLocationConfirmed}
                  onChange={updateDeliveryLocation}
                />
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
