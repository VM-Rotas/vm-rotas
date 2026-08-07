import { Module } from '@nestjs/common';
import { MapsModule } from '../maps/maps.module';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [MapsModule, VehiclesModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
