import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  GeoPoint,
  OptimizableOrder,
  OptimizableVehicle,
  OptimizationContext,
  OptimizationResult,
  OptimizedVehicleRoute,
  RouteOptimizer,
} from './route-optimizer.types';

interface VehicleBucket {
  vehicle: OptimizableVehicle;
  orders: OptimizableOrder[];
  weightKg: number;
  volumeM3: number;
  lastPoint: GeoPoint;
}

const PRIORITY_SCORE: Record<OptimizableOrder['priority'], number> = {
  URGENT: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
};

@Injectable()
export class LocalRouteOptimizerService implements RouteOptimizer {
  private readonly averageSpeedKmh: number;

  constructor(config: ConfigService) {
    this.averageSpeedKmh = config.get<number>('LOCAL_AVG_SPEED_KMH', 35);
  }

  async optimize(context: OptimizationContext): Promise<OptimizationResult> {
    const warnings: string[] = [
      'O modo local usa distância geodésica e velocidade média; não considera trânsito nem malha viária.',
    ];

    const buckets: VehicleBucket[] = context.vehicles.map((vehicle) => ({
      vehicle,
      orders: [],
      weightKg: 0,
      volumeM3: 0,
      lastPoint: context.startLocation,
    }));

    const skippedOrderIds: string[] = [];
    const sortedOrders = [...context.orders].sort((a, b) => {
      const priority = PRIORITY_SCORE[a.priority] - PRIORITY_SCORE[b.priority];
      if (priority !== 0) return priority;
      return this.distanceMeters(context.startLocation, a) - this.distanceMeters(context.startLocation, b);
    });

    for (const order of sortedOrders) {
      const feasible = buckets
        .filter((bucket) => this.hasCapacity(bucket, order))
        .map((bucket) => ({
          bucket,
          score:
            this.distanceMeters(bucket.lastPoint, order) +
            bucket.orders.length * 3_000 +
            this.capacityPenalty(bucket, order),
        }))
        .sort((a, b) => a.score - b.score);

      const selected = feasible[0]?.bucket;
      if (!selected) {
        skippedOrderIds.push(order.id);
        continue;
      }

      selected.orders.push(order);
      selected.weightKg += order.weightKg ?? 0;
      selected.volumeM3 += order.volumeM3 ?? 0;
      selected.lastPoint = order;
    }

    if (skippedOrderIds.length > 0) {
      warnings.push(`${skippedOrderIds.length} ordem(ns) não couberam na capacidade informada da frota.`);
    }

    const routes = buckets
      .filter((bucket) => bucket.orders.length > 0)
      .map((bucket) => this.buildRoute(context, bucket));

    return {
      provider: 'LOCAL',
      routes,
      skippedOrderIds,
      warnings,
    };
  }

  private buildRoute(context: OptimizationContext, bucket: VehicleBucket): OptimizedVehicleRoute {
    const remaining = [...bucket.orders];
    const sequence: OptimizableOrder[] = [];
    let current: GeoPoint = context.startLocation;

    while (remaining.length > 0) {
      remaining.sort((a, b) => {
        const urgencyPenaltyA = PRIORITY_SCORE[a.priority] * 35_000;
        const urgencyPenaltyB = PRIORITY_SCORE[b.priority] * 35_000;
        return (
          this.distanceMeters(current, a) + urgencyPenaltyA -
          (this.distanceMeters(current, b) + urgencyPenaltyB)
        );
      });
      const next = remaining.shift();
      if (!next) break;
      sequence.push(next);
      current = next;
    }

    const startAt = this.vehicleStartAt(context.routeDate, bucket.vehicle.startHour);
    let clock = startAt;
    let previous: GeoPoint = context.startLocation;
    let totalDistanceMeters = 0;
    let totalDurationSeconds = 0;
    const points: GeoPoint[] = [context.startLocation];

    const visits = sequence.map((order) => {
      const distanceFromPreviousM = Math.round(this.distanceMeters(previous, order));
      const durationFromPreviousSec = this.travelDurationSeconds(distanceFromPreviousM);
      const plannedArrivalAt = new Date(clock.getTime() + durationFromPreviousSec * 1_000);
      const plannedDepartureAt = new Date(
        plannedArrivalAt.getTime() + order.serviceDurationMin * 60 * 1_000,
      );

      totalDistanceMeters += distanceFromPreviousM;
      totalDurationSeconds += durationFromPreviousSec + order.serviceDurationMin * 60;
      clock = plannedDepartureAt;
      previous = order;
      points.push(order);

      return {
        orderId: order.id,
        plannedArrivalAt,
        plannedDepartureAt,
        distanceFromPreviousM,
        durationFromPreviousSec,
      };
    });

    const distanceToDepotMeters = Math.round(this.distanceMeters(previous, context.endLocation));
    const durationToDepotSeconds = this.travelDurationSeconds(distanceToDepotMeters);
    totalDistanceMeters += distanceToDepotMeters;
    totalDurationSeconds += durationToDepotSeconds;
    points.push(context.endLocation);

    return {
      vehicleId: bucket.vehicle.id,
      visits,
      totalDistanceMeters,
      totalDurationSeconds,
      encodedPolyline: this.encodePolyline(points),
      distanceToDepotMeters,
      durationToDepotSeconds,
    };
  }

  private hasCapacity(bucket: VehicleBucket, order: OptimizableOrder): boolean {
    const weightCapacity = bucket.vehicle.capacityWeightKg;
    const volumeCapacity = bucket.vehicle.capacityVolumeM3;
    const weightOk = weightCapacity == null || bucket.weightKg + (order.weightKg ?? 0) <= weightCapacity;
    const volumeOk = volumeCapacity == null || bucket.volumeM3 + (order.volumeM3 ?? 0) <= volumeCapacity;
    return weightOk && volumeOk;
  }

  private capacityPenalty(bucket: VehicleBucket, order: OptimizableOrder): number {
    const weightRatio = bucket.vehicle.capacityWeightKg
      ? (bucket.weightKg + (order.weightKg ?? 0)) / bucket.vehicle.capacityWeightKg
      : 0;
    const volumeRatio = bucket.vehicle.capacityVolumeM3
      ? (bucket.volumeM3 + (order.volumeM3 ?? 0)) / bucket.vehicle.capacityVolumeM3
      : 0;
    return Math.max(weightRatio, volumeRatio) * 10_000;
  }

  private travelDurationSeconds(distanceMeters: number): number {
    const metersPerSecond = (this.averageSpeedKmh * 1_000) / 3_600;
    return Math.max(60, Math.round(distanceMeters / metersPerSecond));
  }

  private vehicleStartAt(routeDate: Date, startHour?: string): Date {
    const [hour, minute] = (startHour ?? '08:00').split(':').map(Number);
    // Datas operacionais são armazenadas como DATE. Para o MVP brasileiro, convertemos
    // o horário local BRT (UTC-3) para UTC sem adicionar uma dependência de timezone.
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

  private distanceMeters(a: GeoPoint, b: GeoPoint): number {
    const earthRadiusM = 6_371_000;
    const latitudeA = this.toRadians(a.latitude);
    const latitudeB = this.toRadians(b.latitude);
    const latitudeDelta = this.toRadians(b.latitude - a.latitude);
    const longitudeDelta = this.toRadians(b.longitude - a.longitude);

    const haversine =
      Math.sin(latitudeDelta / 2) ** 2 +
      Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
    return 2 * earthRadiusM * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  }

  private toRadians(value: number): number {
    return (value * Math.PI) / 180;
  }

  private encodePolyline(points: GeoPoint[]): string {
    let previousLatitude = 0;
    let previousLongitude = 0;
    let result = '';

    for (const point of points) {
      const latitude = Math.round(point.latitude * 1e5);
      const longitude = Math.round(point.longitude * 1e5);
      result += this.encodeSignedNumber(latitude - previousLatitude);
      result += this.encodeSignedNumber(longitude - previousLongitude);
      previousLatitude = latitude;
      previousLongitude = longitude;
    }
    return result;
  }

  private encodeSignedNumber(value: number): string {
    let shifted = value < 0 ? ~(value << 1) : value << 1;
    let output = '';
    while (shifted >= 0x20) {
      output += String.fromCharCode((0x20 | (shifted & 0x1f)) + 63);
      shifted >>= 5;
    }
    output += String.fromCharCode(shifted + 63);
    return output;
  }
}
