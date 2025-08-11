import { Injectable } from '@angular/core';
import { twoline2satrec, propagate, gstime, eciToEcf, type SatRec, type EciVec3, type PositionAndVelocity } from 'satellite.js';

export interface SatData {
  satrec: SatRec;
  line1: string;
  line2: string;
  name?: string; // Nombre opcional (line0)
}

@Injectable({ providedIn: 'root' })
export class TleLoaderService {
  private satData: SatData[] = [];
  private activeConstellation: string | null = null;
  private constellationMap: Map<string, { file: string; label?: string }> = new Map();
  private manifestLoaded = false;
  private readonly AU = 149_597_870.7; // km
  /** Carga (una vez) el manifiesto de constelaciones desde assets/constellations.json.
   * Formato esperado: { "constellations": [ { "name":"starlink", "file":"gp_starlink.txt", "label":"Starlink" }, ... ] }
   * Si no existe, crea una entrada por defecto para starlink (gp_starlink.txt y gp.txt como fallback).
   */
  private async loadManifestIfNeeded() {
    if (this.manifestLoaded) return;
    try {
      const res = await fetch('assets/constellations.json');
      if (res.ok) {
        const json = await res.json();
        if (json && Array.isArray(json.constellations)) {
          json.constellations.forEach((c: any) => {
            if (c.name && c.file) this.constellationMap.set(c.name.toLowerCase(), { file: `assets/${c.file}`, label: c.label });
          });
        }
      } else {
        console.warn('[TLE] No se encontró constellations.json, usando configuración por defecto');
      }
    } catch (e) {
      console.warn('[TLE] Error cargando constellations.json, usando configuración por defecto');
    }
    // Asegurar al menos starlink
  if (!this.constellationMap.has('starlink')) this.constellationMap.set('starlink', { file: 'assets/gp_starlink.txt', label: 'Starlink' });
    this.manifestLoaded = true;
  }

  /** Fuerza recarga del manifiesto (por si se edita constellations.json en caliente). */
  public async forceReloadManifest(): Promise<void> {
    this.manifestLoaded = false;
    this.constellationMap.clear();
    await this.loadManifestIfNeeded();
  }

  /** Carga la constelación indicada. Si el fichero específico no existe, intenta fallback. */
  async loadConstellation(name: string): Promise<void> {
    await this.loadManifestIfNeeded();
    this.activeConstellation = name.toLowerCase();
    const entry = this.constellationMap.get(this.activeConstellation);
    const guessed = `assets/gp_${this.activeConstellation}.txt`;
    const primary = entry?.file || guessed;
    let raw: string | null = null;
    try {
      const res = await fetch(primary);
      if (res.ok) raw = await res.text(); else console.error(`[TLE] Error HTTP ${res.status} al cargar ${primary}`);
    } catch (e) {
      console.error(`[TLE] Excepción cargando ${primary}`, e);
    }
    if (!raw) { this.satData = []; return; }

    const lines = raw.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(l => l.length);
    const data: SatData[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('1 ') && i + 1 < lines.length && lines[i + 1].startsWith('2 ')) {
        const l1 = line; const l2 = lines[i + 1];
        // Buscar nombre (antes o después)
        let nameLine: string | undefined;
        if (i - 1 >= 0 && !/^([12]) /.test(lines[i - 1])) nameLine = lines[i - 1];
        else if (i + 2 < lines.length && !/^([12]) /.test(lines[i + 2])) nameLine = lines[i + 2];
        try {
          const satrec = twoline2satrec(l1, l2);
          data.push({ satrec, line1: l1, line2: l2, name: nameLine });
        } catch (e) {
          // omitir
        }
        i += 1; // saltar la línea 2
      }
    }
    this.satData = data;
    console.log(`[TLE] (${this.activeConstellation}) satélites cargados: ${data.length}`);
  }

  /** Método legacy para compatibilidad: carga Starlink por defecto. */
  async load(): Promise<void> { return this.loadConstellation('starlink'); }
  getActiveConstellation(): string | null { return this.activeConstellation; }
  getAvailableConstellations(): string[] { return Array.from(this.constellationMap.keys()); }
  getConstellationLabel(name: string): string { return this.constellationMap.get(name)?.label || name; }

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
