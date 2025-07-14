# 🛰️ Simulador Avanzado de Handover de Starlink

Un simulador 3D en tiempo real de handovers de satélites Starlink desarrollado con Angular, Three.js y algoritmos de machine learning.

![Starlink Simulator](https://img.shields.io/badge/Starlink-Simulator-blue?style=for-the-badge&logo=satellite)
![Angular](https://img.shields.io/badge/Angular-16+-red?style=for-the-badge&logo=angular)
![Three.js](https://img.shields.io/badge/Three.js-3D-green?style=for-the-badge&logo=three.js)

## ✨ Características Principales

### 🌍 **Visualización 3D Realista**
- Modelo terrestre con texturas de alta resolución (64x64 segmentos)
- Sistema de coordenadas astronómicas preciso con conversión geográfica
- Rotación en tiempo real basada en GMST (Greenwich Mean Sidereal Time)
- Wireframe y grid de latitud/longitud para referencia

### 🛰️ **Simulación de Satélites**
- Renderizado optimizado de ~6000 satélites Starlink simultáneamente
- Datos orbitales TLE (Two-Line Elements) reales de CelesTrak
- Propagación orbital SGP4 usando satellite.js en Web Workers
- Escalado dinámico según distancia de cámara (0.1x a 3x)

### 🏷️ **Sistema de Etiquetas Inteligente**
- Algoritmo anti-solapamiento con posicionamiento smart offset
- Etiquetas limitadas por zoom: 50/75/100/150 según nivel de detalle
- Posicionamiento 70% hacia exterior terrestre + 30% hacia cámara
- Identificación visual clara sin saturación de interfaz

### 📡 **Sistema de Handover ML**
- Algoritmos de machine learning para decisiones automáticas
- Métricas de calidad: RSSI, elevación, distancia, disponibilidad
- Histéresis y cooldown configurables para evitar handovers frecuentes
- Visualización en tiempo real del satélite objetivo seleccionado

### 🎮 **Controles Avanzados**
- Cámara orbital sin inercia para control preciso
- Sensibilidad adaptativa según nivel de zoom
- Vista detallada automática con etiquetas de satélites
- Navegación 3D intuitiva con mouse y scroll

### ⏰ **Sincronización Temporal Dual**
- **Modo Tiempo Real**: Sincronizado con fecha/hora actual astronómica
- **Modo Simulación**: Tiempo acelerado para pruebas y análisis
- Cálculos astronómicos precisos para rotación terrestre
- Switching dinámico entre modos durante ejecución

### ⚡ **Optimización de Performance**
- Web Workers para cálculos orbitales sin bloquear UI
- InstancedMesh para renderizado masivo eficiente de satélites
- Frustum culling para optimización de visibilidad
- Procesamiento por chunks para evitar lag

## 🚀 Tecnologías Utilizadas

- **Frontend**: Angular 16+ con TypeScript (modo strict)
- **3D Engine**: Three.js con WebGL y InstancedMesh
- **Cálculos Orbitales**: satellite.js (implementación SGP4)
- **Performance**: Web Workers, chunk processing
- **Tipografía**: Google Fonts (Orbitron, Exo 2, Rajdhani)
- **Build System**: Angular CLI con optimizaciones
- **Control de Versiones**: Git + SourceTree

## 📦 Instalación y Configuración

### Prerrequisitos
- Node.js 16+
- Angular CLI 16+
- Git

### Pasos de Instalación

```bash
# Clonar el repositorio
git clone https://github.com/tu-usuario/handover-simulator-3.git
cd handover-simulator-3

# Instalar dependencias
npm install

# Iniciar servidor de desarrollo
ng serve

# Abrir en navegador
# http://localhost:4200
```

### Build de Producción

```bash
# Build optimizado
ng build --configuration production

# Los archivos estarán en /dist/
```

## 🎛️ Controles de Usuario

### Navegación 3D
- **Mouse**: Rotar cámara alrededor de la Tierra
- **Scroll**: Zoom in/out (activación automática de vista detallada)
- **Vista Detallada**: Se activa automáticamente al hacer zoom cercano

### Modos de Tiempo
- **Tiempo Real**: Satélites sincronizados con posiciones astronómicas reales
- **Simulación**: Tiempo acelerado para pruebas y análisis

### Configuración de Usuario
- **Latitud/Longitud**: Posición del equipo usuario (UE)
- **Parámetros ML**: Histéresis y cooldown para handovers
- **Visualización**: Toggle de etiquetas y modos de renderizado

## 🔧 Arquitectura del Proyecto

```
src/
├── app/
│   ├── components/
│   │   └── starlink-visualizer/     # Componente principal 3D
│   │       ├── starlink-visualizer.component.ts    # Lógica principal
│   │       ├── starlink-visualizer.component.html  # Template
│   │       ├── starlink-visualizer.component.css   # Estilos
│   │       └── orbit-controls.ts                   # Controles cámara
│   ├── services/
│   │   ├── tle-loader.service.ts    # Carga de datos TLE
│   │   └── ml-handover.service.ts   # Algoritmos ML
│   └── workers/
│       └── orbital.worker.ts        # Cálculos orbitales
├── assets/
│   ├── earth_continents_bw.png     # Textura terrestre alta resolución
│   ├── gp.txt                      # Datos TLE de Starlink
│   └── orbital.worker.js           # Worker compilado
└── styles.css                      # Estilos globales futuristas
```

## 🛰️ Datos de Satélites

El simulador utiliza datos TLE (Two-Line Elements) reales de la constelación Starlink:
- **Fuente**: CelesTrak / Space-Track.org
- **Formato**: TLE estándar NOAA
- **Actualización**: Datos recientes de órbitas
- **Cantidad**: ~6000 satélites activos
- **Precisión**: Propagación SGP4 astronómicamente precisa

## 🤖 Algoritmos ML

### Sistema de Handover Inteligente
```typescript
// Factores considerados:
- Distancia al satélite (km)
- Ángulo de elevación (grados)
- SNR simulado (dB)
- Historial de handovers previos
- Tiempo desde último handover (cooldown)
- Métricas de calidad de enlace
```

### Métricas de Calidad
- **RSSI**: Indicador de intensidad de señal (-120 a -60 dBm)
- **Elevación**: Ángulo sobre el horizonte (0-90°)
- **Distancia**: Proximidad al usuario (400-2000 km)
- **Disponibilidad**: Tiempo de visibilidad estimado

## 📊 Performance

### Optimizaciones Implementadas
- **InstancedMesh**: Renderizado de 6000+ satélites en una sola llamada de dibujo
- **Web Workers**: Cálculos SGP4 sin bloquear thread principal
- **Frustum Culling**: Solo procesar objetos visibles en pantalla
- **Escalado Dinámico**: Ajuste automático de tamaño según zoom
- **Etiquetas Limitadas**: Sistema inteligente de 50-150 etiquetas máximo
- **Chunk Processing**: Actualizaciones por lotes para fluidez

### Benchmarks
- **FPS**: 60 FPS estables en hardware moderno
- **Memory**: ~150MB uso de memoria optimizado
- **Load Time**: <3 segundos inicialización completa
- **Satélites**: 6000+ renderizados simultáneamente

## 🔬 Precisión Astronómica

### Sistema de Coordenadas
- **Referencia**: J2000.0 epoch astronómico
- **Rotación Terrestre**: Cálculo GMST (Greenwich Mean Sidereal Time)
- **Conversión**: Geográficas (lat/lon) → Cartesianas XYZ
- **Proyección**: Equirectangular con corrección polar

### Validación Geográfica
Puntos de referencia incluidos para verificación:
- **Greenwich** (0°, 51.48°) - Meridiano principal
- **Madrid** (-3.70°, 40.42°) - Referencia europea
- **Polos** Norte (90°) y Sur (-90°) - Extremos
- **Sydney** (151.21°, -33.87°) - Hemisferio sur

### Sincronización Temporal
- **Tiempo Real**: `new Date()` para posiciones actuales
- **Simulación**: Incremento controlado para análisis
- **Precisión**: Milisegundos para cálculos orbitales

## 🎨 Interfaz de Usuario

### Estética Futurista
- **Colores**: Paleta cyan/verde espacial (#00ffff, #00ff00)
- **Tipografía**: Fuentes sci-fi (Orbitron, Electrolize, Rajdhani)
- **Elementos**: Controles estilo consola espacial
- **Feedback**: Indicadores en tiempo real
- **Animaciones**: Transiciones suaves para UX

### Responsive Design
- Adaptable a diferentes resoluciones
- Controles táctiles para dispositivos móviles
- UI escalable según tamaño de pantalla
- Optimizado para monitores 4K

## 🛠️ Desarrollo

### Scripts Disponibles
```bash
ng serve          # Servidor de desarrollo
ng build          # Build de producción
ng test           # Tests unitarios
ng lint           # Linting y calidad de código
ng e2e            # Tests end-to-end
```

### Estructura de Commits
```
🎉 Initial commit
✨ Add: Nueva funcionalidad
🐛 Fix: Corrección de bug
📝 Docs: Documentación
🎨 Style: Mejoras visuales
⚡ Perf: Optimización
🔧 Config: Configuración
🚀 Deploy: Despliegue
```

## 📝 Roadmap

### Versión Actual (v1.0)
- ✅ Visualización 3D con 6000+ satélites
- ✅ Carga de datos TLE reales
- ✅ Sistema de handover ML inteligente
- ✅ Controles de cámara orbital precisos
- ✅ Sincronización temporal dual
- ✅ Sistema de etiquetas anti-solapamiento
- ✅ Optimización performance con Web Workers

### Próximas Versiones
- 🔄 Interfaz de configuración avanzada
- 🔄 Métricas de performance en tiempo real
- 🔄 Exportación de datos de simulación (JSON/CSV)
- 🔄 Modo VR/AR para inmersión total
- 🔄 API REST para configuración remota
- 🔄 Análisis predictivo de handovers
- 🔄 Integración con datos meteorológicos

## 🤝 Contribución

1. Fork el proyecto
2. Crear branch para feature (`git checkout -b feature/nueva-funcionalidad`)
3. Commit cambios (`git commit -m '✨ Add: Nueva funcionalidad'`)
4. Push al branch (`git push origin feature/nueva-funcionalidad`)
5. Abrir Pull Request

### Guidelines
- Seguir convenciones de TypeScript strict
- Mantener performance de 60 FPS
- Documentar funciones complejas
- Tests unitarios para nuevas features

## 📄 Licencia

Este proyecto está licenciado bajo la MIT License - ver el archivo [LICENSE](LICENSE) para detalles.

## 👨‍💻 Autor

**Desarrollador del Simulador**
- GitHub: [@tu-usuario](https://github.com/tu-usuario)
- LinkedIn: [Tu Perfil](https://linkedin.com/in/tu-perfil)

## 🙏 Agradecimientos

- **CelesTrak**: Por los datos TLE actualizados de satélites
- **Three.js Community**: Por la documentación y ejemplos 3D
- **satellite.js**: Por la implementación SGP4 precisa
- **Angular Team**: Por el framework robusto
- **NASA**: Por las texturas terrestres de dominio público

---

⭐ **¡Si te gusta este proyecto, dale una estrella!** ⭐

## 🔗 Enlaces Útiles

- [Documentación Three.js](https://threejs.org/docs/)
- [satellite.js GitHub](https://github.com/shashwatak/satellite-js)
- [CelesTrak TLE Data](https://celestrak.com/)
- [Angular Documentation](https://angular.io/docs)