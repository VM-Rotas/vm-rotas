import 'dotenv/config';
import { hash } from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL não configurada para o seed.');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

function utcDateOnly(date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: process.env.DEFAULT_TIME_ZONE || 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(`${byType.year}-${byType.month}-${byType.day}T00:00:00.000Z`);
}

async function main(): Promise<void> {
  const organization = await prisma.organization.upsert({
    where: { slug: 'vm-group' },
    update: { name: 'VM GROUP São Pedro do Ivaí' },
    create: {
      name: 'VM GROUP São Pedro do Ivaí',
      slug: 'vm-group',
    },
  });

  const existingAdmin = await prisma.user.findUnique({
    where: { email: 'admin@vmrotas.local' },
  });
  const admin = existingAdmin
    ? await prisma.user.update({
        where: { id: existingAdmin.id },
        data: {
          organizationId: organization.id,
          name: 'Administrador VM Rotas',
          role: 'OWNER',
          active: true,
        },
      })
    : await prisma.user.create({
        data: {
          organizationId: organization.id,
          name: 'Administrador VM Rotas',
          email: 'admin@vmrotas.local',
          passwordHash: await hash('Admin@123', 12),
          role: 'OWNER',
        },
      });

  let depot = await prisma.depot.findFirst({
    where: { organizationId: organization.id, isDefault: true },
  });

  if (!depot) {
    depot = await prisma.depot.create({
      data: {
        organizationId: organization.id,
        name: 'Base principal',
        addressLine: 'Centro operacional — endereço de demonstração',
        city: 'São Pedro do Ivaí',
        state: 'PR',
        postalCode: '86945-000',
        latitude: -23.865,
        longitude: -51.856,
        isDefault: true,
      },
    });
  }

  const vehicleOne = await prisma.vehicle.upsert({
    where: {
      organizationId_plate: {
        organizationId: organization.id,
        plate: 'VMR1A01',
      },
    },
    update: { active: true, status: 'AVAILABLE' },
    create: {
      organizationId: organization.id,
      plate: 'VMR1A01',
      name: 'Fiorino 01',
      status: 'AVAILABLE',
      capacityWeightKg: 650,
      capacityVolumeM3: 3.2,
      startHour: '08:00',
      endHour: '18:00',
    },
  });

  const vehicleTwo = await prisma.vehicle.upsert({
    where: {
      organizationId_plate: {
        organizationId: organization.id,
        plate: 'VMR2B02',
      },
    },
    update: { active: true, status: 'AVAILABLE' },
    create: {
      organizationId: organization.id,
      plate: 'VMR2B02',
      name: 'Van 02',
      status: 'AVAILABLE',
      capacityWeightKg: 1200,
      capacityVolumeM3: 8,
      startHour: '08:00',
      endHour: '18:00',
    },
  });

  const customerNames = ['Cliente Centro', 'Cliente Jandaia', 'Cliente Bom Sucesso'];
  const customers: Array<{ id: string }> = [];
  for (const name of customerNames) {
    const existing = await prisma.customer.findFirst({
      where: { organizationId: organization.id, name },
    });
    customers.push(
      existing ??
        (await prisma.customer.create({
          data: {
            organizationId: organization.id,
            name,
            phone: '(43) 99999-0000',
          },
        })),
    );
  }

  const plannedDate = utcDateOnly();
  const demoOrders = [
    {
      code: 'DEMO-001',
      customerId: customers[0]!.id,
      recipientName: customerNames[0]!,
      addressLine: 'Rua de demonstração 1',
      city: 'São Pedro do Ivaí',
      state: 'PR',
      latitude: -23.861,
      longitude: -51.849,
      priority: 'NORMAL' as const,
      weightKg: 18,
    },
    {
      code: 'DEMO-002',
      customerId: customers[1]!.id,
      recipientName: customerNames[1]!,
      addressLine: 'Avenida de demonstração 2',
      city: 'Jandaia do Sul',
      state: 'PR',
      latitude: -23.602,
      longitude: -51.643,
      priority: 'HIGH' as const,
      weightKg: 26,
    },
    {
      code: 'DEMO-003',
      customerId: customers[2]!.id,
      recipientName: customerNames[2]!,
      addressLine: 'Rua de demonstração 3',
      city: 'Bom Sucesso',
      state: 'PR',
      latitude: -23.706,
      longitude: -51.765,
      priority: 'URGENT' as const,
      weightKg: 12,
    },
  ];

  for (const order of demoOrders) {
    await prisma.serviceOrder.upsert({
      where: {
        organizationId_code: {
          organizationId: organization.id,
          code: order.code,
        },
      },
      update: {
        plannedDate,
        status: 'READY',
        latitude: order.latitude,
        longitude: order.longitude,
        priority: order.priority,
      },
      create: {
        organizationId: organization.id,
        customerId: order.customerId,
        createdById: admin.id,
        code: order.code,
        type: 'DELIVERY',
        status: 'READY',
        priority: order.priority,
        plannedDate,
        serviceDurationMin: 10,
        weightKg: order.weightKg,
        recipientName: order.recipientName,
        recipientPhone: '(43) 99999-0000',
        addressLine: order.addressLine,
        city: order.city,
        state: order.state,
        formattedAddress: `${order.addressLine}, ${order.city} - ${order.state}`,
        latitude: order.latitude,
        longitude: order.longitude,
        notes: 'Registro de demonstração. Pode ser editado ou cancelado.',
      },
    });
  }

  console.log(
    JSON.stringify(
      {
        organization: organization.name,
        admin: admin.email,
        depot: depot.name,
        vehicles: [vehicleOne.plate, vehicleTwo.plate],
        demoOrders: demoOrders.length,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
