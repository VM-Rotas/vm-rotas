'use client';

import { useAuth } from '@/components/auth-provider';
import { EmptyState, ErrorBanner, LoadingBlock, SuccessBanner } from '@/components/feedback';
import { Icon } from '@/components/icons';
import { LiveTrackingMap } from '@/components/live-tracking-map';
import { PageHeader } from '@/components/page-header';
import { api, ApiError } from '@/lib/api';
import type {
  LiveTrackingVehicle,
  TrackingSessionSummary,
  Vehicle,
} from '@/lib/types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

function formatAge(seconds?: number | null): string {
  if (seconds == null) return 'Sem posição';
  if (seconds < 10) return 'Agora';
  if (seconds < 60) return `Há ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Há ${minutes} min`;
  return `Há ${Math.floor(minutes / 60)} h`;
}

function trackingState(item: LiveTrackingVehicle): {
  label: string;
  className: string;
} {
  if (!item.position) return { label: 'Sem sinal', className: 'is-empty' };
  if (item.position.stale) return { label: 'Sinal parado', className: 'is-stale' };
  if (item.session?.active) return { label: 'Ao vivo', className: 'is-live' };
  return { label: 'Jornada encerrada', className: 'is-offline' };
}

export default function TrackingPage() {
  const { user } = useAuth();
  const [liveVehicles, setLiveVehicles] = useState<LiveTrackingVehicle[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [activeSession, setActiveSession] = useState<TrackingSessionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const watchIdRef = useRef<number | null>(null);
  const lastSentAtRef = useRef(0);
  const canStartTest = Boolean(user && ['OWNER', 'ADMIN', 'DISPATCHER', 'DRIVER'].includes(user.role));

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const [live, vehicleData, mySession] = await Promise.all([
        api<LiveTrackingVehicle[]>('/tracking/live'),
        canStartTest ? api<Vehicle[]>('/vehicles') : Promise.resolve([] as Vehicle[]),
        canStartTest
          ? api<TrackingSessionSummary | null>('/tracking/my-session')
          : Promise.resolve(null),
      ]);
      setLiveVehicles(live);
      if (canStartTest) {
        const available = vehicleData.filter((vehicle) => vehicle.active && !['MAINTENANCE', 'INACTIVE'].includes(vehicle.status));
        setVehicles(available);
        setSelectedVehicleId((current) => current || mySession?.vehicle?.id || available[0]?.id || '');
      }
      if (canStartTest) setActiveSession(mySession);
      setError('');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível carregar o rastreamento.');
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [canStartTest]);

  useEffect(() => {
    void load(true);
    const timer = window.setInterval(() => void load(false), 10000);
    return () => {
      window.clearInterval(timer);
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, [load]);

  const selectedLiveVehicle = useMemo(
    () => liveVehicles.find((item) => item.vehicle.id === selectedVehicleId) ?? null,
    [liveVehicles, selectedVehicleId],
  );

  async function startBrowserTest() {
    if (!selectedVehicleId) {
      setError('Selecione um veículo.');
      return;
    }
    if (!navigator.geolocation) {
      setError('Este aparelho não oferece geolocalização pelo navegador.');
      return;
    }
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const session = await api<TrackingSessionSummary>('/tracking/start', {
        method: 'POST',
        body: JSON.stringify({
          vehicleId: selectedVehicleId,
          deviceName: `Teste no navegador — ${navigator.userAgent.slice(0, 80)}`,
        }),
      });
      setActiveSession(session);
      lastSentAtRef.current = 0;
      watchIdRef.current = navigator.geolocation.watchPosition(
        (position) => {
          const now = Date.now();
          if (now - lastSentAtRef.current < 10000) return;
          lastSentAtRef.current = now;
          void api('/tracking/location', {
            method: 'POST',
            body: JSON.stringify({
              sessionId: session.id,
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracyM: position.coords.accuracy,
              speedKmh: position.coords.speed == null ? undefined : Math.max(0, position.coords.speed * 3.6),
              heading: position.coords.heading ?? undefined,
              recordedAt: new Date(position.timestamp).toISOString(),
            }),
          }).then(() => load(false)).catch((caught) => {
            setError(caught instanceof ApiError ? caught.message : 'Falha ao enviar uma posição.');
          });
        },
        (failure) => {
          setError(`GPS indisponível: ${failure.message}`);
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
      );
      setSuccess('Rastreamento de teste iniciado. Mantenha esta tela aberta e ligada.');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível iniciar o teste.');
    } finally {
      setBusy(false);
    }
  }

  async function stopBrowserTest() {
    if (!activeSession) return;
    setBusy(true);
    setError('');
    try {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      await api('/tracking/stop', {
        method: 'POST',
        body: JSON.stringify({ sessionId: activeSession.id }),
      });
      setActiveSession(null);
      setSuccess('Jornada de teste encerrada.');
      await load(false);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Não foi possível encerrar o teste.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Acompanhamento"
        title="Mapa ao vivo"
        description="Acompanhe a última posição recebida de cada veículo. A tela atualiza automaticamente a cada 10 segundos."
        actions={
          <button className="button button-secondary" onClick={() => void load(true)} disabled={loading}>
            <Icon name="refresh" />Atualizar
          </button>
        }
      />
      {error ? <ErrorBanner message={error} /> : null}
      {success ? <SuccessBanner message={success} /> : null}

      {loading ? <LoadingBlock label="Carregando posições..." /> : (
        <div className="tracking-layout">
          <section className="panel tracking-map-panel">
            <LiveTrackingMap
              vehicles={liveVehicles}
              selectedVehicleId={selectedVehicleId}
              onSelectVehicle={setSelectedVehicleId}
            />
            <div className="tracking-map-legend">
              <span><i className="legend-live" />Ao vivo</span>
              <span><i className="legend-stale" />Sem atualização</span>
              <span><i className="legend-offline" />Encerrado</span>
            </div>
          </section>

          <aside className="tracking-sidebar-stack">
            <section className="panel">
              <div className="panel-heading">
                <div><span className="eyebrow">Veículos</span><h2>Últimas posições</h2></div>
                <strong>{liveVehicles.filter((item) => item.position && !item.position.stale).length}/{liveVehicles.length}</strong>
              </div>
              {liveVehicles.length === 0 ? (
                <EmptyState title="Nenhum veículo cadastrado" description="Cadastre os veículos antes de iniciar o rastreamento." />
              ) : (
                <div className="tracking-vehicle-list">
                  {liveVehicles.map((item, index) => {
                    const state = trackingState(item);
                    return (
                      <button
                        className={`tracking-vehicle-card${selectedVehicleId === item.vehicle.id ? ' is-selected' : ''}`}
                        key={item.vehicle.id}
                        onClick={() => setSelectedVehicleId(item.vehicle.id)}
                      >
                        <span className="tracking-vehicle-index">{index + 1}</span>
                        <div>
                          <strong>{item.vehicle.name}</strong>
                          <small>{item.vehicle.plate}{item.session?.driver?.name ? ` · ${item.session.driver.name}` : ''}</small>
                          <span>{item.position ? `${formatAge(item.position.ageSeconds)}${item.position.speedKmh != null ? ` · ${Math.round(item.position.speedKmh)} km/h` : ''}` : 'Aguardando primeira posição'}</span>
                        </div>
                        <em className={state.className}>{state.label}</em>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            {selectedLiveVehicle?.position ? (
              <section className="panel tracking-position-detail">
                <span className="eyebrow">Posição selecionada</span>
                <h2>{selectedLiveVehicle.vehicle.name}</h2>
                <dl>
                  <div><dt>Motorista</dt><dd>{selectedLiveVehicle.session?.driver?.name ?? 'Não informado'}</dd></div>
                  <div><dt>Atualização</dt><dd>{formatAge(selectedLiveVehicle.position.ageSeconds)}</dd></div>
                  <div><dt>Precisão</dt><dd>{selectedLiveVehicle.position.accuracyM == null ? '—' : `${Math.round(selectedLiveVehicle.position.accuracyM)} m`}</dd></div>
                  <div><dt>Velocidade</dt><dd>{selectedLiveVehicle.position.speedKmh == null ? '—' : `${Math.round(selectedLiveVehicle.position.speedKmh)} km/h`}</dd></div>
                  <div><dt>Bateria</dt><dd>{selectedLiveVehicle.position.batteryPercent == null ? '—' : `${selectedLiveVehicle.position.batteryPercent}%`}</dd></div>
                </dl>
                <a
                  className="button button-secondary"
                  href={`https://www.google.com/maps/search/?api=1&query=${selectedLiveVehicle.position.latitude},${selectedLiveVehicle.position.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Icon name="pin" />Abrir posição no Google Maps
                </a>
              </section>
            ) : null}

            {canStartTest ? (
              <section className="panel browser-tracking-test">
                <span className="eyebrow">Teste antes do APK</span>
                <h2>Enviar GPS deste aparelho</h2>
                <p>Este modo valida o backend e o mapa, mas funciona somente com a página aberta e a tela ligada.</p>
                <label className="field">
                  <span>Veículo</span>
                  <select value={selectedVehicleId} onChange={(event) => setSelectedVehicleId(event.target.value)} disabled={Boolean(activeSession)}>
                    <option value="">Selecione</option>
                    {vehicles.map((vehicle) => <option value={vehicle.id} key={vehicle.id}>{vehicle.name} — {vehicle.plate}</option>)}
                  </select>
                </label>
                {activeSession ? (
                  <button className="button button-danger" onClick={() => void stopBrowserTest()} disabled={busy}>
                    {busy ? <span className="spinner small" /> : <Icon name="close" />}Encerrar teste
                  </button>
                ) : (
                  <button className="button button-primary" onClick={() => void startBrowserTest()} disabled={busy || !selectedVehicleId}>
                    {busy ? <span className="spinner small" /> : <Icon name="tracking" />}Iniciar teste com tela ligada
                  </button>
                )}
              </section>
            ) : null}
          </aside>
        </div>
      )}
    </>
  );
}
