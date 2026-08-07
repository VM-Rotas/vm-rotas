-- Agenda de indisponibilidade programada da frota.
CREATE TABLE "VehicleUnavailability" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "vehicleId" UUID NOT NULL,
  "createdById" UUID,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "allDay" BOOLEAN NOT NULL DEFAULT false,
  "reason" TEXT NOT NULL,
  "destinationCity" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VehicleUnavailability_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VehicleUnavailability_organizationId_startsAt_endsAt_idx"
ON "VehicleUnavailability"("organizationId", "startsAt", "endsAt");

CREATE INDEX "VehicleUnavailability_vehicleId_startsAt_endsAt_idx"
ON "VehicleUnavailability"("vehicleId", "startsAt", "endsAt");

ALTER TABLE "VehicleUnavailability"
ADD CONSTRAINT "VehicleUnavailability_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VehicleUnavailability"
ADD CONSTRAINT "VehicleUnavailability_vehicleId_fkey"
FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VehicleUnavailability"
ADD CONSTRAINT "VehicleUnavailability_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
