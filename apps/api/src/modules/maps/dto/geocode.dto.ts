import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class GeocodeDto {
  @ApiProperty({ example: 'Av. Brasil, 1000, São Paulo - SP, 01000-000' })
  @IsString()
  @MinLength(5)
  address: string;
}
