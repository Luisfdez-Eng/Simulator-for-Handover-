// orbital.worker.js
// Worker para propagación de satélites Starlink usando satellite.js

importScripts('https://cdn.jsdelivr.net/npm/satellite.js@4.0.0/dist/satellite.min.js');

const AU = 149597870.7; // km
let tleDataCache = null; // Guardar TLEs en memoria

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
    
    // 🎯 NUEVO: Calcular métricas orbitales para cada satélite
    console.log('[WORKER] Calculando métricas orbitales para', tleDataCache.length, 'satélites...');
    
    // Ejemplo con los primeros 3 satélites para validación
    for (let i = 0; i < Math.min(3, tleDataCache.length); i++) {
      const { line1, line2 } = tleDataCache[i];
      const meanMotion = extractMeanMotion(line2);
      const height = calculateOrbitalHeight(meanMotion);
      const velocity = calculateOrbitalVelocity(meanMotion);
      
      console.log(`[ORBITAL-CALC] Satélite ${i}:`);
      console.log(`  Mean Motion: ${meanMotion.toFixed(8)} rev/día`);
      console.log(`  Altura calculada: ${height.toFixed(2)} km`);
      console.log(`  Velocidad calculada: ${velocity.toFixed(3)} km/s`);
      console.log(`  Período orbital: ${(86400/meanMotion/60).toFixed(1)} minutos`);
    }
    
    self.postMessage({ type: 'tles_ready' });
    return;
  }
  if (type === 'propagate') {
    if (!tleDataCache) {
      self.postMessage({ type: 'debug', payload: 'TLEs no inicializados' });
      return;
    }
    const { date, frustumPlanes, uePosition } = payload;
    const now = new Date(date);
    
    // 🎯 CORREGIDO: Cálculo más preciso del GMST
    const gmst = satellite.gstime(now);
    
    const satResults = tleDataCache.map(({ line1, line2 }, idx) => {
      const satrec = satellite.twoline2satrec(line1, line2);
      const prop = satellite.propagate(satrec, now);
      if (!prop.position) {
        if (idx === 0) self.postMessage({ type: 'debug', payload: 'No position for satrec' });
        return { position: { x: 0, y: 0, z: 0 }, visible: false, index: idx, distance: Infinity };
      }
      
      // 🎯 NUEVO: Calcular métricas orbitales (sin filtrado - mostrar todos los satélites)
      const meanMotion = extractMeanMotion(line2);
      const realHeight = calculateOrbitalHeight(meanMotion);
      const realVelocity = calculateOrbitalVelocity(meanMotion);
      
      // 🎯 CORREGIDO: Usar coordenadas ECF que ya incluyen rotación terrestre
      const ecf = satellite.eciToEcf(prop.position, gmst);
      
      // 🎯 NUEVO: Usar coordenadas reales directas del SGP4 sin escalas artificiales
      // Las coordenadas ECF ya están en km, simplemente las normalizamos al sistema Three.js
      const earthRadiusKm = 6371; // Radio de la Tierra en km
      const visualEarthRadius = 0.1; // Radio visual de la Tierra en Three.js
      const kmToVisualScale = visualEarthRadius / earthRadiusKm; // Factor de conversión km -> visual
      
      const position = {
        x: ecf.x * kmToVisualScale, // Coordenadas reales convertidas a escala visual
        y: ecf.y * kmToVisualScale,
        z: ecf.z * kmToVisualScale
      };
      
      let dist = uePosition ? distanceToUE(position, uePosition) : Infinity;
      if (idx === 0) {
        // Solo log cada 60 frames (~1 segundo) para reducir spam
        if (!self.logFrameCounter) self.logFrameCounter = 0;
        self.logFrameCounter++;
        if (self.logFrameCounter % 60 === 0) {
          const realVelocity = calculateOrbitalVelocity(meanMotion);
          const magnitude = Math.sqrt(position.x * position.x + position.y * position.y + position.z * position.z);
          const heightInSim = (magnitude / kmToVisualScale) - earthRadiusKm; // Altura calculada en el simulador
          
          self.postMessage({ 
            type: 'debug', 
            payload: `[REAL-COORDS] Sat 0: TLE_altura=${realHeight.toFixed(1)}km, SIM_altura=${heightInSim.toFixed(1)}km, vel=${realVelocity.toFixed(2)}km/s, pos_visual=(${position.x.toFixed(6)}, ${position.y.toFixed(6)}, ${position.z.toFixed(6)})` 
          });
        }
      }
      return { position, visible: true, index: idx, distance: dist };
    });
    // Ordenar por distancia al UE
    satResults.sort((a, b) => a.distance - b.distance);
    // Chunks prioritarios y normales
    const PRIORITY_CHUNK = 200;
    const CHUNK_SIZE = 100;
    let offset = 0;
    // Enviar los más cercanos primero
    let chunk = satResults.slice(0, PRIORITY_CHUNK);
    self.postMessage({
      type: 'propagation_chunk',
      payload: {
        chunk: chunk.map(s => ({ position: s.position, visible: s.visible })),
        offset: 0,
        total: satResults.length
      }
    });
    offset += PRIORITY_CHUNK;
    // Enviar el resto en chunks pequeños
    while (offset < satResults.length) {
      let chunk = satResults.slice(offset, offset + CHUNK_SIZE);
      self.postMessage({
        type: 'propagation_chunk',
        payload: {
          chunk: chunk.map(s => ({ position: s.position, visible: s.visible })),
          offset: offset,
          total: satResults.length
        }
      });
      offset += CHUNK_SIZE;
    }
    // Finalmente, enviar el frame completo (orden original)
    const ordered = Array(satResults.length);
    satResults.forEach(s => { ordered[s.index] = { position: s.position, visible: s.visible }; });
    self.postMessage({ type: 'propagation_complete', payload: ordered });
  }
};