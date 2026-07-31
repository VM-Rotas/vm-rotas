import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleAuth } from 'google-auth-library';
import type {
  OptimizableOrder,
  OptimizationContext,
  OptimizationResult,
  OptimizedVehicleRoute,
  RouteOptimizer,
} from './route-optimizer.types';

type GoogleTransition = {
  travelDuration?: string;
  travelDistanceMeters?: number;
};

type GoogleVisit = {
  shipmentIndex?: number;
  isPickup?: boolean;
  visitRequestIndex?: number;
  startTime?: string;
};

type GoogleRoute = {
  vehicleIndex?: number;
  visits?: GoogleVisit[];
  transitions?: GoogleTransition[];
  routePolyline?: { points?: string };
  metrics?: {
    travelDistanceMeters?: number;
    totalDuration?: string;
  };
};

type GoogleOptimizationResponse = {
  routes?: GoogleRoute[];
  skippedShipments?: Array<{ index?: number; label?: string }>;
};

interface MissionShipment {
  id: string;
  orders: OptimizableOrder[];
  pickups: OptimizableOrder[];
  deliveries: OptimizableOrder[];
}

@Injectable()
export class GoogleRouteOptimizerService implements RouteOptimizer {
  private readonly auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });

  constructor(private readonly config: ConfigService) {}

  async optimize(context: OptimizationContext): Promise<OptimizationResult> {
    const enabled = this.config.get<boolean>('GOOGLE_ROUTE_OPTIMIZATION_ENABLED', false);
    const projectId = this.config.get<string>('GOOGLE_CLOUD_PROJECT_ID');
    if (!enabled || !projectId) {
      throw new ServiceUnavailableException(
        'Google Route Optimization não está habilitado ou GOOGLE_CLOUD_PROJECT_ID não foi configurado.',
      );
    }

    const shipments = this.groupMissionShipments(context.orders);
    const request = this.buildRequest(context, shipments);
    const client = await this.auth.getClient();
    const response = await client.request<GoogleOptimizationResponse>({
      url: 'https://routeoptimization.googleapis.com/v1/projects/' +
        encodeURIComponent(projectId) +
        ':optimizeTours',
      method: 'POST',
      data: request,
      timeout: 60_000,
    });

    const routes: OptimizedVehicleRoute[] = (response.data.routes ?? [])
      .map((route) => this.mapRoute(context, shipments, route))
      .filter((route): route is OptimizedVehicleRoute => route !== null);

    const skippedOrderIds = [
      ...new Set(
        (response.data.skippedShipments ?? [])
          .flatMap((skipped) =>
            skipped.index == null ? [] : (shipments[skipped.index]?.orders ?? []),
          )
          .map((order) => order.id),
      ),
    ];

    return {
      provider: 'GOOGLE',
      routes,
      skippedOrderIds,
      warnings: skippedOrderIds.length
        ? [`O Google não conseguiu alocar ${skippedOrderIds.length} parada(s).`]
        : [],
      rawRequest: request,
      rawResponse: response.data,
    };
  }

  private groupMissionShipments(orders: OptimizableOrder[]): MissionShipment[] {
    const groups = new Map<string, OptimizableOrder[]>();

    for (const order of orders) {
      const id = order.missionId || order.id;
      groups.set(id, [...(groups.get(id) ?? []), order]);
    }

    return [...groups.entries()].map(([id, groupedOrders]) => ({
      id,
      orders: groupedOrders,
      pickups: groupedOrders.filter((order) => order.type === 'PICKUP'),
      deliveries: groupedOrders.filter((order) => order.type === 'DELIVERY'),
    }));
  }

  private buildRequest(context: OptimizationContext, shipments: MissionShipment[]) {
    const globalStartTime = this.atOperationalHour(context.routeDate, 8).toISOString();
    const globalEndTime = this.atOperationalHour(context.routeDate, 20).toISOString();

    return {
      timeout: '30s',
      considerRoadTraffic: true,
      populatePolylines: true,
      model: {
        globalStartTime,
        globalEndTime,
        shipments: shipments.map((shipment) => {
          const weightKg = this.maximumDemand(shipment.orders, 'weightKg');
          const volumeM3 = this.maximumDemand(shipment.orders, 'volumeM3');
          const priority = shipment.orders.reduce<OptimizableOrder['priority']>(
            (highest, order) =>
              this.penaltyForPriority(order.priority) > this.penaltyForPriority(highest)
                ? order.priority
                : highest,
            'LOW',
          );

          return {
            label: shipment.id,
            pickups: shipment.pickups.length
              ? shipment.pickups.map((order) => this.visitRequest(order, globalStartTime, globalEndTime))
              : undefined,
            deliveries: shipment.deliveries.length
              ? shipment.deliveries.map((order) => this.visitRequest(order, globalStartTime, globalEndTime))
              : undefined,
            loadDemands: {
              ...(weightKg != null
                ? { weightKg: { amount: String(Math.round(weightKg * 1_000)) } }
                : {}),
              ...(volumeM3 != null
                ? { volumeM3: { amount: String(Math.round(volumeM3 * 10_000)) } }
                : {}),
            },
            penaltyCost: this.penaltyForPriority(priority),
          };
        }),
        vehicles: context.vehicles.map((vehicle) => ({
          label: vehicle.id,
          startLocation: {
            latitude: context.startLocation.latitude,
            longitude: context.startLocation.longitude,
          },
          endLocation: {
            latitude: context.endLocation.latitude,
            longitude: context.endLocation.longitude,
          },
          startTimeWindows: [
            {
              startTime: this.atVehicleHour(context.routeDate, vehicle.startHour ?? '08:00').toISOString(),
              endTime: new Date(
                this.atVehicleHour(context.routeDate, vehicle.startHour ?? '08:00').getTime() +
                  30 * 60 * 1_000,
              ).toISOString(),
            },
          ],
          endTimeWindows: [
            {
              startTime: globalStartTime,
              endTime: this.atVehicleHour(context.routeDate, vehicle.endHour ?? '18:00').toISOString(),
            },
          ],
          loadLimits: {
            ...(vehicle.capacityWeightKg != null
              ? { weightKg: { maxLoad: String(Math.round(vehicle.capacityWeightKg * 1_000)) } }
              : {}),
            ...(vehicle.capacityVolumeM3 != null
              ? { volumeM3: { maxLoad: String(Math.round(vehicle.capacityVolumeM3 * 10_000)) } }
              : {}),
          },
          costPerKilometer: 1,
          costPerHour: 1,
        })),
      },
    };
  }

  private visitRequest(order: OptimizableOrder, globalStartTime: string, globalEndTime: string) {
    return {
      label: order.id,
      arrivalLocation: {
        latitude: order.latitude,
        longitude: order.longitude,
      },
      duration: `${Math.max(60, order.serviceDurationMin * 60)}s`,
      timeWindows:
        order.timeWindowStart || order.timeWindowEnd
          ? [
              {
                startTime: (order.timeWindowStart ?? new Date(globalStartTime)).toISOString(),
                endTime: (order.timeWindowEnd ?? new Date(globalEndTime)).toISOString(),
              },
            ]
          : undefined,
    };
  }

  private mapRoute(
    context: OptimizationContext,
    shipments: MissionShipment[],
    route: GoogleRoute,
  ): OptimizedVehicleRoute | null {
    const vehicle = route.vehicleIndex == null ? undefined : context.vehicles[route.vehicleIndex];
    if (!vehicle) return null;

    const transitions = route.transitions ?? [];
    const visits = (route.visits ?? [])
      .map((visit, index) => {
        const shipment = visit.shipmentIndex == null ? undefined : shipments[visit.shipmentIndex];
        if (!shipment) return null;
        const candidates = visit.isPickup ? shipment.pickups : shipment.deliveries;
        const order = candidates[visit.visitRequestIndex ?? 0] ?? shipment.orders[0];
        if (!order) return null;

        const transition = transitions[index] ?? {};
        const plannedArrivalAt = visit.startTime
          ? new Date(visit.startTime)
          : this.atOperationalHour(context.routeDate, 8);
        const plannedDepartureAt = new Date(
          plannedArrivalAt.getTime() + order.serviceDurationMin * 60 * 1_000,
        );
        return {
          orderId: order.id,
          plannedArrivalAt,
          plannedDepartureAt,
          distanceFromPreviousM: transition.travelDistanceMeters ?? 0,
          durationFromPreviousSec: this.durationToSeconds(transition.travelDuration),
        };
      })
      .filter((visit): visit is NonNullable<typeof visit> => visit !== null);

    const returnTransition = transitions[visits.length] ?? {};
    return {
      vehicleId: vehicle.id,
      visits,
      totalDistanceMeters: route.metrics?.travelDistanceMeters ?? 0,
      totalDurationSeconds: this.durationToSeconds(route.metrics?.totalDuration),
      encodedPolyline: route.routePolyline?.points,
      distanceToDepotMeters: returnTransition.travelDistanceMeters ?? 0,
      durationToDepotSeconds: this.durationToSeconds(returnTransition.travelDuration),
    };
  }

  private maximumDemand(
    orders: OptimizableOrder[],
    field: 'weightKg' | 'volumeM3',
  ): number | undefined {
    const values = orders
      .map((order) => order[field])
      .filter((value): value is number => value != null);
    return values.length ? Math.max(...values) : undefined;
  }

  private penaltyForPriority(priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'): number {
    return { LOW: 1_000, NORMAL: 5_000, HIGH: 20_000, URGENT: 100_000 }[priority];
  }

  private durationToSeconds(value?: string): number {
    if (!value) return 0;
    const parsed = Number(value.replace(/s$/, ''));
    return Number.isFinite(parsed) ? Math.round(parsed) : 0;
  }

  private atOperationalHour(routeDate: Date, hour: number): Date {
    return new Date(
      Date.UTC(
        routeDate.getUTCFullYear(),
        routeDate.getUTCMonth(),
        routeDate.getUTCDate(),
        hour + 3,
      ),
    );
  }

  private atVehicleHour(routeDate: Date, value: string): Date {
    const [hour, minute] = value.split(':').map(Number);
    return new Date(
      Date.UTC(
        routeDate.getUTCFullYear(),
        routeDate.getUTCMonth(),
        routeDate.getUTCDate(),
        (hour ?? 8) + 3,
        minute ?? 0,
      ),
    );
  }
}
