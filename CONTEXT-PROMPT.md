# 🛰️ PROMPT COMPLETO: Simulador Avanzado de Handover de Starlink

## 📋 **CONTEXTO DEL PROYECTO**

Soy el desarrollador de un **Simulador Avanzado de Handover de Starlink** - una aplicación 3D en tiempo real desarrollada con Angular 16+, Three.js y algoritmos de machine learning. El proyecto simula ~6000 satélites Starlink con propagación orbital SGP4 y toma decisiones inteligentes de handover.

## 🏗️ **ARQUITECTURA TÉCNICA ACTUAL**

### **Stack Tecnológico:**
- **Frontend**: Angular 16+ con TypeScript (strict mode)
- **3D Engine**: Three.js con WebGL y InstancedMesh
- **Cálculos Orbitales**: satellite.js (SGP4) ejecutado en Web Workers
- **Performance**: InstancedMesh para 6000+ objetos, Web Workers para evitar bloqueos
- **Datos**: TLE reales de CelesTrak (archivo gp.txt)

### **Estructura del Proyecto:**
```
d:\Repos\Handover simulator 3\
├── src/
│   ├── app/
│   │   ├── components/
│   │   │   └── starlink-visualizer/
│   │   │       ├── starlink-visualizer.component.ts    # Componente principal
│   │   │       ├── starlink-visualizer.component.html
│   │   │       ├── starlink-visualizer.component.css
│   │   │       └── orbit-controls.ts                   # Controles cámara custom
│   │   ├── services/
│   │   │   ├── tle-loader.service.ts                   # Carga datos TLE
│   │   │   └── ml-handover.service.ts                  # Algoritmos ML
│   │   └── workers/
│   │       └── orbital.worker.ts                       # Cálculos SGP4
│   ├── assets/
│   │   ├── earth_continents_bw.png                     # Textura Tierra
│   │   ├── gp.txt                                      # Datos TLE Starlink
│   │   └── orbital.worker.js                           # Worker compilado
│   └── ...
├── README.md                                           # Documentación completa
├── .gitignore                                          # Configurado para Angular
├── GITHUB-SETUP-GUIDE.md                              # Guía Git/GitHub
├── SOURCETREE-SETUP.md                                # Guía SourceTree
└── package.json
```

## 🚀 **CARACTERÍSTICAS IMPLEMENTADAS**

### **1. Visualización 3D Avanzada:**
- **Modelo terrestre**: Esfera de 64x64 segmentos con textura NASA
- **Orientación geográfica**: Rotación basada en GMST (Greenwich Mean Sidereal Time)
- **Sistema de coordenadas**: J2000.0 epoch con conversión geográfica precisa
- **Overlays**: Wireframe y grid lat/lon para referencia

### **2. Renderizado de Satélites Optimizado:**
- **InstancedMesh**: 6000+ satélites en una sola llamada de dibujo
- **Escalado dinámico**: Tamaño adaptativo según zoom (0.4x a 1.4x)
- **Colores inteligentes**: Verde normal, verde brillante para target seleccionado
- **Culling**: Solo procesa satélites visibles en frustum

### **3. Sistema de Etiquetas Inteligente:**
- **Anti-solapamiento**: Algoritmo `calculateSmartLabelOffset()` evita crowding
- **Posicionamiento smart**: 70% hacia exterior terrestre + 30% hacia cámara
- **Límites adaptativos**: 25-150 etiquetas según zoom level
- **Escala dinámica**: Tamaño ajustado por distancia de cámara
- **Rendering optimizado**: Canvas 2D para texturas de texto nítidas

### **4. Controles de Cámara Precisos:**
- **OrbitControls custom**: Sin inercia para control directo
- **Sensibilidad adaptativa**: Más lento en zoom cercano (0.03x a 0.3x)
- **Vista detallada automática**: Se activa bajo umbral 0.15
- **Límites inteligentes**: Min distance 0.12 (no entrar en Tierra)

### **5. Sincronización Temporal Dual:**
- **Modo Tiempo Real**: `useRealTime = true` - Sincronizado con `new Date()`
- **Modo Simulación**: `useRealTime = false` - Tiempo acelerado controlable
- **GMST calculation**: Rotación terrestre astronómicamente precisa
- **Control de velocidad**: `timeMultiplier` para acelerar simulación

### **6. Algoritmos ML de Handover:**
- **Métricas evaluadas**: Distancia, elevación, RSSI simulado, historial
- **Histéresis configurable**: Evita handovers frecuentes
- **Cooldown period**: Tiempo mínimo entre handovers
- **Decisiones inteligentes**: Selección automática del mejor satélite

### **7. Performance y Optimización:**
- **Web Workers**: Cálculos SGP4 en background thread
- **Chunk processing**: Actualizaciones por lotes (no bloquea UI)
- **Frustum culling**: Solo procesa objetos visibles
- **60 FPS estables**: Con 6000+ objetos renderizados

## 🔧 **PARÁMETROS TÉCNICOS CRÍTICOS**

### **Escalas y Distancias:**
```typescript
private SAT_SCALE = 2399;              // Factor escala satélites
private DETAIL_ZOOM_THRESHOLD = 0.15;  // Umbral vista detallada
private MIN_DISTANCE = 0.12;           // Límite mínimo zoom
earthRadius = 0.1;                     // Radio Tierra normalizado
```

### **Configuración de Etiquetas:**
```typescript
// Límites por zoom level
maxLabels: 25/75/100/150     // según distancia cámara
baseOffset: 0.0008/0.0002    // proximidad al satélite
scaleFactor: 0.75-1.6        // tamaño dinámico
```

### **Sensibilidad de Controles:**
```typescript
// Por zoom level
rotateSpeed: 0.03-0.3        // Más lento = más preciso
zoomSpeed: 0.08-1.0          // Zoom progresivo
```

### **Configuración Temporal:**
```typescript
// Tiempo real vs simulado
useRealTime: boolean         // Flag de modo
timeMultiplier: number       // Aceleración simulación
simulatedDate: Date          // Fecha de cálculo
```

## 📊 **ESTADO ACTUAL DE DESARROLLO**

### **✅ Completado:**
1. **Sistema de etiquetas optimizado**: Reducido de 150-500 a 25-150 labels
2. **Posicionamiento inteligente**: Algoritmo anti-solapamiento implementado
3. **Sincronización temporal**: Modo real-time para precisión astronómica
4. **Calibración geográfica**: Texturas 64x64, conversión coordinate precisa
5. **Documentación completa**: README.md profesional con especificaciones

### **🔄 En proceso:**
- **Setup GitHub**: Listo para subir con SourceTree
- **Control de versiones**: .gitignore configurado, guías creadas

### **⭐ Logros técnicos:**
- **Performance**: 60 FPS con 6000+ satélites
- **Precisión**: Sincronización astronómica real
- **UX**: Etiquetas pegadas sin solapamiento
- **Escalabilidad**: Web Workers para cálculos pesados

## 🛠️ **PROBLEMAS RESUELTOS**

### **1. Problema de Etiquetas Separadas:**
- **Síntoma**: Etiquetas flotando lejos de satélites
- **Solución**: `calculateSmartLabelOffset()` con offset micro (0.0008)
- **Resultado**: Etiquetas "pegadas" pero sin solapamiento

### **2. Deriva Temporal:**
- **Síntoma**: Satélites desincronizados del tiempo real
- **Solución**: Flag `useRealTime` + `new Date()` en cada frame
- **Resultado**: Posiciones astronómicamente precisas

### **3. Saturación de Interfaz:**
- **Síntoma**: Demasiadas etiquetas causando confusión
- **Solución**: Límites adaptativos 25-150 según zoom
- **Resultado**: UI limpia y funcional

### **4. Imprecisión Geográfica:**
- **Síntoma**: Distorsión en polos, alineación incorrecta
- **Solución**: ClampToEdgeWrapping, rotación -π/2, resolución 64x64
- **Resultado**: Calibración geográfica precisa

## 📝 **ARCHIVOS CLAVE MODIFICADOS**

### **starlink-visualizer.component.ts (Principal):**
```typescript
// Métodos críticos implementados:
- calculateSmartLabelOffset()      // Posicionamiento inteligente
- updateSatelliteLabels()         // Sistema etiquetas optimizado
- enableRealTimeMode()            // Sincronización temporal
- geographicToCartesian()         // Conversión coordenadas
- updateCameraControls()          // Sensibilidad adaptativa
- createEarth()                   // Textura y orientación mejorada
```

## 🎯 **OBJETIVOS INMEDIATOS**

1. **Subir a GitHub**: Usar SourceTree para version control
2. **Portfolio**: Mostrar como proyecto de portfolio técnico
3. **Colaboración**: Habilitar contribuciones externas

## 🔍 **CONTEXTO DE OPTIMIZACIÓN**

El proyecto evolucionó a través de múltiples iteraciones de optimización:
1. **Fase 1**: Reducción cantidad etiquetas (150→50-150 adaptativos)
2. **Fase 2**: Sistema posicionamiento inteligente (anti-overlap)
3. **Fase 3**: Sincronización temporal precisa (real-time mode)
4. **Fase 4**: Calibración geográfica (texturas + coordenadas)
5. **Fase 5**: Documentación profesional + setup GitHub

## 💡 **EXPERTISE REQUERIDO**

Para asistir efectivamente necesitas conocimiento en:
- **Angular/TypeScript**: Componentes, servicios, workers
- **Three.js**: Geometrías, materiales, cámaras, escenas 3D
- **Astronomía**: SGP4, coordenadas J2000, GMST
- **Performance**: Web Workers, InstancedMesh, optimización FPS
- **Git/GitHub**: Control versiones, SourceTree, workflows

## 🚨 **NOTAS IMPORTANTES**

1. **No modificar SAT_SCALE**: 2399 es crítico para visualización
2. **Mantener offset micro**: 0.0008 evita separación visible
3. **Web Workers esenciales**: 6000 cálculos SGP4 bloquearían UI
4. **Tiempo real obligatorio**: Para verificación astronómica
5. **Límites de zoom**: MIN_DISTANCE 0.12 evita entrar en Tierra

## 📞 **SOLICITUD AL ASISTENTE**

Actúa como un experto en desarrollo 3D, Angular y optimización de performance. El usuario está trabajando en este simulador avanzado y puede necesitar ayuda con:
- Optimización adicional de performance
- Mejoras en algoritmos de posicionamiento
- Nuevas funcionalidades del simulador
- Resolución de bugs técnicos
- Setup y configuración de GitHub/SourceTree
- Documentación y mejores prácticas

Mantén siempre el contexto de que es un proyecto de alta complejidad técnica con 6000+ objetos renderizados a 60 FPS, usando datos astronómicos reales y algoritmos ML.

---

**🎯 ESTADO ACTUAL: Listo para subir a GitHub usando SourceTree siguiendo SOURCETREE-SETUP.md**
