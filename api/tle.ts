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

export const config = {
  runtime: 'edge',
};

export default async function handler(req: Request) {
  // 🎯 Extraer parámetro de constelación
  const url = new URL(req.url);
  const group = url.searchParams.get('group')?.toLowerCase()?.trim();

  // ✅ Validación de parámetro
  if (!group || !ALLOWED_GROUPS[group]) {
    return new Response(JSON.stringify({
      error: 'Invalid or missing group parameter',
      allowed: Object.keys(ALLOWED_GROUPS),
      example: '/api/tle?group=starlink'
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    console.log(`[TLE-PROXY] Starting fetch for group: ${group}`);
    console.log(`[TLE-PROXY] Mapped to CelesTrak group: ${ALLOWED_GROUPS[group]}`);
    
    // 🌐 Construir URL de CelesTrak
    const celestrakUrl = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${ALLOWED_GROUPS[group]}&FORMAT=tle`;
    console.log(`[TLE-PROXY] URL: ${celestrakUrl}`);

    // 📡 Fetch desde CelesTrak con timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000); // 25s timeout (Vercel tiene límite de 10s para hobby plan)

    console.log(`[TLE-PROXY] Iniciando fetch...`);
    const celestrakResponse = await fetch(celestrakUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': '3D-Constellation-Tracker/1.0.0 (Vercel)',
        'Accept': 'text/plain'
      }
    });

    clearTimeout(timeoutId);
    console.log(`[TLE-PROXY] Response status: ${celestrakResponse.status}`);

    // ❌ Manejo de errores HTTP
    if (!celestrakResponse.ok) {
      console.error(`[TLE-PROXY] CelesTrak returned ${celestrakResponse.status}`);
      return new Response(JSON.stringify({
        error: 'CelesTrak service unavailable',
        status: celestrakResponse.status,
        group,
        url: celestrakUrl
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 📥 Obtener contenido TLE
    const tleData = await celestrakResponse.text();
    console.log(`[TLE-PROXY] Received ${tleData.length} bytes`);
    
    // 📊 Métricas (sin loguear contenido completo)
    const lineCount = tleData.split('\n').filter(l => l.trim()).length;
    const approxSatCount = Math.floor(lineCount / 3);
    const sizeKB = (tleData.length / 1024).toFixed(2);
    
    console.log(`[TLE-PROXY] ✅ Success: ${group} - ${approxSatCount} sats (~${sizeKB} KB)`);

    // 🎯 Validación básica del contenido
    if (!tleData.includes('1 ') || !tleData.includes('2 ')) {
      console.warn(`[TLE-PROXY] ⚠️ Response doesn't look like valid TLE data`);
      return new Response(JSON.stringify({
        error: 'Invalid TLE format received from CelesTrak',
        group
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 📦 Headers de caché agresivos para CDN + metadata
    const headers = new Headers({
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': `public, max-age=0, s-maxage=${CACHE_TTL_SECONDS}, stale-while-revalidate=${STALE_WHILE_REVALIDATE}`,
      'X-Content-Type-Options': 'nosniff',
      'X-TLE-Group': group,
      'X-TLE-Satellites': approxSatCount.toString(),
      'X-Cache-TTL': CACHE_TTL_SECONDS.toString()
    });

    // ✅ Devolver TLE como texto plano
    return new Response(tleData, {
      status: 200,
      headers
    });

  } catch (error: any) {
    // 🚨 Manejo de errores de red/timeout
    console.error(`[TLE-PROXY] ❌ Error fetching ${group}:`);
    console.error(`[TLE-PROXY] Error name: ${error.name}`);
    console.error(`[TLE-PROXY] Error message: ${error.message}`);
    
    if (error.name === 'AbortError') {
      return new Response(JSON.stringify({
        error: 'Request timeout',
        group,
        message: 'CelesTrak took too long to respond (>25s)'
      }), {
        status: 504,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      error: 'Failed to fetch TLE data from CelesTrak',
      group,
      errorName: error.name,
      errorMessage: error.message,
      celestrakGroup: ALLOWED_GROUPS[group],
      url: `https://celestrak.org/NORAD/elements/gp.php?GROUP=${ALLOWED_GROUPS[group]}&FORMAT=tle`
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
