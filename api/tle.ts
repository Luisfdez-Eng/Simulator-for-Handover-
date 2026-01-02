import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as https from 'https';
import type { IncomingMessage } from 'http';

// 🔒 Allowlist de grupos permitidos (seguridad)
const ALLOWED_GROUPS: Record<string, string> = {
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
 * Fetch TLE data from CelesTrak using Node.js https module
 */
function fetchFromCelesTrak(group: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${ALLOWED_GROUPS[group]}&FORMAT=tle`;
    
    const options = {
      headers: {
        'User-Agent': '3D-Constellation-Tracker/1.0.0 (Vercel Serverless)',
        'Accept': 'text/plain'
      },
      timeout: 30000
    };

    const req = https.get(url, options, (response: IncomingMessage) => {
      let data = '';

      // Check status code
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      response.on('data', (chunk: Buffer) => {
        data += chunk;
      });

      response.on('end', () => {
        resolve(data);
      });
    });

    req.on('error', (error: Error) => {
      reject(error);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 🎯 Extraer parámetro de constelación
  const group = (req.query['group'] as string)?.toLowerCase()?.trim();

  // ✅ Validación de parámetro
  if (!group || !ALLOWED_GROUPS[group]) {
    return res.status(400).json({
      error: 'Invalid or missing group parameter',
      allowed: Object.keys(ALLOWED_GROUPS),
      example: '/api/tle?group=starlink'
    });
  }

  try {
    // 📡 Fetch desde CelesTrak usando Node.js https module
    const tleData = await fetchFromCelesTrak(group);
    
    // 📊 Métricas (sin loguear contenido completo)
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

    // 📦 Headers de caché agresivos para CDN
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', `public, max-age=0, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=${STALE_WHILE_REVALIDATE}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-TLE-Group', group);
    res.setHeader('X-TLE-Satellites', approxSatCount.toString());
    res.setHeader('X-Cache-TTL', CACHE_TTL_SECONDS.toString());

    // ✅ Devolver TLE como texto plano
    return res.status(200).send(tleData);

  } catch (error: any) {
    // 🚨 Manejo de errores de red/timeout
    console.error(`[TLE-PROXY] Error fetching ${group}:`, error.message);
    
    if (error.message === 'Request timeout') {
      return res.status(504).json({
        error: 'Request timeout',
        group,
        message: 'CelesTrak took too long to respond'
      });
    }

    return res.status(502).json({
      error: 'Failed to fetch TLE data',
      group,
      message: error.message
    });
  }
}
