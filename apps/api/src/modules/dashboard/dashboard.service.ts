import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/types/auth-user';
import { formatDateOnly, parseDateOnly } from '../../common/utils/date.utils';
import { PrismaService } from '../prisma/prisma.service';

type MissionOrderStatus =
  | 'PLANNED'
  | 'READY'
  | 'ROUTED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

type MissionPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

const OPEN_STATUSES: MissionOrderStatus[] = ['PLANNED', 'READY', 'ROUTED', 'IN_PROGRESS'];

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(user: AuthUser, date?: string) {
    const routeDate = parseDateOnly(date);
    const orderWhere = {
      organizationId: user.organizationId,
      plannedDate: routeDate,
    } as const;

    const [
      orders,
      activeRoutes,
      completedRoutes,
      availableVehicles,
      routes,
    ] = await this.prisma.$transaction([
      this.prisma.serviceOrder.findMany({
        where: orderWhere,
        select: {
          code: true,
          externalReference: true,
          status: true,
          priority: true,
        },
      }),
      this.prisma.routePlan.count({
        where: {
          organizationId: user.organizationId,
          routeDate,
          status: { in: ['DRAFT', 'OPTIMIZED', 'IN_PROGRESS'] },
        },
      }),
      this.prisma.routePlan.count({
        where: { organizationId: user.organizationId, routeDate, status: 'COMPLETED' },
      }),
      this.prisma.vehicle.count({
        where: { organizationId: user.organizationId, active: true, status: 'AVAILABLE' },
      }),
      this.prisma.routePlan.findMany({
        where: {
          organizationId: user.organizationId,
          routeDate,
          status: { notIn: ['SUPERSEDED', 'CANCELLED'] },
        },
        include: {
          vehicle: true,
          stops: {
            where: { type: 'SERVICE' },
            orderBy: { sequence: 'asc' },
            select: { id: true, status: true, label: true, plannedArrivalAt: true },
          },
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      }),
    ]);

    const missions = new Map<
      string,
      Array<{ status: MissionOrderStatus; priority: MissionPriority }>
    >();
    for (const order of orders) {
      const key = order.externalReference?.startsWith('MIS-')
        ? order.externalReference
        : order.code;
      missions.set(key, [
        ...(missions.get(key) ?? []),
        { status: order.status, priority: order.priority },
      ]);
    }

    const grouped = [...missions.values()];
    const totalOrders = grouped.length;
    const completedOrders = grouped.filter((mission) =>
      mission.every((stop) => stop.status === 'COMPLETED'),
    ).length;
    const pendingOrders = grouped.filter((mission) =>
      mission.some((stop) => OPEN_STATUSES.includes(stop.status)),
    ).length;
    const urgentOrders = grouped.filter(
      (mission) =>
        mission.some((stop) => stop.priority === 'URGENT') &&
        mission.some((stop) => OPEN_STATUSES.includes(stop.status)),
    ).length;
    const completionRate =
      totalOrders === 0 ? 0 : Math.round((completedOrders / totalOrders) * 100);

    return {
      date: formatDateOnly(routeDate),
      metrics: {
        totalOrders,
        pendingOrders,
        urgentOrders,
        completedOrders,
        completionRate,
        activeRoutes,
        completedRoutes,
        availableVehicles,
      },
      routes,
    };
  }
}
