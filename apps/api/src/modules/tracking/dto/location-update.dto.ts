import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class LocationUpdateDto {
  @ApiProperty()
  @IsUUID()
  sessionId: string;

  @ApiProperty({ example: -23.866 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @ApiProperty({ example: -51.856 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @ApiPropertyOptional({ example: 8.4 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(50000)
  accuracyM?: number;

  @ApiPropertyOptional({ example: 42.5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(350)
  speedKmh?: number;

  @ApiPropertyOptional({ example: 180 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(360)
  heading?: number;

  @ApiPropertyOptional({ example: 73 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  batteryPercent?: number;

  @ApiPropertyOptional({ description: 'Horário registrado pelo aparelho em ISO 8601.' })
  @IsOptional()
  @IsISO8601()
  recordedAt?: string;
}
