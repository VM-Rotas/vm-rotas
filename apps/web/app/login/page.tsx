'use client';

import { useAuth } from '@/components/auth-provider';
import { Icon } from '@/components/icons';
import { ApiError } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const router = useRouter();
  const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
  const [email, setEmail] = useState(demoMode ? 'admin@vmrotas.local' : '');
  const [password, setPassword] = useState(demoMode ? 'Admin@123' : '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && user) router.replace('/dashboard');
  }, [loading, router, user]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await login(email, password);
      router.replace('/dashboard');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível entrar no sistema.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-visual">
        <div className="login-visual-grid" />
        <div className="login-brand"><div className="brand-mark large">VM</div><span>VM Rotas</span></div>
        <div className="login-copy">
          <span className="eyebrow light">Operação em movimento</span>
          <h1>Missões externas organizadas nas melhores rotas para a equipe.</h1>
          <p>Organize coletas, entregas, compras e transferências internas sem perder o controle do dia.</p>
          <div className="login-feature-row">
            <div><Icon name="routes" /><span><strong>Otimização</strong> automática</span></div>
            <div><Icon name="refresh" /><span><strong>Recalculo</strong> em tempo real</span></div>
            <div><Icon name="vehicles" /><span><strong>Veículos</strong> organizados</span></div>
          </div>
        </div>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={handleSubmit}>
          <div className="login-card-heading">
            <span className="eyebrow">Acesso seguro</span>
            <h2>Entre no VM Rotas</h2>
            <p>Use sua conta operacional para continuar.</p>
          </div>
          {error ? <div className="alert alert-error"><Icon name="warning" />{error}</div> : null}
          <label className="field">
            <span>E-mail</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
          </label>
          <label className="field">
            <span>Senha</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
          </label>
          <button className="button button-primary button-large" type="submit" disabled={submitting}>
            {submitting ? <><span className="spinner small" />Entrando...</> : <>Entrar no sistema <Icon name="arrow" /></>}
          </button>
          {demoMode ? (
            <div className="demo-access">
              <strong>Acesso de demonstração</strong>
              <span>admin@vmrotas.local · Admin@123</span>
            </div>
          ) : null}
        </form>
        <p className="login-footer">VM GROUP · Gestão de missões internas</p>
      </section>
    </main>
  );
}
