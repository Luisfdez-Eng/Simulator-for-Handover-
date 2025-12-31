/**
 * 🛰️ Configuración centralizada de constelaciones y TLE
 */

export type ConstellationId = 
  | 'starlink' 
  | 'oneweb' 
  | 'gps-ops' 
  | 'galileo'
  | 'glonass-ops'
  | 'beidou'
  | 'iridium'
  | 'globalstar'
  | 'orbcomm'
  | 'telesat'
  | 'satnogs'
  | 'amateur';

/**
 * Mapeo de IDs internos a grupos de CelesTrak
 */
export const CONSTELLATION_GROUPS: Record<ConstellationId, string> = {
  'starlink': 'starlink',
  'oneweb': 'oneweb',
  'gps-ops': 'gps-ops',
  'galileo': 'galileo',
  'glonass-ops': 'glonass-ops',
  'beidou': 'beidou',
  'iridium': 'iridium',
  'globalstar': 'globalstar',
  'orbcomm': 'orbcomm',
  'telesat': 'telesat',
  'satnogs': 'satnogs',
  'amateur': 'amateur'
};

/**
 * Etiquetas de UI amigables
 */
export const CONSTELLATION_LABELS: Record<ConstellationId, string> = {
  'starlink': 'Starlink',
  'oneweb': 'OneWeb',
  'gps-ops': 'GPS (Operational)',
  'galileo': 'Galileo',
  'glonass-ops': 'GLONASS',
  'beidou': 'BeiDou',
  'iridium': 'Iridium',
  'globalstar': 'Globalstar',
  'orbcomm': 'ORBCOMM',
  'telesat': 'Telesat',
  'satnogs': 'SatNOGS',
  'amateur': 'Amateur Radio'
};

/**
 * TTL de caché: 2 días por defecto
 */
export const TLE_TTL_MS = 2 * 24 * 60 * 60 * 1000; // 172800000 ms

/**
 * Ruta base de la API de proxy
 */
export const TLE_API_BASE = '/api/tle';

/**
 * Nombre de la base de datos IndexedDB
 */
export const TLE_CACHE_DB_NAME = 'tle-cache-db';
export const TLE_CACHE_STORE_NAME = 'tle-entries';
