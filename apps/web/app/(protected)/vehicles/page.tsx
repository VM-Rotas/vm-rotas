'use client';

import { useAuth } from '@/components/auth-provider';
import { EmptyState, ErrorBanner, LoadingBlock, SuccessBanner } from '@/components/feedback';
import { Icon } from '@/components/icons';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { api, ApiError } from '@/lib/api';
import type { Vehicle } from '@/lib/types';
import { FormEvent, useCallback, useEffect, useState } from 'react';

interface VehicleForm {
  plate: string;
  name: string;
  capacityWeightKg: string;
  capacityVolumeM3: string;
  startHour: string;
  endHour: string;
}

const initialForm: VehicleForm = {
  plate: '',
  name: '',
  capacityWeightKg: '',
  capacityVolumeM3: '',
  startHour: '08:00',
  endHour: '18:00',
};

export default function VehiclesPage() {
  const { user } = useAuth();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);
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

  async function createVehicle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api('/vehicles', {
        method: 'POST',
        body: JSON.stringify({
          plate: form.plate,
          name: form.name,
          capacityWeightKg: form.capacityWeightKg ? Number(form.capacityWeightKg) : undefined,
          capacityVolumeM3: form.capacityVolumeM3 ? Number(form.capacityVolumeM3) : undefined,
          startHour: form.startHour,
          endHour: form.endHour,
        }),
      });
      setForm(initialForm);
      setFormOpen(false);
      setSuccess('Veículo cadastrado e disponível para o planejamento.');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível cadastrar o veículo.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleMaintenance(vehicle: Vehicle) {
    const nextStatus = vehicle.status === 'MAINTENANCE' ? 'AVAILABLE' : 'MAINTENANCE';
    try {
      await api(`/vehicles/${vehicle.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      setSuccess(
        nextStatus === 'MAINTENANCE'
          ? `${vehicle.name} foi colocado em manutenção.`
          : `${vehicle.name} voltou a ficar disponível.`,
      );
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível atualizar o veículo.');
    }
  }

  const available = vehicles.filter((vehicle) => vehicle.active && vehicle.status === 'AVAILABLE').length;
  const inRoute = vehicles.filter((vehicle) => vehicle.status === 'IN_ROUTE').length;
  const maintenance = vehicles.filter((vehicle) => vehicle.status === 'MAINTENANCE').length;

  return (
    <>
      <PageHeader
        eyebrow="Recursos operacionais"
        title="Frota"
        description="Controle capacidade, disponibilidade e jornada dos veículos usados nas rotas."
        actions={canManage ? <button className="button button-primary" onClick={() => setFormOpen(true)}><Icon name="plus" />Novo veículo</button> : undefined}
      />
      {error ? <ErrorBanner message={error} /> : null}
      {success ? <SuccessBanner message={success} /> : null}

      <section className="mini-stats-grid">
        <div className="mini-stat"><span>Total ativo</span><strong>{vehicles.filter((vehicle) => vehicle.active).length}</strong></div>
        <div className="mini-stat success"><span>Disponíveis</span><strong>{available}</strong></div>
        <div className="mini-stat warning"><span>Em rota</span><strong>{inRoute}</strong></div>
        <div className="mini-stat muted"><span>Manutenção</span><strong>{maintenance}</strong></div>
      </section>

      {loading && vehicles.length === 0 ? <LoadingBlock label="Carregando frota..." /> : vehicles.length === 0 ? (
        <section className="panel"><EmptyState title="Nenhum veículo cadastrado" description="Adicione o primeiro veículo para começar a distribuir as ordens." /></section>
      ) : (
        <section className="vehicle-grid">
          {vehicles.map((vehicle) => (
            <article className={`vehicle-card${!vehicle.active ? ' inactive' : ''}`} key={vehicle.id}>
              <div className="vehicle-card-top">
                <div className="vehicle-illustration"><Icon name="vehicles" /></div>
                <StatusBadge value={vehicle.active ? vehicle.status : 'INACTIVE'} compact />
              </div>
              <div className="vehicle-card-title"><h2>{vehicle.name}</h2><span>{vehicle.plate}</span></div>
              <div className="vehicle-specs">
                <div><span>Capacidade de peso</span><strong>{vehicle.capacityWeightKg != null ? `${Number(vehicle.capacityWeightKg).toLocaleString('pt-BR')} kg` : 'Não informada'}</strong></div>
                <div><span>Capacidade volumétrica</span><strong>{vehicle.capacityVolumeM3 != null ? `${Number(vehicle.capacityVolumeM3).toLocaleString('pt-BR')} m³` : 'Não informada'}</strong></div>
                <div><span>Jornada</span><strong>{vehicle.startHour ?? '08:00'} — {vehicle.endHour ?? '18:00'}</strong></div>
                <div><span>Rotas registradas</span><strong>{vehicle._count?.routePlans ?? 0}</strong></div>
              </div>
              <div className="vehicle-card-actions">
                {canManage && vehicle.status !== 'IN_ROUTE' ? (
                  <button className="button button-secondary button-small" onClick={() => void toggleMaintenance(vehicle)}>
                    {vehicle.status === 'MAINTENANCE' ? 'Marcar disponível' : 'Colocar em manutenção'}
                  </button>
                ) : vehicle.status === 'IN_ROUTE' ? <span className="in-route-note"><span className="pulse-dot" />Veículo em operação</span> : null}
              </div>
            </article>
          ))}
        </section>
      )}

      <div className={`drawer-backdrop${formOpen ? ' is-open' : ''}`} onClick={() => setFormOpen(false)} />
      <aside className={`drawer${formOpen ? ' is-open' : ''}`} aria-hidden={!formOpen}>
        <div className="drawer-header"><div><span className="eyebrow">Nova capacidade</span><h2>Cadastrar veículo</h2></div><button className="icon-button" onClick={() => setFormOpen(false)} aria-label="Fechar"><Icon name="close" /></button></div>
        <form className="drawer-form" onSubmit={createVehicle}>
          <div className="form-row two"><label className="field"><span>Nome operacional</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Fiorino 03" /></label><label className="field"><span>Placa</span><input required minLength={7} maxLength={10} value={form.plate} onChange={(event) => setForm({ ...form, plate: event.target.value.toUpperCase() })} placeholder="ABC1D23" /></label></div>
          <div className="form-section-title">Capacidade</div>
          <div className="form-row two"><label className="field"><span>Peso máximo (kg)</span><input type="number" min="0" step="0.1" value={form.capacityWeightKg} onChange={(event) => setForm({ ...form, capacityWeightKg: event.target.value })} placeholder="650" /></label><label className="field"><span>Volume máximo (m³)</span><input type="number" min="0" step="0.01" value={form.capacityVolumeM3} onChange={(event) => setForm({ ...form, capacityVolumeM3: event.target.value })} placeholder="3.2" /></label></div>
          <div className="form-section-title">Jornada padrão</div>
          <div className="form-row two"><label className="field"><span>Início</span><input type="time" value={form.startHour} onChange={(event) => setForm({ ...form, startHour: event.target.value })} /></label><label className="field"><span>Fim</span><input type="time" value={form.endHour} onChange={(event) => setForm({ ...form, endHour: event.target.value })} /></label></div>
          <div className="form-hint"><Icon name="warning" />As capacidades são usadas pelo otimizador para evitar alocações incompatíveis.</div>
          <div className="drawer-actions"><button type="button" className="button button-secondary" onClick={() => setFormOpen(false)}>Cancelar</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? <><span className="spinner small" />Salvando...</> : 'Cadastrar veículo'}</button></div>
        </form>
      </aside>
    </>
  );
}
