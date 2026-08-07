import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/types/auth-user';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateVehicleUnavailabilityDto } from './dto/create-vehicle-unavailability.dto';
import type { ListVehicleUnavailabilityQueryDto } from './dto/list-vehicle-unavailability-query.dto';
import type { UpdateVehicleUnavailabilityDto } from './dto/update-vehicle-unavailability.dto';

export interface VehicleUnavailablePeriod {
  id: string;
  vehicleId: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  reason: string;
  destinationCity?: string | null;
}

interface NormalizedWindow {
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
}

@Injectable()
export class VehicleUnavailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, query: ListVehicleUnavailabilityQueryDto) {
    const today = this.localDate(new Date());
    const from = query.from ?? today;
    const to = query.to ?? this.addDays(from, 6);
    const range = this.dateRange(from, to);

    return this.prisma.vehicleUnavailability.findMany({
      where: {
        organizationId: user.organizationId,
        ...(query.vehicleId ? { vehicleId: query.vehicleId } : {}),
        startsAt: { lt: range.end },
        endsAt: { gt: range.start },
      },
      include: {
        vehicle: { select: { id: true, name: true, plate: true, active: true, status: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { startsAt: 'asc' },
    });
  }

  async create(user: AuthUser, dto: CreateVehicleUnavailabilityDto) {
    const vehicle = await this.requireVehicle(user, dto.vehicleId);
    const window = this.normalizeWindow(dto);

    await this.assertNoScheduleOverlap(user.organizationId, vehicle.id, window);
    await this.assertOperationalConflicts(
      user,
      vehicle.id,
      vehicle.name,
      window,
      Boolean(dto.force),
    );

    return this.prisma.$transaction(async (transaction) => {
      const created = await transaction.vehicleUnavailability.create({
        data: {
          organizationId: user.organizationId,
          vehicleId: vehicle.id,
          createdById: user.sub,
          startsAt: window.startsAt,
          endsAt: window.endsAt,
          allDay: window.allDay,
          reason: dto.reason.trim(),
          destinationCity: dto.destinationCity?.trim() || null,
        },
        include: {
          vehicle: { select: { id: true, name: true, plate: true, active: true, status: true } },
          createdBy: { select: { id: true, name: true, email: true } },
        },
      });

      await transaction.auditLog.create({
        data: {
          organizationId: user.organizationId,
          userId: user.sub,
          action: 'VEHICLE_UNAVAILABILITY_CREATED',
          entityType: 'VehicleUnavailability',
          entityId: created.id,
          metadata: {
            vehicleId: vehicle.id,
            startsAt: window.startsAt.toISOString(),
            endsAt: window.endsAt.toISOString(),
            allDay: window.allDay,
            reason: dto.reason.trim(),
            destinationCity: dto.destinationCity?.trim() || null,
          },
        },
      });

      return created;
    });
  }

  async update(user: AuthUser, id: string, dto: UpdateVehicleUnavailabilityDto) {
    const existing = await this.prisma.vehicleUnavailability.findFirst({
      where: { id, organizationId: user.organizationId },
      include: { vehicle: true },
    });
    if (!existing) throw new NotFoundException('Programação do veículo não encontrada.');

    const current = this.dtoFromExisting(existing);
    const merged = {
      ...current,
      ...dto,
      vehicleId: dto.vehicleId ?? current.vehicleId,
      reason: dto.reason ?? current.reason,
      destinationCity:
        dto.destinationCity !== undefined ? dto.destinationCity : current.destinationCity,
      force: dto.force,
    } satisfies CreateVehicleUnavailabilityDto;

    const vehicle = await this.requireVehicle(user, merged.vehicleId);
    const window = this.normalizeWindow(merged);

    await this.assertNoScheduleOverlap(user.organizationId, vehicle.id, window, id);
    await this.assertOperationalConflicts(
      user,
      vehicle.id,
      vehicle.name,
      window,
      Boolean(dto.force),
    );

    return this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.vehicleUnavailability.update({
        where: { id },
        data: {
          vehicleId: vehicle.id,
          startsAt: window.startsAt,
          endsAt: window.endsAt,
          allDay: window.allDay,
          reason: merged.reason.trim(),
          destinationCity: merged.destinationCity?.trim() || null,
        },
        include: {
          vehicle: { select: { id: true, name: true, plate: true, active: true, status: true } },
          createdBy: { select: { id: true, name: true, email: true } },
        },
      });

      await transaction.auditLog.create({
        data: {
          organizationId: user.organizationId,
          userId: user.sub,
          action: 'VEHICLE_UNAVAILABILITY_UPDATED',
          entityType: 'VehicleUnavailability',
          entityId: id,
          metadata: {
            vehicleId: vehicle.id,
            startsAt: window.startsAt.toISOString(),
            endsAt: window.endsAt.toISOString(),
          },
        },
      });

      return updated;
    });
  }

  async remove(user: AuthUser, id: string) {
    const existing = await this.prisma.vehicleUnavailability.findFirst({
      where: { id, organizationId: user.organizationId },
      select: { id: true, vehicleId: true, startsAt: true, endsAt: true },
    });
    if (!existing) throw new NotFoundException('Programação do veículo não encontrada.');

    await this.prisma.$transaction(async (transaction) => {
      await transaction.vehicleUnavailability.delete({ where: { id } });
      await transaction.auditLog.create({
        data: {
          organizationId: user.organizationId,
          userId: user.sub,
          action: 'VEHICLE_UNAVAILABILITY_DELETED',
          entityType: 'VehicleUnavailability',
          entityId: id,
          metadata: {
            vehicleId: existing.vehicleId,
            startsAt: existing.startsAt.toISOString(),
            endsAt: existing.endsAt.toISOString(),
          },
        },
      });
    });

    return { success: true };
  }

  async assertVehicleAvailableForMission(
    user: AuthUser,
    vehicleId: string,
    plannedDate: string,
    windows: Array<{ startsAt: Date; endsAt: Date }>,
  ): Promise<void> {
    const day = this.dateRange(plannedDate, plannedDate);
    const blocks = await this.prisma.vehicleUnavailability.findMany({
      where: {
        organizationId: user.organizationId,
        vehicleId,
        startsAt: { lt: day.end },
        endsAt: { gt: day.start },
      },
      include: { vehicle: { select: { name: true } } },
      orderBy: { startsAt: 'asc' },
    });

    if (blocks.length === 0) return;

    const conflict = windows.length > 0
      ? blocks.find((block) =>
          windows.some((window) => this.overlaps(block.startsAt, block.endsAt, window.startsAt, window.endsAt)),
        )
      : blocks.find((block) => block.allDay || (block.startsAt <= day.start && block.endsAt >= day.end));

    if (!conflict) return;

    throw new BadRequestException(
      `${conflict.vehicle.name} está indisponível ${this.humanPeriod(conflict.startsAt, conflict.endsAt, conflict.allDay)}: ${conflict.reason}.`,
    );
  }

  async assertVehicleFreeForMission(
    user: AuthUser,
    vehicleId: string,
    plannedDate: string,
    windows: Array<{ startsAt: Date; endsAt: Date }>,
    excludeOrderIds: string[] = [],
  ): Promise<void> {
    await this.assertVehicleAvailableForMission(user, vehicleId, plannedDate, windows);

    // Sem horário definido não existe uma janela segura para bloquear. A missão
    // continua aparecendo na agenda como "sem horário", mas não impede outra
    // designação até que um horário seja informado.
    if (windows.length === 0) return;

    const plannedDay = new Date(`${plannedDate}T00:00:00.000Z`);
    const orders = await this.prisma.serviceOrder.findMany({
      where: {
        organizationId: user.organizationId,
        assignedVehicleId: vehicleId,
        plannedDate: plannedDay,
        status: { in: ['PLANNED', 'READY', 'ROUTED', 'IN_PROGRESS'] },
        timeWindowStart: { not: null },
        ...(excludeOrderIds.length > 0 ? { id: { notIn: excludeOrderIds } } : {}),
      },
      include: { assignedVehicle: { select: { name: true } } },
      orderBy: { timeWindowStart: 'asc' },
    });

    const conflict = orders.find((order) => {
      const startsAt = order.timeWindowStart as Date;
      const endsAt = order.timeWindowEnd ?? new Date(startsAt.getTime() + 60 * 60 * 1_000);
      return windows.some((window) =>
        this.overlaps(startsAt, endsAt, window.startsAt, window.endsAt),
      );
    });

    if (!conflict) return;

    const startsAt = conflict.timeWindowStart as Date;
    const endsAt = conflict.timeWindowEnd ?? new Date(startsAt.getTime() + 60 * 60 * 1_000);
    const reference = conflict.externalReference ?? conflict.code;
    const vehicleName = conflict.assignedVehicle?.name ?? 'O veículo';

    throw new BadRequestException(
      `${vehicleName} já está designado para a missão ${reference} de ${this.localTime(startsAt)} a ${this.localTime(endsAt)}. Escolha outro veículo ou outro horário.`,
    );
  }

  async periodsByVehicle(
    organizationId: string,
    vehicleIds: string[],
    routeDate: Date,
  ): Promise<Map<string, VehicleUnavailablePeriod[]>> {
    const date = routeDate.toISOString().slice(0, 10);
    const day = this.dateRange(date, date);
    if (vehicleIds.length === 0) return new Map();

    const blocks = await this.prisma.vehicleUnavailability.findMany({
      where: {
        organizationId,
        vehicleId: { in: vehicleIds },
        startsAt: { lt: day.end },
        endsAt: { gt: day.start },
      },
      orderBy: { startsAt: 'asc' },
    });

    const result = new Map<string, VehicleUnavailablePeriod[]>();
    for (const block of blocks) {
      const current = result.get(block.vehicleId) ?? [];
      current.push({
        id: block.id,
        vehicleId: block.vehicleId,
        startsAt: block.startsAt,
        endsAt: block.endsAt,
        allDay: block.allDay,
        reason: block.reason,
        destinationCity: block.destinationCity,
      });
      result.set(block.vehicleId, current);
    }
    return result;
  }

  private async requireVehicle(user: AuthUser, vehicleId: string) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, organizationId: user.organizationId, active: true },
      select: { id: true, name: true, plate: true },
    });
    if (!vehicle) throw new BadRequestException('Veículo não encontrado ou inativo.');
    return vehicle;
  }

  private async assertNoScheduleOverlap(
    organizationId: string,
    vehicleId: string,
    window: NormalizedWindow,
    excludeId?: string,
  ) {
    const duplicate = await this.prisma.vehicleUnavailability.findFirst({
      where: {
        organizationId,
        vehicleId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        startsAt: { lt: window.endsAt },
        endsAt: { gt: window.startsAt },
      },
      select: { id: true, startsAt: true, endsAt: true, reason: true },
    });

    if (duplicate) {
      throw new BadRequestException(
        `Já existe uma indisponibilidade programada nesse período (${duplicate.reason}).`,
      );
    }
  }

  private async assertOperationalConflicts(
    user: AuthUser,
    vehicleId: string,
    vehicleName: string,
    window: NormalizedWindow,
    force: boolean,
  ) {
    if (force) return;

    const startDate = this.localDate(window.startsAt);
    const inclusiveEnd = new Date(window.endsAt.getTime() - 1);
    const endDate = this.localDate(inclusiveEnd);
    const orders = await this.prisma.serviceOrder.findMany({
      where: {
        organizationId: user.organizationId,
        assignedVehicleId: vehicleId,
        plannedDate: {
          gte: new Date(`${startDate}T00:00:00.000Z`),
          lte: new Date(`${endDate}T00:00:00.000Z`),
        },
        status: { in: ['PLANNED', 'READY', 'ROUTED', 'IN_PROGRESS'] },
      },
      select: {
        id: true,
        externalReference: true,
        code: true,
        timeWindowStart: true,
        timeWindowEnd: true,
      },
    });

    const conflictingOrders = orders.filter((order) => {
      if (!order.timeWindowStart) return true;
      const orderEnd = order.timeWindowEnd ?? new Date(order.timeWindowStart.getTime() + 60 * 60 * 1_000);
      return this.overlaps(window.startsAt, window.endsAt, order.timeWindowStart, orderEnd);
    });

    const routePlans = await this.prisma.routePlan.count({
      where: {
        organizationId: user.organizationId,
        vehicleId,
        routeDate: {
          gte: new Date(`${startDate}T00:00:00.000Z`),
          lte: new Date(`${endDate}T00:00:00.000Z`),
        },
        status: { in: ['DRAFT', 'OPTIMIZED', 'IN_PROGRESS'] },
      },
    });

    const missionReferences = new Set(
      conflictingOrders.map((order) => order.externalReference ?? order.code),
    );
    const conflictCount = missionReferences.size;
    if (conflictCount === 0 && routePlans === 0) return;

    const parts = [];
    if (conflictCount > 0) parts.push(`${conflictCount} missão(ões) já designada(s)`);
    if (routePlans > 0) parts.push(`${routePlans} rota(s) já criada(s)`);

    throw new ConflictException(
      `${vehicleName} possui ${parts.join(' e ')} nesse período. Revise a operação antes de confirmar a indisponibilidade.`,
    );
  }

  private normalizeWindow(dto: CreateVehicleUnavailabilityDto): NormalizedWindow {
    this.assertDate(dto.startDate);
    this.assertDate(dto.endDate);
    if (dto.endDate < dto.startDate) {
      throw new BadRequestException('A data final deve ser igual ou posterior à data inicial.');
    }

    if (dto.allDay) {
      return {
        startsAt: this.localDateTime(dto.startDate, '00:00'),
        endsAt: this.localDateTime(this.addDays(dto.endDate, 1), '00:00'),
        allDay: true,
      };
    }

    if (!dto.startTime || !dto.endTime) {
      throw new BadRequestException('Informe horário inicial e final ou marque Dia inteiro.');
    }

    const startsAt = this.localDateTime(dto.startDate, dto.startTime);
    const endsAt = this.localDateTime(dto.endDate, dto.endTime);
    if (endsAt <= startsAt) {
      throw new BadRequestException('O final da indisponibilidade deve ser posterior ao início.');
    }

    return { startsAt, endsAt, allDay: false };
  }

  private dtoFromExisting(existing: {
    vehicleId: string;
    startsAt: Date;
    endsAt: Date;
    allDay: boolean;
    reason: string;
    destinationCity: string | null;
  }): CreateVehicleUnavailabilityDto {
    const inclusiveEnd = new Date(existing.endsAt.getTime() - (existing.allDay ? 1 : 0));
    return {
      vehicleId: existing.vehicleId,
      startDate: this.localDate(existing.startsAt),
      endDate: this.localDate(inclusiveEnd),
      allDay: existing.allDay,
      startTime: existing.allDay ? undefined : this.localTime(existing.startsAt),
      endTime: existing.allDay ? undefined : this.localTime(existing.endsAt),
      reason: existing.reason,
      destinationCity: existing.destinationCity ?? undefined,
      force: false,
    };
  }

  private dateRange(from: string, to: string): { start: Date; end: Date } {
    this.assertDate(from);
    this.assertDate(to);
    if (to < from) throw new BadRequestException('Período inválido.');
    return {
      start: this.localDateTime(from, '00:00'),
      end: this.localDateTime(this.addDays(to, 1), '00:00'),
    };
  }

  private localDateTime(date: string, time: string): Date {
    const value = new Date(`${date}T${time}:00-03:00`);
    if (Number.isNaN(value.getTime())) throw new BadRequestException('Data ou horário inválido.');
    return value;
  }

  private localDate(value: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(value);
  }

  private localTime(value: Date): string {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(value);
  }

  private addDays(value: string, days: number): string {
    this.assertDate(value);
    const date = new Date(`${value}T12:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  private assertDate(value: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException('A data deve estar no formato YYYY-MM-DD.');
    }
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException('Data inválida.');
    }
  }

  private overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
    return aStart < bEnd && aEnd > bStart;
  }

  private humanPeriod(startsAt: Date, endsAt: Date, allDay: boolean): string {
    const startDate = this.localDate(startsAt);
    const endDate = this.localDate(new Date(endsAt.getTime() - 1));
    if (allDay) {
      return startDate === endDate ? `durante todo o dia ${startDate}` : `de ${startDate} a ${endDate}`;
    }
    const start = `${startDate} ${this.localTime(startsAt)}`;
    const end = `${this.localDate(endsAt)} ${this.localTime(endsAt)}`;
    return `de ${start} até ${end}`;
  }
}
