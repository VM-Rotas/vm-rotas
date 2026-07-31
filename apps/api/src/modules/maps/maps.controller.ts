import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthUser } from '../../common/types/auth-user';
import { GeocodeDto } from './dto/geocode.dto';
import {
  MapsService,
  type AddressSuggestion,
  type GeocodedAddress,
} from './maps.service';

@ApiTags('maps')
@Controller('maps')
export class MapsController {
  constructor(private readonly maps: MapsService) {}

  @Get('address-suggestions')
  @ApiOperation({ summary: 'Sugere endereços enquanto o usuário digita' })
  addressSuggestions(
    @CurrentUser() user: AuthUser,
    @Query('query') query = '',
    @Query('limit') rawLimit = '6',
  ): Promise<AddressSuggestion[]> {
    const parsedLimit = Number.parseInt(rawLimit, 10);
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : 6;

    return this.maps.addressSuggestions(user.organizationId, query, limit);
  }

  @Post('geocode')
  @Roles('OWNER', 'ADMIN', 'DISPATCHER')
  @ApiOperation({ summary: 'Converte um endereço em latitude e longitude' })
  geocode(@Body() dto: GeocodeDto): Promise<GeocodedAddress | null> {
    return this.maps.geocode(dto.address);
  }
}
