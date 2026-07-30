import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface GoogleGeocodeResponse {
  status: string;
  error_message?: string;
  results: Array<{
    formatted_address: string;
    place_id: string;
    geometry: {
      location: {
        lat: number;
        lng: number;
      };
    };
  }>;
}

export interface GeocodedAddress {
  latitude: number;
  longitude: number;
  formattedAddress: string;
  placeId: string;
}

@Injectable()
export class MapsService {
  constructor(private readonly config: ConfigService) {}

  isGeocodingConfigured(): boolean {
    return Boolean(this.config.get<string>('GOOGLE_MAPS_SERVER_API_KEY'));
  }

  async geocode(address: string, required = true): Promise<GeocodedAddress | null> {
    const apiKey = this.config.get<string>('GOOGLE_MAPS_SERVER_API_KEY');
    if (!apiKey) {
      if (required) {
        throw new ServiceUnavailableException(
          'Geocodificação não configurada. Defina GOOGLE_MAPS_SERVER_API_KEY.',
        );
      }
      return null;
    }

    const params = new URLSearchParams({
      address,
      key: apiKey,
      language: 'pt-BR',
      region: 'br',
    });

    let response: Response;
    try {
      response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`, {
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ServiceUnavailableException('O serviço de geocodificação não respondeu a tempo.');
    }
    if (!response.ok) {
      throw new ServiceUnavailableException('Falha ao consultar o serviço de geocodificação.');
    }

    const payload = (await response.json()) as GoogleGeocodeResponse;
    if (payload.status !== 'OK' || !payload.results[0]) {
      if (required) {
        throw new ServiceUnavailableException(
          payload.error_message ?? `Endereço não geocodificado: ${payload.status}.`,
        );
      }
      return null;
    }

    const first = payload.results[0];
    return {
      latitude: first.geometry.location.lat,
      longitude: first.geometry.location.lng,
      formattedAddress: first.formatted_address,
      placeId: first.place_id,
    };
  }
}
