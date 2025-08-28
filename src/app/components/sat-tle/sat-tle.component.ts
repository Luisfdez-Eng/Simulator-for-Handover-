import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-sat-tle',
  template: `
    <div class="sat-panel sat-tle">
      <h2 class="tab-title">TLE</h2>
      <div *ngIf="satIndex!=null; else noSat" class="content">
        <div class="placeholder-note">(Mostrar aquí las dos líneas TLE y fecha epoch)</div>
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
export class SatTleComponent { @Input() satIndex: number | null = null; }
