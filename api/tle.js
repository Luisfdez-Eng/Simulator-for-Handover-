/**
 * 🌐 Versión JavaScript de la API TLE para desarrollo local
 * (La versión TypeScript se usa en producción)
 */

const https = require('https');

// 🔒 Allowlist de grupos permitidos (seguridad)
const ALLOWED_GROUPS = {
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
  'amateur': 'amateur',
  'amateurradio': 'amateur',
  'ses': 'ses',
  'intelsat': 'intelsat',
  'eutelsat': 'eutelsat',
  'experimental': 'x-comm',
  'kuiper': 'kuiper'
};

// 📊 Configuración de caché
const CACHE_TTL_SECONDS = 2 * 24 * 60 * 60; // 2 días
const STALE_WHILE_REVALIDATE = 24 * 60 * 60; // 1 día

/**
 * Fetch con promesa (para Node.js sin fetch nativo)
 */
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode, data });
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    }).on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  console.log('[TLE-HANDLER] Request received:', {
    query: req.query,
    url: req.url,
    method: req.method
  });

  // 🎯 Extraer parámetro de constelación
  const group = req.query?.group?.toLowerCase()?.trim() || req.query['group']?.toLowerCase()?.trim();

  console.log('[TLE-HANDLER] Extracted group:', group);

  // ✅ Validación de parámetro
  if (!group || !ALLOWED_GROUPS[group]) {
    console.error('[TLE-HANDLER] Invalid group:', group);
    return res.status(400).json({
      error: 'Invalid or missing group parameter',
      allowed: Object.keys(ALLOWED_GROUPS),
      example: '/api/tle?group=starlink',
      received: { group, query: req.query }
    });
  }

  try {
    // 🌐 Construir URL de CelesTrak
    const celestrakUrl = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${ALLOWED_GROUPS[group]}&FORMAT=tle`;

    console.log(`[TLE-PROXY] Fetching ${group} from ${celestrakUrl}...`);

    // 📡 Fetch desde CelesTrak
    console.log('[TLE-PROXY] Starting fetch...');
    const response = await fetchUrl(celestrakUrl);
    console.log('[TLE-PROXY] Fetch completed, status:', response.statusCode);
    
    const tleData = response.data;

    // 📊 Métricas
    const lineCount = tleData.split('\n').filter(l => l.trim()).length;
    const approxSatCount = Math.floor(lineCount / 3);
    const sizeKB = (tleData.length / 1024).toFixed(2);
    
    console.log(`[TLE-PROXY] ✅ Success: ${group} - ${approxSatCount} sats (~${sizeKB} KB)`);

    // 🎯 Validación básica del contenido
    if (!tleData.includes('1 ') || !tleData.includes('2 ')) {
      console.warn(`[TLE-PROXY] ⚠️ Response doesn't look like valid TLE data`);
      return res.status(502).json({
        error: 'Invalid TLE format received from CelesTrak',
        group
      });
    }

    // 📦 Headers de caché agresivos
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', `public, max-age=0, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=${STALE_WHILE_REVALIDATE}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-TLE-Group', group);
    res.setHeader('X-TLE-Satellites', approxSatCount.toString());
    res.setHeader('X-Cache-TTL', CACHE_TTL_SECONDS.toString());

    // ✅ Devolver TLE como texto plano
    return res.status(200).send(tleData);

  } catch (error) {
    // 🚨 Manejo de errores de red/timeout
    console.error(`[TLE-PROXY] ❌ Error fetching ${group}:`, {
      message: error.message,
      stack: error.stack,
      code: error.code
    });
    
    return res.status(502).json({
      error: 'Failed to fetch TLE data from CelesTrak',
      group,
      message: error.message,
      code: error.code
    });
  }
};
