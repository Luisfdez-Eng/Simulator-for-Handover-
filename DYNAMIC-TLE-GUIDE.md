# 🚀 Guía Rápida: TLEs Dinámicos en Desarrollo

## ✅ Sistema Funcionando

Ahora tienes **TLEs dinámicos** funcionando tanto en desarrollo como en producción!

---

## 🎯 Cómo Funciona

### Desarrollo Local (TLEs Dinámicos)

**Necesitas 2 terminales corriendo simultáneamente:**

#### Terminal 1: Servidor API
```bash
npm run api:dev
# Puerto 3001 - Proxy local que descarga de CelesTrak
```

#### Terminal 2: Angular con Proxy
```bash
npm run start:proxy
# Puerto 4200 - Angular redirige /api/* al puerto 3001
```

### Flujo Completo:
```
1. Abres http://localhost:4200
2. App intenta fetch /api/tle?group=starlink
3. Angular proxy redirige → http://localhost:3001/api/tle?group=starlink
4. Servidor local descarga de CelesTrak
5. ✓ TLEs frescos en tiempo real!
```

---

## 📊 Comandos Disponibles

### ⚡ Opción FÁCIL: Script Automático (RECOMENDADO)
```powershell
.\start-dev.ps1
```
```
✅ Un solo comando
✅ Abre 2 ventanas automáticamente
✅ API Server + Angular con proxy
✅ TLEs dinámicos funcionando
```

### Opción 1: Solo Fallback (Desarrollo Rápido)
```bash
npm start
# ✓ Un solo comando
# ⚠️ Usa archivos estáticos (gp_*.txt)
# ✓ Perfecto para desarrollo rápido sin red
```

### Opción 2: TLEs Dinámicos Manual (2 Terminales)
```bash
# Terminal 1:
npm run api:dev

# Terminal 2 (esperar 3 segundos):
npm run start:proxy
```
```
# ✓ TLEs actualizados de CelesTrak
# ✓ Simula comportamiento de producción
# ⚠️ Requiere 2 terminales abiertas
```

### Opción 3: Producción (Deploy)
```bash
vercel --prod
# ✓ Todo automático
# ✓ Función serverless activa
# ✓ Sin necesidad de servidor local
```

---

## 🔍 Verificar Que Funciona

### En Consola del Navegador (F12):

#### Con API Dinámica (start:proxy):
```javascript
// Primera carga:
🌐 Fetched fresh TLE for starlink
✅ Loaded 6000+ satellites for starlink (source: remote)

// Segunda carga (< 2 días):
📦 Using cached TLE for starlink
✅ Loaded 6000+ satellites for starlink (source: cache)
```

#### Solo Fallback (start):
```javascript
⚠️ Using fallback assets for starlink
✅ Loaded 6000+ satellites for starlink (source: fallback)
```

### En Terminal del Servidor API:
```bash
📡 GET /api/tle?group=starlink
[TLE-PROXY] Fetching starlink from CelesTrak...
[TLE-PROXY] ✅ Success: starlink - 6000+ sats (~2.5 MB)
```

---

## 🎛️ Configuración del Proxy

### proxy.conf.json
```json
{
  "/api": {
    "target": "http://localhost:3001",
    "secure": false,
    "logLevel": "debug",
    "changeOrigin": true
  }
}
```

**Qué hace**: Redirige todas las llamadas a `/api/*` desde Angular (puerto 4200) al servidor local (puerto 3001).

---

## 🛠️ Arquitectura del Sistema

### Desarrollo Local:
```
┌─────────────────────────────────────────┐
│  Angular Dev Server (4200)              │
│  - UI/UX                                │
│  - Hot reload                           │
│  - Proxy config                         │
└────────────┬────────────────────────────┘
             │ /api/tle?group=X
             ↓
┌─────────────────────────────────────────┐
│  API Server (3001) - api/server.js      │
│  - CORS enabled                         │
│  - Ejecuta api/tle.js                   │
└────────────┬────────────────────────────┘
             │ HTTPS request
             ↓
┌─────────────────────────────────────────┐
│  CelesTrak.org                          │
│  - TLE data provider                    │
│  - Actualizado cada 4-6 horas           │
└─────────────────────────────────────────┘
```

### Producción (Vercel):
```
┌─────────────────────────────────────────┐
│  Vercel CDN                             │
│  - Distribución global                  │
│  - Archivos estáticos (dist/)           │
└────────────┬────────────────────────────┘
             │ /api/tle?group=X
             ↓
┌─────────────────────────────────────────┐
│  Vercel Function - api/tle.ts           │
│  - Serverless                           │
│  - Cache CDN (2 días)                   │
└────────────┬────────────────────────────┘
             │
             ↓
┌─────────────────────────────────────────┐
│  CelesTrak.org                          │
└─────────────────────────────────────────┘
```

---

## 🧪 Pruebas Manuales

### Test 1: API Server Funciona
```bash
# En navegador o terminal nueva:
curl http://localhost:3001/api/tle?group=starlink

# Deberías ver TLEs en formato texto
```

### Test 2: Proxy Funciona
```bash
# Con ambos servidores corriendo, abre:
http://localhost:4200

# DevTools Console debería mostrar:
# 🌐 Fetched fresh TLE for starlink
```

### Test 3: Cache Funciona
```bash
# En consola del navegador (F12):
tle.loadingStatus

# Primera vez: { source: 'remote', ... }
# Recarga página:  { source: 'cache', ... }
```

### Test 4: Force Refresh
```bash
# En consola del navegador:
await tle.forceRefresh()

# Debería descargar TLE frescos ignorando cache
```

---

## 🐛 Troubleshooting

### "ECONNREFUSED en puerto 3001"
**Causa**: Servidor API no está corriendo  
**Solución**: Ejecuta `npm run api:dev` en una terminal

### "Sigue usando fallback en lugar de remote"
**Causa**: No estás usando `start:proxy`, solo `start`  
**Solución**: Usa `npm run start:proxy` en lugar de `npm start`

### "Proxy error en Angular"
**Causa**: Orden incorrecto de inicio  
**Solución**: 
1. Primero inicia `npm run api:dev`
2. Luego inicia `npm run start:proxy`

### "Puerto 3001 ya en uso"
**Causa**: Servidor previo no se detuvo  
**Solución**: 
```bash
# Windows:
taskkill /F /IM node.exe

# Luego reinicia:
npm run api:dev
```

---

## ✅ Checklist de Funcionamiento

- [ ] Servidor API corriendo en puerto 3001
- [ ] Angular corriendo en puerto 4200 con proxy
- [ ] Navegador abierto en http://localhost:4200
- [ ] Consola muestra "source: remote" o "source: cache"
- [ ] Satélites visibles en pantalla
- [ ] Terminal API muestra requests entrantes

---

## 📝 Archivos Clave

| Archivo | Propósito |
|---------|-----------|
| `api/server.js` | Servidor de desarrollo local |
| `api/tle.js` | Handler JavaScript para desarrollo |
| `api/tle.ts` | Handler TypeScript para producción |
| `proxy.conf.json` | Configuración proxy Angular |
| `package.json` → scripts | Comandos npm |

---

## 🎉 Estado Actual

✅ **Sistema completo funcionando!**

- Desarrollo local con TLEs dinámicos
- Cache de 2 días activo
- Fallback a archivos estáticos
- Listo para producción en Vercel

**Próximo paso**: Deploy a producción con `vercel --prod` 🚀
