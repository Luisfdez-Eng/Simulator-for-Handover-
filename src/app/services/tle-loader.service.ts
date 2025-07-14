import { Injectable } from '@angular/core';
import { twoline2satrec, propagate, gstime, eciToEcf, type SatRec, type EciVec3, type PositionAndVelocity } from 'satellite.js';

export interface SatData {
  satrec: SatRec;
  line1: string;
  line2: string;
}

@Injectable({ providedIn: 'root' })
export class TleLoaderService {
  private satData: SatData[] = [];
  private readonly AU = 149_597_870.7; // km

  async load(): Promise<void> {
    const res = await fetch('assets/gp.txt');
    const raw = await res.text();

    const blocks = raw
      .replace(/\r/g, '')
      .split(/\n(?=[^12])/)
      .filter(b => b.trim().length)
      .map(b => b.split('\n'));

    this.satData = blocks
      .filter(([name]) => name.toUpperCase().includes('STARLINK'))
      .map(([_, l1, l2]) => ({
        satrec: twoline2satrec(l1, l2),
        line1: l1,
        line2: l2
      }));
  }

  getAllSatrecs(): SatData[] {
    return this.satData;
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
