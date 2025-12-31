import { Injectable } from '@angular/core';
import { TLE_CACHE_DB_NAME, TLE_CACHE_STORE_NAME, TLE_TTL_MS } from '../config/constellations.config';

/**
 * 💾 Entrada de caché con TTL
 */
export interface TleCacheEntry {
  groupId: string;
  tleData: string;
  cachedAt: number; // timestamp
  source: 'remote' | 'fallback';
}

/**
 * 🗄️ Servicio de caché con IndexedDB (primario) y localStorage (fallback)
 */
@Injectable({
  providedIn: 'root'
})
export class TleCacheService {
  private db: IDBDatabase | null = null;
  private dbInitPromise: Promise<IDBDatabase> | null = null;

  constructor() {
    this.dbInitPromise = this.initDB();
  }

  /**
   * Inicializar IndexedDB
   */
  private async initDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(TLE_CACHE_DB_NAME, 1);

      request.onerror = () => {
        console.warn('⚠️ IndexedDB init failed, falling back to localStorage');
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        if (!db.objectStoreNames.contains(TLE_CACHE_STORE_NAME)) {
          db.createObjectStore(TLE_CACHE_STORE_NAME, { keyPath: 'groupId' });
        }
      };
    });
  }

  /**
   * Obtener entrada de caché (IndexedDB con fallback a localStorage)
   */
  async get(groupId: string): Promise<TleCacheEntry | null> {
    // Intentar IndexedDB primero
    try {
      const db = await this.dbInitPromise!;
      const tx = db.transaction(TLE_CACHE_STORE_NAME, 'readonly');
      const store = tx.objectStore(TLE_CACHE_STORE_NAME);
      
      return new Promise((resolve, reject) => {
        const request = store.get(groupId);
        
        request.onsuccess = () => {
          const entry = request.result as TleCacheEntry | undefined;
          
          if (entry && this.isValid(entry)) {
            resolve(entry);
          } else {
            resolve(null);
          }
        };
        
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.warn('⚠️ IndexedDB get failed, trying localStorage', error);
      return this.getFromLocalStorage(groupId);
    }
  }

  /**
   * Guardar entrada en caché (IndexedDB con fallback a localStorage)
   */
  async set(entry: TleCacheEntry): Promise<void> {
    // Intentar IndexedDB primero
    try {
      const db = await this.dbInitPromise!;
      const tx = db.transaction(TLE_CACHE_STORE_NAME, 'readwrite');
      const store = tx.objectStore(TLE_CACHE_STORE_NAME);
      
      return new Promise((resolve, reject) => {
        const request = store.put(entry);
        
        request.onsuccess = () => {
          console.log(`✅ Cached ${entry.groupId} in IndexedDB`);
          resolve();
        };
        
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.warn('⚠️ IndexedDB set failed, using localStorage', error);
      this.setToLocalStorage(entry);
    }
  }

  /**
   * Limpiar entradas caducadas
   */
  async cleanup(): Promise<void> {
    try {
      const db = await this.dbInitPromise!;
      const tx = db.transaction(TLE_CACHE_STORE_NAME, 'readwrite');
      const store = tx.objectStore(TLE_CACHE_STORE_NAME);
      
      return new Promise((resolve, reject) => {
        const request = store.openCursor();
        
        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
          
          if (cursor) {
            const entry = cursor.value as TleCacheEntry;
            
            if (!this.isValid(entry)) {
              cursor.delete();
              console.log(`🗑️ Deleted expired cache: ${entry.groupId}`);
            }
            
            cursor.continue();
          } else {
            resolve();
          }
        };
        
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.warn('⚠️ IndexedDB cleanup failed', error);
    }
  }

  /**
   * Verificar si la entrada es válida (dentro de TTL)
   */
  private isValid(entry: TleCacheEntry): boolean {
    const now = Date.now();
    const age = now - entry.cachedAt;
    return age < TLE_TTL_MS;
  }

  /**
   * FALLBACK: Obtener de localStorage
   */
  private getFromLocalStorage(groupId: string): TleCacheEntry | null {
    try {
      const key = `tle_${groupId}`;
      const raw = localStorage.getItem(key);
      
      if (!raw) return null;
      
      const entry = JSON.parse(raw) as TleCacheEntry;
      
      return this.isValid(entry) ? entry : null;
    } catch (error) {
      console.error('❌ localStorage get failed', error);
      return null;
    }
  }

  /**
   * FALLBACK: Guardar en localStorage
   */
  private setToLocalStorage(entry: TleCacheEntry): void {
    try {
      const key = `tle_${entry.groupId}`;
      localStorage.setItem(key, JSON.stringify(entry));
      console.log(`✅ Cached ${entry.groupId} in localStorage`);
    } catch (error) {
      console.error('❌ localStorage set failed', error);
    }
  }
}
