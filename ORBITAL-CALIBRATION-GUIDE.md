# 🛰️ GUÍA DEL SISTEMA DE CALIBRACIÓN ORBITAL STARLINK

## 📋 **DESCRIPCIÓN GENERAL**

El sistema de calibración orbital permite analizar la diferencia entre las trayectorias reales observadas de los satélites Starlink y las órbitas teóricas calculadas usando los elementos TLE (Two-Line Elements). Esto es crucial para calibrar las transformaciones de coordenadas entre el sistema astronómico estándar y el sistema de coordenadas Three.js utilizado en el simulador.

## 🚀 **CÓMO USAR EL SISTEMA**

### **Paso 1: Acceder al Simulador**
1. Abrir el simulador Starlink en el navegador
2. Esperar a que carguen todos los satélites
3. Abrir las herramientas de desarrollador (F12)

### **Paso 2: Seleccionar un Satélite**
```javascript
// Opción A: Selección manual por clic
// Hacer clic en cualquier satélite en la visualización 3D

// Opción B: Selección programática
window.starlinkVisualizer.selectSatellite(42); // Ejemplo: satélite índice 42
```

### **Paso 3: Iniciar Calibración**
```javascript
// Iniciar calibración para el satélite seleccionado
window.starlinkVisualizer.calibrateOrbitalSystem(42);
```

### **Paso 4: Monitorear Progreso**
```javascript
// Verificar estado de calibración
window.starlinkVisualizer.getCalibrationStatus();

// Resultado ejemplo:
// {
//   active: true,
//   satelliteIndex: 42,
//   progressPercent: 35,
//   pointsCaptured: 6300,
//   elapsedMs: 105000,
//   remainingMinutes: 3,
//   message: "Calibración activa: 35% completado (6300 puntos capturados)"
// }

// 🎯 NUEVO: Diagnóstico de datos capturados
window.starlinkVisualizer.diagnoseCalibrationData();
```

### **Paso 5: Resultados (Automático tras 5 minutos)**
El sistema mostrará automáticamente:
- **Trayectoria observada** (línea cyan) - El camino real del satélite
- **Órbita TLE corregida** (línea verde) - La órbita teórica ajustada
- **Centro orbital** (esfera amarilla) - Centro de masa de la órbita
- **Normal del plano** (línea magenta) - Vector perpendicular al plano orbital

## ⚙️ **COMANDOS DISPONIBLES**

### **Calibración**
```javascript
// Iniciar calibración para un satélite específico
window.starlinkVisualizer.calibrateOrbitalSystem(index);

// Detener calibración en curso
window.starlinkVisualizer.stopCalibration();

// Verificar estado actual
window.starlinkVisualizer.getCalibrationStatus();
```

### **Gestión de Satélites**
```javascript
// Seleccionar satélite manualmente
window.starlinkVisualizer.selectSatellite(index);

// Deseleccionar satélite actual
window.starlinkVisualizer.deselectSatellite();
```

### **Visualización**
```javascript
// Limpiar todas las trazas orbitales
window.starlinkVisualizer.clearOrbitalTraces();
```

### **🎯 NUEVO: Diagnóstico y Debugging**
```javascript
// Analizar datos de calibración capturados
window.starlinkVisualizer.diagnoseCalibrationData();

// Muestra estadísticas detalladas:
// - Total de puntos capturados
// - Rangos de movimiento en X, Y, Z
// - Variación del radio orbital
// - Detección de patrones problemáticos
// - Identificación del eje dominante de movimiento
```

## 🔬 **ANÁLISIS MATEMÁTICO IMPLEMENTADO**

### **1. Captura de Trayectoria**
- Frecuencia: ~60 FPS durante 5 minutos
- Puntos capturados: ~18,000 posiciones
- Validación: Verificación de coordenadas finitas

### **2. Análisis de Trayectoria Observada**
- **Centro orbital**: Promedio de todas las posiciones
- **Radio promedio**: Distancia media al centro
- **Plano orbital**: Calculado usando mínimos cuadrados
- **Inclinación**: Ángulo respecto al plano ecuatorial
- **RAAN**: Ascensión recta del nodo ascendente
- **Excentricidad**: Calculada desde puntos extremos

### **3. Elementos TLE Extraídos**
- **Inclinación**: Directa del TLE (grados)
- **RAAN**: Directa del TLE (grados)
- **Excentricidad**: Directa del TLE
- **Semi-eje mayor**: Calculado desde movimiento medio
- **Argumento del periapsis**: Directa del TLE

### **4. Generación de Órbita Corregida**
- **200 puntos** distribuidos uniformemente
- **Rotaciones aplicadas**:
  1. Argumento del periapsis
  2. Inclinación
  3. RAAN
  4. Transformaciones del sistema de coordenadas
  5. Alineación Three.js (rotación -90° en X)

## 📊 **INTERPRETACIÓN DE RESULTADOS**

### **Colores de Visualización**
- 🟦 **Cyan**: Trayectoria real observada
- 🟢 **Verde**: Órbita teórica TLE corregida
- 🟡 **Amarillo**: Centro orbital calculado
- 🟣 **Magenta**: Normal del plano orbital

### **Métricas Reportadas**
```
[TRAJECTORY-ANALYSIS] Centro orbital: (0.1140, -0.0023, 0.0156)
[TRAJECTORY-ANALYSIS] Radio promedio: 0.1142
[TRAJECTORY-ANALYSIS] Inclinación observada: 53.17°
[TRAJECTORY-ANALYSIS] RAAN observado: 287.43°
[TRAJECTORY-ANALYSIS] Excentricidad observada: 0.000892

[COORD-TRANSFORM] TLE Inclinación: 53.16°
[COORD-TRANSFORM] Observada Inclinación: 53.17°
[COORD-TRANSFORM] Corrección Inclinación: 0.01°

[CORRECTED-ORBIT] Radio orbital corregido: 0.1142 unidades Three.js
```

## 🛠️ **PARÁMETROS CONFIGURABLES**

### **Duración de Calibración**
```javascript
// Para cambiar la duración (por defecto 5 minutos)
window.starlinkVisualizer.calibrationDuration = 180000; // 3 minutos
```

### **Resolución de Órbita Corregida**
Modificar en el código el parámetro `numPoints` en `generateCorrectedOrbit`:
```typescript
const numPoints = 400; // Más puntos = mayor resolución
```

## 🚨 **SOLUCIÓN DE PROBLEMAS**

### **Error: "Datos insuficientes para calibración"**
- **Causa**: Menos de 100 puntos capturados
- **Solución**: Verificar que el satélite esté visible y en movimiento

### **Error: "Índice de satélite inválido"**
- **Causa**: Índice fuera del rango válido
- **Solución**: Verificar que el índice esté entre 0 y el número total de satélites

### **Error: "No se pudieron extraer elementos orbitales"**
- **Causa**: TLE corrupto o incompleto
- **Solución**: Seleccionar un satélite diferente

### **Calibración no captura datos**
- **Verificar**: Que el satélite esté seleccionado visualmente
- **Verificar**: Que la calibración esté activa (`getCalibrationStatus()`)
- **Verificar**: Que el simulador no esté pausado

## 📝 **EJEMPLO COMPLETO**

```javascript
// 1. Verificar que el simulador esté cargado
console.log(window.starlinkVisualizer ? "✅ Simulador disponible" : "❌ Simulador no encontrado");

// 2. Seleccionar un satélite
window.starlinkVisualizer.selectSatellite(100);

// 3. Iniciar calibración
window.starlinkVisualizer.calibrateOrbitalSystem(100);

// 4. Monitorear progreso (opcional)
setInterval(() => {
  const status = window.starlinkVisualizer.getCalibrationStatus();
  if (status.active) {
    console.log(status.message);
  }
}, 30000); // Cada 30 segundos

// 5. Los resultados se mostrarán automáticamente tras 5 minutos
```

## 🎯 **CASOS DE USO**

1. **Validación de TLE**: Comparar precisión de elementos orbitales
2. **Calibración de coordenadas**: Ajustar transformaciones del sistema
3. **Análisis orbital**: Estudiar comportamiento real vs teórico
4. **Debugging**: Identificar problemas en la propagación SGP4
5. **Investigación**: Analizar efectos atmosféricos y perturbaciones

## 🔧 **CONFIGURACIÓN AVANZADA**

Para desarrolladores que quieran modificar el sistema:

- **Archivo principal**: `starlink-visualizer.component.ts`
- **Métodos clave**: 
  - `calibrateOrbitalSystem()`
  - `analyzeObservedTrajectory()`
  - `generateCorrectedOrbit()`
  - `visualizeCalibrationResults()`

---

**¡El sistema de calibración orbital está listo para usar!** 🚀✨
