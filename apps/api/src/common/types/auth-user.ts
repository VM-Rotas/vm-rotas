export interface AuthUser {
  sub: string;
  organizationId: string;
  email: string;
  name: string;
  role: 'OWNER' | 'ADMIN' | 'DISPATCHER' | 'DRIVER' | 'VIEWER';
}
