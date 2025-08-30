import { Component, Input, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { TleLoaderService } from '../../services/tle-loader.service';

interface SatelliteInfo {
  name: string;
  noradId: string;
  internationalDesignator: string;
  constellation: string;
  meanMotion: number;
  eccentricity: number;
  inclination: number;
  raan: number;
  argOfPerigee: number;
  meanAnomaly: number;
  revolutionNumber: number;
  epochYear: number;
  epochDay: number;
  bstar: number;
  orbitType: string;
  period: number; // en minutos
}

@Component({
  selector: 'app-sat-info',
  template: `
    <div class="sat-panel sat-info">
      <div *ngIf="satelliteInfo; else noSat" class="content">
        <!-- Espacio reservado para futura imagen del satélite -->
        <div class="image-placeholder">
          <div class="image-icon">🛰️</div>
          <div class="image-text">Satellite Image</div>
        </div>
        
        <div class="info-grid">
          <div class="info-row">
            <span class="label">Orbit Type:</span>
            <span class="value orbit-type" [ngClass]="satelliteInfo.orbitType.toLowerCase()">{{satelliteInfo.orbitType}}</span>
          </div>
          <div class="info-row">
            <span class="label">Orbit Period:</span>
            <span class="value">{{satelliteInfo.period | number:'1.2-2'}} min</span>
          </div>
          <div class="info-row">
            <span class="label">Inclination:</span>
            <span class="value">{{satelliteInfo.inclination | number:'1.2-2'}}°</span>
          </div>
          <div class="info-row">
            <span class="label">Eccentricity:</span>
            <span class="value">{{satelliteInfo.eccentricity | number:'1.4-4'}}</span>
          </div>
          <div class="info-row">
            <span class="label">Mean Motion:</span>
            <span class="value">{{satelliteInfo.meanMotion | number:'1.4-4'}} rev/day</span>
          </div>
          <div class="info-row">
            <span class="label">Revolution #:</span>
            <span class="value">{{satelliteInfo.revolutionNumber}}</span>
          </div>
        </div>
      </div>
      <ng-template #noSat>
        <div class="placeholder-note">Select a satellite to view additional information.</div>
      </ng-template>
    </div>
  `,
  styles: [`
    .sat-panel { padding: 8px 12px; font: 500 12px 'Inter', sans-serif; color: #fff; }
    .placeholder-note { margin-top: 8px; opacity: .55; font-size: 11px; text-align: center; padding: 20px; }
    
    .content { display: flex; flex-direction: column; gap: 12px; }
    
    .image-placeholder { 
      display: flex; 
      flex-direction: column; 
      align-items: center; 
      padding: 16px; 
      background: rgba(255,255,255,0.03); 
      border: 1px dashed rgba(255,255,255,0.15); 
      border-radius: 12px; 
      text-align: center; 
    }
    .image-icon { font-size: 24px; margin-bottom: 4px; }
    .image-text { font-size: 10px; color: #a8b4c8; opacity: 0.7; }
    
    .info-grid { display: flex; flex-direction: column; gap: 6px; }
    .info-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; background: rgba(255,255,255,0.03); border-radius: 6px; border: 1px solid rgba(255,255,255,0.08); }
    .label { font-size: 11px; color: #a8b4c8; font-weight: 500; }
    .value { font-size: 11px; color: #e4ecf6; font-weight: 600; text-align: right; }
    
    .orbit-type.leo { color: #4ade80; }
    .orbit-type.meo { color: #fbbf24; }
    .orbit-type.geo { color: #f87171; }
    .orbit-type.heo { color: #a78bfa; }
  `]
})
export class SatInfoComponent implements OnInit, OnChanges {
  @Input() satIndex: number | null = null;
  
  satelliteInfo: SatelliteInfo | null = null;

  constructor(private tle: TleLoaderService) {}

  ngOnInit() {
    this.loadSatelliteInfo();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['satIndex']) {
      this.loadSatelliteInfo();
    }
  }

  private loadSatelliteInfo() {
    if (this.satIndex === null) {
      this.satelliteInfo = null;
      return;
    }

    const satellites = this.tle.getAllSatrecs();
    if (this.satIndex >= satellites.length) {
      this.satelliteInfo = null;
      return;
    }

    const satData = satellites[this.satIndex];
    if (!satData) {
      this.satelliteInfo = null;
      return;
    }

    try {
      // Extraer datos del TLE
      const line1 = satData.line1;
      const line2 = satData.line2;
      const satrec = satData.satrec;

      // Parsear información básica
      const noradId = this.tle.extractNoradId(line1) || 'Unknown';
      const name = satData.name || `SAT-${this.satIndex + 1}`;
      const constellation = this.tle.getConstellationLabel(this.tle.getActiveConstellation() || 'unknown');

      // International Designator (columnas 10-17 de line1)
      const internationalDesignator = line1.substring(9, 17).trim();

      // Epoch (columnas 19-32 de line1)
      const epochYearStr = line1.substring(18, 20);
      const epochDayStr = line1.substring(20, 32);
      const epochYear = 2000 + parseInt(epochYearStr);
      const epochDay = parseFloat(epochDayStr);

      // BSTAR drag term (columnas 54-61 de line1)
      const bstarStr = line1.substring(53, 61).trim();
      const bstar = this.parseBstar(bstarStr);

      // Revolution number (columnas 64-68 de line1)
      const revolutionNumber = parseInt(line1.substring(63, 68).trim());

      // Elementos orbitales de line2
      const inclination = parseFloat(line2.substring(8, 16).trim());
      const raan = parseFloat(line2.substring(17, 25).trim());
      const eccentricityStr = '0.' + line2.substring(26, 33).trim();
      const eccentricity = parseFloat(eccentricityStr);
      const argOfPerigee = parseFloat(line2.substring(34, 42).trim());
      const meanAnomaly = parseFloat(line2.substring(43, 51).trim());
      const meanMotion = parseFloat(line2.substring(52, 63).trim());

      // Calcular período orbital en minutos
      const period = (24 * 60) / meanMotion; // 1440 minutos/día dividido por revoluciones/día

      // Determinar tipo de órbita basado en el período
      const orbitType = this.determineOrbitType(period);

      this.satelliteInfo = {
        name,
        noradId,
        internationalDesignator,
        constellation,
        meanMotion,
        eccentricity,
        inclination,
        raan,
        argOfPerigee,
        meanAnomaly,
        revolutionNumber,
        epochYear,
        epochDay,
        bstar,
        orbitType,
        period
      };

    } catch (error) {
      console.error('Error parsing satellite TLE data:', error);
      this.satelliteInfo = null;
    }
  }

  private parseBstar(bstarStr: string): number {
    if (!bstarStr || bstarStr.trim() === '') return 0;
    
    try {
      // BSTAR está en formato científico comprimido
      // Ejemplo: " 12345-3" significa 0.12345 × 10^-3
      const match = bstarStr.match(/([+-]?\d+)([+-]\d+)/);
      if (match) {
        const mantissa = parseFloat('0.' + Math.abs(parseInt(match[1])).toString().padStart(5, '0'));
        const exponent = parseInt(match[2]);
        return mantissa * Math.pow(10, exponent) * (parseInt(match[1]) < 0 ? -1 : 1);
      }
      return parseFloat(bstarStr);
    } catch {
      return 0;
    }
  }

  private determineOrbitType(periodMinutes: number): string {
    if (periodMinutes < 200) return 'LEO';  // Low Earth Orbit
    if (periodMinutes < 720) return 'MEO';  // Medium Earth Orbit  
    if (periodMinutes > 1400 && periodMinutes < 1450) return 'GEO';  // Geostationary
    if (periodMinutes > 720) return 'HEO';  // High Earth Orbit
    return 'LEO';
  }
}
