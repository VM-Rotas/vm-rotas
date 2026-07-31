import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ConfigService } from '@nestjs/config';
import { LocalRouteOptimizerService } from '../src/modules/routes/providers/local-route-optimizer.service';
import type { OptimizationContext } from '../src/modules/routes/providers/route-optimizer.types';

function optimizer(): LocalRouteOptimizerService {
  return new LocalRouteOptimizerService({
    get: (_key: string, fallback: number) => fallback,
  } as ConfigService);
}

function context(): OptimizationContext {
  return {
    routeDate: new Date('2026-07-30T00:00:00.000Z'),
    startLocation: {
      label: 'Base',
      address: 'Base',
      latitude: -23.865,
      longitude: -51.856,
    },
    endLocation: {
      label: 'Base',
      address: 'Base',
      latitude: -23.865,
      longitude: -51.856,
    },
    vehicles: [
      {
        id: 'vehicle-1',
        plate: 'ABC1D23',
        name: 'Veículo 1',
        capacityWeightKg: 50,
        startHour: '08:00',
      },
      {
        id: 'vehicle-2',
        plate: 'EFG4H56',
        name: 'Veículo 2',
        capacityWeightKg: 50,
        startHour: '08:00',
      },
    ],
    orders: [
      {
        id: 'normal',
        code: 'N-1',
        label: 'Normal',
        address: 'A',
        type: 'DELIVERY',
        priority: 'NORMAL',
        serviceDurationMin: 10,
        weightKg: 20,
        latitude: -23.86,
        longitude: -51.85,
      },
      {
        id: 'urgent',
        code: 'U-1',
        label: 'Urgente',
        address: 'B',
        type: 'DELIVERY',
        priority: 'URGENT',
        serviceDurationMin: 10,
        weightKg: 20,
        latitude: -23.7,
        longitude: -51.76,
      },
      {
        id: 'high',
        code: 'H-1',
        label: 'Alta',
        address: 'C',
        type: 'PICKUP',
        priority: 'HIGH',
        serviceDurationMin: 15,
        weightKg: 20,
        latitude: -23.6,
        longitude: -51.64,
      },
    ],
  };
}

describe('LocalRouteOptimizerService', () => {
  it('distribui todas as ordens sem ultrapassar a frota disponível', async () => {
    const result = await optimizer().optimize(context());
    const assigned = result.routes.flatMap((route) => route.visits.map((visit) => visit.orderId));

    assert.equal(result.provider, 'LOCAL');
    assert.equal(result.skippedOrderIds.length, 0);
    assert.deepEqual(new Set(assigned), new Set(['normal', 'urgent', 'high']));
    assert.ok(result.routes.every((route) => route.totalDistanceMeters > 0));
    assert.ok(result.routes.every((route) => route.encodedPolyline));
  });

  it('mantém coleta e entrega da mesma missão no mesmo veículo e na ordem correta', async () => {
    const data = context();
    data.orders = [
      {
        id: 'pickup-mission',
        code: 'MIS-1-C',
        missionId: 'MIS-1',
        label: 'Coleta',
        address: 'Costureira',
        type: 'PICKUP',
        priority: 'HIGH',
        serviceDurationMin: 10,
        latitude: -23.72,
        longitude: -51.78,
      },
      {
        id: 'delivery-mission',
        code: 'MIS-1-E',
        missionId: 'MIS-1',
        label: 'Entrega',
        address: 'Barracão',
        type: 'DELIVERY',
        priority: 'HIGH',
        serviceDurationMin: 10,
        latitude: -23.86,
        longitude: -51.85,
      },
    ];

    const result = await optimizer().optimize(data);
    const routeWithMission = result.routes.find((route) =>
      route.visits.some((visit) => visit.orderId === 'pickup-mission'),
    );

    assert.ok(routeWithMission);
    assert.deepEqual(
      routeWithMission.visits.map((visit) => visit.orderId),
      ['pickup-mission', 'delivery-mission'],
    );
  });

  it('marca uma ordem como não alocada quando ela excede toda a capacidade', async () => {
    const data = context();
    data.orders = [
      {
        ...data.orders[0]!,
        id: 'too-heavy',
        weightKg: 500,
      },
    ];

    const result = await optimizer().optimize(data);
    assert.deepEqual(result.skippedOrderIds, ['too-heavy']);
    assert.equal(result.routes.length, 0);
  });
});
