import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class ListVehicleUnavailabilityQueryDto {
  @ApiPropertyOptional({ example: '2026-08-10' })
  @IsOptional()
  @IsString()
  @Length(10, 10)
  from?: string;

  @ApiPropertyOptional({ example: '2026-08-16' })
  @IsOptional()
  @IsString()
  @Length(10, 10)
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  vehicleId?: string;
}
