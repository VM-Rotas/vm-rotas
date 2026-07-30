import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class OptimizeRoutesDto {
  @ApiProperty({ example: '2026-07-30' })
  @IsString()
  @Length(10, 10)
  routeDate: string;

  @ApiPropertyOptional({ type: [String], description: 'Limita a otimização a veículos específicos.' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  vehicleIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Limita a otimização a ordens específicas.' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  orderIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('4')
  depotId?: string;

  @ApiPropertyOptional({ enum: ['local', 'google'] })
  @IsOptional()
  @IsIn(['local', 'google'])
  provider?: 'local' | 'google';
}
