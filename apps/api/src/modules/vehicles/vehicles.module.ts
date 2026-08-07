import { Module } from '@nestjs/common';
import { VehicleUnavailabilityController } from './vehicle-unavailability.controller';
import { VehicleUnavailabilityService } from './vehicle-unavailability.service';
import { VehiclesController } from './vehicles.controller';
import { VehiclesService } from './vehicles.service';

@Module({
  controllers: [VehiclesController, VehicleUnavailabilityController],
  providers: [VehiclesService, VehicleUnavailabilityService],
  exports: [VehiclesService, VehicleUnavailabilityService],
})
export class VehiclesModule {}
