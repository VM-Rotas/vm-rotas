'use client';

import { useAuth } from '@/components/auth-provider';
import { EmptyState, ErrorBanner, LoadingBlock, SuccessBanner } from '@/components/feedback';
import { Icon } from '@/components/icons';
import { PageHeader } from '@/components/page-header';
import { api, ApiError } from '@/lib/api';
import type { Vehicle } from '@/lib/types';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import styles from './vehicles.module.css';

interface VehicleForm {
  plate: string;
  name: string;
  capacityWeightKg: string;
  capacityVolumeM3: string;
  startHour: string;
  endHour: string;
}

type OperationalStatus = 'AVAILABLE' | 'IN_ROUTE' | 'OCCUPIED' | 'MAINTENANCE' | 'UNAVAILABLE';

type EditableOperationalStatus = Exclude<OperationalStatus, 'IN_ROUTE'>;

const initialForm: VehicleForm = {
  plate: '',
  name: '',
  capacityWeightKg: '',
  capacityVolumeM3: '',
  startHour: '08:00',
  endHour: '18:00',
};

const STATUS_OPTIONS: Array<{
  value: EditableOperationalStatus;
  label: string;
  description: string;
}> = [
  {
    value: 'AVAILABLE',
    label: 'Disponível',
    description: 'Pode receber novas missões na roteirização.',
  },
  {
    value: 'OCCUPIED',
    label: 'Ocupado',
    description: 'Fica fora de novas rotas até ser liberado manualmente.',
  },
  {
    value: 'MAINTENANCE',
    label: 'Em manutenção',
    description: 'Não participa da operação nem da roteirização.',
  },
  {
    value: 'UNAVAILABLE',
    label: 'Indisponível',
    description: 'Fica desativado até ser marcado como disponível novamente.',
  },
];

const STATUS_META: Record<OperationalStatus, { label: string; description: string; tone: string }> = {
  AVAILABLE: {
    label: 'Disponível',
    description: 'Pode receber novas missões.',
    tone: styles.statusAvailable ?? '',
  },
  IN_ROUTE: {
    label: 'Em rota',
    description: 'Status controlado pela execução da rota.',
    tone: styles.statusInRoute ?? '',
  },
  OCCUPIED: {
    label: 'Ocupado',
    description: 'Temporariamente fora de novas rotas.',
    tone: styles.statusOccupied ?? '',
  },
  MAINTENANCE: {
    label: 'Manutenção',
    description: 'Fora da operação por manutenção.',
    tone: styles.statusMaintenance ?? '',
  },
  UNAVAILABLE: {
    label: 'Indisponível',
    description: 'Desativado para a operação.',
    tone: styles.statusUnavailable ?? '',
  },
};

function getOperationalStatus(vehicle: Vehicle): OperationalStatus {
  if (!vehicle.active) return 'UNAVAILABLE';
  if (vehicle.status === 'INACTIVE') return 'OCCUPIED';
  return vehicle.status;
}

function getStatusPayload(status: EditableOperationalStatus): Pick<Vehicle, 'active' | 'status'> {
  switch (status) {
    case 'AVAILABLE':
      return { active: true, status: 'AVAILABLE' };
    case 'OCCUPIED':
      return { active: true, status: 'INACTIVE' };
    case 'MAINTENANCE':
      return { active: true, status: 'MAINTENANCE' };
    case 'UNAVAILABLE':
      return { active: false, status: 'AVAILABLE' };
  }

  throw new Error('Status operacional inválido.');
}

function vehicleToForm(vehicle: Vehicle): VehicleForm {
  return {
    plate: vehicle.plate,
    name: vehicle.name,
    capacityWeightKg:
      vehicle.capacityWeightKg == null ? '' : String(Number(vehicle.capacityWeightKg)),
    capacityVolumeM3:
      vehicle.capacityVolumeM3 == null ? '' : String(Number(vehicle.capacityVolumeM3)),
    startHour: vehicle.startHour ?? '08:00',
    endHour: vehicle.endHour ?? '18:00',
  };
}

export default function VehiclesPage() {
  const { user } = useAuth();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);
  const [form, setForm] = useState<VehicleForm>(initialForm);
  const [saving, setSaving] = useState(false);
  const [savingStatusId, setSavingStatusId] = useState<string | null>(null);

  const canManage = Boolean(user && ['OWNER', 'ADMIN', 'DISPATCHER'].includes(user.role));

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setVehicles(await api<Vehicle[]>('/vehicles'));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível carregar a frota.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counters = useMemo(() => {
    const statuses = vehicles.map(getOperationalStatus);
    return {
      total: vehicles.length,
      available: statuses.filter((status) => status === 'AVAILABLE').length,
      inRoute: statuses.filter((status) => status === 'IN_ROUTE').length,
      occupied: statuses.filter((status) => status === 'OCCUPIED').length,
      outOfOperation: statuses.filter(
        (status) => status === 'MAINTENANCE' || status === 'UNAVAILABLE',
      ).length,
    };
  }, [vehicles]);

  function openCreateForm() {
    setEditingVehicleId(null);
    setForm(initialForm);
    setError('');
    setSuccess('');
    setFormOpen(true);
  }

  function openEditForm(vehicle: Vehicle) {
    setEditingVehicleId(vehicle.id);
    setForm(vehicleToForm(vehicle));
    setError('');
    setSuccess('');
    setFormOpen(true);
  }

  function closeForm() {
    if (saving) return;
    setFormOpen(false);
    setEditingVehicleId(null);
    setForm(initialForm);
  }

  async function saveVehicle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');

    const payload = {
      plate: form.plate,
      name: form.name,
      capacityWeightKg: form.capacityWeightKg ? Number(form.capacityWeightKg) : undefined,
      capacityVolumeM3: form.capacityVolumeM3 ? Number(form.capacityVolumeM3) : undefined,
      startHour: form.startHour,
      endHour: form.endHour,
    };

    try {
      if (editingVehicleId) {
        await api(`/vehicles/${editingVehicleId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setSuccess('Dados do veículo atualizados com sucesso.');
      } else {
        await api('/vehicles', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setSuccess('Veículo cadastrado e disponível para a roteirização.');
      }

      closeForm();
      await load();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : editingVehicleId
            ? 'Não foi possível editar o veículo.'
            : 'Não foi possível cadastrar o veículo.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function changeOperationalStatus(
    vehicle: Vehicle,
    nextStatus: EditableOperationalStatus,
  ) {
    const currentStatus = getOperationalStatus(vehicle);
    if (currentStatus === 'IN_ROUTE') return;
    if (currentStatus === nextStatus) return;

    setSavingStatusId(vehicle.id);
    setError('');
    setSuccess('');

    try {
      await api(`/vehicles/${vehicle.id}`, {
        method: 'PATCH',
        body: JSON.stringify(getStatusPayload(nextStatus)),
      });
      setSuccess(`${vehicle.name} agora está como ${STATUS_META[nextStatus].label.toLowerCase()}.`);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível alterar o status.');
    } finally {
      setSavingStatusId(null);
    }
  }

  const editingVehicle = editingVehicleId
    ? vehicles.find((vehicle) => vehicle.id === editingVehicleId)
    : null;

  return (
    <>
      <PageHeader
        eyebrow="Recursos operacionais"
        title="Veículos"
        description="Edite os veículos e informe rapidamente quais estão disponíveis para receber missões."
        actions={
          canManage ? (
            <button className="button button-primary" onClick={openCreateForm}>
              <Icon name="plus" />
              Novo veículo
            </button>
          ) : undefined
        }
      />

      {error ? <ErrorBanner message={error} /> : null}
      {success ? <SuccessBanner message={success} /> : null}

      <section className={styles.routingNotice}>
        <span className={styles.routingNoticeIcon}>
          <Icon name="warning" />
        </span>
        <div>
          <strong>Regra da roteirização</strong>
          <span>
            Somente veículos marcados como <b>Disponível</b> recebem novas missões. Ocupados,
            em manutenção e indisponíveis ficam automaticamente fora do cálculo.
          </span>
        </div>
      </section>

      <section className={styles.statsGrid} aria-label="Resumo da frota">
        <div className={styles.statCard}>
          <span>Cadastrados</span>
          <strong>{counters.total}</strong>
        </div>
        <div className={`${styles.statCard} ${styles.statSuccess}`}>
          <span>Disponíveis</span>
          <strong>{counters.available}</strong>
        </div>
        <div className={`${styles.statCard} ${styles.statRoute}`}>
          <span>Em rota</span>
          <strong>{counters.inRoute}</strong>
        </div>
        <div className={`${styles.statCard} ${styles.statOccupied}`}>
          <span>Ocupados</span>
          <strong>{counters.occupied}</strong>
        </div>
        <div className={`${styles.statCard} ${styles.statMuted}`}>
          <span>Fora da operação</span>
          <strong>{counters.outOfOperation}</strong>
        </div>
      </section>

      {loading && vehicles.length === 0 ? (
        <LoadingBlock label="Carregando frota..." />
      ) : vehicles.length === 0 ? (
        <section className="panel">
          <EmptyState
            title="Nenhum veículo cadastrado"
            description="Adicione o primeiro veículo para começar a distribuir as missões."
          />
        </section>
      ) : (
        <section className={styles.vehicleGrid}>
          {vehicles.map((vehicle) => {
            const operationalStatus = getOperationalStatus(vehicle);
            const statusMeta = STATUS_META[operationalStatus];
            const isChangingStatus = savingStatusId === vehicle.id;

            return (
              <article
                className={`${styles.vehicleCard}${
                  operationalStatus === 'UNAVAILABLE' ? ` ${styles.vehicleCardInactive}` : ''
                }`}
                key={vehicle.id}
              >
                <div className={styles.cardTop}>
                  <div className={styles.vehicleIcon}>
                    <Icon name="vehicles" />
                  </div>
                  <span className={`${styles.statusBadge} ${statusMeta.tone}`}>
                    {statusMeta.label}
                  </span>
                </div>

                <div className={styles.vehicleTitle}>
                  <h2>{vehicle.name}</h2>
                  <span>{vehicle.plate}</span>
                </div>

                <div className={styles.vehicleSpecs}>
                  <div>
                    <span>Capacidade de peso</span>
                    <strong>
                      {vehicle.capacityWeightKg != null
                        ? `${Number(vehicle.capacityWeightKg).toLocaleString('pt-BR')} kg`
                        : 'Não informada'}
                    </strong>
                  </div>
                  <div>
                    <span>Capacidade volumétrica</span>
                    <strong>
                      {vehicle.capacityVolumeM3 != null
                        ? `${Number(vehicle.capacityVolumeM3).toLocaleString('pt-BR')} m³`
                        : 'Não informada'}
                    </strong>
                  </div>
                  <div>
                    <span>Jornada</span>
                    <strong>
                      {vehicle.startHour ?? '08:00'} — {vehicle.endHour ?? '18:00'}
                    </strong>
                  </div>
                  <div>
                    <span>Rotas registradas</span>
                    <strong>{vehicle._count?.routePlans ?? 0}</strong>
                  </div>
                </div>

                <div className={styles.statusSection}>
                  <label htmlFor={`vehicle-status-${vehicle.id}`}>Situação atual</label>
                  {operationalStatus === 'IN_ROUTE' ? (
                    <div className={styles.inRouteBox}>
                      <span className="pulse-dot" />
                      <div>
                        <strong>Veículo em operação</strong>
                        <small>O status volta a disponível ao concluir a rota.</small>
                      </div>
                    </div>
                  ) : (
                    <select
                      id={`vehicle-status-${vehicle.id}`}
                      value={operationalStatus}
                      disabled={!canManage || isChangingStatus}
                      onChange={(event) =>
                        void changeOperationalStatus(
                          vehicle,
                          event.target.value as EditableOperationalStatus,
                        )
                      }
                    >
                      {STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  )}
                  <small>{statusMeta.description}</small>
                </div>

                <div className={styles.cardActions}>
                  {canManage ? (
                    <button
                      className="button button-secondary button-small"
                      type="button"
                      onClick={() => openEditForm(vehicle)}
                    >
                      Editar veículo
                    </button>
                  ) : null}
                  {isChangingStatus ? (
                    <span className={styles.savingStatus}>
                      <span className="spinner small" /> Atualizando...
                    </span>
                  ) : null}
                </div>
              </article>
            );
          })}
        </section>
      )}

      <div
        className={`drawer-backdrop${formOpen ? ' is-open' : ''}`}
        onClick={closeForm}
      />
      <aside className={`drawer${formOpen ? ' is-open' : ''}`} aria-hidden={!formOpen}>
        <div className="drawer-header">
          <div>
            <span className="eyebrow">
              {editingVehicleId ? 'Editar cadastro' : 'Nova capacidade'}
            </span>
            <h2>{editingVehicleId ? `Editar ${editingVehicle?.name ?? 'veículo'}` : 'Cadastrar veículo'}</h2>
          </div>
          <button className="icon-button" onClick={closeForm} aria-label="Fechar" type="button">
            <Icon name="close" />
          </button>
        </div>

        <form className="drawer-form" onSubmit={saveVehicle}>
          <div className="form-row two">
            <label className="field">
              <span>Nome operacional</span>
              <input
                required
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="Fiorino 01"
              />
            </label>
            <label className="field">
              <span>Placa</span>
              <input
                required
                minLength={7}
                maxLength={10}
                value={form.plate}
                onChange={(event) =>
                  setForm({ ...form, plate: event.target.value.toUpperCase() })
                }
                placeholder="ABC1D23"
              />
            </label>
          </div>

          <div className="form-section-title">Capacidade</div>
          <div className="form-row two">
            <label className="field">
              <span>Peso máximo (kg)</span>
              <input
                type="number"
                min="0"
                step="0.1"
                value={form.capacityWeightKg}
                onChange={(event) =>
                  setForm({ ...form, capacityWeightKg: event.target.value })
                }
                placeholder="650"
              />
            </label>
            <label className="field">
              <span>Volume máximo (m³)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.capacityVolumeM3}
                onChange={(event) =>
                  setForm({ ...form, capacityVolumeM3: event.target.value })
                }
                placeholder="3.2"
              />
            </label>
          </div>

          <div className="form-section-title">Jornada padrão</div>
          <div className="form-row two">
            <label className="field">
              <span>Início</span>
              <input
                type="time"
                value={form.startHour}
                onChange={(event) => setForm({ ...form, startHour: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Fim</span>
              <input
                type="time"
                value={form.endHour}
                onChange={(event) => setForm({ ...form, endHour: event.target.value })}
              />
            </label>
          </div>

          <div className="form-hint">
            <Icon name="warning" />
            Altere a situação operacional diretamente no cartão do veículo. A capacidade e a jornada
            são usadas pela roteirização.
          </div>

          <div className="drawer-actions">
            <button type="button" className="button button-secondary" onClick={closeForm}>
              Cancelar
            </button>
            <button type="submit" className="button button-primary" disabled={saving}>
              {saving ? (
                <>
                  <span className="spinner small" /> Salvando...
                </>
              ) : editingVehicleId ? (
                'Salvar alterações'
              ) : (
                'Cadastrar veículo'
              )}
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}
