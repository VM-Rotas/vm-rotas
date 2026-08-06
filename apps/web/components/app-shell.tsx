'use client';

import { useAuth } from '@/components/auth-provider';
import { Icon, type IconName } from '@/components/icons';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const links: Array<{ href: string; label: string; icon: IconName; adminOnly?: boolean }> = [
  { href: '/dashboard', label: 'Visão geral', icon: 'dashboard' },
  { href: '/orders', label: 'Missões', icon: 'orders' },
  { href: '/vehicles', label: 'Veículos', icon: 'vehicles' },
  { href: '/routes', label: 'Roteirização', icon: 'routes' },
  { href: '/tracking', label: 'Mapa ao vivo', icon: 'tracking' },
  { href: '/team', label: 'Equipe e acessos', icon: 'team', adminOnly: true },
];

export function ProtectedShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, router, user]);

  if (loading) {
    return <div className="app-loading"><div className="brand-mark">VM</div><span className="spinner" />Preparando operação...</div>;
  }
  if (!user) {
    return <div className="app-loading"><span className="spinner" />Redirecionando...</div>;
  }
  return <AppShell>{children}</AppShell>;
}

function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  return (
    <div className="app-shell">
      <button
        className={`mobile-overlay${menuOpen ? ' is-open' : ''}`}
        onClick={() => setMenuOpen(false)}
        aria-label="Fechar menu"
      />
      <aside className={`sidebar${menuOpen ? ' is-open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-mark">VM</div>
          <div><strong>VM Rotas</strong><span>Missões externas</span></div>
          <button className="icon-button sidebar-close" onClick={() => setMenuOpen(false)} aria-label="Fechar menu"><Icon name="close" /></button>
        </div>
        <nav className="sidebar-nav" aria-label="Navegação principal">
          <span className="nav-section-label">Operação</span>
          {links.filter((link) => !link.adminOnly || user?.role === 'OWNER' || user?.role === 'ADMIN').map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                className={`nav-link${active ? ' active' : ''}`}
                href={link.href}
                onClick={() => setMenuOpen(false)}
              >
                <Icon name={link.icon} />
                <span>{link.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="user-avatar">{user?.name?.slice(0, 2).toUpperCase()}</div>
          <div className="user-meta"><strong>{user?.name}</strong><span>{user?.role}</span></div>
          <button className="icon-button" onClick={handleLogout} title="Sair" aria-label="Sair"><Icon name="logout" /></button>
        </div>
      </aside>
      <div className="main-column">
        <header className="mobile-topbar">
          <button className="icon-button" onClick={() => setMenuOpen(true)} aria-label="Abrir menu"><Icon name="menu" /></button>
          <div className="mobile-brand"><div className="brand-mark small">VM</div><strong>VM Rotas</strong></div>
          <div className="user-avatar small">{user?.name?.slice(0, 2).toUpperCase()}</div>
        </header>
        <main className="main-content">{children}</main>
      </div>
    </div>
  );
}
