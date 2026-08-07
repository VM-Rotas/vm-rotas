import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthUser } from '../../common/types/auth-user';
import { CreateVehicleUnavailabilityDto } from './dto/create-vehicle-unavailability.dto';
import { ListVehicleUnavailabilityQueryDto } from './dto/list-vehicle-unavailability-query.dto';
import { UpdateVehicleUnavailabilityDto } from './dto/update-vehicle-unavailability.dto';
import { VehicleUnavailabilityService } from './vehicle-unavailability.service';

@ApiTags('vehicle-unavailability')
@Controller('vehicle-unavailability')
@Roles('OWNER', 'ADMIN', 'DISPATCHER')
export class VehicleUnavailabilityController {
  constructor(private readonly schedules: VehicleUnavailabilityService) {}

  @Get()
  @ApiOperation({ summary: 'Lista indisponibilidades programadas da frota' })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListVehicleUnavailabilityQueryDto,
  ) {
    return this.schedules.list(user, query);
  }

  @Post()
  @ApiOperation({ summary: 'Programa uma indisponibilidade de veículo' })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateVehicleUnavailabilityDto,
  ) {
    return this.schedules.create(user, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edita uma indisponibilidade programada' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateVehicleUnavailabilityDto,
  ) {
    return this.schedules.update(user, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove uma indisponibilidade programada' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.schedules.remove(user, id);
  }
}
