'use client';

import { useAuth } from '@/components/auth-provider';
import { EmptyState, ErrorBanner, LoadingBlock, SuccessBanner } from '@/components/feedback';
import { Icon } from '@/components/icons';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { SystemUser, UserRole } from '@/lib/types';
import { FormEvent, useCallback, useEffect, useState } from 'react';

interface UserForm {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}

const initialForm: UserForm = {
  name: '',
  email: '',
  password: '',
  role: 'DISPATCHER',
};

const roleLabels: Record<UserRole, string> = {
  OWNER: 'Proprietário',
  ADMIN: 'Administrador',
  DISPATCHER: 'Despachante',
  DRIVER: 'Motorista',
  VIEWER: 'Consulta',
};

export default function TeamPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<SystemUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<UserForm>(initialForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setUsers(await api<SystemUser[]>('/users'));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível carregar a equipe.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api('/users', { method: 'POST', body: JSON.stringify(form) });
      setForm(initialForm);
      setFormOpen(false);
      setSuccess('Usuário criado e pronto para acessar o VM Rotas.');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível criar o usuário.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleUser(target: SystemUser) {
    try {
      await api(`/users/${target.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !target.active }),
      });
      setSuccess(`${target.name} foi ${target.active ? 'desativado' : 'reativado'}.`);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível atualizar o usuário.');
    }
  }

  if (user && !['OWNER', 'ADMIN'].includes(user.role)) {
    return <ErrorBanner message="Seu perfil não possui permissão para administrar usuários." />;
  }

  return (
    <>
      <PageHeader
        eyebrow="Governança"
        title="Equipe e acessos"
        description="Crie usuários por função e mantenha o acesso da operação sob controle."
        actions={<button className="button button-primary" onClick={() => setFormOpen(true)}><Icon name="plus" />Novo usuário</button>}
      />
      {error ? <ErrorBanner message={error} /> : null}
      {success ? <SuccessBanner message={success} /> : null}

      <section className="mini-stats-grid">
        <div className="mini-stat"><span>Total de usuários</span><strong>{users.length}</strong></div>
        <div className="mini-stat success"><span>Ativos</span><strong>{users.filter((item) => item.active).length}</strong></div>
        <div className="mini-stat warning"><span>Motoristas</span><strong>{users.filter((item) => item.role === 'DRIVER' && item.active).length}</strong></div>
        <div className="mini-stat muted"><span>Administradores</span><strong>{users.filter((item) => ['OWNER', 'ADMIN'].includes(item.role) && item.active).length}</strong></div>
      </section>

      <section className="panel table-panel">
        {loading && users.length === 0 ? <LoadingBlock label="Carregando equipe..." /> : users.length === 0 ? (
          <EmptyState title="Nenhum usuário adicional" description="Crie despachantes, motoristas, administradores ou perfis de consulta." />
        ) : (
          <div className="responsive-table-wrap">
            <table className="data-table">
              <thead><tr><th>Usuário</th><th>Função</th><th>Situação</th><th>Último acesso</th><th>Criado em</th><th aria-label="Ações" /></tr></thead>
              <tbody>
                {users.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Usuário"><strong>{item.name}</strong><small>{item.email}</small></td>
                    <td data-label="Função">{roleLabels[item.role]}</td>
                    <td data-label="Situação"><StatusBadge value={item.active ? 'AVAILABLE' : 'INACTIVE'} compact /></td>
                    <td data-label="Último acesso">{item.lastLoginAt ? formatDate(item.lastLoginAt) : 'Nunca'}</td>
                    <td data-label="Criado em">{formatDate(item.createdAt)}</td>
                    <td className="table-actions">{item.id !== user?.sub ? <button className={`button button-ghost button-small${item.active ? ' danger-text' : ''}`} onClick={() => void toggleUser(item)}>{item.active ? 'Desativar' : 'Reativar'}</button> : <small>Você</small>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className={`drawer-backdrop${formOpen ? ' is-open' : ''}`} onClick={() => setFormOpen(false)} />
      <aside className={`drawer${formOpen ? ' is-open' : ''}`} aria-hidden={!formOpen}>
        <div className="drawer-header"><div><span className="eyebrow">Novo acesso</span><h2>Cadastrar usuário</h2></div><button className="icon-button" onClick={() => setFormOpen(false)} aria-label="Fechar"><Icon name="close" /></button></div>
        <form className="drawer-form" onSubmit={createUser}>
          <label className="field"><span>Nome</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label className="field"><span>E-mail</span><input type="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
          <label className="field"><span>Senha inicial</span><input type="password" minLength={8} required value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /><small className="field-help">Use ao menos 8 caracteres. A troca de senha será ampliada na próxima etapa.</small></label>
          <label className="field"><span>Função</span><select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as UserRole })}>{user?.role === 'OWNER' ? <option value="OWNER">Proprietário</option> : null}<option value="ADMIN">Administrador</option><option value="DISPATCHER">Despachante</option><option value="DRIVER">Motorista</option><option value="VIEWER">Somente consulta</option></select></label>
          <div className="role-guide">
            <strong>Permissões</strong>
            <p><b>Despachante:</b> missões, veículos e roteirização. <b>Motorista:</b> execução das paradas. <b>Consulta:</b> leitura dos dados.</p>
          </div>
          <div className="drawer-actions"><button type="button" className="button button-secondary" onClick={() => setFormOpen(false)}>Cancelar</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? <><span className="spinner small" />Salvando...</> : 'Criar usuário'}</button></div>
        </form>
      </aside>
    </>
  );
}
