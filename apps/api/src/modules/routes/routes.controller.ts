import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthUser } from '../../common/types/auth-user';
import { ListRoutesQueryDto } from './dto/list-routes-query.dto';
import { OptimizeRoutesDto } from './dto/optimize-routes.dto';
import { RecalculateRouteDto } from './dto/recalculate-route.dto';
import { UpdateStopStatusDto } from './dto/update-stop-status.dto';
import { RoutesService } from './routes.service';

@ApiTags('routes')
@Controller('routes')
export class RoutesController {
  constructor(private readonly routes: RoutesService) {}

  @Get()
  @ApiOperation({ summary: 'Lista rotas planejadas' })
  list(@CurrentUser() user: AuthUser, @Query() query: ListRoutesQueryDto) {
    return this.routes.list(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Busca uma rota com paradas e histórico de otimização' })
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.routes.findOne(user, id);
  }

  @Post('optimize')
  @Roles('OWNER', 'ADMIN', 'DISPATCHER')
  @ApiOperation({ summary: 'Gera as melhores rotas para as ordens e veículos disponíveis' })
  optimize(@CurrentUser() user: AuthUser, @Body() dto: OptimizeRoutesDto) {
    return this.routes.optimize(user, dto);
  }

  @Post(':id/recalculate')
  @Roles('OWNER', 'ADMIN', 'DISPATCHER')
  @ApiOperation({ summary: 'Recalcula uma rota incluindo, opcionalmente, uma urgência' })
  recalculate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: RecalculateRouteDto,
  ) {
    return this.routes.recalculate(user, id, dto);
  }

  @Patch(':routeId/stops/:stopId/status')
  @Roles('OWNER', 'ADMIN', 'DISPATCHER', 'DRIVER')
  @ApiOperation({ summary: 'Atualiza o andamento de uma parada' })
  updateStopStatus(
    @CurrentUser() user: AuthUser,
    @Param('routeId') routeId: string,
    @Param('stopId') stopId: string,
    @Body() dto: UpdateStopStatusDto,
  ) {
    return this.routes.updateStopStatus(user, routeId, stopId, dto);
  }
}
