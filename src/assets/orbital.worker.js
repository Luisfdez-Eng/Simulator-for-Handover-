// orbital.worker.js
// Worker para propagación de satélites Starlink usando satellite.js

importScripts('https://cdn.jsdelivr.net/npm/satellite.js@4.0.0/dist/satellite.min.js');

const AU = 149597870.7; // km
let tleDataCache = null; // Guardar TLEs en memoria

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
    const gmst = satellite.gstime(now);
    const satResults = tleDataCache.map(({ line1, line2 }, idx) => {
      const satrec = satellite.twoline2satrec(line1, line2);
      const prop = satellite.propagate(satrec, now);
      if (!prop.position) {
        if (idx === 0) self.postMessage({ type: 'debug', payload: 'No position for satrec' });
        return { position: { x: 0, y: 0, z: 0 }, visible: false, index: idx, distance: Infinity };
      }
      const ecf = satellite.eciToEcf(prop.position, gmst);
      const position = {
        x: ecf.x / AU,
        y: ecf.y / AU,
        z: ecf.z / AU
      };
      let dist = uePosition ? distanceToUE(position, uePosition) : Infinity;
      if (idx === 0) self.postMessage({ type: 'debug', payload: `First sat pos: ${JSON.stringify(position)}` });
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