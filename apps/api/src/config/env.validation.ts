export interface AppEnvironment {
  NODE_ENV: 'development' | 'test' | 'production';
  API_PORT: number;
  DATABASE_URL: string;
  JWT_SECRET: string;
  WEB_ORIGIN: string;
  COOKIE_SECURE: boolean;
  SWAGGER_ENABLED: boolean;
  DEFAULT_TIME_ZONE: string;
  ROUTE_OPTIMIZATION_PROVIDER: 'local' | 'google';
  LOCAL_AVG_SPEED_KMH: number;
  GOOGLE_MAPS_SERVER_API_KEY?: string;
  GOOGLE_CLOUD_PROJECT_ID?: string;
  GOOGLE_ROUTE_OPTIMIZATION_ENABLED: boolean;
}

function readRequired(config: Record<string, unknown>, key: string): string {
  const value = String(config[key] ?? '').trim();
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${key}`);
  }
  return value;
}

export function validateEnvironment(config: Record<string, unknown>): AppEnvironment {
  const nodeEnv = String(config.NODE_ENV ?? 'development');
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV deve ser development, test ou production.');
  }

  const provider = String(config.ROUTE_OPTIMIZATION_PROVIDER ?? 'local').toLowerCase();
  if (!['local', 'google'].includes(provider)) {
    throw new Error('ROUTE_OPTIMIZATION_PROVIDER deve ser local ou google.');
  }

  const jwtSecret = readRequired(config, 'JWT_SECRET');
  if (nodeEnv === 'production' && jwtSecret.length < 32) {
    throw new Error('JWT_SECRET deve ter no mínimo 32 caracteres em produção.');
  }

  const port = Number(config.API_PORT ?? 3001);
  const speed = Number(config.LOCAL_AVG_SPEED_KMH ?? 35);

  if (!Number.isFinite(port) || port <= 0) {
    throw new Error('API_PORT inválida.');
  }
  if (!Number.isFinite(speed) || speed <= 0) {
    throw new Error('LOCAL_AVG_SPEED_KMH inválida.');
  }

  return {
    NODE_ENV: nodeEnv as AppEnvironment['NODE_ENV'],
    API_PORT: port,
    DATABASE_URL: readRequired(config, 'DATABASE_URL'),
    JWT_SECRET: jwtSecret,
    WEB_ORIGIN: String(config.WEB_ORIGIN ?? 'http://localhost:3000'),
    COOKIE_SECURE: String(config.COOKIE_SECURE ?? 'false').toLowerCase() === 'true',
    SWAGGER_ENABLED: String(config.SWAGGER_ENABLED ?? 'true').toLowerCase() === 'true',
    DEFAULT_TIME_ZONE: String(config.DEFAULT_TIME_ZONE ?? 'America/Sao_Paulo'),
    ROUTE_OPTIMIZATION_PROVIDER: provider as AppEnvironment['ROUTE_OPTIMIZATION_PROVIDER'],
    LOCAL_AVG_SPEED_KMH: speed,
    GOOGLE_MAPS_SERVER_API_KEY: String(config.GOOGLE_MAPS_SERVER_API_KEY ?? '').trim() || undefined,
    GOOGLE_CLOUD_PROJECT_ID: String(config.GOOGLE_CLOUD_PROJECT_ID ?? '').trim() || undefined,
    GOOGLE_ROUTE_OPTIMIZATION_ENABLED:
      String(config.GOOGLE_ROUTE_OPTIMIZATION_ENABLED ?? 'false').toLowerCase() === 'true',
  };
}
