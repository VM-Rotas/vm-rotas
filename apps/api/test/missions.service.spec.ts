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

describe('OrdersService.createMission', () => {
  it('cria coleta e entrega com a mesma referência de missão', async () => {
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
      $transaction: async <T>(callback: (client: typeof transaction) => Promise<T>) =>
        callback(transaction),
    } as unknown as PrismaService;
    const maps = {
      geocode: async (address: string) => ({
        latitude: address.includes('Costureira') ? -23.7 : -23.8,
        longitude: -51.8,
        formattedAddress: address,
        placeId: 'test',
      }),
    } as unknown as MapsService;

    const service = new OrdersService(prisma, maps);
    const result = await service.createMission(user, {
      plannedDate: '2026-07-30',
      priority: 'HIGH',
      pickupName: 'Costureira Maria',
      pickupAddress: 'Rua da Costureira, 10, Marialva - PR',
      pickupItem: 'Buscar 30 jalecos',
      pickupTime: '09:00',
      deliveryName: 'Barracão VM',
      deliveryAddress: 'Rua do Barracão, 20, São Pedro do Ivaí - PR',
      deliveryItem: 'Trazer os jalecos ao barracão',
    });

    assert.equal(result.orders.length, 2);
    assert.equal(created[0]?.externalReference, created[1]?.externalReference);
    assert.equal(created[0]?.type, 'PICKUP');
    assert.equal(created[1]?.type, 'DELIVERY');
    assert.equal(created[0]?.priority, 'HIGH');
    assert.ok(created[0]?.timeWindowStart instanceof Date);
    assert.ok(created[0]?.timeWindowEnd instanceof Date);
  });
});
