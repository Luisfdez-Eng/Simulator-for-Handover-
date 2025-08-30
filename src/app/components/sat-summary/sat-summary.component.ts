import { Component, Input, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { TleLoaderService } from '../../services/tle-loader.service';

@Component({
  selector: 'app-sat-summary',
  template: `
    <div class="sat-panel sat-summary">
      <div *ngIf="satelliteData; else noSat" class="info-grid">
        <div class="info-row">
          <span class="label">Name:</span>
          <span class="value">{{satelliteData.name}}</span>
        </div>
        <div class="info-row">
          <span class="label">NORAD ID:</span>
          <span class="value">{{satelliteData.noradId}}</span>
        </div>
        <div class="info-row">
          <span class="label">International Designator:</span>
          <span class="value">{{satelliteData.internationalDesignator}}</span>
        </div>
        <div class="info-row">
          <span class="label">Constellation:</span>
          <span class="value">{{satelliteData.constellation}}</span>
        </div>
      </div>
      <ng-template #noSat><div class="placeholder-note">Select a satellite.</div></ng-template>
    </div>
  `,
  styles: [`
    .sat-panel { padding: 8px 12px; font: 500 12px 'Inter', sans-serif; color: #fff; }
    .placeholder-note { margin-top: 8px; opacity: .55; font-size: 11px; text-align: center; padding: 20px; }
    
    .info-grid { display: flex; flex-direction: column; gap: 8px; }
    .info-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: rgba(255,255,255,0.04); border-radius: 8px; border: 1px solid rgba(255,255,255,0.10); }
    .label { font-size: 12px; color: #a8b4c8; font-weight: 500; }
    .value { font-size: 12px; color: #e4ecf6; font-weight: 600; text-align: right; }
  `]
})
export class SatSummaryComponent implements OnInit, OnChanges {
  @Input() satIndex: number | null = null;
  
  satelliteData: {
    name: string;
    noradId: string;
    internationalDesignator: string;
    constellation: string;
  } | null = null;

  constructor(private tle: TleLoaderService) {}

  ngOnInit() {
    this.loadSatelliteData();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['satIndex']) {
      this.loadSatelliteData();
    }
  }

  private loadSatelliteData() {
    if (this.satIndex === null) {
      this.satelliteData = null;
      return;
    }

    const satellites = this.tle.getAllSatrecs();
    if (this.satIndex >= satellites.length) {
      this.satelliteData = null;
      return;
    }

    const satData = satellites[this.satIndex];
    if (!satData) {
      this.satelliteData = null;
      return;
    }

    try {
      const line1 = satData.line1;
      const noradId = this.tle.extractNoradId(line1) || 'Unknown';
      const name = satData.name || `SAT-${this.satIndex + 1}`;
      const constellation = this.tle.getConstellationLabel(this.tle.getActiveConstellation() || 'unknown');
      const internationalDesignator = line1.substring(9, 17).trim();

      this.satelliteData = {
        name,
        noradId,
        internationalDesignator,
        constellation
      };

    } catch (error) {
      console.error('Error loading satellite basic data:', error);
      this.satelliteData = null;
    }
  }
}
