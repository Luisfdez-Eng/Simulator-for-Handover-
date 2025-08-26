import { Injectable } from '@angular/core';

export interface CityEntry { name: string; lat: number; lon: number; country?: string; code?: string; }

@Injectable({ providedIn: 'root' })
export class CityLoaderService {
  private cities: CityEntry[] = [];
  private loaded = false;
  private loadingPromise: Promise<void> | null = null;

  private async loadIfNeeded() {
    if (this.loaded) return;
    if (this.loadingPromise) return this.loadingPromise;
    this.loadingPromise = (async () => {
      try {
        const res = await fetch('assets/cities.json');
        if (res.ok) {
          const json = await res.json();
          if (Array.isArray(json)) {
            this.cities = json.filter(c => c && typeof c.name === 'string' && typeof c.lat === 'number' && typeof c.lon === 'number');
          } else if (json && Array.isArray(json.cities)) {
            this.cities = json.cities.filter((c: any) => c && typeof c.name === 'string' && typeof c.lat === 'number' && typeof c.lon === 'number');
          } else {
            console.warn('[CITY] Formato inesperado cities.json');
          }
        } else {
          console.warn('[CITY] No se pudo cargar cities.json');
        }
      } catch (e) {
        console.warn('[CITY] Error cargando cities.json', e);
      }
      this.loaded = true;
    })();
    return this.loadingPromise;
  }

  public async getCities(): Promise<CityEntry[]> {
    await this.loadIfNeeded();
    return this.cities;
  }

  public async search(term: string, limit = 200): Promise<CityEntry[]> {
    await this.loadIfNeeded();
    const t = term.trim().toLowerCase();
    if (!t) return this.cities.slice(0, limit);
    const res = this.cities.filter(c => c.name.toLowerCase().includes(t) || (c.country && c.country.toLowerCase().includes(t)));
    return res.slice(0, limit);
  }
}
