import { Module } from '@nestjs/common';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { GoogleRouteOptimizerService } from './providers/google-route-optimizer.service';
import { LocalRouteOptimizerService } from './providers/local-route-optimizer.service';
import { RouteOptimizationService } from './route-optimization.service';
import { RoutesController } from './routes.controller';
import { RoutesService } from './routes.service';

@Module({
  imports: [VehiclesModule],
  controllers: [RoutesController],
  providers: [
    RoutesService,
    RouteOptimizationService,
    LocalRouteOptimizerService,
    GoogleRouteOptimizerService,
  ],
  exports: [RoutesService],
})
export class RoutesModule {}
