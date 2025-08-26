// orbital.worker.js
// Worker para propagación de satélites Starlink usando satellite.js

importScripts('https://cdn.jsdelivr.net/npm/satellite.js@4.0.0/dist/satellite.min.js');

const AU = 149597870.7; // km
let tleDataCache = null; // Guardar TLEs en memoria (líneas)
let satrecsCache = null; // satrec precompilado para rendimiento

// 🎯 NUEVO: Constantes físicas para cálculos orbitales precisos
const G = 6.67430e-11; // N·m²/kg² - Constante gravitacional
const M_EARTH = 5.972e24; // kg - Masa de la Tierra
const R_EARTH = 6371; // km - Radio medio de la Tierra

/**
 * 🎯 NUEVA FUNCIÓN: Extrae el movimiento medio (Mean Motion) del TLE
 * @param {string} line2 - Segunda línea del TLE
 * @returns {number} - Movimiento medio en revoluciones por día
 */
function extractMeanMotion(line2) {
  // Mean Motion está en posiciones 53-63 de la línea 2
  const meanMotionStr = line2.substring(52, 63).trim();
  return parseFloat(meanMotionStr);
}

/**
 * 🎯 NUEVA FUNCIÓN: Calcula la altura orbital usando la tercera ley de Kepler
 * @param {number} meanMotion - Movimiento medio en rev/día
 * @returns {number} - Altura sobre la superficie en km
 */
function calculateOrbitalHeight(meanMotion) {
  // 1. Período orbital en segundos
  const T = 86400 / meanMotion; // segundos
  
  // 2. Radio orbital medio usando la tercera ley de Kepler
  const GM = G * M_EARTH; // m³/s²
  const r_cubed = (GM * T * T) / (4 * Math.PI * Math.PI);
  const r_meters = Math.pow(r_cubed, 1/3); // metros
  const r_km = r_meters / 1000; // kilómetros
  
  // 3. Altura orbital (radio - radio terrestre)
  const height = r_km - R_EARTH;
  
  return height;
}

/**
 * 🎯 NUEVA FUNCIÓN: Calcula la velocidad orbital media
 * @param {number} meanMotion - Movimiento medio en rev/día
 * @returns {number} - Velocidad orbital en km/s
 */
function calculateOrbitalVelocity(meanMotion) {
  // 1. Período orbital en segundos
  const T = 86400 / meanMotion;
  
  // 2. Radio orbital usando la tercera ley de Kepler
  const GM = G * M_EARTH;
  const r_cubed = (GM * T * T) / (4 * Math.PI * Math.PI);
  const r_meters = Math.pow(r_cubed, 1/3);
  const r_km = r_meters / 1000;
  
  // 3. Velocidad orbital: v = 2πr/T
  const circumference = 2 * Math.PI * r_km; // km
  const velocity = circumference / T; // km/s
  
  return velocity;
}

/**
 * 🎯 NUEVA FUNCIÓN: Factor de corrección temporal para sincronizar con velocidad real
 * @param {number} calculatedVelocity - Velocidad calculada en km/s
 * @param {number} realVelocity - Velocidad real esperada en km/s (típicamente 7.66 km/s para Starlink)
 * @returns {number} - Factor de corrección (1.0 = sin corrección)
 */
function calculateTimeCorrectionFactor(calculatedVelocity, realVelocity = 7.66) {
  return realVelocity / calculatedVelocity;
}

function distanceToUE(satPos, uePos) {
  const dx = satPos.x - uePos.x;
  const dy = satPos.y - uePos.y;
  const dz = satPos.z - uePos.z;
  return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

self.onmessage = function(e) {
  const { type, payload } = e.data;
  if (type === 'init_tles') {
    tleDataCache = payload.tleData;
    const t0 = performance.now();
    satrecsCache = tleDataCache.map(({ line1, line2 }) => satellite.twoline2satrec(line1, line2));
    const t1 = performance.now();
    console.log(`[WORKER] satrecs compilados (${satrecsCache.length}) en ${(t1-t0).toFixed(1)} ms`);
    // Métricas de los primeros 2 para validar
    for (let i = 0; i < Math.min(2, satrecsCache.length); i++) {
      const mm = satrecsCache[i].no_kozai || satrecsCache[i].no; // rad/min
      if (mm) {
        const periodMin = (2*Math.PI)/mm;
        console.log(`[WORKER] Sat ${i} período≈${periodMin.toFixed(2)} min`);
      }
    }
    // Propagación inicial inmediata (reduce tiempo "vacío" en UI)
    const now = new Date();
    const gmst = satellite.gstime(now);
    const initialResults = [];
    const CHUNK_SIZE_INIT = 200;
    for (let idx = 0; idx < satrecsCache.length; idx++) {
      const satrec = satrecsCache[idx];
      const prop = satellite.propagate(satrec, now);
      if (prop.position) {
        const geo = satellite.eciToGeodetic(prop.position, gmst);
        initialResults.push({
          index: idx,
          eci_km: { x: prop.position.x, y: prop.position.y, z: prop.position.z },
          gmst,
          lat: geo.latitude,
          lon: geo.longitude,
          height: geo.height,
          visible: true
        });
      } else {
        initialResults.push({ index: idx, eci_km: { x:0,y:0,z:0 }, gmst, visible:false });
      }
      if ((idx+1) % CHUNK_SIZE_INIT === 0) {
        self.postMessage({ type:'propagation_chunk', payload:{ chunk: initialResults.slice(idx+1-CHUNK_SIZE_INIT, idx+1), offset: idx+1-CHUNK_SIZE_INIT, total: satrecsCache.length } });
      }
    }
    // Enviar chunks restantes si no cayeron exactos
    const remainder = initialResults.length % CHUNK_SIZE_INIT;
    if (remainder) {
      const start = initialResults.length - remainder;
      self.postMessage({ type:'propagation_chunk', payload:{ chunk: initialResults.slice(start), offset: start, total: satrecsCache.length } });
    }
    self.postMessage({ type: 'propagation_complete', payload: initialResults });
    self.postMessage({ type: 'tles_ready' });
    return;
  }
  if (type === 'propagate') {
    if (!satrecsCache) {
      self.postMessage({ type: 'debug', payload: 'TLEs no inicializados' });
      return;
    }
    const { date } = payload;
    const now = new Date(date); // fecha objetivo exacta
    const gmst = satellite.gstime(now);

    const tProp0 = performance.now();
    // ECI directo + gmst
    const satResults = satrecsCache.map((satrec, idx) => {
      const prop = satellite.propagate(satrec, now);
      if (!prop.position) {
        return { index: idx, eci_km: { x: 0, y: 0, z: 0 }, gmst, visible: false };
      }
      // Geodésico de referencia usando satellite.js (lat/lon rad)
  const geo = satellite.eciToGeodetic(prop.position, gmst);
      return {
        index: idx,
        eci_km: { x: prop.position.x, y: prop.position.y, z: prop.position.z },
        gmst,
        lat: geo.latitude, // rad
        lon: geo.longitude, // rad
        height: geo.height,
        visible: true
      };
    });
    const tProp1 = performance.now();
    if ((tProp1 - tProp0) > 200) {
      console.log(`[WORKER] Propagación ${satrecsCache.length} sats en ${(tProp1-tProp0).toFixed(0)} ms`);
    }

    // Enviar en chunks secuenciales (orden original). Mantener estructura simple.
    const CHUNK_SIZE = 200;
    for (let offset = 0; offset < satResults.length; offset += CHUNK_SIZE) {
      const chunk = satResults.slice(offset, offset + CHUNK_SIZE);
      self.postMessage({
        type: 'propagation_chunk',
        payload: {
          chunk,
          offset,
          total: satResults.length
        }
      });
    }

    // Frame completo
    self.postMessage({ type: 'propagation_complete', payload: satResults });
  }
};