'use client';

import { useAuth } from '@/components/auth-provider';
import { EmptyState, ErrorBanner, LoadingBlock, SuccessBanner } from '@/components/feedback';
import { Icon } from '@/components/icons';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { api, ApiError, queryString } from '@/lib/api';
import { todayDateInput } from '@/lib/format';
import type { ServiceOrder } from '@/lib/types';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

interface OrderForm {
  type: 'DELIVERY' | 'PICKUP';
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  recipientName: string;
  recipientPhone: string;
  addressLine: string;
  addressNumber: string;
  neighborhood: string;
  city: string;
  state: string;
  postalCode: string;
  latitude: string;
  longitude: string;
  serviceDurationMin: string;
  weightKg: string;
  notes: string;
}

const initialForm: OrderForm = {
  type: 'DELIVERY',
  priority: 'NORMAL',
  recipientName: '',
  recipientPhone: '',
  addressLine: '',
  addressNumber: '',
  neighborhood: '',
  city: 'São Pedro do Ivaí',
  state: 'PR',
  postalCode: '',
  latitude: '',
  longitude: '',
  serviceDurationMin: '10',
  weightKg: '',
  notes: '',
};

export default function OrdersPage() {
  const { user } = useAuth();
  const [date, setDate] = useState(todayDateInput());
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<OrderForm>(initialForm);
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
        `/orders${queryString({ date, search, status, take: 100 })}`,
      );
      setOrders(result.items);
      setTotal(result.total);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível carregar as ordens.');
    } finally {
      setLoading(false);
    }
  }, [date, search, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  const urgentCount = useMemo(
    () => orders.filter((order) => order.priority === 'URGENT' && !['COMPLETED', 'CANCELLED'].includes(order.status)).length,
    [orders],
  );

  async function createOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await api('/orders', {
        method: 'POST',
        body: JSON.stringify({
          type: form.type,
          priority: form.priority,
          plannedDate: date,
          recipientName: form.recipientName,
          customerName: form.recipientName,
          recipientPhone: form.recipientPhone || undefined,
          addressLine: form.addressLine,
          addressNumber: form.addressNumber || undefined,
          neighborhood: form.neighborhood || undefined,
          city: form.city,
          state: form.state,
          postalCode: form.postalCode || undefined,
          latitude: form.latitude ? Number(form.latitude) : undefined,
          longitude: form.longitude ? Number(form.longitude) : undefined,
          serviceDurationMin: Number(form.serviceDurationMin),
          weightKg: form.weightKg ? Number(form.weightKg) : undefined,
          notes: form.notes || undefined,
        }),
      });
      setForm(initialForm);
      setFormOpen(false);
      setSuccess('Ordem criada e adicionada à operação do dia.');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível criar a ordem.');
    } finally {
      setSaving(false);
    }
  }

  async function cancelOrder(order: ServiceOrder) {
    if (!window.confirm(`Cancelar a ordem ${order.code}?`)) return;
    try {
      await api(`/orders/${order.id}`, { method: 'DELETE' });
      setSuccess(`Ordem ${order.code} cancelada.`);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível cancelar a ordem.');
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Demanda operacional"
        title="Entregas e coletas"
        description="Cadastre destinos, defina prioridades e prepare tudo o que deve entrar no planejamento."
        actions={canManage ? <button className="button button-primary" onClick={() => setFormOpen(true)}><Icon name="plus" />Nova ordem</button> : undefined}
      />
      {error ? <ErrorBanner message={error} /> : null}
      {success ? <SuccessBanner message={success} /> : null}

      <section className="panel filter-panel">
        <div className="filter-grid">
          <label className="field compact"><span>Data</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label className="field compact field-grow"><span>Buscar</span><input type="search" placeholder="Código, cliente ou cidade" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <label className="field compact"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Todos</option><option value="PLANNED">Planejada</option><option value="READY">Pronta</option><option value="ROUTED">Roteirizada</option><option value="IN_PROGRESS">Em andamento</option><option value="COMPLETED">Concluída</option><option value="FAILED">Falhou</option><option value="CANCELLED">Cancelada</option></select></label>
        </div>
        <div className="filter-summary"><strong>{total}</strong> ordens encontradas {urgentCount > 0 ? <span className="urgent-inline"><Icon name="warning" />{urgentCount} urgência(s)</span> : null}</div>
      </section>

      <section className="panel table-panel">
        {loading && orders.length === 0 ? <LoadingBlock /> : orders.length === 0 ? (
          <EmptyState title="Nenhuma ordem nesta data" description="Cadastre a primeira entrega ou coleta para iniciar o planejamento." />
        ) : (
          <div className="responsive-table-wrap">
            <table className="data-table">
              <thead><tr><th>Ordem</th><th>Destino</th><th>Tipo</th><th>Prioridade</th><th>Status</th><th>Geolocalização</th><th aria-label="Ações" /></tr></thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td data-label="Ordem"><strong>{order.code}</strong>{order.externalReference ? <small>{order.externalReference}</small> : null}</td>
                    <td data-label="Destino"><strong>{order.recipientName}</strong><small>{order.addressLine}{order.addressNumber ? `, ${order.addressNumber}` : ''} · {order.city}/{order.state}</small></td>
                    <td data-label="Tipo">{order.type === 'DELIVERY' ? 'Entrega' : 'Coleta'}</td>
                    <td data-label="Prioridade"><StatusBadge value={order.priority} compact /></td>
                    <td data-label="Status"><StatusBadge value={order.status} compact /></td>
                    <td data-label="Geolocalização"><span className={order.latitude != null && order.longitude != null ? 'coordinate-ok' : 'coordinate-missing'}><Icon name={order.latitude != null && order.longitude != null ? 'check' : 'warning'} />{order.latitude != null && order.longitude != null ? 'Pronta' : 'Pendente'}</span></td>
                    <td className="table-actions">{canManage && !['IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(order.status) ? <button className="button button-ghost button-small danger-text" onClick={() => void cancelOrder(order)}>Cancelar</button> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className={`drawer-backdrop${formOpen ? ' is-open' : ''}`} onClick={() => setFormOpen(false)} />
      <aside className={`drawer${formOpen ? ' is-open' : ''}`} aria-hidden={!formOpen}>
        <div className="drawer-header"><div><span className="eyebrow">Nova demanda</span><h2>Cadastrar ordem</h2></div><button className="icon-button" onClick={() => setFormOpen(false)} aria-label="Fechar"><Icon name="close" /></button></div>
        <form className="drawer-form" onSubmit={createOrder}>
          <div className="form-row two">
            <label className="field"><span>Tipo</span><select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as OrderForm['type'] })}><option value="DELIVERY">Entrega</option><option value="PICKUP">Coleta</option></select></label>
            <label className="field"><span>Prioridade</span><select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as OrderForm['priority'] })}><option value="LOW">Baixa</option><option value="NORMAL">Normal</option><option value="HIGH">Alta</option><option value="URGENT">Urgente</option></select></label>
          </div>
          <label className="field"><span>Destinatário</span><input required value={form.recipientName} onChange={(event) => setForm({ ...form, recipientName: event.target.value })} placeholder="Nome da pessoa ou empresa" /></label>
          <label className="field"><span>Telefone</span><input value={form.recipientPhone} onChange={(event) => setForm({ ...form, recipientPhone: event.target.value })} placeholder="(43) 99999-9999" /></label>
          <div className="form-section-title">Endereço</div>
          <div className="form-row address"><label className="field"><span>Logradouro</span><input required value={form.addressLine} onChange={(event) => setForm({ ...form, addressLine: event.target.value })} /></label><label className="field narrow"><span>Número</span><input value={form.addressNumber} onChange={(event) => setForm({ ...form, addressNumber: event.target.value })} /></label></div>
          <label className="field"><span>Bairro</span><input value={form.neighborhood} onChange={(event) => setForm({ ...form, neighborhood: event.target.value })} /></label>
          <div className="form-row city"><label className="field"><span>Cidade</span><input required value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} /></label><label className="field state"><span>UF</span><input required maxLength={2} value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value.toUpperCase() })} /></label><label className="field postal"><span>CEP</span><input value={form.postalCode} onChange={(event) => setForm({ ...form, postalCode: event.target.value })} /></label></div>
          <div className="form-hint"><Icon name="pin" />Com a chave de Geocoding configurada, latitude e longitude são preenchidas automaticamente. Para testes sem chave, informe-as abaixo.</div>
          <div className="form-row two"><label className="field"><span>Latitude</span><input type="number" step="any" value={form.latitude} onChange={(event) => setForm({ ...form, latitude: event.target.value })} placeholder="-23.865" /></label><label className="field"><span>Longitude</span><input type="number" step="any" value={form.longitude} onChange={(event) => setForm({ ...form, longitude: event.target.value })} placeholder="-51.856" /></label></div>
          <div className="form-section-title">Operação</div>
          <div className="form-row two"><label className="field"><span>Atendimento (min)</span><input required type="number" min="1" value={form.serviceDurationMin} onChange={(event) => setForm({ ...form, serviceDurationMin: event.target.value })} /></label><label className="field"><span>Peso (kg)</span><input type="number" min="0" step="0.1" value={form.weightKg} onChange={(event) => setForm({ ...form, weightKg: event.target.value })} /></label></div>
          <label className="field"><span>Observações</span><textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
          <div className="drawer-actions"><button type="button" className="button button-secondary" onClick={() => setFormOpen(false)}>Cancelar</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? <><span className="spinner small" />Salvando...</> : 'Cadastrar ordem'}</button></div>
        </form>
      </aside>
    </>
  );
}
