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

interface MissionJob {
  id: string;
  orders: OptimizableOrder[];
  entryPoint: OptimizableOrder;
  exitPoint: OptimizableOrder;
  priorityScore: number;
  weightKg: number;
  volumeM3: number;
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
    const jobs = this.groupMissionJobs(context.orders).sort((a, b) => {
      const priority = a.priorityScore - b.priorityScore;
      if (priority !== 0) return priority;
      return this.distanceMeters(context.startLocation, a.entryPoint) -
        this.distanceMeters(context.startLocation, b.entryPoint);
    });

    for (const job of jobs) {
      const feasible = buckets
        .filter((bucket) => this.hasJobCapacity(bucket, job))
        .map((bucket) => ({
          bucket,
          score:
            this.distanceMeters(bucket.lastPoint, job.entryPoint) +
            bucket.orders.length * 3_000 +
            this.jobCapacityPenalty(bucket, job),
        }))
        .sort((a, b) => a.score - b.score);

      const selected = feasible[0]?.bucket;
      if (!selected) {
        skippedOrderIds.push(...job.orders.map((order) => order.id));
        continue;
      }

      selected.orders.push(...job.orders);
      selected.weightKg += job.weightKg;
      selected.volumeM3 += job.volumeM3;
      selected.lastPoint = job.exitPoint;
    }

    if (skippedOrderIds.length > 0) {
      warnings.push(`${skippedOrderIds.length} parada(s) não couberam na capacidade informada da frota.`);
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

  private groupMissionJobs(orders: OptimizableOrder[]): MissionJob[] {
    const groups = new Map<string, OptimizableOrder[]>();

    for (const order of orders) {
      const key = order.missionId || order.id;
      const current = groups.get(key) ?? [];
      current.push(order);
      groups.set(key, current);
    }

    return [...groups.entries()].map(([id, groupedOrders]) => {
      const ordered = [...groupedOrders].sort((a, b) => {
        if (a.type === b.type) return 0;
        return a.type === 'PICKUP' ? -1 : 1;
      });
      const first = ordered[0];
      if (!first) throw new Error('Uma missão sem paradas não pode ser otimizada.');
      const pickup = ordered.find((order) => order.type === 'PICKUP');
      const delivery = [...ordered].reverse().find((order) => order.type === 'DELIVERY');

      return {
        id,
        orders: ordered,
        entryPoint: pickup ?? first,
        exitPoint: delivery ?? ordered[ordered.length - 1] ?? first,
        priorityScore: Math.min(...ordered.map((order) => PRIORITY_SCORE[order.priority])),
        weightKg: ordered.reduce((total, order) => total + (order.weightKg ?? 0), 0),
        volumeM3: ordered.reduce((total, order) => total + (order.volumeM3 ?? 0), 0),
      };
    });
  }

  private buildRoute(context: OptimizationContext, bucket: VehicleBucket): OptimizedVehicleRoute {
    const remaining = [...bucket.orders];
    const sequence: OptimizableOrder[] = [];
    const missionsWithPickup = new Set(
      bucket.orders
        .filter((order) => order.type === 'PICKUP' && order.missionId)
        .map((order) => order.missionId as string),
    );
    const completedPickups = new Set<string>();
    let current: GeoPoint = context.startLocation;

    while (remaining.length > 0) {
      const eligible = remaining.filter(
        (order) =>
          order.type !== 'DELIVERY' ||
          !order.missionId ||
          !missionsWithPickup.has(order.missionId) ||
          completedPickups.has(order.missionId),
      );
      const candidates = eligible.length > 0 ? eligible : remaining;

      candidates.sort((a, b) => {
        const urgencyPenaltyA = PRIORITY_SCORE[a.priority] * 35_000;
        const urgencyPenaltyB = PRIORITY_SCORE[b.priority] * 35_000;
        return (
          this.distanceMeters(current, a) + urgencyPenaltyA -
          (this.distanceMeters(current, b) + urgencyPenaltyB)
        );
      });

      const next = candidates[0];
      if (!next) break;
      remaining.splice(remaining.findIndex((order) => order.id === next.id), 1);
      sequence.push(next);
      current = next;
      if (next.type === 'PICKUP' && next.missionId) completedPickups.add(next.missionId);
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

  private hasJobCapacity(bucket: VehicleBucket, job: MissionJob): boolean {
    const weightCapacity = bucket.vehicle.capacityWeightKg;
    const volumeCapacity = bucket.vehicle.capacityVolumeM3;
    const weightOk = weightCapacity == null || bucket.weightKg + job.weightKg <= weightCapacity;
    const volumeOk = volumeCapacity == null || bucket.volumeM3 + job.volumeM3 <= volumeCapacity;
    return weightOk && volumeOk;
  }

  private jobCapacityPenalty(bucket: VehicleBucket, job: MissionJob): number {
    const weightRatio = bucket.vehicle.capacityWeightKg
      ? (bucket.weightKg + job.weightKg) / bucket.vehicle.capacityWeightKg
      : 0;
    const volumeRatio = bucket.vehicle.capacityVolumeM3
      ? (bucket.volumeM3 + job.volumeM3) / bucket.vehicle.capacityVolumeM3
      : 0;
    return Math.max(weightRatio, volumeRatio) * 10_000;
  }

  private travelDurationSeconds(distanceMeters: number): number {
    const metersPerSecond = (this.averageSpeedKmh * 1_000) / 3_600;
    return Math.max(60, Math.round(distanceMeters / metersPerSecond));
  }

  private vehicleStartAt(routeDate: Date, startHour?: string): Date {
    const [hour, minute] = (startHour ?? '08:00').split(':').map(Number);
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
