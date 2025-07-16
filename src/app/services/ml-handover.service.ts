import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { SatRec } from 'satellite.js';

export interface SatelliteMetrics {
  elevation: number;
  distance: number;
  rssi: number;
  snr: number;
  throughput: number;
  latency: number;
}

export interface Decision {
  shouldHandover: boolean;
  targetIndex: number | null;
  metrics?: SatelliteMetrics;
}

@Injectable({ providedIn: 'root' })
export class MLHandoverService {
  private lastIndex: number | null = null;
  private lastHandoverTime = 0;
  private readonly hysteresisDeg = 5;
  private readonly cooldownPeriod = 30000; // 30 segundos en ms
  private readonly minElevation = 25; // grados
  private readonly minSnr = 5; // dB
  private readonly maxLatency = 100; // ms
  makeLocalDecision(
    uePos: THREE.Vector3,
    satsPos: THREE.Vector3[]
  ): Decision {
    // 🎯 DESHABILITADO: Sistema de handover para mantener visualización limpia
    // Siempre retornar que no hay handover
    return { 
      shouldHandover: false, 
      targetIndex: null,
      metrics: undefined 
    };

    /* CÓDIGO ORIGINAL COMENTADO PARA PRESERVAR:
    const now = Date.now();
    const metrics = satsPos.map((pos, i) => this.computeMetrics(uePos, pos, i));
    
    // Aplicar filtros básicos
    const validCandidates = metrics.filter(m => 
      m.elevation >= this.minElevation &&
      m.snr >= this.minSnr &&
      m.latency <= this.maxLatency
    );

    if (validCandidates.length === 0) {
      return { shouldHandover: false, targetIndex: this.lastIndex };
    }

    // Normalizar y ponderar métricas
    const weights = { elevation: 0.3, snr: 0.3, throughput: 0.2, latency: 0.2 };
    const scores = validCandidates.map(m => this.computeScore(m, weights));
    
    // Encontrar el mejor candidato
    const bestScore = Math.max(...scores);
    const bestIdx = scores.indexOf(bestScore);
    const bestMetrics = validCandidates[bestIdx];

    // Aplicar histéresis y cooldown
    const isCurrentBetter = this.lastIndex !== null && 
      metrics[this.lastIndex].elevation > bestMetrics.elevation - this.hysteresisDeg;
    const isCooldownActive = now - this.lastHandoverTime < this.cooldownPeriod;

    const shouldHandover = !isCurrentBetter && !isCooldownActive && bestIdx !== this.lastIndex;

    if (shouldHandover) {
      this.lastHandoverTime = now;
      this.lastIndex = bestIdx;
    }

    return {
      shouldHandover,
      targetIndex: shouldHandover ? bestIdx : this.lastIndex,
      metrics: bestMetrics
    };
    */
  }

  private computeElevation(ue: THREE.Vector3, sat: THREE.Vector3) {
    const dir = sat.clone().sub(ue).normalize();
    return THREE.MathUtils.radToDeg(ue.clone().normalize().dot(dir));
  }

  private computeMetrics(ue: THREE.Vector3, sat: THREE.Vector3, index: number): SatelliteMetrics {
    const elevation = this.computeElevation(ue, sat);
    const distance = sat.distanceTo(ue);
    
    // Simulación de métricas basadas en distancia y elevación
    const pathLoss = this.computePathLoss(distance, elevation);
    const rssi = -50 - pathLoss; // dBm, asumiendo potencia de transmisión de -50dBm
    const snr = this.computeSNR(rssi);
    const throughput = this.computeThroughput(snr);
    const latency = this.computeLatency(distance);

    return {
      elevation,
      distance,
      rssi,
      snr,
      throughput,
      latency
    };
  }

  private computePathLoss(distance: number, elevation: number): number {
    // Modelo simplificado de pérdida de trayecto
    const fspl = 20 * Math.log10(distance) + 20 * Math.log10(12.5) + 92.45; // FSPL para 12.5 GHz
    const atmosphericLoss = Math.max(0, (90 - elevation) * 0.1); // Mayor pérdida a menor elevación
    return fspl + atmosphericLoss;
  }

  private computeSNR(rssi: number): number {
    const noiseFloor = -130; // dBm
    return rssi - noiseFloor;
  }

  private computeThroughput(snr: number): number {
    // Modelo simplificado basado en Shannon-Hartley
    const bandwidth = 50e6; // 50 MHz
    return bandwidth * Math.log2(1 + Math.pow(10, snr / 10)) / 1e6; // Mbps
  }

  private computeLatency(distance: number): number {
    const speedOfLight = 299792.458; // km/s
    const processingDelay = 2; // ms
    return (distance / speedOfLight) * 1000 + processingDelay;
  }

  private computeScore(metrics: SatelliteMetrics, weights: Record<string, number>): number {
    // Normalización min-max para cada métrica
    const normalized = {
      elevation: metrics.elevation / 90,
      snr: Math.min(metrics.snr / 30, 1),
      throughput: Math.min(metrics.throughput / 1000, 1),
      latency: Math.max(0, 1 - metrics.latency / this.maxLatency)
    };

    // Calcular score ponderado
    return Object.entries(weights).reduce((score, [metric, weight]) => 
      score + weight * normalized[metric as keyof typeof normalized], 0);
  }
}
