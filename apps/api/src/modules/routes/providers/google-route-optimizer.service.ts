import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleAuth } from 'google-auth-library';
import type {
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

    const request = this.buildRequest(context);
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
      .map((route) => this.mapRoute(context, route))
      .filter((route): route is OptimizedVehicleRoute => route !== null);

    const skippedOrderIds = (response.data.skippedShipments ?? [])
      .map((skipped) => skipped.index)
      .filter((index): index is number => index != null)
      .map((index) => context.orders[index]?.id)
      .filter((id): id is string => Boolean(id));

    return {
      provider: 'GOOGLE',
      routes,
      skippedOrderIds,
      warnings: skippedOrderIds.length
        ? [`O Google não conseguiu alocar ${skippedOrderIds.length} ordem(ns).`]
        : [],
      rawRequest: request,
      rawResponse: response.data,
    };
  }

  private buildRequest(context: OptimizationContext) {
    const globalStartTime = this.atOperationalHour(context.routeDate, 8).toISOString();
    const globalEndTime = this.atOperationalHour(context.routeDate, 20).toISOString();

    return {
      timeout: '30s',
      considerRoadTraffic: true,
      populatePolylines: true,
      model: {
        globalStartTime,
        globalEndTime,
        shipments: context.orders.map((order) => {
          const visitRequest = {
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

          return {
            label: order.id,
            pickups: order.type === 'PICKUP' ? [visitRequest] : undefined,
            deliveries: order.type === 'DELIVERY' ? [visitRequest] : undefined,
            loadDemands: {
              ...(order.weightKg != null
                ? { weightKg: { amount: String(Math.round(order.weightKg * 1_000)) } }
                : {}),
              ...(order.volumeM3 != null
                ? { volumeM3: { amount: String(Math.round(order.volumeM3 * 10_000)) } }
                : {}),
            },
            penaltyCost: this.penaltyForPriority(order.priority),
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

  private mapRoute(context: OptimizationContext, route: GoogleRoute): OptimizedVehicleRoute | null {
    const vehicle = route.vehicleIndex == null ? undefined : context.vehicles[route.vehicleIndex];
    if (!vehicle) return null;

    const transitions = route.transitions ?? [];
    const visits = (route.visits ?? [])
      .map((visit, index) => {
        const order = visit.shipmentIndex == null ? undefined : context.orders[visit.shipmentIndex];
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
