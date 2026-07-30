import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class RecalculateRouteDto {
  @ApiPropertyOptional({ description: 'Ordem urgente que deve entrar na rota.' })
  @IsOptional()
  @IsUUID('4')
  urgentOrderId?: string;

  @ApiPropertyOptional({ example: -23.865 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  currentLatitude?: number;

  @ApiPropertyOptional({ example: -51.856 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  currentLongitude?: number;

  @ApiPropertyOptional({ enum: ['local', 'google'] })
  @IsOptional()
  @IsIn(['local', 'google'])
  provider?: 'local' | 'google';
}
