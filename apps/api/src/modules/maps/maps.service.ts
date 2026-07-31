import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
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

interface GeoapifyResult {
  name?: string;
  country?: string;
  country_code?: string;
  state?: string;
  state_code?: string;
  county?: string;
  city?: string;
  postcode?: string;
  district?: string;
  suburb?: string;
  quarter?: string;
  street?: string;
  housenumber?: string;
  lon?: number;
  lat?: number;
  formatted?: string;
  address_line1?: string;
  address_line2?: string;
  place_id?: string;
}

interface GeoapifyResponse {
  results?: GeoapifyResult[];
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
  neighborhood?: string;
  state?: string;
  postalCode?: string;
  source: 'HISTORY' | 'GEOAPIFY' | 'OPENSTREETMAP';
}

export interface GeocodedAddress {
  latitude: number;
  longitude: number;
  formattedAddress: string;
  placeId: string;
  city?: string;
  neighborhood?: string;
  state?: string;
  postalCode?: string;
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
  private readonly logger = new Logger(MapsService.name);
  private readonly suggestionCache = new Map<string, CacheEntry>();

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

    const remaining = Math.max(1, limit - history.length);
    const remote = await this.remoteSuggestions(query, Math.min(8, remaining + 2));

    return this.dedupeSuggestions([...history, ...remote]).slice(0, limit);
  }

  async geocode(address: string, required = true): Promise<GeocodedAddress | null> {
    const normalizedAddress = this.normalizeQuery(address);
    const googleApiKey = this.config.get<string>('GOOGLE_MAPS_SERVER_API_KEY');
    if (googleApiKey) {
      return this.googleGeocode(normalizedAddress, googleApiKey, required);
    }

    const geoapifyApiKey = this.config.get<string>('GEOAPIFY_API_KEY')?.trim();
    if (geoapifyApiKey) {
      try {
        const result = (await this.geoapifySuggestions(normalizedAddress, 1, geoapifyApiKey))[0];
        if (result) return this.suggestionToGeocodedAddress(result);
      } catch (error) {
        this.logger.warn(`Geoapify não respondeu ao geocodificar: ${this.errorMessage(error)}`);
      }
    }

    try {
      const result = (await this.photonSuggestions(normalizedAddress, 1))[0];
      if (result) return this.suggestionToGeocodedAddress(result);
    } catch (error) {
      this.logger.warn(`Photon não respondeu ao geocodificar: ${this.errorMessage(error)}`);
      if (required) {
        throw new ServiceUnavailableException(
          'Não foi possível localizar o endereço agora. Digite rua, número e cidade e tente novamente.',
        );
      }
      return null;
    }

    if (required) {
      throw new ServiceUnavailableException(
        'Endereço não encontrado. Informe rua, número e cidade.',
      );
    }
    return null;
  }

  private async remoteSuggestions(query: string, limit: number): Promise<AddressSuggestion[]> {
    const geoapifyApiKey = this.config.get<string>('GEOAPIFY_API_KEY')?.trim();

    if (geoapifyApiKey) {
      try {
        const geoapifyResults = await this.geoapifySuggestions(query, limit, geoapifyApiKey);
        if (geoapifyResults.length > 0) return geoapifyResults;
      } catch (error) {
        this.logger.warn(`Geoapify autocomplete falhou: ${this.errorMessage(error)}`);
      }
    }

    try {
      return await this.photonSuggestions(query, limit);
    } catch (error) {
      this.logger.warn(`Photon autocomplete falhou: ${this.errorMessage(error)}`);
      return [];
    }
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
        neighborhood: true,
        state: true,
        postalCode: true,
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
          neighborhood: row.neighborhood ?? undefined,
          state: this.normalizeBrazilState(row.state),
          postalCode: row.postalCode ?? undefined,
          source: 'HISTORY',
        },
      ];
    });

    return this.dedupeSuggestions(suggestions).slice(0, limit);
  }

  private async geoapifySuggestions(
    query: string,
    limit: number,
    apiKey: string,
  ): Promise<AddressSuggestion[]> {
    if (query.length < 3) return [];

    const cacheKey = `geoapify|${query.toLocaleLowerCase('pt-BR')}|${limit}`;
    const cached = this.suggestionCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const lat = this.config.get<number>('ADDRESS_SEARCH_LAT', -23.865);
    const lon = this.config.get<number>('ADDRESS_SEARCH_LON', -51.856);
    const params = new URLSearchParams({
      text: query,
      format: 'json',
      limit: String(Math.max(1, Math.min(limit, 8))),
      lang: 'pt',
      filter: 'countrycode:br',
      bias: `proximity:${lon},${lat}`,
      apiKey,
    });

    const response = await fetch(
      `https://api.geoapify.com/v1/geocode/autocomplete?${params.toString()}`,
      {
        headers: {
          Accept: 'application/json',
          'Accept-Language': 'pt-BR,pt;q=0.9',
        },
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Geoapify respondeu com HTTP ${response.status}.`,
      );
    }

    const payload = (await response.json()) as GeoapifyResponse;
    const value = this.dedupeSuggestions(
      (payload.results ?? []).flatMap((result) => this.geoapifyResultToSuggestion(result)),
    ).slice(0, limit);

    this.storeCache(cacheKey, value);
    return value;
  }

  private geoapifyResultToSuggestion(result: GeoapifyResult): AddressSuggestion[] {
    const latitude = Number(result.lat);
    const longitude = Number(result.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];

    const streetLine = [result.street, result.housenumber].filter(Boolean).join(', ');
    const primaryText =
      result.address_line1?.trim() ||
      streetLine ||
      result.name?.trim() ||
      result.formatted?.trim() ||
      result.city?.trim() ||
      'Endereço encontrado';
    const secondaryText =
      result.address_line2?.trim() ||
      this.uniqueParts([
        result.suburb,
        result.district,
        result.city,
        result.state,
        result.postcode,
        result.country,
      ]).join(', ');
    const label =
      result.formatted?.trim() ||
      this.uniqueParts([primaryText, secondaryText]).join(', ');

    return [
      {
        id: `geoapify:${result.place_id ?? `${latitude}:${longitude}`}`,
        label,
        primaryText,
        secondaryText: secondaryText || undefined,
        latitude,
        longitude,
        city: result.city || result.county,
        neighborhood: result.suburb || result.district || result.quarter,
        state: this.normalizeBrazilState(result.state_code || result.state),
        postalCode: result.postcode,
        source: 'GEOAPIFY',
      },
    ];
  }

  private async photonSuggestions(query: string, limit: number): Promise<AddressSuggestion[]> {
    if (query.length < 3) return [];

    const cacheKey = `photon|${query.toLocaleLowerCase('pt-BR')}|${limit}`;
    const cached = this.suggestionCache.get(cacheKey);
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
        'User-Agent': 'VM-Rotas/0.5 internal-address-search',
      },
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      throw new ServiceUnavailableException(`Photon respondeu com HTTP ${response.status}.`);
    }

    const payload = (await response.json()) as PhotonResponse;
    const value = this.dedupeSuggestions(
      (payload.features ?? []).flatMap((feature) => this.photonFeatureToSuggestion(feature)),
    ).slice(0, limit);

    this.storeCache(cacheKey, value);
    return value;
  }

  private photonFeatureToSuggestion(feature: PhotonFeature): AddressSuggestion[] {
    const coordinates = feature.geometry?.coordinates;
    const properties = feature.properties;
    if (!coordinates || !properties) return [];

    const [longitude, latitude] = coordinates;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];

    const city =
      properties.city || properties.locality || properties.county || properties.district;
    const neighborhood =
      properties.district && properties.district !== city
        ? properties.district
        : properties.locality && properties.locality !== city
          ? properties.locality
          : undefined;
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
        neighborhood,
        state,
        postalCode: properties.postcode,
        source: 'OPENSTREETMAP',
      },
    ];
  }

  private suggestionToGeocodedAddress(suggestion: AddressSuggestion): GeocodedAddress {
    return {
      latitude: suggestion.latitude,
      longitude: suggestion.longitude,
      formattedAddress: suggestion.label,
      placeId: suggestion.id,
      city: suggestion.city,
      neighborhood: suggestion.neighborhood,
      state: suggestion.state,
      postalCode: suggestion.postalCode,
    };
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

  private storeCache(key: string, value: AddressSuggestion[]): void {
    this.suggestionCache.set(key, {
      expiresAt: Date.now() + 30 * 60 * 1_000,
      value,
    });
    this.trimCache();
  }

  private trimCache(): void {
    if (this.suggestionCache.size <= 150) return;
    const oldestKeys = [...this.suggestionCache.keys()].slice(0, 50);
    oldestKeys.forEach((key) => this.suggestionCache.delete(key));
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
