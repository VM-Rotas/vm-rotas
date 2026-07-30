import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/types/auth-user';
import { formatDateOnly, parseDateOnly } from '../../common/utils/date.utils';
import { PrismaService } from '../prisma/prisma.service';

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
      totalOrders,
      pendingOrders,
      urgentOrders,
      completedOrders,
      activeRoutes,
      completedRoutes,
      availableVehicles,
      routes,
    ] = await this.prisma.$transaction([
      this.prisma.serviceOrder.count({ where: orderWhere }),
      this.prisma.serviceOrder.count({
        where: { ...orderWhere, status: { in: ['PLANNED', 'READY', 'ROUTED', 'IN_PROGRESS'] } },
      }),
      this.prisma.serviceOrder.count({
        where: {
          ...orderWhere,
          priority: 'URGENT',
          status: { in: ['PLANNED', 'READY', 'ROUTED', 'IN_PROGRESS'] },
        },
      }),
      this.prisma.serviceOrder.count({ where: { ...orderWhere, status: 'COMPLETED' } }),
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

    const completionRate = totalOrders === 0 ? 0 : Math.round((completedOrders / totalOrders) * 100);

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
