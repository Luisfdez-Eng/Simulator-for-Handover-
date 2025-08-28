import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-sat-charts',
  template: `
    <div class="sat-panel sat-charts">
      <h2 class="tab-title">Charts</h2>
      <div *ngIf="satIndex!=null; else noSat" class="content">
        <div class="placeholder-note">(Placeholder de mini-gráficas: altitud vs tiempo, velocidad, elevación UE)</div>
      </div>
      <ng-template #noSat><div class="placeholder-note">Selecciona un satélite.</div></ng-template>
    </div>
  `,
  styles: [`
    .sat-panel{padding:4px 6px;font:500 12px 'Inter',sans-serif;color:#fff;}
    .tab-title{margin:0 0 6px;font:600 14px 'Inter',sans-serif;letter-spacing:.5px;}
    .placeholder-note{margin-top:4px;opacity:.55;font-size:11px;}
  `]
})
export class SatChartsComponent { @Input() satIndex: number | null = null; }
