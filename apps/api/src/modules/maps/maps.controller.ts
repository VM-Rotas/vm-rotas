import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthUser } from '../../common/types/auth-user';
import { AddressSuggestionsQueryDto } from './dto/address-suggestions-query.dto';
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
  @Roles('OWNER', 'ADMIN', 'DISPATCHER')
  @ApiOperation({ summary: 'Sugere endereços já usados e resultados do OpenStreetMap' })
  addressSuggestions(
    @CurrentUser() user: AuthUser,
    @Query() query: AddressSuggestionsQueryDto,
  ): Promise<AddressSuggestion[]> {
    return this.maps.addressSuggestions(user.organizationId, query.query, query.limit);
  }

  @Post('geocode')
  @Roles('OWNER', 'ADMIN', 'DISPATCHER')
  @ApiOperation({ summary: 'Converte um endereço em latitude e longitude' })
  geocode(@Body() dto: GeocodeDto): Promise<GeocodedAddress | null> {
    return this.maps.geocode(dto.address);
  }
}
