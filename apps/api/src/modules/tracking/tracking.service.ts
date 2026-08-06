import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/types/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import type { LocationUpdateDto } from './dto/location-update.dto';
import type { StartTrackingDto } from './dto/start-tracking.dto';
import type { StopTrackingDto } from './dto/stop-tracking.dto';
import type { TrackingHistoryQueryDto } from './dto/tracking-history-query.dto';

const managerRoles = new Set<AuthUser['role']>(['OWNER', 'ADMIN', 'DISPATCHER']);
const liveVisibilityRoles = new Set<AuthUser['role']>(['OWNER', 'ADMIN', 'DISPATCHER', 'VIEWER']);
const STALE_AFTER_MS = 3 * 60 * 1000;

@Injectable()
export class TrackingService {
  constructor(private readonly prisma: PrismaService) {}

  async start(user: AuthUser, dto: StartTrackingDto) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: {
        id: dto.vehicleId,
        organizationId: user.organizationId,
        active: true,
        status: { notIn: ['MAINTENANCE', 'INACTIVE'] },
      },
      select: { id: true, name: true, plate: true },
    });
    if (!vehicle) throw new NotFoundException('Veículo ativo não encontrado.');

    const now = new Date();
    const session = await this.prisma.$transaction(async (transaction) => {
      await transaction.trackingSession.updateMany({
        where: {
          organizationId: user.organizationId,
          active: true,
          OR: [{ userId: user.sub }, { vehicleId: vehicle.id }],
        },
        data: { active: false, endedAt: now },
      });

      const created = await transaction.trackingSession.create({
        data: {
          organizationId: user.organizationId,
          userId: user.sub,
          vehicleId: vehicle.id,
          deviceId: dto.deviceId?.trim() || undefined,
          deviceName: dto.deviceName?.trim() || undefined,
          active: true,
          startedAt: now,
        },
        include: {
          vehicle: { select: { id: true, name: true, plate: true } },
          user: { select: { id: true, name: true, email: true } },
        },
      });

      await transaction.vehicle.update({
        where: { id: vehicle.id },
        data: { status: 'IN_ROUTE' },
      });
      await transaction.auditLog.create({
        data: {
          organizationId: user.organizationId,
          userId: user.sub,
          action: 'TRACKING_STARTED',
          entityType: 'TrackingSession',
          entityId: created.id,
          metadata: { vehicleId: vehicle.id, deviceName: dto.deviceName ?? null },
        },
      });
      return created;
    });

    return this.serializeSession(session);
  }

  async record(user: AuthUser, dto: LocationUpdateDto) {
    const session = await this.findControlledSession(user, dto.sessionId);
    const recordedAt = this.normalizeRecordedAt(dto.recordedAt);

    await this.prisma.$transaction([
      this.prisma.trackingPoint.create({
        data: {
          organizationId: user.organizationId,
          sessionId: session.id,
          userId: session.userId,
          vehicleId: session.vehicleId,
          latitude: dto.latitude,
          longitude: dto.longitude,
          accuracyM: dto.accuracyM,
          speedKmh: dto.speedKmh,
          heading: dto.heading,
          batteryPercent: dto.batteryPercent,
          recordedAt,
        },
      }),
      this.prisma.trackingSession.update({
        where: { id: session.id },
        data: {
          lastLatitude: dto.latitude,
          lastLongitude: dto.longitude,
          lastAccuracyM: dto.accuracyM,
          lastSpeedKmh: dto.speedKmh,
          lastHeading: dto.heading,
          lastBatteryPercent: dto.batteryPercent,
          lastRecordedAt: recordedAt,
        },
      }),
    ]);

    return {
      accepted: true,
      sessionId: session.id,
      recordedAt: recordedAt.toISOString(),
    };
  }

  async stop(user: AuthUser, dto: StopTrackingDto) {
    const session = await this.findControlledSession(user, dto.sessionId);
    const now = new Date();

    await this.prisma.$transaction(async (transaction) => {
      await transaction.trackingSession.update({
        where: { id: session.id },
        data: { active: false, endedAt: now },
      });

      const otherActiveSessions = await transaction.trackingSession.count({
        where: {
          organizationId: user.organizationId,
          vehicleId: session.vehicleId,
          active: true,
          id: { not: session.id },
        },
      });
      if (otherActiveSessions === 0) {
        await transaction.vehicle.updateMany({
          where: {
            id: session.vehicleId,
            organizationId: user.organizationId,
            status: 'IN_ROUTE',
          },
          data: { status: 'AVAILABLE' },
        });
      }
      await transaction.auditLog.create({
        data: {
          organizationId: user.organizationId,
          userId: user.sub,
          action: 'TRACKING_STOPPED',
          entityType: 'TrackingSession',
          entityId: session.id,
          metadata: { vehicleId: session.vehicleId },
        },
      });
    });

    return { success: true, endedAt: now.toISOString() };
  }

  async mySession(user: AuthUser) {
    const session = await this.prisma.trackingSession.findFirst({
      where: { organizationId: user.organizationId, userId: user.sub, active: true },
      orderBy: { startedAt: 'desc' },
      include: {
        vehicle: { select: { id: true, name: true, plate: true } },
        user: { select: { id: true, name: true, email: true } },
      },
    });
    return session ? this.serializeSession(session) : null;
  }

  async live(user: AuthUser) {
    if (!liveVisibilityRoles.has(user.role) && user.role !== 'DRIVER') {
      throw new ForbiddenException('Usuário sem permissão para visualizar rastreamento.');
    }

    const vehicles = await this.prisma.vehicle.findMany({
      where: { organizationId: user.organizationId, active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, plate: true, status: true },
    });
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const sessions = await this.prisma.trackingSession.findMany({
      where: {
        organizationId: user.organizationId,
        ...(user.role === 'DRIVER' ? { userId: user.sub } : {}),
        OR: [{ active: true }, { lastRecordedAt: { gte: since } }],
      },
      orderBy: [{ active: 'desc' }, { lastRecordedAt: 'desc' }, { startedAt: 'desc' }],
      include: {
        vehicle: { select: { id: true, name: true, plate: true, status: true } },
        user: { select: { id: true, name: true, email: true } },
      },
    });

    const latestByVehicle = new Map<string, (typeof sessions)[number]>();
    for (const session of sessions) {
      if (!latestByVehicle.has(session.vehicleId)) latestByVehicle.set(session.vehicleId, session);
    }

    const now = Date.now();
    return vehicles
      .filter((vehicle) => user.role !== 'DRIVER' || latestByVehicle.has(vehicle.id))
      .map((vehicle) => {
        const session = latestByVehicle.get(vehicle.id);
        const lastRecordedAt = session?.lastRecordedAt ?? null;
        const ageMs = lastRecordedAt ? Math.max(0, now - lastRecordedAt.getTime()) : null;
        return {
          vehicle,
          session: session
            ? {
                id: session.id,
                active: session.active,
                startedAt: session.startedAt.toISOString(),
                endedAt: session.endedAt?.toISOString() ?? null,
                deviceName: session.deviceName,
                driver: session.user,
              }
            : null,
          position:
            session?.lastLatitude != null && session.lastLongitude != null
              ? {
                  latitude: Number(session.lastLatitude),
                  longitude: Number(session.lastLongitude),
                  accuracyM: session.lastAccuracyM,
                  speedKmh: session.lastSpeedKmh,
                  heading: session.lastHeading,
                  batteryPercent: session.lastBatteryPercent,
                  recordedAt: lastRecordedAt?.toISOString() ?? null,
                  ageSeconds: ageMs == null ? null : Math.round(ageMs / 1000),
                  stale: ageMs == null || ageMs > STALE_AFTER_MS,
                }
              : null,
        };
      });
  }

  async history(user: AuthUser, query: TrackingHistoryQueryDto) {
    if (!liveVisibilityRoles.has(user.role) && user.role !== 'DRIVER') {
      throw new ForbiddenException('Usuário sem permissão para visualizar histórico.');
    }
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: query.vehicleId, organizationId: user.organizationId },
      select: { id: true },
    });
    if (!vehicle) throw new NotFoundException('Veículo não encontrado.');

    const { start, end } = this.dateRange(query.date);
    const points = await this.prisma.trackingPoint.findMany({
      where: {
        organizationId: user.organizationId,
        vehicleId: query.vehicleId,
        ...(user.role === 'DRIVER' ? { userId: user.sub } : {}),
        recordedAt: { gte: start, lt: end },
      },
      orderBy: { recordedAt: 'desc' },
      take: query.limit,
      select: {
        latitude: true,
        longitude: true,
        accuracyM: true,
        speedKmh: true,
        heading: true,
        batteryPercent: true,
        recordedAt: true,
      },
    });

    return points.reverse().map((point) => ({
      latitude: Number(point.latitude),
      longitude: Number(point.longitude),
      accuracyM: point.accuracyM,
      speedKmh: point.speedKmh,
      heading: point.heading,
      batteryPercent: point.batteryPercent,
      recordedAt: point.recordedAt.toISOString(),
    }));
  }

  private async findControlledSession(user: AuthUser, sessionId: string) {
    const session = await this.prisma.trackingSession.findFirst({
      where: { id: sessionId, organizationId: user.organizationId, active: true },
      select: { id: true, userId: true, vehicleId: true },
    });
    if (!session) throw new NotFoundException('Jornada de rastreamento ativa não encontrada.');
    if (session.userId !== user.sub && !managerRoles.has(user.role)) {
      throw new ForbiddenException('Esta jornada pertence a outro motorista.');
    }
    return session;
  }

  private normalizeRecordedAt(value?: string): Date {
    if (!value) return new Date();
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) throw new BadRequestException('Horário da posição inválido.');
    const fiveMinutes = 5 * 60 * 1000;
    if (parsed.getTime() > Date.now() + fiveMinutes) return new Date();
    return parsed;
  }

  private dateRange(value?: string): { start: Date; end: Date } {
    const day = value ?? new Date().toISOString().slice(0, 10);
    const start = new Date(`${day}T00:00:00-03:00`);
    if (!Number.isFinite(start.getTime())) throw new BadRequestException('Data inválida.');
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }

  private serializeSession(session: {
    id: string;
    active: boolean;
    startedAt: Date;
    endedAt: Date | null;
    deviceId: string | null;
    deviceName: string | null;
    lastLatitude: unknown;
    lastLongitude: unknown;
    lastAccuracyM: number | null;
    lastSpeedKmh: number | null;
    lastHeading: number | null;
    lastBatteryPercent: number | null;
    lastRecordedAt: Date | null;
    vehicle: { id: string; name: string; plate: string };
    user: { id: string; name: string; email: string };
  }) {
    return {
      id: session.id,
      active: session.active,
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt?.toISOString() ?? null,
      deviceId: session.deviceId,
      deviceName: session.deviceName,
      vehicle: session.vehicle,
      driver: session.user,
      position:
        session.lastLatitude != null && session.lastLongitude != null
          ? {
              latitude: Number(session.lastLatitude),
              longitude: Number(session.lastLongitude),
              accuracyM: session.lastAccuracyM,
              speedKmh: session.lastSpeedKmh,
              heading: session.lastHeading,
              batteryPercent: session.lastBatteryPercent,
              recordedAt: session.lastRecordedAt?.toISOString() ?? null,
            }
          : null,
    };
  }
}
