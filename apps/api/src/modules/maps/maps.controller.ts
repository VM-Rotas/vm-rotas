import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { GeocodeDto } from './dto/geocode.dto';
import { MapsService, type GeocodedAddress } from './maps.service';

@ApiTags('maps')
@Controller('maps')
export class MapsController {
  constructor(private readonly maps: MapsService) {}

  @Post('geocode')
  @Roles('OWNER', 'ADMIN', 'DISPATCHER')
  @ApiOperation({ summary: 'Converte um endereço em latitude e longitude' })
  geocode(@Body() dto: GeocodeDto): Promise<GeocodedAddress | null> {
    return this.maps.geocode(dto.address);
  }
}
