import type { Metadata, Viewport } from 'next';
import { AuthProvider } from '@/components/auth-provider';
import 'leaflet/dist/leaflet.css';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'VM Rotas',
    template: '%s | VM Rotas',
  },
  description: 'Gestão inteligente de entregas, coletas e rotas da VM GROUP.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0d3b40',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
