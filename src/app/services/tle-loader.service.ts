import { Injectable } from '@angular/core';
import { twoline2satrec, propagate, gstime, eciToEcf, type SatRec, type EciVec3, type PositionAndVelocity } from 'satellite.js';
import { TleRemoteService, TleLoadingStatus } from './tle-remote.service';
import { TleParserService, ParsedTle } from './tle-parser.service';
import { ConstellationId, CONSTELLATION_LABELS } from '../config/constellations.config';

export interface SatData {
  satrec: SatRec;
  line1: string;
  line2: string;
  name?: string; // Nombre opcional (line0)
}

/**
 * 🛰️ Servicio principal de carga de TLE (ahora con sistema dinámico)
 */
@Injectable({ providedIn: 'root' })
export class TleLoaderService {
  private satData: SatData[] = [];
  private activeConstellation: ConstellationId | null = null;
  private readonly AU = 149_597_870.7; // km

  /**
   * Estado de carga observable
   */
  public loadingStatus: TleLoadingStatus = {
    loading: false,
    progress: 0,
    source: null,
    error: null,
    lastUpdate: null
  };
  constructor(
    private remoteService: TleRemoteService,
    private parser: TleParserService
  ) {}

  /**
   * Cargar constelación con sistema dinámico (cache-first)
   */
  async loadConstellation(name: ConstellationId, forceRefresh = false): Promise<void> {
    this.activeConstellation = name;
    this.loadingStatus = {
      loading: true,
      progress: 20,
      source: null,
      error: null,
      lastUpdate: this.loadingStatus.lastUpdate
    };

    try {
      // Obtener TLE (cache o remoto)
      const result = await this.remoteService.getTle(name, forceRefresh);
      
      this.loadingStatus.progress = 60;
      this.loadingStatus.source = result.source;

      // Debug: mostrar primeras líneas
      console.log(`[TLE-DEBUG] Data length: ${result.data.length} bytes`);
      console.log(`[TLE-DEBUG] First 500 chars:`, result.data.substring(0, 500));

      // Validar contenido
      if (!this.parser.validateRawTle(result.data)) {
        console.error('[TLE-DEBUG] Validation failed for data:', result.data.substring(0, 200));
        throw new Error('Invalid TLE data format');
      }

      // Parsear TLE
      const parsed = this.parser.parse(result.data);
      this.loadingStatus.progress = 80;

      // Compilar satélites
      const compiled = this.compileSatellites(parsed);
      this.satData = compiled;
      
      this.loadingStatus = {
        loading: false,
        progress: 100,
        source: result.source,
        error: null,
        lastUpdate: Date.now()
      };

      console.log(`✅ Loaded ${compiled.length} satellites for ${name} (source: ${result.source})`);
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      
      this.loadingStatus = {
        loading: false,
        progress: 0,
        source: null,
        error: errorMsg,
        lastUpdate: this.loadingStatus.lastUpdate
      };

      console.error(`❌ Failed to load ${name}:`, error);
      this.satData = [];
    }
  }

  /**
   * Compilar TLEs parseados a SatRec
   */
  private compileSatellites(parsed: ParsedTle[]): SatData[] {
    const compiled: SatData[] = [];

    for (const tle of parsed) {
      try {
        const satrec = twoline2satrec(tle.line1, tle.line2);
        
        compiled.push({
          satrec,
          line1: tle.line1,
          line2: tle.line2,
          name: tle.name
        });
      } catch (error) {
        console.warn(`⚠️ Failed to compile TLE for ${tle.name}:`, error);
      }
    }

    return compiled;
  }

  /**
   * Forzar refresh desde origen remoto
   */
  async forceRefresh(): Promise<void> {
    if (!this.activeConstellation) {
      console.warn('⚠️ No active constellation to refresh');
      return;
    }

    await this.loadConstellation(this.activeConstellation, true);
  }

  /**
   * Método legacy: carga Starlink por defecto
   */
  async load(): Promise<void> {
    return this.loadConstellation('starlink');
  }

  /**
   * Obtener constelación activa
   */
  getActiveConstellation(): ConstellationId | null {
    return this.activeConstellation;
  }

  /**
   * Obtener constelaciones disponibles
   */
  getAvailableConstellations(): ConstellationId[] {
    return Object.keys(CONSTELLATION_LABELS) as ConstellationId[];
  }

  /**
   * Obtener etiqueta de constelación
   */
  getConstellationLabel(name: ConstellationId): string {
    return CONSTELLATION_LABELS[name] || name;
  }

  getAllSatrecs(): SatData[] {
    return this.satData;
  }

  /** Devuelve un nombre amigable para mostrar (puede incluir número NORAD). */
  public getDisplayName(index: number): string {
    const sat = this.satData[index];
    if (!sat) return '';
    // Preferir nombre de line0 si existe
    const base = sat.name && sat.name.trim().length ? sat.name.trim() : this.extractNoradId(sat.line1) || `SAT-${index+1}`;
    const norad = this.extractNoradId(sat.line1);
    return norad ? `${base} (${norad})` : base;
  }

  public extractNoradId(line1: string): string | null {
    if (!line1 || line1.length < 7) return null;
    // NORAD en columnas 3-7 típicamente (carácter 2-7 índice base 0). Retirar espacios.
    const id = line1.substring(2, 7).trim();
    return id || null;
  }

  propagateToECI(satrec: SatRec, date: Date): PositionAndVelocity {
    return propagate(satrec, date);
  }

  eciToAU(eciPos: EciVec3<number>, date: Date) {
    const gmst = gstime(date);
    const ecf = eciToEcf(eciPos, gmst);
    return {
      x: Number(ecf.x) / this.AU,
      y: Number(ecf.y) / this.AU,
      z: Number(ecf.z) / this.AU
    };
  }
}
