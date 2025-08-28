import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-sat-summary',
  template: `
    <div class="sat-panel sat-summary">
      <h2 class="tab-title">Satellite Summary</h2>
      <div *ngIf="satIndex!=null; else noSat" class="grid">
        <div class="row"><span class="label">Index</span><span>{{satIndex}}</span></div>
        <div class="placeholder-note">(Resumen básico – añadir nombre, NORAD, estado, generación...)</div>
      </div>
      <ng-template #noSat><div class="placeholder-note">Selecciona un satélite.</div></ng-template>
    </div>
  `,
  styles: [`
    .sat-panel{padding:4px 6px;font:500 12px 'Inter',sans-serif;color:#fff;}
    .tab-title{margin:0 0 6px;font:600 14px 'Inter',sans-serif;letter-spacing:.5px;}
    .label{opacity:.65;margin-right:6px;}
    .grid{display:flex;flex-direction:column;gap:4px;}
    .row{display:flex;justify-content:space-between;}
    .placeholder-note{margin-top:4px;opacity:.55;font-size:11px;}
  `]
})
export class SatSummaryComponent { @Input() satIndex: number | null = null; }
