import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MinLength,
} from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class UpdateVehicleUnavailabilityDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @ApiPropertyOptional({ example: '2026-08-10' })
  @IsOptional()
  @IsString()
  @Length(10, 10)
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-08-11' })
  @IsOptional()
  @IsString()
  @Length(10, 10)
  endDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allDay?: boolean;

  @ApiPropertyOptional({ example: '08:00' })
  @IsOptional()
  @Matches(TIME_PATTERN)
  startTime?: string;

  @ApiPropertyOptional({ example: '14:00' })
  @IsOptional()
  @Matches(TIME_PATTERN)
  endTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  reason?: string;

  @ApiPropertyOptional({ example: 'Maringá' })
  @IsOptional()
  @IsString()
  destinationCity?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
