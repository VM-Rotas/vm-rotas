import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class AutoRecalculateUrgencyDto {
  @ApiProperty({ description: 'Uma parada da missão urgente que deve entrar na melhor rota.' })
  @IsUUID('4')
  urgentOrderId: string;
}
