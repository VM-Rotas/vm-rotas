'use client';

import type { RouteStop } from '@/lib/types';
import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';

let loaderConfigured = false;

export function RouteMap({
  stops,
  encodedPolyline,
}: {
  stops: RouteStop[];
  encodedPolyline?: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
  const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? 'DEMO_MAP_ID';

  useEffect(() => {
    if (!apiKey || !containerRef.current || stops.length === 0) return;
    let cancelled = false;

    async function renderMap() {
      try {
        if (!loaderConfigured) {
          setOptions({ key: apiKey!, v: 'weekly', mapIds: [mapId] });
          loaderConfigured = true;
        }
        const maps = (await importLibrary('maps')) as google.maps.MapsLibrary;
        const marker = (await importLibrary('marker')) as google.maps.MarkerLibrary;
        const geometry = (await importLibrary('geometry')) as google.maps.GeometryLibrary;
        if (cancelled || !containerRef.current) return;

        const map = new maps.Map(containerRef.current, {
          mapId,
          center: { lat: Number(stops[0]!.latitude), lng: Number(stops[0]!.longitude) },
          zoom: 11,
          disableDefaultUI: true,
          zoomControl: true,
          fullscreenControl: true,
        });
        const bounds = new google.maps.LatLngBounds();
        stops.forEach((stop, index) => {
          const position = { lat: Number(stop.latitude), lng: Number(stop.longitude) };
          bounds.extend(position);
          const badge = document.createElement('div');
          badge.className = `map-marker map-marker-${stop.type.toLowerCase()}`;
          badge.textContent = stop.type === 'SERVICE' ? String(index) : stop.type === 'DEPOT_START' ? 'S' : 'F';
          new marker.AdvancedMarkerElement({
            map,
            position,
            title: stop.label,
            content: badge,
          });
        });

        if (encodedPolyline) {
          const path = geometry.encoding.decodePath(encodedPolyline);
          new maps.Polyline({
            map,
            path,
            strokeColor: '#116466',
            strokeOpacity: 0.9,
            strokeWeight: 5,
          });
          path.forEach((point) => bounds.extend(point));
        } else {
          new maps.Polyline({
            map,
            path: stops.map((stop) => ({
              lat: Number(stop.latitude),
              lng: Number(stop.longitude),
            })),
            strokeColor: '#116466',
            strokeOpacity: 0.72,
            strokeWeight: 4,
          });
        }
        map.fitBounds(bounds, 48);
      } catch (error) {
        console.error(error);
        if (!cancelled) setMapError('Não foi possível carregar o Google Maps nesta sessão.');
      }
    }

    void renderMap();
    return () => {
      cancelled = true;
    };
  }, [apiKey, encodedPolyline, mapId, stops]);

  if (!apiKey || mapError) {
    return (
      <div className="route-map-fallback">
        <div className="route-map-grid" />
        <div className="route-map-path">
          {stops.map((stop, index) => (
            <div key={stop.id} className="fallback-stop">
              <span>{stop.type === 'SERVICE' ? index : stop.type === 'DEPOT_START' ? 'S' : 'F'}</span>
              <div><strong>{stop.label}</strong><small>{stop.address}</small></div>
            </div>
          ))}
        </div>
        <div className="map-notice"><Icon name="pin" />{mapError ?? 'Adicione a chave do Google Maps para visualizar o mapa real.'}</div>
      </div>
    );
  }

  return <div ref={containerRef} className="route-map" aria-label="Mapa da rota" />;
}
