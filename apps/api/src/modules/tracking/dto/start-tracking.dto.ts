import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class StartTrackingDto {
  @ApiProperty({ description: 'Veículo que será rastreado durante a jornada.' })
  @IsUUID()
  vehicleId: string;

  @ApiPropertyOptional({ description: 'Identificador estável do aparelho.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceId?: string;

  @ApiPropertyOptional({ example: 'Motorola do João' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceName?: string;
}
