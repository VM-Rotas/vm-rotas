import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleRouteOptimizerService } from './providers/google-route-optimizer.service';
import { LocalRouteOptimizerService } from './providers/local-route-optimizer.service';
import type {
  OptimizationContext,
  OptimizationProviderName,
  OptimizationResult,
} from './providers/route-optimizer.types';

@Injectable()
export class RouteOptimizationService {
  private readonly logger = new Logger(RouteOptimizationService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly local: LocalRouteOptimizerService,
    private readonly google: GoogleRouteOptimizerService,
  ) {}

  async optimize(
    context: OptimizationContext,
    requestedProvider?: 'local' | 'google',
  ): Promise<OptimizationResult> {
    const provider =
      requestedProvider ??
      this.config.get<'local' | 'google'>('ROUTE_OPTIMIZATION_PROVIDER', 'local');

    if (provider === 'google') {
      try {
        return await this.google.optimize(context);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Falha desconhecida no Google.';
        this.logger.warn(`Google Route Optimization indisponível; fallback local: ${message}`);
        const fallback = await this.local.optimize(context);
        return {
          ...fallback,
          warnings: [
            `Fallback local ativado porque o Google Route Optimization falhou: ${message}`,
            ...fallback.warnings,
          ],
        };
      }
    }

    return this.local.optimize(context);
  }

  providerEnum(provider: OptimizationProviderName): 'LOCAL' | 'GOOGLE' {
    return provider;
  }
}
