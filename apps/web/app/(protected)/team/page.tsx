'use client';

import { useAuth } from '@/components/auth-provider';
import { EmptyState, ErrorBanner, LoadingBlock, SuccessBanner } from '@/components/feedback';
import { Icon } from '@/components/icons';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { SystemUser, UserRole, Vehicle } from '@/lib/types';
import { FormEvent, useCallback, useEffect, useState } from 'react';

interface CreateUserForm {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  assignedVehicleId: string;
}

interface EditUserForm {
  name: string;
  email: string;
  role: UserRole;
  assignedVehicleId: string;
}

interface PasswordForm {
  password: string;
  confirmPassword: string;
}

type DrawerMode = 'create' | 'edit' | 'password' | null;

const initialCreateForm: CreateUserForm = {
  name: '',
  email: '',
  password: '',
  role: 'DISPATCHER',
  assignedVehicleId: '',
};

const initialEditForm: EditUserForm = {
  name: '',
  email: '',
  role: 'DISPATCHER',
  assignedVehicleId: '',
};

const initialPasswordForm: PasswordForm = {
  password: '',
  confirmPassword: '',
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
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [drawerError, setDrawerError] = useState('');
  const [drawerMode, setDrawerMode] = useState<DrawerMode>(null);
  const [selectedUser, setSelectedUser] = useState<SystemUser | null>(null);
  const [createForm, setCreateForm] = useState<CreateUserForm>(initialCreateForm);
  const [editForm, setEditForm] = useState<EditUserForm>(initialEditForm);
  const [passwordForm, setPasswordForm] = useState<PasswordForm>(initialPasswordForm);
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [userData, vehicleData] = await Promise.all([
        api<SystemUser[]>('/users'),
        api<Vehicle[]>('/vehicles'),
      ]);
      setUsers(userData);
      setVehicles(vehicleData);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível carregar a equipe.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function closeDrawer() {
    setDrawerMode(null);
    setSelectedUser(null);
    setCreateForm(initialCreateForm);
    setEditForm(initialEditForm);
    setPasswordForm(initialPasswordForm);
    setShowPassword(false);
    setDrawerError('');
  }

  function openCreateDrawer() {
    setError('');
    setSuccess('');
    setDrawerError('');
    setSelectedUser(null);
    setCreateForm(initialCreateForm);
    setDrawerMode('create');
  }

  function openEditDrawer(target: SystemUser) {
    setError('');
    setSuccess('');
    setDrawerError('');
    setSelectedUser(target);
    setEditForm({
      name: target.name,
      email: target.email,
      role: target.role,
      assignedVehicleId: target.assignedVehicleId ?? '',
    });
    setDrawerMode('edit');
  }

  function openPasswordDrawer(target: SystemUser) {
    setError('');
    setSuccess('');
    setDrawerError('');
    setSelectedUser(target);
    setPasswordForm(initialPasswordForm);
    setShowPassword(false);
    setDrawerMode('password');
  }

  function canManageTarget(target: SystemUser) {
    return Boolean(user && (user.role === 'OWNER' || target.role !== 'OWNER'));
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setDrawerError('');
    setSuccess('');
    try {
      await api('/users', {
        method: 'POST',
        body: JSON.stringify({
          ...createForm,
          assignedVehicleId:
            createForm.role === 'DRIVER' && createForm.assignedVehicleId
              ? createForm.assignedVehicleId
              : undefined,
        }),
      });
      closeDrawer();
      setSuccess('Usuário criado e pronto para acessar o VM Rotas.');
      await load();
    } catch (caught) {
      setDrawerError(caught instanceof ApiError ? caught.message : 'Não foi possível criar o usuário.');
    } finally {
      setSaving(false);
    }
  }

  async function updateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedUser) return;

    setSaving(true);
    setDrawerError('');
    setSuccess('');
    try {
      await api(`/users/${selectedUser.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...editForm,
          assignedVehicleId:
            editForm.role === 'DRIVER' ? editForm.assignedVehicleId || null : null,
        }),
      });
      const changedOwnEmail = selectedUser.id === user?.sub && editForm.email.trim().toLowerCase() !== selectedUser.email;
      closeDrawer();
      setSuccess(
        changedOwnEmail
          ? 'Dados atualizados. No próximo login, use o novo e-mail.'
          : `Dados de ${selectedUser.name} atualizados com sucesso.`,
      );
      await load();
    } catch (caught) {
      setDrawerError(caught instanceof ApiError ? caught.message : 'Não foi possível editar o usuário.');
    } finally {
      setSaving(false);
    }
  }

  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedUser) return;

    if (passwordForm.password !== passwordForm.confirmPassword) {
      setDrawerError('A confirmação da senha não confere.');
      return;
    }

    setSaving(true);
    setDrawerError('');
    setSuccess('');
    try {
      await api(`/users/${selectedUser.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ password: passwordForm.password }),
      });
      closeDrawer();
      setSuccess(`Senha de ${selectedUser.name} redefinida. A nova senha já pode ser usada no login.`);
    } catch (caught) {
      setDrawerError(caught instanceof ApiError ? caught.message : 'Não foi possível redefinir a senha.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleUser(target: SystemUser) {
    setError('');
    setSuccess('');
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

  function generateTemporaryPassword() {
    const [firstValue = Date.now(), secondValue = Math.floor(Math.random() * 10_000)] =
      window.crypto.getRandomValues(new Uint32Array(2));
    const firstPart = firstValue.toString(36).slice(-4).toUpperCase().padStart(4, 'X');
    const secondPart = String(secondValue % 10_000).padStart(4, '0');
    const temporaryPassword = `VMR-${firstPart}-${secondPart}`;
    setPasswordForm({ password: temporaryPassword, confirmPassword: temporaryPassword });
    setShowPassword(true);
  }

  if (user && !['OWNER', 'ADMIN'].includes(user.role)) {
    return <ErrorBanner message="Seu perfil não possui permissão para administrar usuários." />;
  }

  const drawerOpen = drawerMode !== null;

  return (
    <>
      <PageHeader
        eyebrow="Governança"
        title="Equipe e acessos"
        description="Crie, edite, desative e recupere o acesso de todos os usuários do VM Rotas."
        actions={<button className="button button-primary" onClick={openCreateDrawer}><Icon name="plus" />Novo usuário</button>}
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
              <thead><tr><th>Usuário</th><th>Função</th><th>Veículo</th><th>Situação</th><th>Último acesso</th><th>Criado em</th><th aria-label="Ações" /></tr></thead>
              <tbody>
                {users.map((item) => {
                  const manageable = canManageTarget(item);
                  const isCurrentUser = item.id === user?.sub;
                  return (
                    <tr key={item.id}>
                      <td data-label="Usuário"><strong>{item.name}</strong><small>{item.email}</small></td>
                      <td data-label="Função">{roleLabels[item.role]}</td>
                      <td data-label="Veículo">
                        {item.role === 'DRIVER' ? (
                          item.assignedVehicle ? (
                            <><strong>{item.assignedVehicle.name}</strong><small>{item.assignedVehicle.plate}</small></>
                          ) : <small>Sem veículo atribuído</small>
                        ) : <small>—</small>}
                      </td>
                      <td data-label="Situação"><StatusBadge value={item.active ? 'AVAILABLE' : 'INACTIVE'} compact /></td>
                      <td data-label="Último acesso">{item.lastLoginAt ? formatDate(item.lastLoginAt) : 'Nunca'}</td>
                      <td data-label="Criado em">{formatDate(item.createdAt)}</td>
                      <td className="table-actions">
                        {manageable ? (
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.35rem', flexWrap: 'wrap' }}>
                            <button type="button" className="button button-ghost button-small" onClick={() => openEditDrawer(item)}>Editar</button>
                            <button type="button" className="button button-ghost button-small" onClick={() => openPasswordDrawer(item)}>Redefinir senha</button>
                            {isCurrentUser ? (
                              <small style={{ alignSelf: 'center' }}>Conta atual</small>
                            ) : (
                              <button
                                type="button"
                                className={`button button-ghost button-small${item.active ? ' danger-text' : ''}`}
                                onClick={() => void toggleUser(item)}
                              >
                                {item.active ? 'Desativar' : 'Reativar'}
                              </button>
                            )}
                          </div>
                        ) : <small>Somente proprietário</small>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className={`drawer-backdrop${drawerOpen ? ' is-open' : ''}`} onClick={closeDrawer} />
      <aside className={`drawer${drawerOpen ? ' is-open' : ''}`} aria-hidden={!drawerOpen}>
        {drawerMode === 'create' ? (
          <>
            <div className="drawer-header"><div><span className="eyebrow">Novo acesso</span><h2>Cadastrar usuário</h2></div><button className="icon-button" onClick={closeDrawer} aria-label="Fechar"><Icon name="close" /></button></div>
            <form className="drawer-form" onSubmit={createUser}>
              {drawerError ? <ErrorBanner message={drawerError} /> : null}
              <label className="field"><span>Nome</span><input required value={createForm.name} onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })} /></label>
              <label className="field"><span>E-mail</span><input type="email" required value={createForm.email} onChange={(event) => setCreateForm({ ...createForm, email: event.target.value })} /></label>
              <label className="field"><span>Senha inicial</span><input type="password" minLength={8} required autoComplete="new-password" value={createForm.password} onChange={(event) => setCreateForm({ ...createForm, password: event.target.value })} /><small className="field-help">Use ao menos 8 caracteres.</small></label>
              <label className="field"><span>Função</span><select value={createForm.role} onChange={(event) => { const role = event.target.value as UserRole; setCreateForm({ ...createForm, role, assignedVehicleId: role === 'DRIVER' ? createForm.assignedVehicleId : '' }); }}>{user?.role === 'OWNER' ? <option value="OWNER">Proprietário</option> : null}<option value="ADMIN">Administrador</option><option value="DISPATCHER">Despachante</option><option value="DRIVER">Motorista</option><option value="VIEWER">Somente consulta</option></select></label>
               {createForm.role === 'DRIVER' ? (
                 <label className="field"><span>Veículo atribuído</span><select value={createForm.assignedVehicleId} onChange={(event) => setCreateForm({ ...createForm, assignedVehicleId: event.target.value })}><option value="">Sem veículo</option>{vehicles.filter((vehicle) => vehicle.active).map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name} · {vehicle.plate}</option>)}</select><small className="field-help">O motorista verá e executará somente as rotas deste veículo.</small></label>
               ) : null}
              <div className="role-guide"><strong>Permissões</strong><p><b>Despachante:</b> missões, veículos, mapa e roteirização. <b>Motorista:</b> execução das paradas. <b>Consulta:</b> leitura dos dados.</p></div>
              <div className="drawer-actions"><button type="button" className="button button-secondary" onClick={closeDrawer}>Cancelar</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? <><span className="spinner small" />Salvando...</> : 'Criar usuário'}</button></div>
            </form>
          </>
        ) : null}

        {drawerMode === 'edit' && selectedUser ? (
          <>
            <div className="drawer-header"><div><span className="eyebrow">Gerenciar conta</span><h2>Editar usuário</h2></div><button className="icon-button" onClick={closeDrawer} aria-label="Fechar"><Icon name="close" /></button></div>
            <form className="drawer-form" onSubmit={updateUser}>
              {drawerError ? <ErrorBanner message={drawerError} /> : null}
              <label className="field"><span>Nome</span><input required minLength={2} value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} /></label>
              <label className="field"><span>E-mail de acesso</span><input type="email" required value={editForm.email} onChange={(event) => setEditForm({ ...editForm, email: event.target.value })} /><small className="field-help">Se o e-mail mudar, o próximo login deverá usar o novo endereço.</small></label>
              <label className="field"><span>Função</span><select disabled={selectedUser.id === user?.sub} value={editForm.role} onChange={(event) => { const role = event.target.value as UserRole; setEditForm({ ...editForm, role, assignedVehicleId: role === 'DRIVER' ? editForm.assignedVehicleId : '' }); }}>{user?.role === 'OWNER' ? <option value="OWNER">Proprietário</option> : null}<option value="ADMIN">Administrador</option><option value="DISPATCHER">Despachante</option><option value="DRIVER">Motorista</option><option value="VIEWER">Somente consulta</option></select>{selectedUser.id === user?.sub ? <small className="field-help">A função da conta que está em uso não pode ser alterada nesta tela.</small> : null}</label>
               {editForm.role === 'DRIVER' ? (
                 <label className="field"><span>Veículo atribuído</span><select value={editForm.assignedVehicleId} onChange={(event) => setEditForm({ ...editForm, assignedVehicleId: event.target.value })}><option value="">Sem veículo</option>{vehicles.filter((vehicle) => vehicle.active || vehicle.id === selectedUser.assignedVehicleId).map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.name} · {vehicle.plate}</option>)}</select><small className="field-help">Cada veículo pode ficar vinculado a apenas um motorista por vez.</small></label>
               ) : null}
              <div className="role-guide"><strong>Acesso</strong><p>Para retirar o acesso sem apagar o histórico do usuário, utilize o botão <b>Desativar</b> na lista.</p></div>
              <div className="drawer-actions"><button type="button" className="button button-secondary" onClick={closeDrawer}>Cancelar</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? <><span className="spinner small" />Salvando...</> : 'Salvar alterações'}</button></div>
            </form>
          </>
        ) : null}

        {drawerMode === 'password' && selectedUser ? (
          <>
            <div className="drawer-header"><div><span className="eyebrow">Recuperar acesso</span><h2>Redefinir senha</h2></div><button className="icon-button" onClick={closeDrawer} aria-label="Fechar"><Icon name="close" /></button></div>
            <form className="drawer-form" onSubmit={resetPassword}>
              {drawerError ? <ErrorBanner message={drawerError} /> : null}
              <div className="role-guide"><strong>{selectedUser.name}</strong><p>{selectedUser.email}<br />A senha atual será substituída imediatamente.</p></div>
              <label className="field"><span>Nova senha</span><input type={showPassword ? 'text' : 'password'} minLength={8} maxLength={128} required autoComplete="new-password" value={passwordForm.password} onChange={(event) => setPasswordForm({ ...passwordForm, password: event.target.value })} /></label>
              <label className="field"><span>Confirmar nova senha</span><input type={showPassword ? 'text' : 'password'} minLength={8} maxLength={128} required autoComplete="new-password" value={passwordForm.confirmPassword} onChange={(event) => setPasswordForm({ ...passwordForm, confirmPassword: event.target.value })} /></label>
              <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                <button type="button" className="button button-secondary button-small" onClick={generateTemporaryPassword}>Gerar senha temporária</button>
                <button type="button" className="button button-ghost button-small" onClick={() => setShowPassword((current) => !current)}>{showPassword ? 'Ocultar senha' : 'Mostrar senha'}</button>
              </div>
              <small className="field-help">Informe a nova senha ao usuário por um canal seguro. O VM Rotas não envia a senha por e-mail.</small>
              <div className="drawer-actions"><button type="button" className="button button-secondary" onClick={closeDrawer}>Cancelar</button><button type="submit" className="button button-primary" disabled={saving}>{saving ? <><span className="spinner small" />Salvando...</> : 'Redefinir senha'}</button></div>
            </form>
          </>
        ) : null}
      </aside>
    </>
  );
}
