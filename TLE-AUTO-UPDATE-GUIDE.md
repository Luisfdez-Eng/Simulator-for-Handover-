# 🛰️ Sistema de Actualización Automática de TLE

## 📊 Cómo Funciona el Sistema

### Arquitectura de Tres Capas

```
┌─────────────────────────────────────────────────────────┐
│  1. CACHE LOCAL (IndexedDB/localStorage)               │
│     ✓ TTL: 2 días (172,800,000 ms)                    │
│     ✓ Rápido (0ms de red)                             │
│     ✓ Funciona offline                                │
└─────────────────────────────────────────────────────────┘
                        ↓ (si expiró o force refresh)
┌─────────────────────────────────────────────────────────┐
│  2. PROXY VERCEL (/api/tle)                           │
│     ✓ Fetches desde CelesTrak.org                     │
│     ✓ Cacheado en CDN Edge (2 días)                   │
│     ✓ Actualizado automáticamente cada 2 días         │
└─────────────────────────────────────────────────────────┘
                        ↓ (si falla el proxy)
┌─────────────────────────────────────────────────────────┐
│  3. FALLBACK ESTÁTICO (assets/gp_*.txt)               │
│     ✓ Último recurso                                   │
│     ✓ NUNCA se actualiza (son parte del build)        │
│     ✓ Solo para emergencias                           │
└─────────────────────────────────────────────────────────┘
```

---

## 🔄 Flujo de Actualización Automática

### Primera Carga (Usuario Nuevo)
```
Usuario visita app
  → Cache vacío
  → Llama /api/tle?group=starlink
  → Vercel proxy fetches CelesTrak
  → Guarda en IndexedDB con timestamp
  → Muestra satélites
```

### Cargas Subsecuentes (Mismo Día)
```
Usuario visita app
  → Lee de IndexedDB
  → Timestamp < 2 días? ✓
  → Usa cache (instantáneo)
  → NO descarga nada
```

### Después de 2 Días (Actualización Automática)
```
Usuario visita app
  → Lee de IndexedDB
  → Timestamp > 2 días? ✗ EXPIRADO
  → Llama /api/tle?group=starlink
  → Descarga TLE nuevos
  → SOBRESCRIBE cache con datos frescos
  → Guarda nuevo timestamp
  → Muestra satélites actualizados
```

### Si Todo Falla (Sin Internet)
```
Usuario visita app
  → IndexedDB vacío o expirado
  → /api/tle falla (sin red)
  → Usa assets/gp_starlink.txt
  → Muestra satélites (datos antiguos pero funciona)
```

---

## 🎯 Respuestas a Preguntas Comunes

### ❓ ¿Se actualizan los archivos en `src/assets/`?
**NO**, y es correcto que no lo hagan porque:
- Son parte del build compilado (inmutables)
- Solo sirven como backup de emergencia
- Actualizarlos requeriría rebuild + redeploy (ineficiente)
- El sistema de cache hace el trabajo de actualización

### ❓ ¿Cada cuánto se actualizan los TLE realmente?
**Cada 2 días automáticamente**, cuando el usuario carga la app y el cache expiró.

### ❓ ¿Cómo fuerzo una actualización manual?
Desde la consola del navegador:
```javascript
await tle.forceRefresh()
// O desde UI: click en "Force Refresh" badge
```

### ❓ ¿Qué pasa si CelesTrak está caído?
1. Primero intenta con cache (aunque esté expirado un poco)
2. Si no hay cache, usa archivos estáticos
3. Reintentará en la próxima carga

### ❓ ¿Cómo sé qué fuente se usó?
En la consola del navegador verás:
- `📦 Using cached TLE for starlink` → Cache local
- `🌐 Fetched fresh TLE for starlink` → Descargado nuevo
- `⚠️ Using fallback assets for starlink` → Archivo estático

---

## 🚀 Comandos de Desarrollo

### Desarrollo Local (Angular Dev Server) - **RECOMENDADO**
```bash
npm start
# http://localhost:4200
# ⚠️ El proxy /api/tle NO está disponible localmente
# ✓ Usa fallback estático automáticamente (gp_*.txt)
# ✓ Hot reload funciona perfectamente
# ✓ Simula comportamiento cuando API falla
```

**En desarrollo local**: La app intentará llamar a `/api/tle` que fallará (404), y automáticamente usará el fallback de `assets/gp_starlink.txt`. Esto es CORRECTO y esperado.

### Producción (Vercel Deploy) - **CON PROXY**
```bash
vercel --prod
# ✓ Proxy /api/tle SÍ funciona
# ✓ Cache CDN activo  
# ✓ Actualización automática cada 2 días
# ✓ Todo el sistema de 3 capas activo
```

**En producción**: La función serverless `/api/tle.ts` está disponible, descarga de CelesTrak, y el sistema completo funciona.

---

## 📈 Métricas del Sistema

### Tiempos de Carga Típicos
- **Cache hit**: ~0-50ms (instantáneo)
- **Remote fetch**: ~500-2000ms (primera vez o expirado)
- **Fallback**: ~100-300ms (lectura de archivo local)

### Tamaños de Datos
- **Starlink TLE**: ~2.5 MB (~6000 satélites)
- **OneWeb TLE**: ~300 KB (~600 satélites)
- **IndexedDB limit**: 50 MB+ (suficiente para muchas constelaciones)

### Frecuencia de Actualización
- **TTL Cache**: 2 días (configurable en `constellations.config.ts`)
- **CDN Cache**: 2 días (configurable en `api/tle.ts`)
- **CelesTrak actualiza**: ~Cada 4-6 horas (upstream)

---

## 🔧 Configuración

### Cambiar TTL de Cache (duración antes de revalidar)
```typescript
// src/app/config/constellations.config.ts
export const TLE_TTL_MS = 2 * 24 * 60 * 60 * 1000; // 2 días
// Cambiar a: 1 * 24 * 60 * 60 * 1000 para 1 día
```

### Cambiar TTL de CDN (Vercel Edge)
```typescript
// api/tle.ts
const CACHE_TTL_SECONDS = 2 * 24 * 60 * 60; // 2 días
// Cambiar a: 1 * 24 * 60 * 60 para 1 día
```

### Agregar Nueva Constelación
```typescript
// 1. Agregar a constellations.config.ts
export type ConstellationId = 
  | 'starlink' 
  | 'oneweb'
  | 'mi-nueva-constelacion'; // ← Agregar aquí

export const CONSTELLATION_GROUPS: Record<ConstellationId, string> = {
  'starlink': 'starlink',
  'oneweb': 'oneweb',
  'mi-nueva-constelacion': 'grupo-celestrak', // ← Mapear a grupo de CelesTrak
};

// 2. Agregar a allowlist del proxy (api/tle.ts)
const ALLOWED_GROUPS: Record<string, string> = {
  'starlink': 'starlink',
  'oneweb': 'oneweb',
  'mi-nueva-constelacion': 'grupo-celestrak', // ← Agregar aquí
};

// 3. (Opcional) Agregar archivo fallback
// src/assets/gp_mi-nueva-constelacion.txt
```

---

## ✅ Verificación de Estado

### Inspeccionar Cache en DevTools
```javascript
// Abrir DevTools Console:

// 1. Ver todas las entradas en cache
indexedDB.databases().then(dbs => console.log(dbs))

// 2. Limpiar cache manualmente
indexedDB.deleteDatabase('tle-cache-db')

// 3. Ver tamaño de cache
navigator.storage.estimate().then(est => {
  console.log(`Usado: ${(est.usage / 1024 / 1024).toFixed(2)} MB`)
  console.log(`Disponible: ${(est.quota / 1024 / 1024).toFixed(2)} MB`)
})

// 4. Ver status de carga actual
console.log(tle.loadingStatus)
// Output: { loading: false, progress: 100, source: 'cache', error: null, lastUpdate: 1735851117116 }
```

---

## 🐛 Troubleshooting

### "Cannot load TLE data for X"
**Causa**: Proxy no disponible + fallback file no existe  
**Solución**: Crear `src/assets/gp_X.txt` o verificar que el servidor Vercel esté corriendo

### "Satélites desactualizados"
**Causa**: Cache no ha expirado  
**Solución**: `await tle.forceRefresh()` en consola o esperar 2 días

### "IndexedDB quota exceeded"
**Causa**: Demasiadas constelaciones cacheadas  
**Solución**: `indexedDB.deleteDatabase('tle-cache-db')` para limpiar

### "Proxy timeout"
**Causa**: CelesTrak lento o caído  
**Solución**: El sistema automáticamente usará fallback, reintentar más tarde

---

## 📝 Notas Importantes

1. **Los archivos estáticos NO deben editarse** - son solo backup
2. **El cache se actualiza solo** - no requiere intervención manual
3. **Vercel Dev es necesario** para probar el proxy localmente
4. **La primera carga siempre es lenta** - descarga datos frescos
5. **Las cargas subsecuentes son instantáneas** - usa cache

---

¡El sistema está diseñado para ser completamente automático! 🚀
