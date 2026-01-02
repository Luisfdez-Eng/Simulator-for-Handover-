import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { TleCacheService, TleCacheEntry } from './tle-cache.service';
import { ConstellationId, TLE_API_BASE } from '../config/constellations.config';

/**
 * 🌐 Estado de carga de TLE
 */
export interface TleLoadingStatus {
  loading: boolean;
  progress: number; // 0-100
  source: 'cache' | 'remote' | 'fallback' | null;
  error: string | null;
  lastUpdate: number | null; // timestamp
}

/**
 * 🔄 Servicio de fetching remoto con cache-first strategy
 */
@Injectable({
  providedIn: 'root'
})
export class TleRemoteService {
  private fetchInProgress = new Map<string, Promise<string>>();

  constructor(
    private http: HttpClient,
    private cache: TleCacheService
  ) {}

  /**
   * Obtener TLE con estrategia cache-first
   * @returns TLE data string
   */
  async getTle(
    groupId: ConstellationId,
    forceRefresh = false
  ): Promise<{ data: string; source: 'cache' | 'remote' | 'fallback' }> {
    
    // 1. Si no es refresh forzado, intentar caché primero
    if (!forceRefresh) {
      const cached = await this.cache.get(groupId);
      
      if (cached) {
        console.log(`📦 Using cached TLE for ${groupId}`);
        return { data: cached.tleData, source: 'cache' };
      }
    }

    // 2. Intentar fetch remoto (con deduplicación)
    try {
      const tleData = await this.fetchRemote(groupId);
      
      // Guardar en caché
      const entry: TleCacheEntry = {
        groupId,
        tleData,
        cachedAt: Date.now(),
        source: 'remote'
      };
      
      await this.cache.set(entry);
      
      console.log(`🌐 Fetched fresh TLE for ${groupId}`);
      return { data: tleData, source: 'remote' };
      
    } catch (error) {
      console.error(`❌ Remote fetch failed for ${groupId}:`, error);
      
      // 3. Fallback a assets estáticos
      return this.loadFallback(groupId);
    }
  }

  /**
   * Fetch remoto con deduplicación (evita múltiples requests simultáneos)
   */
  private async fetchRemote(groupId: string): Promise<string> {
    // Si ya hay un fetch en progreso, reutilizarlo
    if (this.fetchInProgress.has(groupId)) {
      console.log(`⏳ Reusing in-progress fetch for ${groupId}`);
      return this.fetchInProgress.get(groupId)!;
    }

    // Crear nueva promesa de fetch
    const fetchPromise = this.doFetch(groupId);
    this.fetchInProgress.set(groupId, fetchPromise);

    try {
      const result = await fetchPromise;
      return result;
    } finally {
      this.fetchInProgress.delete(groupId);
    }
  }

  /**
   * Ejecutar fetch HTTP
   */
  private async doFetch(groupId: string): Promise<string> {
    const url = `${TLE_API_BASE}?group=${groupId}`;
    
    try {
      const response = await firstValueFrom(
        this.http.get(url, {
          responseType: 'text',
          headers: {
            'Accept': 'text/plain'
          }
        })
      );

      if (!response || response.trim().length === 0) {
        throw new Error('Empty response from API');
      }

      return response;
      
    } catch (error) {
      if (error instanceof HttpErrorResponse) {
        console.error(`[TLE-REMOTE] HTTP error:`, error.status, error.statusText);
        throw new Error(`HTTP ${error.status}: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Cargar TLE de assets estáticos (último recurso)
   */
  private async loadFallback(
    groupId: string
  ): Promise<{ data: string; source: 'fallback' }> {
    console.warn(`⚠️ Using fallback assets for ${groupId}`);
    
    try {
      // Intentar cargar de assets (solo para grupos compatibles)
      const fallbackPath = this.getFallbackPath(groupId);
      
      const response = await firstValueFrom(
        this.http.get(fallbackPath, { responseType: 'text' })
      );

      // Guardar en caché con marca de fallback
      const entry: TleCacheEntry = {
        groupId,
        tleData: response,
        cachedAt: Date.now(),
        source: 'fallback'
      };
      
      await this.cache.set(entry);
      
      return { data: response, source: 'fallback' };
      
    } catch (error) {
      console.error(`❌ Fallback load failed for ${groupId}:`, error);
      throw new Error(`Cannot load TLE data for ${groupId}`);
    }
  }

  /**
   * Determinar ruta de fallback (assets estáticos)
   */
  private getFallbackPath(groupId: string): string {
    // Usar convención de nombres: gp_<groupId>.txt
    // Los archivos existentes en assets son:
    // gp_starlink.txt, gp_oneweb.txt, gp_kuiper.txt, etc.
    return `/assets/gp_${groupId}.txt`;
  }

  /**
   * Limpiar caché y forzar refresh
   */
  async forceRefresh(groupId: ConstellationId): Promise<void> {
    console.log(`🔄 Force refresh for ${groupId}`);
    await this.getTle(groupId, true);
  }
}
