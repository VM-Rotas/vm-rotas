import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AuthUser } from '../src/common/types/auth-user';
import { OrdersService } from '../src/modules/orders/orders.service';
import type { MapsService } from '../src/modules/maps/maps.service';
import type { PrismaService } from '../src/modules/prisma/prisma.service';

const user: AuthUser = {
  sub: 'user-1',
  organizationId: 'org-1',
  email: 'admin@vmrotas.local',
  name: 'Administrador',
  role: 'OWNER',
};

function createHarness() {
  const created: Array<Record<string, unknown>> = [];
  const transaction = {
    serviceOrder: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const order = { id: `order-${created.length + 1}`, ...data };
        created.push(order);
        return order;
      },
    },
    auditLog: { create: async () => ({ id: 'audit-1' }) },
  };
  const prisma = {
    vehicle: {
      findFirst: async ({ where }: { where: { id?: string } }) =>
        where.id
          ? { id: where.id, name: 'Fiorino 01', plate: 'VMR1A01', status: 'AVAILABLE' }
          : null,
    },
    $transaction: async <T>(callback: (client: typeof transaction) => Promise<T>) =>
      callback(transaction),
  } as unknown as PrismaService;
  let geocodeCalls = 0;
  const maps = {
    geocode: async (address: string) => {
      geocodeCalls += 1;
      return {
        latitude: address.includes('Costureira') ? -23.7 : -23.8,
        longitude: -51.8,
        formattedAddress: address,
        placeId: 'test',
      };
    },
  } as unknown as MapsService;

  return {
    created,
    service: new OrdersService(prisma, maps),
    geocodeCalls: () => geocodeCalls,
  };
}

describe('OrdersService.createMission', () => {
  it('cria coleta e entrega com a mesma referência e preserva os pontos confirmados', async () => {
    const harness = createHarness();
    const result = await harness.service.createMission(user, {
      plannedDate: '2026-07-30',
      priority: 'HIGH',
      pickupName: 'Costureira Maria',
      pickupAddress: 'Rua da Costureira',
      pickupAddressNumber: '10',
      pickupNeighborhood: 'Centro',
      pickupCity: 'Marialva',
      pickupState: 'PR',
      pickupItem: 'Buscar 30 jalecos',
      pickupTime: '09:00',
      pickupLatitude: -23.7012345,
      pickupLongitude: -51.8012345,
      pickupLocationConfirmed: true,
      deliveryName: 'Barracão VM',
      deliveryAddress: 'Rua do Barracão',
      deliveryAddressNumber: '20',
      deliveryNeighborhood: 'Centro',
      deliveryCity: 'São Pedro do Ivaí',
      deliveryState: 'PR',
      deliveryItem: 'Trazer os jalecos ao barracão',
      deliveryLatitude: -23.8111111,
      deliveryLongitude: -51.8222222,
      deliveryLocationConfirmed: true,
    });

    assert.equal(result.orders.length, 2);
    assert.equal(harness.created[0]?.externalReference, harness.created[1]?.externalReference);
    assert.equal(harness.created[0]?.type, 'PICKUP');
    assert.equal(harness.created[1]?.type, 'DELIVERY');
    assert.equal(harness.created[0]?.priority, 'HIGH');
    assert.equal(harness.created[0]?.latitude, -23.7012345);
    assert.equal(harness.created[0]?.longitude, -51.8012345);
    assert.equal(harness.created[1]?.latitude, -23.8111111);
    assert.equal(harness.created[1]?.longitude, -51.8222222);
    assert.equal(harness.geocodeCalls(), 0);
    assert.ok(harness.created[0]?.timeWindowStart instanceof Date);
    assert.ok(harness.created[0]?.timeWindowEnd instanceof Date);
  });

  it('grava o mesmo veículo designado na coleta e na entrega', async () => {
    const harness = createHarness();
    const result = await harness.service.createMission(user, {
      plannedDate: '2026-07-30',
      assignedVehicleId: '11111111-1111-4111-8111-111111111111',
      pickupName: 'Costureira Maria',
      pickupAddress: 'Rua da Costureira',
      pickupAddressNumber: '10',
      pickupCity: 'Marialva',
      pickupState: 'PR',
      pickupItem: 'Buscar jalecos',
      pickupLatitude: -23.7,
      pickupLongitude: -51.8,
      pickupLocationConfirmed: true,
      deliveryName: 'Barracão VM',
      deliveryAddress: 'Rua do Barracão',
      deliveryAddressNumber: '20',
      deliveryCity: 'São Pedro do Ivaí',
      deliveryState: 'PR',
      deliveryItem: 'Levar jalecos',
      deliveryLatitude: -23.8,
      deliveryLongitude: -51.9,
      deliveryLocationConfirmed: true,
    });

    assert.equal(result.orders.length, 2);
    assert.equal(
      harness.created[0]?.assignedVehicleId,
      '11111111-1111-4111-8111-111111111111',
    );
    assert.equal(
      harness.created[1]?.assignedVehicleId,
      '11111111-1111-4111-8111-111111111111',
    );
  });

  it('recusa missão sem confirmação do ponto exato', async () => {
    const harness = createHarness();

    await assert.rejects(
      () =>
        harness.service.createMission(user, {
          plannedDate: '2026-07-30',
          pickupName: 'Costureira Maria',
          pickupAddress: 'Rua da Costureira',
          pickupAddressNumber: '10',
          pickupCity: 'Marialva',
          pickupState: 'PR',
          pickupItem: 'Buscar 30 jalecos',
          pickupLatitude: -23.7,
          pickupLongitude: -51.8,
          pickupLocationConfirmed: false,
        }),
      /Confirme no mapa o ponto exato do GPS da coleta/,
    );
  });
});

describe('OrdersService.complete', () => {
  it('marca a coleta e a parada ativa como concluídas', async () => {
    const routeStopUpdates: Array<Record<string, unknown>> = [];
    const orderUpdates: Array<Record<string, unknown>> = [];
    const existing = {
      id: 'order-1',
      organizationId: 'org-1',
      code: 'MIS-TEST-C',
      externalReference: 'MIS-TEST',
      type: 'PICKUP',
      status: 'READY',
      routeStops: [
        {
          id: 'stop-1',
          actualArrivalAt: null,
        },
      ],
    };
    const transaction = {
      routeStop: {
        update: async ({ data }: { data: Record<string, unknown> }) => {
          routeStopUpdates.push(data);
          return { id: 'stop-1', ...data };
        },
      },
      serviceOrder: {
        update: async ({ data }: { data: Record<string, unknown> }) => {
          orderUpdates.push(data);
          return { ...existing, ...data };
        },
      },
      auditLog: { create: async () => ({ id: 'audit-1' }) },
    };
    const prisma = {
      serviceOrder: { findFirst: async () => existing },
      $transaction: async <T>(callback: (client: typeof transaction) => Promise<T>) =>
        callback(transaction),
    } as unknown as PrismaService;
    const maps = {} as MapsService;
    const service = new OrdersService(prisma, maps);

    const result = await service.complete(user, 'order-1');

    assert.equal(result.status, 'COMPLETED');
    assert.equal(orderUpdates[0]?.status, 'COMPLETED');
    assert.equal(routeStopUpdates[0]?.status, 'COMPLETED');
    assert.ok(routeStopUpdates[0]?.actualDepartureAt instanceof Date);
  });

  it('não permite concluir a entrega antes da coleta da mesma missão', async () => {
    const existing = {
      id: 'order-2',
      organizationId: 'org-1',
      code: 'MIS-TEST-E',
      externalReference: 'MIS-TEST',
      type: 'DELIVERY',
      status: 'READY',
      routeStops: [],
    };
    let calls = 0;
    const prisma = {
      serviceOrder: {
        findFirst: async () => {
          calls += 1;
          return calls === 1 ? existing : { status: 'READY' };
        },
      },
    } as unknown as PrismaService;
    const maps = {} as MapsService;
    const service = new OrdersService(prisma, maps);

    await assert.rejects(
      () => service.complete(user, 'order-2'),
      /Conclua a coleta antes de marcar a entrega/,
    );
  });
});

describe('OrdersService.assignMissionVehicle', () => {
  it('designa o mesmo veículo para todas as paradas disponíveis da missão', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const auditActions: string[] = [];
    const orders = [
      { id: 'pickup-1', status: 'READY', assignedVehicleId: null },
      { id: 'delivery-1', status: 'READY', assignedVehicleId: null },
    ];
    const transaction = {
      serviceOrder: {
        updateMany: async ({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          return { count: orders.length };
        },
      },
      auditLog: {
        create: async ({ data }: { data: { action: string } }) => {
          auditActions.push(data.action);
          return { id: 'audit-1' };
        },
      },
    };
    const prisma = {
      serviceOrder: {
        findMany: async ({ select }: { select?: Record<string, boolean> }) =>
          select?.status
            ? orders
            : orders.map((order) => ({
                ...order,
                type: order.id.startsWith('pickup') ? 'PICKUP' : 'DELIVERY',
                assignedVehicle: {
                  id: 'vehicle-2',
                  name: 'Van 02',
                  plate: 'VMR2B02',
                  status: 'AVAILABLE',
                  active: true,
                },
              })),
      },
      vehicle: {
        findFirst: async () => ({
          id: 'vehicle-2',
          name: 'Van 02',
          plate: 'VMR2B02',
          status: 'AVAILABLE',
          active: true,
        }),
      },
      $transaction: async <T>(callback: (client: typeof transaction) => Promise<T>) =>
        callback(transaction),
    } as unknown as PrismaService;
    const maps = { geocode: async () => null } as unknown as MapsService;
    const service = new OrdersService(prisma, maps);

    const result = await service.assignMissionVehicle(user, 'MIS-TEST', {
      assignedVehicleId: '22222222-2222-4222-8222-222222222222',
    });

    assert.equal(updates[0]?.assignedVehicleId, 'vehicle-2');
    assert.equal(auditActions[0], 'MISSION_VEHICLE_ASSIGNED');
    assert.equal(result.assignedVehicle?.name, 'Van 02');
  });
});
