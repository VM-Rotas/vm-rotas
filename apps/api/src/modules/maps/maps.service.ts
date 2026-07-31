import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

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

interface PhotonFeature {
  type: 'Feature';
  geometry?: {
    type: 'Point';
    coordinates?: [number, number];
  };
  properties?: {
    name?: string;
    street?: string;
    housenumber?: string;
    postcode?: string;
    district?: string;
    locality?: string;
    city?: string;
    county?: string;
    state?: string;
    country?: string;
    countrycode?: string;
    osm_type?: string;
    osm_id?: number;
  };
}

interface PhotonResponse {
  features?: PhotonFeature[];
}

export interface AddressSuggestion {
  id: string;
  label: string;
  primaryText: string;
  secondaryText?: string;
  latitude: number;
  longitude: number;
  city?: string;
  state?: string;
  source: 'HISTORY' | 'OPENSTREETMAP';
}

export interface GeocodedAddress {
  latitude: number;
  longitude: number;
  formattedAddress: string;
  placeId: string;
  city?: string;
  state?: string;
}

interface CacheEntry {
  expiresAt: number;
  value: AddressSuggestion[];
}

const BRAZIL_STATE_CODES: Record<string, string> = {
  acre: 'AC',
  alagoas: 'AL',
  amapa: 'AP',
  amazonas: 'AM',
  bahia: 'BA',
  ceara: 'CE',
  'distrito federal': 'DF',
  'espirito santo': 'ES',
  goias: 'GO',
  maranhao: 'MA',
  'mato grosso': 'MT',
  'mato grosso do sul': 'MS',
  'minas gerais': 'MG',
  para: 'PA',
  paraiba: 'PB',
  parana: 'PR',
  pernambuco: 'PE',
  piaui: 'PI',
  'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN',
  'rio grande do sul': 'RS',
  rondonia: 'RO',
  roraima: 'RR',
  'santa catarina': 'SC',
  'sao paulo': 'SP',
  sergipe: 'SE',
  tocantins: 'TO',
};

@Injectable()
export class MapsService {
  private readonly photonCache = new Map<string, CacheEntry>();

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  isGeocodingConfigured(): boolean {
    return true;
  }

  async addressSuggestions(
    organizationId: string,
    rawQuery: string,
    requestedLimit = 6,
  ): Promise<AddressSuggestion[]> {
    const query = this.normalizeQuery(rawQuery);
    if (query.length < 3) return [];

    const limit = Math.max(1, Math.min(requestedLimit, 8));
    const history = await this.historySuggestions(organizationId, query, limit);
    if (history.length >= limit) return history.slice(0, limit);

    let remote: AddressSuggestion[] = [];
    try {
      remote = await this.photonSuggestions(query, Math.min(8, limit + 2));
    } catch {
      // O cadastro continua funcionando manualmente quando o serviço gratuito está indisponível.
    }

    return this.dedupeSuggestions([...history, ...remote]).slice(0, limit);
  }

  async geocode(address: string, required = true): Promise<GeocodedAddress | null> {
    const apiKey = this.config.get<string>('GOOGLE_MAPS_SERVER_API_KEY');
    if (apiKey) {
      return this.googleGeocode(address, apiKey, required);
    }

    try {
      const result = (await this.photonSuggestions(this.normalizeQuery(address), 1))[0];
      if (result) {
        return {
          latitude: result.latitude,
          longitude: result.longitude,
          formattedAddress: result.label,
          placeId: result.id,
          city: result.city,
          state: result.state,
        };
      }
    } catch {
      if (required) {
        throw new ServiceUnavailableException(
          'A busca gratuita de endereço está temporariamente indisponível. Tente novamente.',
        );
      }
      return null;
    }

    if (required) {
      throw new ServiceUnavailableException('Endereço não encontrado. Informe mais detalhes.');
    }
    return null;
  }

  private async googleGeocode(
    address: string,
    apiKey: string,
    required: boolean,
  ): Promise<GeocodedAddress | null> {
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

  private async historySuggestions(
    organizationId: string,
    query: string,
    limit: number,
  ): Promise<AddressSuggestion[]> {
    const rows = await this.prisma.serviceOrder.findMany({
      where: {
        organizationId,
        latitude: { not: null },
        longitude: { not: null },
        OR: [
          { recipientName: { contains: query, mode: 'insensitive' } },
          { addressLine: { contains: query, mode: 'insensitive' } },
          { formattedAddress: { contains: query, mode: 'insensitive' } },
          { city: { contains: query, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        recipientName: true,
        addressLine: true,
        formattedAddress: true,
        city: true,
        state: true,
        latitude: true,
        longitude: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: Math.max(limit * 3, 12),
    });

    const suggestions = rows.flatMap<AddressSuggestion>((row) => {
      const latitude = Number(row.latitude);
      const longitude = Number(row.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];

      const label =
        row.formattedAddress?.trim() ||
        [row.addressLine, row.city, row.state].filter(Boolean).join(', ');
      if (!label) return [];

      return [
        {
          id: `history:${row.id}`,
          label,
          primaryText: row.recipientName || row.addressLine,
          secondaryText: label,
          latitude,
          longitude,
          city: row.city,
          state: this.normalizeBrazilState(row.state),
          source: 'HISTORY',
        },
      ];
    });

    return this.dedupeSuggestions(suggestions).slice(0, limit);
  }

  private async photonSuggestions(query: string, limit: number): Promise<AddressSuggestion[]> {
    if (query.length < 3) return [];

    const cacheKey = `${query.toLocaleLowerCase('pt-BR')}|${limit}`;
    const cached = this.photonCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const baseUrl = this.config.get<string>(
      'ADDRESS_SEARCH_BASE_URL',
      'https://photon.komoot.io',
    );
    const params = new URLSearchParams({
      q: query,
      limit: String(Math.max(1, Math.min(limit, 8))),
      lang: 'pt',
      countrycode: this.config.get<string>('ADDRESS_SEARCH_COUNTRY_CODE', 'BR'),
      lat: String(this.config.get<number>('ADDRESS_SEARCH_LAT', -23.865)),
      lon: String(this.config.get<number>('ADDRESS_SEARCH_LON', -51.856)),
      zoom: '8',
      location_bias_scale: '0.2',
    });

    const endpoint = `${baseUrl.replace(/\/+$/, '')}/api?${params.toString()}`;
    const response = await fetch(endpoint, {
      headers: {
        Accept: 'application/geo+json, application/json',
        'Accept-Language': 'pt-BR,pt;q=0.9',
        'User-Agent': 'VM-Rotas/0.3 address-search',
      },
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      throw new ServiceUnavailableException('Falha ao consultar sugestões de endereço.');
    }

    const payload = (await response.json()) as PhotonResponse;
    const value = this.dedupeSuggestions(
      (payload.features ?? []).flatMap((feature) => this.photonFeatureToSuggestion(feature)),
    ).slice(0, limit);

    this.photonCache.set(cacheKey, {
      expiresAt: Date.now() + 30 * 60 * 1_000,
      value,
    });
    this.trimCache();
    return value;
  }

  private photonFeatureToSuggestion(feature: PhotonFeature): AddressSuggestion[] {
    const coordinates = feature.geometry?.coordinates;
    const properties = feature.properties;
    if (!coordinates || !properties) return [];

    const [longitude, latitude] = coordinates;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];

    const city =
      properties.city || properties.locality || properties.district || properties.county;
    const state = this.normalizeBrazilState(properties.state);
    const street = properties.street?.trim();
    const number = properties.housenumber?.trim();
    const streetLine = [street, number].filter(Boolean).join(', ');
    const placeName = properties.name?.trim();
    const placeMatchesStreet = Boolean(
      placeName &&
        street &&
        placeName.localeCompare(street, 'pt-BR', { sensitivity: 'base' }) === 0,
    );
    const primaryText =
      streetLine && (!placeName || placeMatchesStreet)
        ? streetLine
        : placeName || streetLine || city || 'Endereço encontrado';

    const secondaryParts = [
      streetLine && streetLine !== primaryText ? streetLine : undefined,
      properties.district && properties.district !== city ? properties.district : undefined,
      city,
      properties.state,
      properties.postcode,
      properties.country || 'Brasil',
    ];
    const secondaryText = this.uniqueParts(secondaryParts).join(', ');
    const label = this.uniqueParts([primaryText, secondaryText]).join(', ');

    return [
      {
        id: `osm:${properties.osm_type ?? 'X'}:${properties.osm_id ?? `${latitude}:${longitude}`}`,
        label,
        primaryText,
        secondaryText: secondaryText || undefined,
        latitude,
        longitude,
        city,
        state,
        source: 'OPENSTREETMAP',
      },
    ];
  }

  private dedupeSuggestions(suggestions: AddressSuggestion[]): AddressSuggestion[] {
    const seen = new Set<string>();
    const result: AddressSuggestion[] = [];

    for (const suggestion of suggestions) {
      const key = suggestion.label
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase('pt-BR')
        .replace(/\s+/g, ' ')
        .trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(suggestion);
    }

    return result;
  }

  private uniqueParts(parts: Array<string | undefined>): string[] {
    const seen = new Set<string>();
    return parts.flatMap((part) => {
      const value = part?.trim();
      if (!value) return [];
      const key = value.toLocaleLowerCase('pt-BR');
      if (seen.has(key)) return [];
      seen.add(key);
      return [value];
    });
  }

  private normalizeBrazilState(value?: string | null): string | undefined {
    const state = value?.trim();
    if (!state) return undefined;
    if (/^[A-Za-z]{2}$/.test(state)) return state.toUpperCase();

    const normalized = state
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('pt-BR');
    return BRAZIL_STATE_CODES[normalized];
  }

  private normalizeQuery(value: string): string {
    return value.trim().replace(/\s+/g, ' ');
  }

  private trimCache(): void {
    if (this.photonCache.size <= 150) return;
    const oldestKeys = [...this.photonCache.keys()].slice(0, 50);
    oldestKeys.forEach((key) => this.photonCache.delete(key));
  }
}
