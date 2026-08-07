'use client';

import { useAuth } from '@/components/auth-provider';
import { ErrorBanner, LoadingBlock, SuccessBanner } from '@/components/feedback';
import { Icon } from '@/components/icons';
import { api, ApiError, queryString } from '@/lib/api';
import type { Vehicle, VehicleUnavailability } from '@/lib/types';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import styles from './vehicle-week-schedule.module.css';

interface ScheduleForm {
  vehicleId: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  startTime: string;
  endTime: string;
  reason: string;
  destinationCity: string;
}

const WEEKDAY = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' });
const DAY_MONTH = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });
const TIME = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function dateValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDate(value: string): Date {
  return new Date(`${value}T12:00:00`);
}

function addDays(value: string, days: number): string {
  const date = parseLocalDate(value);
  date.setDate(date.getDate() + days);
  return dateValue(date);
}

function mondayOf(value: string): string {
  const date = parseLocalDate(value);
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  return dateValue(date);
}

function localDateFromIso(value: string): string {
  return dateValue(new Date(value));
}

function localTimeFromIso(value: string): string {
  return TIME.format(new Date(value));
}

function dayWindow(value: string): { start: Date; end: Date } {
  return {
    start: new Date(`${value}T00:00:00-03:00`),
    end: new Date(`${addDays(value, 1)}T00:00:00-03:00`),
  };
}

function overlaps(block: VehicleUnavailability, date: string): boolean {
  const day = dayWindow(date);
  return new Date(block.startsAt) < day.end && new Date(block.endsAt) > day.start;
}

function timeLabel(block: VehicleUnavailability, date: string): string {
  if (block.allDay) return 'Dia inteiro';
  const day = dayWindow(date);
  const startsAt = new Date(block.startsAt);
  const endsAt = new Date(block.endsAt);
  const start = startsAt <= day.start ? '00:00' : TIME.format(startsAt);
  const end = endsAt >= day.end ? '23:59' : TIME.format(endsAt);
  return `${start}–${end}`;
}

function initialScheduleForm(date: string, vehicleId = ''): ScheduleForm {
  return {
    vehicleId,
    startDate: date,
    endDate: date,
    allDay: true,
    startTime: '08:00',
    endTime: '18:00',
    reason: '',
    destinationCity: '',
  };
}

export function VehicleWeekSchedule() {
  const { user } = useAuth();
  const canManage = Boolean(user && ['OWNER', 'ADMIN', 'DISPATCHER'].includes(user.role));
  const today = dateValue(new Date());
  const [weekStart, setWeekStart] = useState(mondayOf(today));
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [blocks, setBlocks] = useState<VehicleUnavailability[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ScheduleForm>(() => initialScheduleForm(today));
  const [saving, setSaving] = useState(false);
  const weekEnd = addDays(weekStart, 6);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);

  const load = useCallback(async () => {
    if (!canManage) return;
    setLoading(true);
    setError('');
    try {
      const [vehicleData, scheduleData] = await Promise.all([
        api<Vehicle[]>('/vehicles'),
        api<VehicleUnavailability[]>(
          `/vehicle-unavailability${queryString({ from: weekStart, to: weekEnd })}`,
        ),
      ]);
      setVehicles(vehicleData.filter((vehicle) => vehicle.active));
      setBlocks(scheduleData);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível carregar a agenda da frota.');
    } finally {
      setLoading(false);
    }
  }, [canManage, weekEnd, weekStart]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canManage) return null;

  function openNew(date = weekStart) {
    setError('');
    setSuccess('');
    setEditingId(null);
    setForm(initialScheduleForm(date, vehicles[0]?.id ?? ''));
    setFormOpen(true);
  }

  function openEdit(block: VehicleUnavailability) {
    const inclusiveEnd = new Date(new Date(block.endsAt).getTime() - (block.allDay ? 1 : 0));
    setError('');
    setSuccess('');
    setEditingId(block.id);
    setForm({
      vehicleId: block.vehicleId,
      startDate: localDateFromIso(block.startsAt),
      endDate: dateValue(inclusiveEnd),
      allDay: block.allDay,
      startTime: block.allDay ? '08:00' : localTimeFromIso(block.startsAt),
      endTime: block.allDay ? '18:00' : localTimeFromIso(block.endsAt),
      reason: block.reason,
      destinationCity: block.destinationCity ?? '',
    });
    setFormOpen(true);
  }

  async function save(event?: FormEvent, force = false) {
    event?.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    setSuccess('');
    const body = {
      vehicleId: form.vehicleId,
      startDate: form.startDate,
      endDate: form.endDate,
      allDay: form.allDay,
      startTime: form.allDay ? undefined : form.startTime,
      endTime: form.allDay ? undefined : form.endTime,
      reason: form.reason,
      destinationCity: form.destinationCity || undefined,
      force,
    };

    try {
      if (editingId) {
        await api(`/vehicle-unavailability/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      } else {
        await api('/vehicle-unavailability', {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }
      setFormOpen(false);
      setSuccess(editingId ? 'Programação atualizada.' : 'Indisponibilidade programada.');
      await load();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409 && !force) {
        const proceed = window.confirm(`${caught.message}\n\nDeseja salvar mesmo assim?`);
        setSaving(false);
        if (proceed) await save(undefined, true);
        return;
      }
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível salvar a programação.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(block: VehicleUnavailability) {
    if (!window.confirm(`Remover a indisponibilidade de ${block.vehicle.name}?`)) return;
    setError('');
    setSuccess('');
    try {
      await api(`/vehicle-unavailability/${block.id}`, { method: 'DELETE' });
      setFormOpen(false);
      setEditingId(null);
      setSuccess('Programação removida.');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível remover a programação.');
    }
  }

  return (
    <section className={`panel ${styles.wrapper}`}>
      <div className={styles.heading}>
        <div>
          <span className="eyebrow">Agenda da frota</span>
          <h2>Disponibilidade por semana</h2>
          <p>Programe viagens, compromissos e períodos em que cada veículo ficará fora da operação.</p>
        </div>
        <button className="button button-primary button-icon-text" onClick={() => openNew()}>
          <Icon name="plus" /> Programar indisponibilidade
        </button>
      </div>

      {error ? <ErrorBanner message={error} /> : null}
      {success ? <SuccessBanner message={success} /> : null}

      <div className={styles.weekToolbar}>
        <button className="button button-secondary" onClick={() => setWeekStart(addDays(weekStart, -7))}>← Semana anterior</button>
        <div className={styles.weekTitle}>
          <strong>{DAY_MONTH.format(parseLocalDate(weekStart))} a {DAY_MONTH.format(parseLocalDate(weekEnd))}</strong>
          <button className="text-link" onClick={() => setWeekStart(mondayOf(today))}>Ir para esta semana</button>
        </div>
        <button className="button button-secondary" onClick={() => setWeekStart(addDays(weekStart, 7))}>Próxima semana →</button>
      </div>

      {loading ? <LoadingBlock label="Carregando agenda da frota..." /> : (
        <div className={styles.weekGrid}>
          {days.map((day) => (
            <article className={`${styles.dayCard}${day === today ? ` ${styles.today}` : ''}`} key={day}>
              <header className={styles.dayHeader}>
                <div>
                  <strong>{WEEKDAY.format(parseLocalDate(day)).replace('.', '')}</strong>
                  <span>{DAY_MONTH.format(parseLocalDate(day))}</span>
                </div>
                <button className={styles.dayAdd} onClick={() => openNew(day)} aria-label={`Programar ${day}`}>+</button>
              </header>

              <div className={styles.vehicleDayList}>
                {vehicles.map((vehicle) => {
                  const vehicleBlocks = blocks.filter(
                    (block) => block.vehicleId === vehicle.id && overlaps(block, day),
                  );
                  return (
                    <div className={styles.vehicleDay} key={vehicle.id}>
                      <div className={styles.vehicleName}>
                        <Icon name="vehicles" />
                        <span><strong>{vehicle.name}</strong><small>{vehicle.plate}</small></span>
                      </div>
                      {vehicleBlocks.length === 0 ? (
                        <span className={styles.available}>Disponível</span>
                      ) : (
                        <div className={styles.blockList}>
                          {vehicleBlocks.map((block) => (
                            <button className={styles.block} key={block.id} onClick={() => openEdit(block)}>
                              <strong>{timeLabel(block, day)}</strong>
                              <span>{block.reason}</span>
                              {block.destinationCity ? <small>{block.destinationCity}</small> : null}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      )}

      {formOpen ? (
        <div className={styles.modalBackdrop} onMouseDown={() => !saving && setFormOpen(false)}>
          <div className={styles.modal} onMouseDown={(event) => event.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div><span className="eyebrow">Agenda da frota</span><h2>{editingId ? 'Editar indisponibilidade' : 'Programar veículo'}</h2></div>
              <button className="icon-button" onClick={() => setFormOpen(false)} disabled={saving} aria-label="Fechar"><Icon name="close" /></button>
            </div>
            <form className={styles.form} onSubmit={(event) => void save(event)}>
              <label className="field"><span>Veículo</span><select required value={form.vehicleId} onChange={(event) => setForm((current) => ({ ...current, vehicleId: event.target.value }))}>{vehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name} · {vehicle.plate}</option>)}</select></label>
              <div className={styles.formRow}>
                <label className="field"><span>Data inicial</span><input type="date" required value={form.startDate} onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value, endDate: current.endDate < event.target.value ? event.target.value : current.endDate }))} /></label>
                <label className="field"><span>Data final</span><input type="date" required min={form.startDate} value={form.endDate} onChange={(event) => setForm((current) => ({ ...current, endDate: event.target.value }))} /></label>
              </div>
              <label className={styles.checkRow}><input type="checkbox" checked={form.allDay} onChange={(event) => setForm((current) => ({ ...current, allDay: event.target.checked }))} /><span><strong>Dia inteiro</strong><small>Também funciona para vários dias consecutivos.</small></span></label>
              {!form.allDay ? <div className={styles.formRow}><label className="field"><span>Horário inicial</span><input type="time" required value={form.startTime} onChange={(event) => setForm((current) => ({ ...current, startTime: event.target.value }))} /></label><label className="field"><span>Horário final</span><input type="time" required value={form.endTime} onChange={(event) => setForm((current) => ({ ...current, endTime: event.target.value }))} /></label></div> : null}
              <label className="field"><span>Motivo / descrição</span><input required minLength={2} value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Ex.: Viagem programada, descarga, compromisso externo" /></label>
              <label className="field"><span>Cidade / destino <small>(opcional)</small></span><input value={form.destinationCity} onChange={(event) => setForm((current) => ({ ...current, destinationCity: event.target.value }))} placeholder="Ex.: Maringá" /></label>
              <div className={styles.formActions}>
                {editingId ? <button type="button" className="button button-ghost danger-text" onClick={() => { const block = blocks.find((item) => item.id === editingId); if (block) void remove(block); }} disabled={saving}>Excluir programação</button> : <span />}
                <div><button type="button" className="button button-secondary" onClick={() => setFormOpen(false)} disabled={saving}>Cancelar</button><button type="submit" className="button button-primary" disabled={saving || !form.vehicleId}>{saving ? 'Salvando...' : 'Salvar'}</button></div>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
