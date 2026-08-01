'use client';

import { Icon } from '@/components/icons';
import { api, ApiError } from '@/lib/api';
import type { GeocodedAddress, LocationAccuracy } from '@/lib/types';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

type LatLngTuple = [number, number];

interface LeafletLatLng {
  lat: number;
  lng: number;
}

interface LeafletMap {
  getZoom(): number;
  invalidateSize(): void;
  on(event: 'click', handler: (event: { latlng: LeafletLatLng }) => void): LeafletMap;
  remove(): void;
  setView(
    center: LatLngTuple,
    zoom?: number,
    options?: { animate?: boolean },
  ): LeafletMap;
}

interface LeafletMarker {
  addTo(map: LeafletMap): LeafletMarker;
  getLatLng(): LeafletLatLng;
  on(event: 'dragend', handler: () => void): LeafletMarker;
  setLatLng(center: LatLngTuple): LeafletMarker;
}

interface LeafletTileLayer {
  addTo(map: LeafletMap): LeafletTileLayer;
}

interface LeafletNamespace {
  divIcon(options: {
    className: string;
    html: string;
    iconAnchor: [number, number];
    iconSize: [number, number];
  }): unknown;
  map(
    element: HTMLElement,
    options?: {
      attributionControl?: boolean;
      scrollWheelZoom?: boolean;
      tap?: boolean;
      touchZoom?: boolean;
      zoomControl?: boolean;
    },
  ): LeafletMap;
  marker(
    center: LatLngTuple,
    options?: { autoPan?: boolean; draggable?: boolean; icon?: unknown },
  ): LeafletMarker;
  tileLayer(
    urlTemplate: string,
    options?: {
      attribution?: string;
      maxZoom?: number;
      minZoom?: number;
    },
  ): LeafletTileLayer;
}

declare global {
  interface Window {
    L?: LeafletNamespace;
  }
}

export interface ConfirmedLocationUpdate {
  latitude: number;
  longitude: number;
  confirmed: boolean;
  formattedAddress?: string;
  city?: string;
  neighborhood?: string;
  state?: string;
  postalCode?: string;
}

interface PreciseLocationPickerProps {
  kind: 'pickup' | 'delivery';
  address: string;
  addressNumber: string;
  neighborhood?: string;
  city: string;
  state: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  confirmed: boolean;
  onChange: (update: ConfirmedLocationUpdate) => void;
}

type PositionSource = 'ADDRESS' | 'MAP' | 'DEVICE';

const LEAFLET_VERSION = '1.9.4';
const LEAFLET_CDN = `https://cdn.jsdelivr.net/npm/leaflet@${LEAFLET_VERSION}/dist`;
let leafletLoader: Promise<LeafletNamespace> | null = null;

function ensureLeafletStylesheet(): void {
  if (document.getElementById('vm-rotas-leaflet-css')) return;
  const link = document.createElement('link');
  link.id = 'vm-rotas-leaflet-css';
  link.rel = 'stylesheet';
  link.href = `${LEAFLET_CDN}/leaflet.css`;
  link.crossOrigin = 'anonymous';
  document.head.appendChild(link);
}

function loadLeaflet(): Promise<LeafletNamespace> {
  if (window.L) return Promise.resolve(window.L);
  if (leafletLoader) return leafletLoader;

  ensureLeafletStylesheet();
  leafletLoader = new Promise<LeafletNamespace>((resolve, reject) => {
    const existing = document.getElementById('vm-rotas-leaflet-js') as HTMLScriptElement | null;

    const finish = () => {
      if (window.L) resolve(window.L);
      else reject(new Error('Leaflet não foi inicializado.'));
    };

    if (existing) {
      if (existing.dataset.loaded === 'true') {
        finish();
        return;
      }
      existing.addEventListener('load', finish, { once: true });
      existing.addEventListener(
        'error',
        () => {
          existing.remove();
          reject(new Error('Não foi possível carregar o mapa.'));
        },
        { once: true },
      );
      return;
    }

    const script = document.createElement('script');
    script.id = 'vm-rotas-leaflet-js';
    script.src = `${LEAFLET_CDN}/leaflet.js`;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.addEventListener(
      'load',
      () => {
        script.dataset.loaded = 'true';
        finish();
      },
      { once: true },
    );
    script.addEventListener(
      'error',
      () => {
        script.remove();
        reject(new Error('Não foi possível carregar o mapa.'));
      },
      { once: true },
    );
    document.head.appendChild(script);
  }).catch((error) => {
    leafletLoader = null;
    throw error;
  });

  return leafletLoader;
}

function validCoordinate(value?: number): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function accuracyLabel(accuracy?: LocationAccuracy): string {
  if (accuracy === 'BUILDING') return 'Número encontrado pelo serviço de endereço';
  if (accuracy === 'STREET') return 'Ponto aproximado da rua';
  if (accuracy === 'AREA') return 'Ponto aproximado da região';
  return 'Localização encontrada';
}

export function PreciseLocationPicker({
  kind,
  address,
  addressNumber,
  neighborhood,
  city,
  state,
  postalCode,
  latitude,
  longitude,
  confirmed,
  onChange,
}: PreciseLocationPickerProps) {
  const mapElementRef = useRef<HTMLDivElement>(null);
  const mapHostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<LeafletMarker | null>(null);
  const onChangeRef = useRef(onChange);
  const lastGeocodedQueryRef = useRef('');
  const requestSequenceRef = useRef(0);
  const [loadingAddress, setLoadingAddress] = useState(false);
  const [locatingDevice, setLocatingDevice] = useState(false);
  const [message, setMessage] = useState('');
  const [mapError, setMapError] = useState('');
  const [accuracy, setAccuracy] = useState<LocationAccuracy>();
  const [positionSource, setPositionSource] = useState<PositionSource>('ADDRESS');
  const [deviceAccuracyMeters, setDeviceAccuracyMeters] = useState<number>();
  const [retryVersion, setRetryVersion] = useState(0);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const searchAddress = useMemo(
    () =>
      [
        [address.trim(), addressNumber.trim()].filter(Boolean).join(', '),
        neighborhood?.trim(),
        city.trim() && `${city.trim()} - ${(state || 'PR').trim()}`,
        postalCode?.trim(),
        'Brasil',
      ]
        .filter(Boolean)
        .join(', '),
    [address, addressNumber, city, neighborhood, postalCode, state],
  );

  const ready =
    address.trim().length >= 3 &&
    addressNumber.trim().length >= 1 &&
    city.trim().length >= 2;
  const coordinates =
    validCoordinate(latitude) && validCoordinate(longitude)
      ? { latitude, longitude }
      : null;
  const hasCoordinates = coordinates !== null;

  const updatePointFromMap = useCallback((nextLatitude: number, nextLongitude: number) => {
    setPositionSource('MAP');
    setDeviceAccuracyMeters(undefined);
    setMessage('Pino ajustado manualmente. Confirme este ponto antes de salvar.');
    onChangeRef.current({
      latitude: nextLatitude,
      longitude: nextLongitude,
      confirmed: false,
    });
  }, []);

  useEffect(() => {
    if (!ready) {
      setLoadingAddress(false);
      setMessage('');
      setAccuracy(undefined);
      lastGeocodedQueryRef.current = '';
      return;
    }
    if (confirmed || lastGeocodedQueryRef.current === searchAddress) return;

    const requestSequence = ++requestSequenceRef.current;
    const timer = window.setTimeout(async () => {
      setLoadingAddress(true);
      setMessage('Localizando rua e número...');
      try {
        const result = await api<GeocodedAddress>('/maps/geocode', {
          method: 'POST',
          body: JSON.stringify({ address: searchAddress }),
        });
        if (requestSequence !== requestSequenceRef.current) return;

        lastGeocodedQueryRef.current = searchAddress;
        setAccuracy(result.accuracy);
        setPositionSource('ADDRESS');
        setDeviceAccuracyMeters(undefined);
        setMessage(
          result.accuracy === 'BUILDING'
            ? 'Número localizado. Confira se o pino está na entrada correta.'
            : 'A localização é aproximada. Arraste o pino ou toque no mapa até a entrada correta.',
        );
        onChangeRef.current({
          latitude: result.latitude,
          longitude: result.longitude,
          confirmed: false,
          formattedAddress: result.formattedAddress,
          city: result.city ?? undefined,
          neighborhood: result.neighborhood ?? undefined,
          state: result.state ?? undefined,
          postalCode: result.postalCode ?? undefined,
        });
      } catch (caught) {
        if (requestSequence !== requestSequenceRef.current) return;
        lastGeocodedQueryRef.current = searchAddress;
        setMessage(
          caught instanceof ApiError
            ? caught.message
            : 'Não foi possível localizar o número automaticamente. Tente novamente ou ajuste pelo mapa.',
        );
      } finally {
        if (requestSequence === requestSequenceRef.current) setLoadingAddress(false);
      }
    }, 650);

    return () => window.clearTimeout(timer);
  }, [confirmed, ready, retryVersion, searchAddress]);

  useEffect(() => {
    if (coordinates) return;
    mapRef.current?.remove();
    mapRef.current = null;
    markerRef.current = null;
    mapHostRef.current = null;
  }, [coordinates]);

  useEffect(() => {
    if (!coordinates || !mapElementRef.current) return;
    let cancelled = false;

    void loadLeaflet()
      .then((leaflet) => {
        if (cancelled || !mapElementRef.current) return;
        setMapError('');
        const point: LatLngTuple = [coordinates.latitude, coordinates.longitude];
        const mapElement = mapElementRef.current;

        if (mapRef.current && mapHostRef.current !== mapElement) {
          mapRef.current.remove();
          mapRef.current = null;
          markerRef.current = null;
          mapHostRef.current = null;
        }

        if (!mapRef.current) {
          const map = leaflet.map(mapElement, {
            attributionControl: true,
            scrollWheelZoom: false,
            tap: true,
            touchZoom: true,
            zoomControl: true,
          });
          map.setView(point, 18);
          leaflet
            .tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
              attribution: '&copy; OpenStreetMap contributors',
              minZoom: 3,
              maxZoom: 19,
            })
            .addTo(map);

          const icon = leaflet.divIcon({
            className: 'vm-location-marker-shell',
            html: '<span class="vm-location-marker"><span></span></span>',
            iconSize: [42, 50],
            iconAnchor: [21, 46],
          });
          const marker = leaflet
            .marker(point, { autoPan: true, draggable: true, icon })
            .addTo(map);
          marker.on('dragend', () => {
            const nextPoint = marker.getLatLng();
            updatePointFromMap(nextPoint.lat, nextPoint.lng);
          });
          map.on('click', (event) => {
            marker.setLatLng([event.latlng.lat, event.latlng.lng]);
            updatePointFromMap(event.latlng.lat, event.latlng.lng);
          });

          mapRef.current = map;
          markerRef.current = marker;
          mapHostRef.current = mapElement;
          window.setTimeout(() => map.invalidateSize(), 120);
        } else {
          markerRef.current?.setLatLng(point);
          mapRef.current.setView(point, Math.max(mapRef.current.getZoom(), 18), {
            animate: true,
          });
          window.setTimeout(() => mapRef.current?.invalidateSize(), 80);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMapError('Não foi possível carregar o minimapa. Tente novamente em instantes.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [coordinates?.latitude, coordinates?.longitude, updatePointFromMap]);

  useEffect(
    () => () => {
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
      mapHostRef.current = null;
    },
    [],
  );

  function retryAddressSearch() {
    lastGeocodedQueryRef.current = '';
    setRetryVersion((current) => current + 1);
  }

  function useDeviceLocation() {
    if (!navigator.geolocation) {
      setMessage('Este aparelho não disponibilizou o GPS para o navegador.');
      return;
    }

    setLocatingDevice(true);
    setMessage('Obtendo a localização atual do aparelho...');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextLatitude = position.coords.latitude;
        const nextLongitude = position.coords.longitude;
        setLocatingDevice(false);
        setPositionSource('DEVICE');
        setDeviceAccuracyMeters(Math.round(position.coords.accuracy));
        setMessage('Localização do aparelho encontrada. Confira o pino e confirme.');
        onChangeRef.current({
          latitude: nextLatitude,
          longitude: nextLongitude,
          confirmed: false,
        });
      },
      (error) => {
        setLocatingDevice(false);
        const denied = error.code === error.PERMISSION_DENIED;
        setMessage(
          denied
            ? 'A permissão de localização foi negada neste aparelho.'
            : 'Não foi possível obter a localização atual do aparelho.',
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
  }

  function confirmPoint() {
    if (!coordinates) return;
    onChangeRef.current({
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      confirmed: true,
    });
    setMessage('Ponto exato confirmado para o GPS.');
  }

  if (!ready) {
    return (
      <div className="precise-location precise-location-waiting">
        <div className="precise-location-heading">
          <span className="precise-location-icon"><Icon name="pin" /></span>
          <div>
            <strong>Ponto exato do GPS</strong>
            <small>Selecione a rua e informe o número e a cidade.</small>
          </div>
        </div>
      </div>
    );
  }

  const googlePreviewUrl = coordinates
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${coordinates.latitude},${coordinates.longitude}`)}`
    : undefined;
  const statusClass = confirmed
    ? 'is-confirmed'
    : positionSource === 'MAP' || positionSource === 'DEVICE'
      ? 'is-adjusted'
      : 'is-pending';

  return (
    <section className={`precise-location ${statusClass}`}>
      <div className="precise-location-heading">
        <span className="precise-location-icon"><Icon name={confirmed ? 'check' : 'pin'} /></span>
        <div>
          <strong>Ponto exato do GPS — {kind === 'pickup' ? 'coleta' : 'entrega'}</strong>
          <small>
            {confirmed
              ? 'Confirmado. Google Maps e Waze usarão estas coordenadas.'
              : 'Confira o ponto e ajuste até a entrada ou o portão correto.'}
          </small>
        </div>
        <span className="precise-location-status">
          {confirmed ? 'Confirmado' : loadingAddress ? 'Localizando...' : 'Falta confirmar'}
        </span>
      </div>

      {hasCoordinates ? (
        <div className="precise-location-map-wrap">
          <div ref={mapElementRef} className="precise-location-map" aria-label="Mapa para confirmar o ponto exato" />
          <div className="precise-location-map-tip">Arraste o pino ou toque no ponto exato.</div>
        </div>
      ) : (
        <div className="precise-location-loading">
          {loadingAddress ? <span className="spinner" /> : <Icon name="pin" />}
          <span>{loadingAddress ? 'Procurando o número informado...' : 'Aguardando uma localização.'}</span>
        </div>
      )}

      {mapError ? <p className="precise-location-message is-error">{mapError}</p> : null}
      {message ? <p className="precise-location-message">{message}</p> : null}

      {hasCoordinates ? (
        <div className="precise-location-details">
          <span>{positionSource === 'DEVICE' ? 'GPS do aparelho' : positionSource === 'MAP' ? 'Pino ajustado' : accuracyLabel(accuracy)}</span>
          <code>{coordinates!.latitude.toFixed(6)}, {coordinates!.longitude.toFixed(6)}</code>
          {deviceAccuracyMeters != null ? <small>Precisão informada pelo aparelho: aproximadamente {deviceAccuracyMeters} m.</small> : null}
        </div>
      ) : null}

      <div className="precise-location-actions">
        <button type="button" className="button button-ghost button-small" onClick={retryAddressSearch} disabled={loadingAddress}>
          <Icon name="refresh" />Localizar pelo endereço
        </button>
        <button type="button" className="button button-secondary button-small" onClick={useDeviceLocation} disabled={locatingDevice}>
          {locatingDevice ? <span className="spinner small" /> : <Icon name="pin" />}
          Usar GPS deste aparelho
        </button>
        {googlePreviewUrl ? (
          <a className="button button-ghost button-small" href={googlePreviewUrl} target="_blank" rel="noreferrer">
            <Icon name="routes" />Conferir no Google Maps
          </a>
        ) : null}
        <button type="button" className="button button-primary button-small" onClick={confirmPoint} disabled={!hasCoordinates || loadingAddress}>
          <Icon name="check" />{confirmed ? 'Ponto confirmado' : 'Confirmar ponto do GPS'}
        </button>
      </div>
    </section>
  );
}
