'use client';

import type { LiveTrackingVehicle } from '@/lib/types';
import type { LatLngExpression, Map as LeafletMap, Marker } from 'leaflet';
import { useEffect, useRef, useState } from 'react';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function LiveTrackingMap({
  vehicles,
  selectedVehicleId,
  onSelectVehicle,
}: {
  vehicles: LiveTrackingVehicle[];
  selectedVehicleId?: string | null;
  onSelectVehicle?: (vehicleId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<typeof import('leaflet') | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<Map<string, Marker>>(new Map());
  const initialFitDoneRef = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      if (!containerRef.current || mapRef.current) return;
      const L = await import('leaflet');
      if (cancelled || !containerRef.current) return;
      leafletRef.current = L;
      const map = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
      }).setView([-23.865, -51.856], 10);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap',
      }).addTo(map);
      mapRef.current = map;
      setReady(true);
    }

    void initialize();
    return () => {
      cancelled = true;
      markersRef.current.clear();
      mapRef.current?.remove();
      mapRef.current = null;
      leafletRef.current = null;
      initialFitDoneRef.current = false;
    };
  }, []);

  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;

    const activeIds = new Set<string>();
    const bounds: LatLngExpression[] = [];

    vehicles.forEach((item, index) => {
      const position = item.position;
      if (!position) return;
      activeIds.add(item.vehicle.id);
      const latLng: LatLngExpression = [position.latitude, position.longitude];
      bounds.push(latLng);
      const stateClass = position.stale
        ? 'is-stale'
        : item.session?.active
          ? 'is-live'
          : 'is-offline';
      const selectedClass = selectedVehicleId === item.vehicle.id ? 'is-selected' : '';
      const icon = L.divIcon({
        className: 'tracking-marker-wrapper',
        html: `<div class="tracking-map-marker ${stateClass} ${selectedClass}"><span>${index + 1}</span></div>`,
        iconSize: [42, 42],
        iconAnchor: [21, 21],
      });
      const popup = [
        `<strong>${escapeHtml(item.vehicle.name)}</strong>`,
        `<span>${escapeHtml(item.vehicle.plate)}</span>`,
        item.session?.driver?.name ? `<span>Motorista: ${escapeHtml(item.session.driver.name)}</span>` : '',
        position.speedKmh != null ? `<span>Velocidade: ${Math.round(position.speedKmh)} km/h</span>` : '',
        position.recordedAt
          ? `<span>Última posição: ${new Date(position.recordedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>`
          : '',
      ].filter(Boolean).join('<br>');

      let marker = markersRef.current.get(item.vehicle.id);
      if (!marker) {
        marker = L.marker(latLng, { icon, title: item.vehicle.name }).addTo(map);
        marker.on('click', () => onSelectVehicle?.(item.vehicle.id));
        marker.bindPopup(popup);
        markersRef.current.set(item.vehicle.id, marker);
      } else {
        marker.setLatLng(latLng);
        marker.setIcon(icon);
        marker.setPopupContent(popup);
      }
    });

    for (const [vehicleId, marker] of markersRef.current.entries()) {
      if (!activeIds.has(vehicleId)) {
        marker.removeFrom(map);
        markersRef.current.delete(vehicleId);
      }
    }

    if (selectedVehicleId) {
      const selected = vehicles.find((item) => item.vehicle.id === selectedVehicleId)?.position;
      if (selected) map.panTo([selected.latitude, selected.longitude], { animate: true });
    } else if (!initialFitDoneRef.current && bounds.length > 0) {
      if (bounds.length === 1) map.setView(bounds[0]!, 15);
      else map.fitBounds(L.latLngBounds(bounds), { padding: [36, 36], maxZoom: 16 });
      initialFitDoneRef.current = true;
    }
  }, [onSelectVehicle, ready, selectedVehicleId, vehicles]);

  return <div ref={containerRef} className="live-tracking-map" aria-label="Mapa ao vivo dos veículos" />;
}
