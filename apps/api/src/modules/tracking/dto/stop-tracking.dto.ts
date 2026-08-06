import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class StopTrackingDto {
  @ApiProperty()
  @IsUUID()
  sessionId: string;
}
