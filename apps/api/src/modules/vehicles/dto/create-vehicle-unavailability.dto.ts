import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

export class CreateVehicleUnavailabilityDto {
  @ApiProperty({ example: '4abdb504-ef85-4f38-9c80-421c1d1cdd9e' })
  @IsUUID()
  vehicleId: string;

  @ApiProperty({ example: '2026-08-10' })
  @IsString()
  @Length(10, 10)
  startDate: string;

  @ApiProperty({ example: '2026-08-10' })
  @IsString()
  @Length(10, 10)
  endDate: string;

  @ApiProperty({ example: false })
  @IsBoolean()
  allDay: boolean;

  @ApiPropertyOptional({ example: '08:00' })
  @IsOptional()
  @Matches(TIME_PATTERN)
  startTime?: string;

  @ApiPropertyOptional({ example: '14:00' })
  @IsOptional()
  @Matches(TIME_PATTERN)
  endTime?: string;

  @ApiProperty({ example: 'Viagem programada para coleta de produção' })
  @IsString()
  @MinLength(2)
  reason: string;

  @ApiPropertyOptional({ example: 'Maringá' })
  @IsOptional()
  @IsString()
  destinationCity?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
