import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthUser } from '../../common/types/auth-user';
import { CreateMissionDto } from './dto/create-mission.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @ApiOperation({ summary: 'Lista entregas e coletas' })
  list(@CurrentUser() user: AuthUser, @Query() query: ListOrdersQueryDto) {
    return this.orders.list(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Busca uma ordem' })
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.findOne(user, id);
  }

  @Post('missions')
  @Roles('OWNER', 'ADMIN', 'DISPATCHER')
  @ApiOperation({ summary: 'Cria uma missão com coleta, entrega ou ambas' })
  createMission(@CurrentUser() user: AuthUser, @Body() dto: CreateMissionDto) {
    return this.orders.createMission(user, dto);
  }

  @Delete('missions/:reference')
  @Roles('OWNER', 'ADMIN', 'DISPATCHER')
  @ApiOperation({ summary: 'Cancela todas as paradas de uma missão' })
  cancelMission(
    @CurrentUser() user: AuthUser,
    @Param('reference') reference: string,
  ) {
    return this.orders.cancelMission(user, reference);
  }

  @Post()
  @Roles('OWNER', 'ADMIN', 'DISPATCHER')
  @ApiOperation({ summary: 'Cria uma entrega ou coleta individual' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return this.orders.create(user, dto);
  }

  @Patch(':id/complete')
  @Roles('OWNER', 'ADMIN', 'DISPATCHER', 'DRIVER')
  @ApiOperation({ summary: 'Marca uma coleta ou entrega como concluída' })
  complete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.complete(user, id);
  }

  @Patch(':id')
  @Roles('OWNER', 'ADMIN', 'DISPATCHER')
  @ApiOperation({ summary: 'Atualiza uma ordem' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateOrderDto,
  ) {
    return this.orders.update(user, id, dto);
  }

  @Delete(':id')
  @Roles('OWNER', 'ADMIN', 'DISPATCHER')
  @ApiOperation({ summary: 'Cancela uma ordem ainda não executada' })
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.cancel(user, id);
  }
}
