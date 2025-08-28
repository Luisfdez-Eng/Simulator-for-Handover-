import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-sat-hardware',
  template: `
    <div class="sat-panel sat-hardware">
      <h2 class="tab-title">Hardware</h2>
      <div *ngIf="satIndex!=null; else noSat" class="content">
        <div class="placeholder-note">(Bus, antenas, generación, masa, potencia – placeholders)</div>
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
export class SatHardwareComponent { @Input() satIndex: number | null = null; }
