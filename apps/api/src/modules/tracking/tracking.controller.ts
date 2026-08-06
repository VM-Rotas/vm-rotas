import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthUser } from '../../common/types/auth-user';
import { LocationUpdateDto } from './dto/location-update.dto';
import { StartTrackingDto } from './dto/start-tracking.dto';
import { StopTrackingDto } from './dto/stop-tracking.dto';
import { TrackingHistoryQueryDto } from './dto/tracking-history-query.dto';
import { TrackingService } from './tracking.service';

@ApiTags('tracking')
@Controller('tracking')
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Post('start')
  @Roles('OWNER', 'ADMIN', 'DISPATCHER', 'DRIVER')
  @ApiOperation({ summary: 'Inicia a jornada e o rastreamento de um veículo' })
  start(@CurrentUser() user: AuthUser, @Body() dto: StartTrackingDto) {
    return this.tracking.start(user, dto);
  }

  @Post('location')
  @Roles('OWNER', 'ADMIN', 'DISPATCHER', 'DRIVER')
  @ApiOperation({ summary: 'Registra uma posição enviada pelo aparelho do motorista' })
  record(@CurrentUser() user: AuthUser, @Body() dto: LocationUpdateDto) {
    return this.tracking.record(user, dto);
  }

  @Post('stop')
  @Roles('OWNER', 'ADMIN', 'DISPATCHER', 'DRIVER')
  @ApiOperation({ summary: 'Encerra a jornada e o rastreamento' })
  stop(@CurrentUser() user: AuthUser, @Body() dto: StopTrackingDto) {
    return this.tracking.stop(user, dto);
  }

  @Get('my-session')
  @Roles('OWNER', 'ADMIN', 'DISPATCHER', 'DRIVER')
  @ApiOperation({ summary: 'Retorna a jornada ativa do usuário atual' })
  mySession(@CurrentUser() user: AuthUser) {
    return this.tracking.mySession(user);
  }

  @Get('live')
  @ApiOperation({ summary: 'Retorna a última posição dos veículos' })
  live(@CurrentUser() user: AuthUser) {
    return this.tracking.live(user);
  }

  @Get('history')
  @ApiOperation({ summary: 'Retorna o trajeto de um veículo em uma data' })
  history(@CurrentUser() user: AuthUser, @Query() query: TrackingHistoryQueryDto) {
    return this.tracking.history(user, query);
  }
}
