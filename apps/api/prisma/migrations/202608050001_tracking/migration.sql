-- CreateTable
CREATE TABLE "TrackingSession" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "deviceId" TEXT,
    "deviceName" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "lastLatitude" DECIMAL(10,7),
    "lastLongitude" DECIMAL(10,7),
    "lastAccuracyM" DOUBLE PRECISION,
    "lastSpeedKmh" DOUBLE PRECISION,
    "lastHeading" DOUBLE PRECISION,
    "lastBatteryPercent" INTEGER,
    "lastRecordedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TrackingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingPoint" (
    "id" BIGSERIAL NOT NULL,
    "organizationId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "accuracyM" DOUBLE PRECISION,
    "speedKmh" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "batteryPercent" INTEGER,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrackingPoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrackingSession_organizationId_active_idx" ON "TrackingSession"("organizationId", "active");
CREATE INDEX "TrackingSession_vehicleId_startedAt_idx" ON "TrackingSession"("vehicleId", "startedAt");
CREATE INDEX "TrackingSession_userId_startedAt_idx" ON "TrackingSession"("userId", "startedAt");
CREATE INDEX "TrackingPoint_sessionId_recordedAt_idx" ON "TrackingPoint"("sessionId", "recordedAt");
CREATE INDEX "TrackingPoint_organizationId_recordedAt_idx" ON "TrackingPoint"("organizationId", "recordedAt");
CREATE INDEX "TrackingPoint_vehicleId_recordedAt_idx" ON "TrackingPoint"("vehicleId", "recordedAt");

-- AddForeignKey
ALTER TABLE "TrackingSession" ADD CONSTRAINT "TrackingSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrackingSession" ADD CONSTRAINT "TrackingSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrackingSession" ADD CONSTRAINT "TrackingSession_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrackingPoint" ADD CONSTRAINT "TrackingPoint_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrackingPoint" ADD CONSTRAINT "TrackingPoint_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrackingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrackingPoint" ADD CONSTRAINT "TrackingPoint_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrackingPoint" ADD CONSTRAINT "TrackingPoint_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
