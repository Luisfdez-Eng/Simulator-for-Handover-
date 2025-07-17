import { Component, OnInit, OnDestroy } from '@angular/core';
import * as THREE from 'three';
import { TleLoaderService, SatData } from '../../services/tle-loader.service';
import { MLHandoverService, SatelliteMetrics } from '../../services/ml-handover.service';
import OrbitControls from './orbit-controls';

/*
  NOTA: Para las fuentes futuristas, añade esto al archivo CSS principal o index.html:
  
  En el <head> del index.html:
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@100;200;300;400;500;600;700;800;900&display=swap" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Exo+2:wght@100;200;300;400;500;600;700;800;900&display=swap" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Electrolize&display=swap" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Audiowide&display=swap" rel="stylesheet">
  
  O en el archivo CSS:
  @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@100;200;300;400;500;600;700;800;900&display=swap');
  @import url('https://fonts.googleapis.com/css2?family=Exo+2:wght@100;200;300;400;500;600;700;800;900&display=swap');
  @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@300;400;500;600;700&display=swap');
  @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap');
  @import url('https://fonts.googleapis.com/css2?family=Electrolize&display=swap');
  @import url('https://fonts.googleapis.com/css2?family=Audiowide&display=swap');
  */

@Component({
  selector: 'app-starlink-visualizer',
  templateUrl: './starlink-visualizer.component.html',
  styleUrls: ['./starlink-visualizer.component.css']
})
export class StarlinkVisualizerComponent implements OnInit, OnDestroy {
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private satsMesh: THREE.InstancedMesh | null = null;
  private instanceMatrix = new THREE.Matrix4();
  private ueMesh!: THREE.Mesh;
  private frameId = 0;
  private frustum = new THREE.Frustum();
  private frustumMatrix = new THREE.Matrix4();
  private worker: Worker | null = null;
  private lastWorkerFrameDate: Date = new Date();
  private workerBusy = false;

  currentMetrics: SatelliteMetrics | null = null; // 🎯 FORZADO: Mantener siempre null para interfaz limpia
  userLat = 0;
  userLon = 0;
  hysteresis = 5;
  cooldown = 30;
  loadingFirstFrame = true;
  loadingProgress = 0; // porcentaje 0-100
  firstFrameSatCount = 0;
  firstFrameReceived = 0;
  loadingStartTime: number = 0;
  loadingEndTime: number = 0;
  loadingElapsedMs: number = 0;

  private SAT_SCALE = 1200; // 🎯 AJUSTADO: Factor óptimo para satélites visibles (era 800, original 2399)
  timeMultiplier = 1; // Control de velocidad temporal (x1 por defecto)
  private simulatedDate = new Date();
  private useRealTime = true; // 🎯 NUEVO: Flag para usar tiempo real vs simulado
  private lastRealTimeUpdate = 0; // 🎯 NUEVO: Timestamp para control de actualización
  private earthMesh: THREE.Mesh | null = null;
  private earthWireframe: THREE.LineSegments | null = null;
  private earthGrid: THREE.LineSegments | null = null;
  private earthTexture: THREE.Texture | null = null;
  private isDetailedView = false;
  private readonly DETAIL_ZOOM_THRESHOLD = 0.15; // Umbral para vista detallada
  private satLabels: THREE.Sprite[] = [];
  private labelMaterial!: THREE.SpriteMaterial;
  private canvas2D!: HTMLCanvasElement;
  private context2D!: CanvasRenderingContext2D;

  // 🌍 PUNTOS DE REFERENCIA PARA VALIDACIÓN DE CALIBRACIÓN
  private readonly REFERENCE_POINTS = [
    { name: "Greenwich Observatory", lat: 51.4769, lon: 0.0005, color: 0xff0000 },
    { name: "Polo Norte", lat: 90, lon: 0, color: 0x00ff00 },
    { name: "Polo Sur", lat: -90, lon: 0, color: 0x0000ff },
    { name: "Línea Internacional de Fecha", lat: 0, lon: 180, color: 0xffff00 },
    { name: "Meridiano 90°E (Índico)", lat: 0, lon: 90, color: 0xff00ff },
    { name: "Meridiano 90°W (Pacífico)", lat: 0, lon: -90, color: 0x00ffff },
    { name: "Ecuador - 0°", lat: 0, lon: 0, color: 0xffffff }
  ];

  // 🎯 NUEVO: Sistema de calibración manual empírica
  private readonly CALIBRATION_OFFSET_DEGREES = -103; // 🎯 CALIBRADO: Ajustado para STARLINK-30354 (real: 37.32°E vs simulador: Australia ~140°E)
  private referencePointsMesh: THREE.Group | null = null;

  // 🎯 NUEVO: Sistema de corrección temporal para velocidades orbitales
  private orbitalTimeCorrection = 1.0; // Factor de corrección temporal (1.0 = sin corrección)
  private averageOrbitalVelocity = 7.66; // km/s - Velocidad orbital típica de Starlink
  private lastOrbitalMetricsUpdate = 0; // Timestamp de última actualización

  // 🎯 NUEVO: Sistema de visualización de órbitas
  private orbitalTraces: THREE.Group | null = null;
  private orbitalTracesVisible = true; // Activado por defecto para calibración
  private orbitalTraceMaterial: THREE.LineBasicMaterial | null = null;

  constructor(
    public tle: TleLoaderService,
    private ml: MLHandoverService
  ) { }

  async ngOnInit() {
    await this.tle.load();
    this.initThree();
    this.initializeLabelSystem();
    this.createEarth();
    this.createReferencePoints(); // 🎯 IMPLEMENTADO: Puntos de referencia para calibración
    this.createSatellites();
    this.createUE();
    
    // 🎯 COMENTADO: Órbitas deshabilitadas para depuración de coordenadas
    // setTimeout(() => {
    //   console.log('[ORBITAL-TRACES] 🕐 Iniciando creación de trazas tras delay...');
    //   this.createOrbitalTraces();
    // }, 5000); // Esperar 5 segundos para que los satélites estén completamente cargados
    
    // 🎯 COMENTADO: Método no implementado aún
    // this.enableRealTimeMode();
    
    // 🎯 NUEVO: Exponer componente globalmente para calibración desde consola
    (window as any).starlinkVisualizer = this;
    console.log('[CALIBRATION] 🎯 Componente expuesto globalmente.');
    console.log('[CALIBRATION] Para ajustar calibración usa: starlinkVisualizer.adjustCalibration(NUMERO)');
    console.log('[CALIBRATION] Ejemplo: starlinkVisualizer.adjustCalibration(10) para probar +10°');
    console.log('[CALIBRATION] Offset actual:', this.CALIBRATION_OFFSET_DEGREES, '°');
    
    // 🎯 NUEVO: Información de control orbital
    console.log('[ORBITAL] Para verificar alturas: starlinkVisualizer.checkSatelliteHeights()');
    console.log('[ORBITAL] Para analizar TLEs: starlinkVisualizer.analyzeTLEQuality()');
    console.log('[ORBITAL] Para métricas orbitales: starlinkVisualizer.getOrbitalMetrics()');
    console.log('[ORBITAL] Para ajustar velocidad: starlinkVisualizer.setOrbitalTimeCorrection(FACTOR)');
    console.log('[ORBITAL] Para sincronizar: starlinkVisualizer.syncOrbitalVelocity(VELOCIDAD_KM_S)');
    console.log('[ORBITAL] Para resetear: starlinkVisualizer.resetOrbitalCorrection()');
    console.log('[CALIBRATION] Para verificar STARLINK-6157: starlinkVisualizer.verifyStarlink6157Position()');
    console.log('[REFERENCE] Para mostrar/ocultar puntos de referencia: starlinkVisualizer.toggleReferencePoints()');
    console.log('[REFERENCE] Para listar puntos de referencia: starlinkVisualizer.listReferencePoints()');
    console.log('[COORDS] 🔧 Sistema de coordenadas en modo depuración - Tierra sin rotaciones');
    console.log('[COORDS] Para evaluar orientación: starlinkVisualizer.evaluateCoordinateSystem()');
    console.log('[UE] 📍 Para mover UE a coordenadas: starlinkVisualizer.moveUETo(lat, lon)');
    console.log('[UE] 🌍 Para probar ubicaciones: starlinkVisualizer.testUELocations()');
    console.log('[UE] 🔍 Para verificar calibración: starlinkVisualizer.verifyCalibrationPoints()');
    // 🎯 COMENTADO: Trazas orbitales deshabilitadas para depuración
    // console.log('[ORBITAL-TRACES] Para mostrar/ocultar órbitas: starlinkVisualizer.toggleOrbitalTraces()');
    // console.log('[ORBITAL-TRACES] Para recrear trazas: starlinkVisualizer.recreateOrbitalTraces()');
    // console.log('[ORBITAL-TRACES] Para info de trazas: starlinkVisualizer.getOrbitalTracesInfo()');
    console.log('[DEBUG] Para diagnóstico TLE: starlinkVisualizer.debugTLEPropagation()');
    this.animate();
  }

  ngOnDestroy() {
    cancelAnimationFrame(this.frameId);
    this.clearSatelliteLabels();
    this.renderer.domElement.remove();
  }

  private controls!: OrbitControls;

  private initThree() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.001, 100);
    this.camera.position.set(0, 0, 0.5); // Más cerca y centrada
    this.camera.lookAt(0, 0, 0);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // Añadir el canvas al contenedor del componente
    const container = document.querySelector('.canvas-container') || document.body;
    container.appendChild(this.renderer.domElement);
    // OrbitControls sin inercia - control directo del ratón
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false; // Eliminar inercia completamente
    this.controls.enablePan = false;
    this.controls.minDistance = 0.12; // Límite mínimo fijo
    this.controls.maxDistance = 2;
    this.controls.rotateSpeed = 1.0; // Velocidad base
    this.controls.zoomSpeed = 1.0;

    // Listener para cambios de zoom
    this.controls.addEventListener('change', () => {
      this.updateCameraControls();
    });
    // Añadir helper de ejes
    const axesHelper = new THREE.AxesHelper(0.2);
    this.scene.add(axesHelper);
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  // Calcula el ángulo de rotación de la Tierra (Greenwich) en radianes para la fecha simulada
  private getEarthRotationAngle(date: Date): number {
    // Referencia: J2000 = 2000-01-01T12:00:00Z
    const J2000 = Date.UTC(2000, 0, 1, 12, 0, 0, 0);
    const msSinceJ2000 = date.getTime() - J2000;
    const days = msSinceJ2000 / 86400000;
    // Ángulo de Greenwich en horas (GMST)
    const GMST = (18.697374558 + 24.06570982441908 * days) % 24;
    return (GMST / 24) * 2 * Math.PI;
  }
  private updateCameraControls() {
    const distance = this.camera.position.distanceTo(new THREE.Vector3(0, 0, 0));
    const wasDetailedView = this.isDetailedView;

    // Límite mínimo de zoom (no entrar en la Tierra)
    const MIN_DISTANCE = 0.12; // Ajusta según necesites
    if (distance < MIN_DISTANCE) {
      // Forzar distancia mínima
      const direction = this.camera.position.clone().normalize();
      this.camera.position.copy(direction.multiplyScalar(MIN_DISTANCE));
      this.controls.update();
    }

    // Zona de vista detallada con sensibilidad ajustada
    if (distance < this.DETAIL_ZOOM_THRESHOLD && distance >= MIN_DISTANCE && !this.isDetailedView) {
      // Entrar en vista detallada - sensibilidad más baja para precisión
      this.isDetailedView = true;
      this.controls.rotateSpeed = 0.08; // 🎯 AJUSTA AQUÍ: Sensibilidad inicial más baja (era 0.05)
      this.controls.zoomSpeed = 0.2;    // 🎯 AJUSTA AQUÍ: Zoom inicial más lento (era 0.25)
      this.controls.minDistance = MIN_DISTANCE;
      console.log('[CAMERA] Entrando en vista detallada - sensibilidad reducida');
    } else if (distance >= this.DETAIL_ZOOM_THRESHOLD && this.isDetailedView) {
      // Salir de vista detallada - restaurar sensibilidad normal
      this.isDetailedView = false;
      this.controls.rotateSpeed = 0.3; // Velocidad normal
      this.controls.zoomSpeed = 1.0;   // Zoom normal
      this.controls.minDistance = MIN_DISTANCE;
      this.clearSatelliteLabels();
      console.log('[CAMERA] Saliendo de vista detallada - sensibilidad normal');
    }

    // Sensibilidad progresiva en zona detallada (más cerca = más preciso)
    if (distance < this.DETAIL_ZOOM_THRESHOLD && distance >= MIN_DISTANCE) {
      // Sensibilidad inversamente proporcional a qué tan cerca estemos
      const proximityFactor = distance / this.DETAIL_ZOOM_THRESHOLD; // 0.8 a 1.0
      
      // 🎯 AJUSTA AQUÍ: Rango de sensibilidad progresiva
      // Valores más bajos = más lento y preciso
      this.controls.rotateSpeed = Math.max(0.05, 0.12 * proximityFactor); // Era 0.08 y 0.15
      this.controls.zoomSpeed = Math.max(0.1, 0.2 * proximityFactor);     // Era 0.15 y 0.25
      
      // Sensibilidad extra baja en zoom extremo para máxima precisión
      if (distance <= 0.125) {
        this.controls.rotateSpeed = 0.03; // 🎯 AJUSTA AQUÍ: SúPER lento (era 0.05)
        this.controls.zoomSpeed = 0.08;   // 🎯 AJUSTA AQUÍ: Zoom súper lento (era 0.1)
      }
    }

    // Actualizar visibilidad de etiquetas y escala de satélites
    if (this.isDetailedView !== wasDetailedView) {
      this.updateSatelliteLabels();
      this.updateSatelliteScale();
    }
  }
  private initializeLabelSystem() {
    // Canvas para generar texturas de texto (ya no se usa este canvas específico)
    this.canvas2D = document.createElement('canvas');
    this.canvas2D.width = 512;  // Mayor resolución
    this.canvas2D.height = 128;
    this.context2D = this.canvas2D.getContext('2d')!;

    // Configurar calidad alta
    this.context2D.imageSmoothingEnabled = true;
    this.context2D.imageSmoothingQuality = 'high';

    // Material base para sprites de texto
    this.labelMaterial = new THREE.SpriteMaterial({
      transparent: true,
      alphaTest: 0.1
    });
  }

  private createTextTexture(text: string): THREE.Texture {
    // Canvas optimizado para texto nítido y limpio
    const canvas = document.createElement('canvas');
    canvas.width = 512;  
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    // Configuración de máxima calidad
    ctx.imageSmoothingEnabled = false; // Desactivar para texto más nítido
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Configurar fuente moderna y limpia
    const fontSize = 30;
    ctx.font = `${fontSize}px "Segoe UI", "Roboto", "Inter", "SF Pro Display", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Posición centrada
    const x = canvas.width / 2;
    const y = canvas.height / 2;
    
    // Calcular dimensiones del texto para el fondo
    const metrics = ctx.measureText(text);
    const textWidth = metrics.width;
    const textHeight = fontSize;
    
    // Padding para el fondo
    const padding = 8;
    const bgWidth = textWidth + padding * 2;
    const bgHeight = textHeight + padding * 2;
    
    // Fondo semi-transparente oscuro con bordes redondeados
    ctx.fillStyle = 'rgba(20, 25, 35, 0.85)'; // Fondo oscuro semi-transparente
    
    // Crear rectángulo con bordes redondeados manualmente
    const radius = 6;
    const rectX = x - bgWidth/2;
    const rectY = y - bgHeight/2;
    
    ctx.beginPath();
    ctx.moveTo(rectX + radius, rectY);
    ctx.lineTo(rectX + bgWidth - radius, rectY);
    ctx.quadraticCurveTo(rectX + bgWidth, rectY, rectX + bgWidth, rectY + radius);
    ctx.lineTo(rectX + bgWidth, rectY + bgHeight - radius);
    ctx.quadraticCurveTo(rectX + bgWidth, rectY + bgHeight, rectX + bgWidth - radius, rectY + bgHeight);
    ctx.lineTo(rectX + radius, rectY + bgHeight);
    ctx.quadraticCurveTo(rectX, rectY + bgHeight, rectX, rectY + bgHeight - radius);
    ctx.lineTo(rectX, rectY + radius);
    ctx.quadraticCurveTo(rectX, rectY, rectX + radius, rectY);
    ctx.closePath();
    ctx.fill();
    
    // Texto principal blanco y nítido
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(text, x, y);

    const texture = new THREE.CanvasTexture(canvas);
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.format = THREE.RGBAFormat;
    texture.needsUpdate = true;
    
    return texture;
  }

  private updateSatelliteLabels() {
    if (!this.isDetailedView || !this.satsMesh) {
      this.clearSatelliteLabels();
      return;
    }

    // Limpiar etiquetas existentes
    this.clearSatelliteLabels();

    // Calcular frustum de la cámara con un margen más amplio
    const frustum = new THREE.Frustum();
    const matrix = new THREE.Matrix4();
    matrix.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(matrix);

    const sats = this.tle.getAllSatrecs();
    const tempMatrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const cameraDistance = this.camera.position.distanceTo(new THREE.Vector3(0, 0, 0));

    // Radio de visibilidad más generoso basado en el zoom
    let visibilityRadius: number;
    let maxLabels: number;
    
    if (cameraDistance <= 0.12) {
      // Zoom máximo - mostrar todos los satélites en un área pequeña
      visibilityRadius = 0.08;
      maxLabels = 25;
    } else if (cameraDistance <= 0.15) {
      // Zoom alto - área moderada
      visibilityRadius = 0.12;
      maxLabels = 75;
    } else if (cameraDistance <= 0.2) {
      // Zoom medio - área amplia
      visibilityRadius = 0.18;
      maxLabels = 100;
    } else {
      // Zoom bajo - área muy amplia
      visibilityRadius = 0.25;
      maxLabels = 150;
    }

    let labelsCreated = 0;
    const candidateLabels: { sat: any, position: THREE.Vector3, index: number, distance: number }[] = [];

    // Primero, recopilar todos los candidatos válidos
    for (let i = 0; i < Math.min(this.satsMesh.count, sats.length); i++) {
      this.satsMesh.getMatrixAt(i, tempMatrix);
      position.setFromMatrixPosition(tempMatrix);

      const distanceToCamera = this.camera.position.distanceTo(position);
      const distanceToCenter = position.distanceTo(new THREE.Vector3(0, 0, 0));

      // Criterios más permisivos:
      // 1. Debe estar dentro del radio de visibilidad
      // 2. Debe estar fuera del núcleo de la Tierra (radio > 0.102) - 🎯 AJUSTADO para satélites más bajos
      // 3. Debe ser visible en pantalla (proyección)
      if (distanceToCamera < visibilityRadius && distanceToCenter > 0.102) { // 🎯 REDUCIDO de 0.103 a 0.102
        // Verificar si es visible en pantalla usando proyección
        const screenPosition = position.clone().project(this.camera);
        const isOnScreen = screenPosition.x >= -1.2 && screenPosition.x <= 1.2 && 
                          screenPosition.y >= -1.2 && screenPosition.y <= 1.2 && 
                          screenPosition.z >= -1 && screenPosition.z <= 1;

        if (isOnScreen) {
          candidateLabels.push({
            sat: sats[i],
            position: position.clone(),
            index: i,
            distance: distanceToCamera
          });
        }
      }
    }

    // Ordenar por distancia a la cámara (más cercanos primero)
    candidateLabels.sort((a, b) => a.distance - b.distance);

    // Crear etiquetas hasta el límite, priorizando los más cercanos
    for (let j = 0; j < Math.min(candidateLabels.length, maxLabels); j++) {
      const candidate = candidateLabels[j];
      this.createSatelliteLabel(candidate.sat, candidate.position, candidate.index, cameraDistance);
      labelsCreated++;
    }

    console.log(`[LABELS] Creadas ${labelsCreated}/${candidateLabels.length} etiquetas (candidatos encontrados) - zoom: ${cameraDistance.toFixed(3)} - radio: ${visibilityRadius.toFixed(3)}`);
  }

  private createSatelliteLabel(sat: any, position: THREE.Vector3, index: number, cameraDistance: number) {
    const satName = this.extractSatelliteName(sat, index);
    const texture = this.createTextTexture(satName);
    
    const spriteMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.01,
      depthTest: false,
      depthWrite: false,
      sizeAttenuation: false,
      blending: THREE.NormalBlending, // Blending normal para mejor legibilidad
      opacity: 1.0 // Opacidad completa
    });

    const sprite = new THREE.Sprite(spriteMaterial);

    // 🎯 NUEVO: Offset inteligente que garantiza proximidad pero evita solapamientos
    const labelOffset = this.calculateSmartLabelOffset(position, index, cameraDistance);
    sprite.position.copy(position.clone().add(labelOffset));

    // Escala dinámica basada en la distancia de la cámara
    const scaleFactor = this.calculateLabelScale(cameraDistance);
    sprite.scale.set(scaleFactor.x, scaleFactor.y, 1);

    sprite.userData = { 
      satIndex: index, 
      satName: satName,
      satellitePosition: position.clone() // Guardamos la posición del satélite para referencia
    };

    this.scene.add(sprite);
    this.satLabels.push(sprite);
  }

  private updateExistingLabelsScale() {
    const cameraDistance = this.camera.position.distanceTo(new THREE.Vector3(0, 0, 0));
    const scaleFactor = this.calculateLabelScale(cameraDistance);

    this.satLabels.forEach((label, index) => {
      // Actualizar escala
      label.scale.set(scaleFactor.x, scaleFactor.y, 1);
      
      // 🎯 NUEVO: También actualizar posición para mantener proximidad
      if (label.userData && label.userData['satellitePosition']) {
        const satellitePosition = label.userData['satellitePosition'] as THREE.Vector3;
        const satIndex = label.userData['satIndex'] || index;
        const newOffset = this.calculateSmartLabelOffset(satellitePosition, satIndex, cameraDistance);
        label.position.copy(satellitePosition.clone().add(newOffset));
      }
    });
  }

  private clearSatelliteLabels() {
    this.satLabels.forEach(label => {
      this.scene.remove(label);
      if (label.material.map) {
        label.material.map.dispose();
      }
      label.material.dispose();
    });
    this.satLabels = [];
  }
  private async createEarth() {
    const geo = new THREE.SphereGeometry(0.1, 64, 64); // 🎯 Resolución alta para suavidad
    
    // � NASA BLUE MARBLE: Textura profesional con calibración astronómica
    const loader = new THREE.TextureLoader();
    this.earthTexture = await new Promise<THREE.Texture>((resolve, reject) => {
      loader.load(
        'assets/blue_marble_nasa_proper.jpg', // 🎯 NUEVA: Blue Marble NASA calibrada
        (texture) => {
          console.log('[EARTH] Blue Marble NASA calibrada cargada exitosamente');
          resolve(texture);
        },
        (progress) => {
          console.log('[EARTH] Progreso de carga:', (progress.loaded / progress.total * 100).toFixed(2) + '%');
        },
        (error) => {
          console.error('[EARTH] Error cargando Blue Marble NASA:', error);
          // Fallback a texturas de respaldo en orden de preferencia
          loader.load('assets/earth_4k_hd.jpg', 
            resolve, 
            undefined, 
            () => loader.load('assets/earth_continents_bw.png', resolve, undefined, reject)
          );
        }
      );
    });
    
    // 🎯 CONFIGURACIÓN OPTIMIZADA PARA PROYECCIÓN EQUIRECTANGULAR NASA
    this.earthTexture.wrapS = THREE.ClampToEdgeWrapping; // Sin repetición horizontal
    this.earthTexture.wrapT = THREE.ClampToEdgeWrapping; // Sin repetición vertical
    this.earthTexture.minFilter = THREE.LinearMipmapLinearFilter; // 🎯 MEJORADO: Mejor filtrado para zoom
    this.earthTexture.magFilter = THREE.LinearFilter; // Filtrado para magnificación
    this.earthTexture.generateMipmaps = true; // Mipmaps para mejor rendimiento
    this.earthTexture.flipY = true; // 🎯 CORREGIDO: Blue Marble NASA SÍ necesita flip para orientación correcta
    this.earthTexture.encoding = THREE.sRGBEncoding; // 🎯 NUEVO: Encoding correcto para colores naturales
    this.earthTexture.anisotropy = this.renderer.capabilities.getMaxAnisotropy(); // 🎯 NUEVO: Filtrado anisotrópico máximo
    
    console.log(`[EARTH] 🎯 Filtrado anisotrópico activado: ${this.earthTexture.anisotropy}x para máxima nitidez en zoom`);
    
    // 🎯 MATERIAL MEJORADO con configuración astronómica
    const mat = new THREE.MeshBasicMaterial({
      map: this.earthTexture,
      transparent: false,
      opacity: 1.0,
      side: THREE.FrontSide // Solo cara frontal para mejor rendimiento
    });
    
    this.earthMesh = new THREE.Mesh(geo, mat);
    
    // 🎯 PASO 2: Eliminar rotaciones forzadas - Orientación natural de la Tierra
    // Sin rotaciones iniciales para ver la orientación base de la textura
    this.earthMesh.rotation.x = 0; 
    this.earthMesh.rotation.y = 0; 
    this.earthMesh.rotation.z = 0; 
    
    this.scene.add(this.earthMesh);
    // Wireframe moderno
    const wireframe = new THREE.WireframeGeometry(geo);
    this.earthWireframe = new THREE.LineSegments(wireframe, new THREE.LineBasicMaterial({ color: 0x00ffff, linewidth: 2 }));
    // 🎯 PASO 2: Sin rotaciones forzadas - alineado con la Tierra
    this.earthWireframe.rotation.x = 0;
    this.earthWireframe.rotation.y = 0;
    this.earthWireframe.rotation.z = 0;
    this.earthWireframe.renderOrder = 1;
    this.scene.add(this.earthWireframe);
    // Líneas de latitud/longitud (grid)
    const gridGeo = new THREE.BufferGeometry();
    const gridVerts: number[] = [];
    const radius = 0.101;
    for (let lat = -60; lat <= 60; lat += 30) {
      for (let lon = 0; lon < 360; lon += 5) {
        const theta1 = THREE.MathUtils.degToRad(lon);
        const theta2 = THREE.MathUtils.degToRad(lon + 5);
        const phi = THREE.MathUtils.degToRad(lat);
        gridVerts.push(
          radius * Math.cos(phi) * Math.cos(theta1),
          radius * Math.cos(phi) * Math.sin(theta1),
          radius * Math.sin(phi),
          radius * Math.cos(phi) * Math.cos(theta2),
          radius * Math.cos(phi) * Math.sin(theta2),
          radius * Math.sin(phi)
        );
      }
    }
    for (let lon = 0; lon < 360; lon += 30) {
      for (let lat = -80; lat < 80; lat += 5) {
        const phi1 = THREE.MathUtils.degToRad(lat);
        const phi2 = THREE.MathUtils.degToRad(lat + 5);
        const theta = THREE.MathUtils.degToRad(lon);
        gridVerts.push(
          radius * Math.cos(phi1) * Math.cos(theta),
          radius * Math.cos(phi1) * Math.sin(theta),
          radius * Math.sin(phi1),
          radius * Math.cos(phi2) * Math.cos(theta),
          radius * Math.cos(phi2) * Math.sin(theta),
          radius * Math.sin(phi2)
        );
      }
    }
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridVerts, 3));
    this.earthGrid = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: 0x00ffff, opacity: 0.5, transparent: true }));
    // 🎯 PASO 2: Sin rotaciones forzadas - alineado con la Tierra
    this.earthGrid.rotation.x = 0;
    this.earthGrid.rotation.y = 0;
    this.earthGrid.rotation.z = 0;
    this.earthGrid.renderOrder = 2;
    this.scene.add(this.earthGrid);

  }
  private createReferencePoints() {
    console.log('[REFERENCE-POINTS] 📍 Creando puntos de referencia geográficos...');
    
    // Crear grupo para los puntos de referencia
    this.referencePointsMesh = new THREE.Group();
    
    // Crear cada punto de referencia
    this.REFERENCE_POINTS.forEach((point, index) => {
      // Convertir coordenadas geográficas a cartesianas usando nuestro método actual
      const position = this.geographicToCartesian(point.lat, point.lon, 5); // 5km de altura para que se vean
      
      // Crear geometría para el punto (esfera más grande que los satélites)
      const geometry = new THREE.SphereGeometry(0.002); // Más grande que satélites
      const material = new THREE.MeshBasicMaterial({ 
        color: point.color,
        transparent: false
      });
      
      const pointMesh = new THREE.Mesh(geometry, material);
      pointMesh.position.copy(position);
      
      // Metadata para identificación
      pointMesh.userData = {
        name: point.name,
        lat: point.lat,
        lon: point.lon,
        type: 'reference_point'
      };
      
      this.referencePointsMesh!.add(pointMesh);
      
      console.log(`[REFERENCE-POINTS] ${point.name}: lat=${point.lat}°, lon=${point.lon}° -> (${position.x.toFixed(4)}, ${position.y.toFixed(4)}, ${position.z.toFixed(4)})`);
    });
    
    // Añadir grupo a la escena
    this.scene.add(this.referencePointsMesh!);
    console.log(`[REFERENCE-POINTS] ✅ ${this.REFERENCE_POINTS.length} puntos de referencia creados`);
  }

  private createSatellites() {
    const sats = this.tle.getAllSatrecs();
    console.log(`[INIT] Creando ${sats.length} satélites`);

    // Tamaño razonable y color rojo puro
    const geometry = new THREE.SphereGeometry(0.0002);
    const material = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: false,
      opacity: 1.0
    });
    this.satsMesh = new THREE.InstancedMesh(geometry, material, sats.length);
    this.scene.add(this.satsMesh);

    this.worker = new Worker('assets/orbital.worker.js');
    this.workerBusy = true;

    // Inicializar loading para el primer frame
    this.loadingFirstFrame = true;
    this.loadingProgress = 0;
    this.firstFrameSatCount = sats.length;
    this.firstFrameReceived = 0;
    this.loadingStartTime = performance.now();
    this.loadingEndTime = 0;
    this.loadingElapsedMs = 0;

    // Configurar el handler del worker UNA SOLA VEZ
    this.worker.onmessage = ({ data }) => {
      if (data.type === 'tles_ready') {
        console.log('[WORKER] TLEs ready, enviando primer propagate');
        this.workerBusy = false;
        // ENVIAR EL PRIMER PROPAGATE AQUÍ
        const frustumPlanes = this.updateFrustum();
        this.workerBusy = true;
        if (this.worker) {
          this.worker.postMessage({
            type: 'propagate',
            payload: {
              date: this.simulatedDate.toISOString(),
              frustumPlanes,
              uePosition: {
                x: this.ueMesh.position.x,
                y: this.ueMesh.position.y,
                z: this.ueMesh.position.z
              }
            }
          });
        }
      }
      else if (data.type === 'debug') {
        // 🎯 DESHABILITADO: No aplicar corrección automática para evitar bucles
        const debugMsg = data.payload;
        // if (debugMsg.includes('vel=') && debugMsg.includes('km/s')) {
        //   // Extraer velocidad del mensaje de debug
        //   const velMatch = debugMsg.match(/vel=([\d.]+)km\/s/);
        //   if (velMatch) {
        //     const calculatedVel = parseFloat(velMatch[1]);
        //     // Calcular factor de corrección temporal
        //     this.orbitalTimeCorrection = this.averageOrbitalVelocity / calculatedVel;
        //     console.log(`[ORBITAL-SYNC] Velocidad calculada: ${calculatedVel.toFixed(3)} km/s`);
        //     console.log(`[ORBITAL-SYNC] Factor de corrección temporal: ${this.orbitalTimeCorrection.toFixed(4)}`);
        //   }
        // }
        console.log('[WORKER-DEBUG]', debugMsg);
      }
      else if (data.type === 'propagation_chunk') {
        // data.payload: { chunk: [{position, visible}], offset, total }
        this.updateSatellitePositionsChunk(data.payload.chunk, data.payload.offset);
        // Actualizar progreso
        if (this.loadingFirstFrame) {
          this.firstFrameReceived += data.payload.chunk.length;
          this.loadingProgress = Math.min(100, Math.round(100 * this.firstFrameReceived / this.firstFrameSatCount));
          console.log(`[CHUNK] Progreso: ${this.firstFrameReceived}/${this.firstFrameSatCount} (${this.loadingProgress}%)`);
        }
      }
      else if (data.type === 'propagation_complete' || data.type === 'propagation_result') {
        //console.log(`[WORKER] Frame completo (${data.type})`);
        // data.payload: [{position, visible}]
        this.updateSatellitePositions(data.payload);

        if (this.loadingFirstFrame) {
          this.loadingFirstFrame = false;
          this.loadingProgress = 100;
          this.loadingEndTime = performance.now();
          this.loadingElapsedMs = this.loadingEndTime - this.loadingStartTime;
          console.log(`[LOAD] Primer frame completo en ${this.loadingElapsedMs.toFixed(0)} ms.`);
        }

        // 🎯 CORREGIDO: Sistema de tiempo con corrección temporal apropiada
        if (this.useRealTime) {
          // Usar tiempo real actual - sincronización perfecta con la realidad
          this.simulatedDate = new Date();
          //console.log(`[TIME-SYNC] Usando tiempo real: ${this.simulatedDate.toISOString()}`);
        } else {
          // Modo simulación acelerada - NO aplicar corrección orbital en modo simulación
          // La corrección orbital solo debe aplicarse si hay desincronización real
          const timeIncrement = 16.67 * this.timeMultiplier; // Sin corrección orbital artificial
          this.simulatedDate = new Date(this.simulatedDate.getTime() + timeIncrement);
          console.log(`[TIME-SIM] Tiempo simulado (x${this.timeMultiplier}): ${this.simulatedDate.toISOString()}`);
        }
        
        this.lastWorkerFrameDate = new Date(this.simulatedDate);
        this.workerBusy = false; // Listo para el siguiente frame
      }
    };

    // Enviar los TLEs al worker
    console.log('[WORKER] Enviando TLEs iniciales');
    this.worker.postMessage({
      type: 'init_tles',
      payload: {
        tleData: sats.map(sat => ({ line1: sat.line1, line2: sat.line2 }))
      }
    });
  }

  private createUE() {
    this.ueMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.0004),
      new THREE.MeshBasicMaterial({ color: 0xFFA500  })
    );
    this.ueMesh.position.set(0.1, 0, 0);
    this.scene.add(this.ueMesh);
  }
  private animate = () => {
    this.frameId = requestAnimationFrame(this.animate);
    
    // Actualizar controles sin damping - solo cuando hay cambios reales
    this.controls?.update();
    
    if (!this.worker || !this.satsMesh || !this.ueMesh) return;

    // Si el primer frame está cargando, solo renderiza y espera
    if (this.loadingFirstFrame) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    // Si el worker está ocupado, solo renderiza y espera
    if (this.workerBusy) {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    // 🎯 PASO 2: Rotación temporal deshabilitada para depuración de coordenadas
    // const earthAngle = this.getEarthRotationAngle(this.lastWorkerFrameDate);
    // if (this.earthMesh) {
    //   this.earthMesh.rotation.y = earthAngle; // Solo rotación temporal
    // }
    // if (this.earthWireframe) {
    //   this.earthWireframe.rotation.y = earthAngle;
    // }
    // if (this.earthGrid) {
    //   this.earthGrid.rotation.y = earthAngle;
    // }

    // Actualizar las opacidades basadas en la decisión de handover
    const positions: THREE.Vector3[] = [];
    for (let i = 0; i < this.satsMesh.count; i++) {
      const matrix = new THREE.Matrix4();
      this.satsMesh.getMatrixAt(i, matrix);
      const position = new THREE.Vector3();
      position.setFromMatrixPosition(matrix);
      positions.push(position);
    }

    // 🎯 NUEVO: Forzar color verde brillante constante para todos los satélites
    const constantColor = new THREE.Color(0xff0000); // Verde brillante siempre
    for (let i = 0; i < this.satsMesh.count; i++) {
      this.satsMesh.setColorAt(i, constantColor);
    }

    if (this.satsMesh.instanceColor) {
      this.satsMesh.instanceColor.needsUpdate = true;
    }

    // 🎯 ASEGURAR: Métricas siempre null para mantener interfaz limpia
    this.currentMetrics = null;

    // Enviar al worker las nuevas posiciones a calcular
    const frustumPlanes = this.updateFrustum();
    this.workerBusy = true; // Bloquear hasta la siguiente respuesta
    this.worker.postMessage({
      type: 'propagate',
      payload: {
        date: this.simulatedDate.toISOString(),
        frustumPlanes,
        uePosition: {
          x: this.ueMesh.position.x,
          y: this.ueMesh.position.y,
          z: this.ueMesh.position.z
        }
      }
    });
    // Actualizar etiquetas y escala de satélites si estamos en vista detallada
    if (this.isDetailedView) {
      if (this.frameId % 15 === 0) { // Cada 15 frames para regeneración completa de etiquetas
        this.updateSatelliteLabels();
      } else if (this.frameId % 2 === 0) { // Cada 2 frames para actualizar posiciones y escalas (más frecuente)
        this.updateExistingLabelsScale();
      }
    }
    
    // Actualizar escala de satélites en todos los modos (no solo vista detallada)
    if (this.frameId % 10 === 0) { // Cada 10 frames para suavidad
      this.updateSatelliteScale();
    }

    this.renderer.render(this.scene, this.camera);
  };

  private updateSatellitePositions(satellites: { position: { x: number; y: number; z: number }; visible: boolean }[]) {
    if (!this.satsMesh) return;
    
    const cameraDistance = this.camera.position.distanceTo(new THREE.Vector3(0, 0, 0));
    const scale = this.calculateSatelliteScale(cameraDistance);
    
    satellites.forEach((sat, index) => {
      if (sat.visible) {
        // 🎯 NUEVO: Usar coordenadas reales directas del worker (ya están en escala visual correcta)
        const pos = new THREE.Vector3(
          sat.position.x, // Coordenadas ya escaladas correctamente en el worker
          sat.position.y,
          sat.position.z
        );
        
    // 🎯 CORREGIDO: Solo alinear con el sistema Three.js + calibración geográfica
    // Aplicar rotación para alinear con Three.js Y luego ajuste de calibración
    pos.applyAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    
    // 🎯 RESTAURAR: Calibración geográfica (rotación adicional para alinear Greenwich)
    const calibrationAngleRad = THREE.MathUtils.degToRad(this.CALIBRATION_OFFSET_DEGREES);
    pos.applyAxisAngle(new THREE.Vector3(0, 1, 0), calibrationAngleRad);
        
        // Aplicar posición y escala dinámica
        this.instanceMatrix.makeScale(scale, scale, scale);
        this.instanceMatrix.setPosition(pos.x, pos.y, pos.z);
        
        if (this.satsMesh) {
          this.satsMesh.setMatrixAt(index, this.instanceMatrix);
        }
      }
    });

    if (this.satsMesh.instanceMatrix) {
      this.satsMesh.instanceMatrix.needsUpdate = true;
    }
  }
  private updateFrustum() {
    this.frustumMatrix.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse
    );
    this.frustum.setFromProjectionMatrix(this.frustumMatrix);
    return this.frustum.planes.map(plane => [plane.normal.x, plane.normal.y, plane.normal.z, plane.constant]);
  }

  updateUserPosition() {
    // 🎯 MEJORADO: Usar conversión geográfica precisa
    const position = this.geographicToCartesian(this.userLat, this.userLon, 0);
    
    if (this.ueMesh) {
      this.ueMesh.position.copy(position);
      console.log(`[UE-POS] Usuario ubicado en: lat=${this.userLat}°, lon=${this.userLon}° -> (${position.x.toFixed(4)}, ${position.y.toFixed(4)}, ${position.z.toFixed(4)})`);
    }
  }

  private updateSatellitePositionsChunk(chunk: { position: { x: number; y: number; z: number }; visible: boolean }[], offset: number) {
    if (!this.satsMesh) return;
    
    const cameraDistance = this.camera.position.distanceTo(new THREE.Vector3(0, 0, 0));
    const scale = this.calculateSatelliteScale(cameraDistance);
    
    chunk.forEach((sat, i) => {
      if (sat.visible) {
        // 🎯 NUEVO: Usar coordenadas reales directas del worker (ya están en escala visual correcta)
        const pos = new THREE.Vector3(
          sat.position.x, // Coordenadas ya escaladas correctamente en el worker
          sat.position.y,
          sat.position.z
        );
        
        // 🎯 CORREGIDO: Solo alinear con el sistema Three.js + calibración geográfica
        pos.applyAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
        
        // 🎯 RESTAURAR: Calibración geográfica (rotación adicional para alinear Greenwich)
        const calibrationAngleRad = THREE.MathUtils.degToRad(this.CALIBRATION_OFFSET_DEGREES);
        pos.applyAxisAngle(new THREE.Vector3(0, 1, 0), calibrationAngleRad);
        
        // Aplicar posición y escala dinámica
        this.instanceMatrix.makeScale(scale, scale, scale);
        this.instanceMatrix.setPosition(pos.x, pos.y, pos.z);
        
        if (this.satsMesh) {
          this.satsMesh.setMatrixAt(offset + i, this.instanceMatrix);
        }
      }
    });
    
    if (this.satsMesh.instanceMatrix) {
      this.satsMesh.instanceMatrix.needsUpdate = true;
    }
  }
  // Método para resetear el tiempo simulado o resincronizar con tiempo real
  resetSimTime() {
    if (this.useRealTime) {
      // this.resyncWithRealTime(); // 🎯 COMENTADO: Método no implementado aún
      this.simulatedDate = new Date();
      console.log('[TIME-RESET] ⏰ Tiempo resincronizado con tiempo real');
    } else {
      this.simulatedDate = new Date();
      console.log('[TIME-RESET] ⏰ Tiempo simulado reseteado al actual');
    }
  }
  private extractSatelliteName(sat: any, index: number): string {
    // Debug solo para los primeros 3 satélites para no saturar
    if (index < 3) {
      console.log(`[DEBUG] Satélite ${index}:`, sat);
    }

    // Verificar si hay un nombre directo
    if (sat.name && sat.name.trim() !== '') {
      return sat.name.trim();
    }

    // Intentar obtener del line0 si existe
    if (sat.line0 && sat.line0.trim() !== '') {
      return sat.line0.trim();
    }

    // Si no hay nombre directo, extraer del número de catálogo de la línea 1
    if (sat.line1 && sat.line1.length >= 7) {
      const catalogNumber = sat.line1.substring(2, 7).trim();
      // Remover ceros a la izquierda si los hay
      const cleanNumber = catalogNumber.replace(/^0+/, '') || catalogNumber;
      return `STARLINK-${cleanNumber}`;
    }

    // Intentar extraer de line2 si line1 no funciona
    if (sat.line2 && sat.line2.length >= 7) {
      const catalogNumber = sat.line2.substring(2, 7).trim();
      const cleanNumber = catalogNumber.replace(/^0+/, '') || catalogNumber;
      return `STARLINK-${cleanNumber}`;
    }

    // Fallback único
    return `SAT-${index + 1}`;
  }
  private calculateLabelScale(cameraDistance: number): { x: number; y: number } {
    // Escala base para etiquetas tipo cuadro como en la imagen
    const baseScale = { x: 0.3, y: 0.08 }; 

    // Factor de escala adaptado al zoom
    let scaleFactor = 1;

    if (cameraDistance <= 0.12) {
      // Zoom máximo - etiquetas pequeñas pero legibles
      scaleFactor = 0.75;
    } else if (cameraDistance <= 0.15) {
      // Zoom alto - etiquetas normales
      scaleFactor = 0.8;
    } else if (cameraDistance <= 0.2) {
      // Zoom medio - etiquetas estándar
      scaleFactor = 1.0;
    } else if (cameraDistance <= 0.3) {
      // Zoom bajo - etiquetas más grandes
      scaleFactor = 1.3;
    } else {
      // Sin zoom - etiquetas grandes
      scaleFactor = 1.6;
    }

    return {
      x: baseScale.x * scaleFactor,
      y: baseScale.y * scaleFactor
    };
  }

  /**
   * Calcula el factor de escala para los satélites basado en la distancia de la cámara
   * Los satélites se hacen más pequeños al acercarse (zoom in) para mejor visibilidad
   */
  private calculateSatelliteScale(cameraDistance: number): number {
    // Escala base para los satélites
    const baseScale = 1.0;
    
    let scaleFactor = 1;
    
    if (cameraDistance <= 0.12) {
      // Zoom máximo - satélites más pequeños para no saturar la vista
      scaleFactor = 0.4;
    } else if (cameraDistance <= 0.15) {
      // Zoom alto - satélites pequeños
      scaleFactor = 0.6;
    } else if (cameraDistance <= 0.2) {
      // Zoom medio - satélites tamaño normal-pequeño
      scaleFactor = 0.8;
    } else if (cameraDistance <= 0.3) {
      // Zoom bajo - satélites tamaño normal
      scaleFactor = 1.0;
    } else {
      // Sin zoom - satélites más grandes para vista general
      scaleFactor = 1.4;
    }
    
    return baseScale * scaleFactor;
  }

  /**
   * Actualiza el tamaño de todos los satélites basado en la distancia de la cámara
   */
  private updateSatelliteScale() {
    if (!this.satsMesh) return;
    
    const cameraDistance = this.camera.position.distanceTo(new THREE.Vector3(0, 0, 0));
    const scale = this.calculateSatelliteScale(cameraDistance);
    
    // Aplicar la escala a todas las instancias
    for (let i = 0; i < this.satsMesh.count; i++) {
      // Obtener la matriz actual
      this.satsMesh.getMatrixAt(i, this.instanceMatrix);
      
      // Extraer posición y rotación, aplicar nueva escala
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const currentScale = new THREE.Vector3();
      this.instanceMatrix.decompose(position, quaternion, currentScale);
      
      // Crear nueva matriz con la escala actualizada
      this.instanceMatrix.compose(position, quaternion, new THREE.Vector3(scale, scale, scale));
      this.satsMesh.setMatrixAt(i, this.instanceMatrix);
    }
    
    if (this.satsMesh.instanceMatrix) {
      this.satsMesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * 🎯 NUEVO: Crear traza orbital usando elementos kepler (órbitas elípticas reales)
   */
  private createKeplerianOrbitTrace(elements: any, index: number): THREE.Line | null {
    try {
      const points: THREE.Vector3[] = [];
      
      // Validar elementos orbitales
      if (!elements || isNaN(elements.semiMajorAxis) || isNaN(elements.inclination)) {
        console.warn(`[KEPLER-ORBIT] Elementos orbitales inválidos para satélite ${index}`);
        return null;
      }

      console.log(`[KEPLER-ORBIT] Creando órbita para ${elements.name}:`);
      console.log(`  Semi-eje mayor: ${elements.semiMajorAxis.toFixed(1)} km`);
      console.log(`  Excentricidad: ${elements.eccentricity.toFixed(6)}`);
      console.log(`  Inclinación: ${elements.inclination.toFixed(2)}°`);

      // Convertir elementos a radianes
      const inc = THREE.MathUtils.degToRad(elements.inclination);
      const raan = THREE.MathUtils.degToRad(elements.raan);
      const argPer = THREE.MathUtils.degToRad(elements.argumentOfPeriapsis);
      
      // Parámetros orbitales
      const a = elements.semiMajorAxis; // km
      const e = elements.eccentricity;
      
      // Factor de escala del simulador
      const kmToVisualScale = 0.1 / 6371; // 0.1 = radio visual de la Tierra
      
      // Número de puntos para la órbita (más puntos para órbitas más excéntricas)
      const numPoints = e > 0.1 ? 128 : 64;
      
      // Generar puntos de la órbita elíptica usando anomalía eccéntrica
      for (let i = 0; i <= numPoints; i++) {
        const E = (i / numPoints) * 2 * Math.PI; // Anomalía eccéntrica
        
        // Coordenadas en el plano orbital (ecuación de Kepler)
        const r = a * (1 - e * Math.cos(E)); // Radio vector
        const x_orb = r * Math.cos(E) - a * e; // Posición X en plano orbital
        const y_orb = r * Math.sin(E) * Math.sqrt(1 - e * e); // Posición Y en plano orbital
        const z_orb = 0; // En el plano orbital
        
        // Matrices de rotación para transformar del plano orbital al sistema inercial
        // Rotación 1: Argumento del periapsis
        const x1 = x_orb * Math.cos(argPer) - y_orb * Math.sin(argPer);
        const y1 = x_orb * Math.sin(argPer) + y_orb * Math.cos(argPer);
        const z1 = z_orb;
        
        // Rotación 2: Inclinación
        const x2 = x1;
        const y2 = y1 * Math.cos(inc) - z1 * Math.sin(inc);
        const z2 = y1 * Math.sin(inc) + z1 * Math.cos(inc);
        
        // Rotación 3: Ascensión del nodo
        const x3 = x2 * Math.cos(raan) - y2 * Math.sin(raan);
        const y3 = x2 * Math.sin(raan) + y2 * Math.cos(raan);
        const z3 = z2;
        
        // Convertir a escala del simulador
        const pos = new THREE.Vector3(
          x3 * kmToVisualScale,
          y3 * kmToVisualScale,
          z3 * kmToVisualScale
        );
        
        // Aplicar las mismas transformaciones que los satélites
        // Rotación para alinear con el sistema de coordenas del simulador
        pos.applyAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
        
        // Aplicar calibración geográfica
        const calibrationAngleRad = THREE.MathUtils.degToRad(this.CALIBRATION_OFFSET_DEGREES);
        pos.applyAxisAngle(new THREE.Vector3(0, 1, 0), calibrationAngleRad);
        
        // Verificar que las coordenadas sean válidas
        if (!isNaN(pos.x) && !isNaN(pos.y) && !isNaN(pos.z) &&
            isFinite(pos.x) && isFinite(pos.y) && isFinite(pos.z)) {
          points.push(pos);
        }
      }
      
      // Crear la geometría si tenemos suficientes puntos
      if (points.length >= numPoints * 0.8) {
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(geometry, this.orbitalTraceMaterial!);
        
        // Metadata
        line.userData = {
          satelliteIndex: index,
          satelliteName: elements.name,
          orbitalElements: elements,
          pointCount: points.length,
          traceType: 'keplerian',
          eccentricity: elements.eccentricity,
          inclination: elements.inclination
        };
        
        console.log(`[KEPLER-ORBIT] ✅ Órbita kepleriana creada para ${elements.name}: ${points.length} puntos, e=${elements.eccentricity.toFixed(4)}`);
        return line;
      } else {
        console.warn(`[KEPLER-ORBIT] ⚠️ Insuficientes puntos válidos para ${elements.name}: ${points.length}/${numPoints}`);
        return null;
      }
    } catch (error) {
      console.error(`[KEPLER-ORBIT] Error creando órbita kepleriana para satélite ${index}:`, error);
      return null;
    }
  }

  // 🎯 SISTEMA CORREGIDO: Crear trazas orbitales sincronizadas con posiciones reales
  private createOrbitalTraces() {
    console.log('[ORBITAL-TRACES-V4] 🚀 Iniciando sistema corregido sincronizado con posiciones reales...');
    
    // Limpiar trazas existentes
    if (this.orbitalTraces) {
      this.scene.remove(this.orbitalTraces);
      this.orbitalTraces.children.forEach(child => {
        if (child instanceof THREE.Line && child.geometry) {
          child.geometry.dispose();
        }
      });
    }

    this.orbitalTraces = new THREE.Group();
    
    // Material para las líneas orbitales
    this.orbitalTraceMaterial = new THREE.LineBasicMaterial({
      color: 0xffff00,
      transparent: true,
      opacity: 0.8,
      linewidth: 1
    });

    // NUEVA ESTRATEGIA: Sincronizar con posiciones actuales de satélites
    if (!this.satsMesh) {
      console.warn('[ORBITAL-TRACES-V4] ⚠️ No hay satélites cargados');
      return;
    }

    const sats = this.tle.getAllSatrecs();
    console.log(`[ORBITAL-TRACES-V4] Creando ${sats.length} trazas sincronizadas...`);

    let successfulTraces = 0;

    // Procesar cada satélite usando su posición real actual
    sats.forEach((sat, index) => {
      try {
        // Obtener posición actual del satélite en el simulador
        this.satsMesh!.getMatrixAt(index, this.instanceMatrix);
        const currentSatPosition = new THREE.Vector3();
        currentSatPosition.setFromMatrixPosition(this.instanceMatrix);

        // Extraer elementos orbitales del TLE
        const orbitalElements = this.extractOrbitalElements(sat, index);
        
        if (orbitalElements && currentSatPosition) {
          // Crear traza que pase por la posición actual del satélite
          const trace = this.createSynchronizedOrbitTrace(orbitalElements, currentSatPosition, index);
          
          if (trace) {
            this.orbitalTraces!.add(trace);
            successfulTraces++;
          }
        }
      } catch (error) {
        console.warn(`[ORBITAL-TRACES-V4] Error en satélite ${index}:`, error);
      }
    });

    if (successfulTraces > 0) {
      this.scene.add(this.orbitalTraces);
      console.log(`[ORBITAL-TRACES-V4] ✅ ${successfulTraces} trazas sincronizadas creadas exitosamente`);
    } else {
      console.error('[ORBITAL-TRACES-V4] ❌ No se pudieron crear trazas orbitales');
    }
  }

  // 🎯 MÉTODOS PÚBLICOS ACTUALIZADOS: Controlar trazas orbitales
  public toggleOrbitalTraces(): void {
    this.orbitalTracesVisible = !this.orbitalTracesVisible;
    
    if (this.orbitalTraces) {
      this.orbitalTraces.visible = this.orbitalTracesVisible;
      console.log(`[ORBITAL-TRACES-V2] Trazas orbitales ${this.orbitalTracesVisible ? 'activadas' : 'desactivadas'}`);
    } else {
      this.createOrbitalTraces();
    }
  }

  public recreateOrbitalTraces(): void {
    console.log('[ORBITAL-TRACES-V2] Recreando trazas orbitales...');
    this.createOrbitalTraces();
  }

  public hideOrbitalTraces(): void {
    if (this.orbitalTraces) {
      this.orbitalTraces.visible = false;
      this.orbitalTracesVisible = false;
      console.log('[ORBITAL-TRACES-V2] Trazas orbitales ocultadas');
    }
  }

  public showOrbitalTraces(): void {
    if (this.orbitalTraces) {
      this.orbitalTraces.visible = true;
      this.orbitalTracesVisible = true;
      console.log('[ORBITAL-TRACES-V2] Trazas orbitales mostradas');
    } else {
      this.createOrbitalTraces();
    }
  }

  public getOrbitalTracesInfo(): void {
    if (this.orbitalTraces) {
      console.log(`[ORBITAL-TRACES-V2] Estado actual:`);
      console.log(`  Visible: ${this.orbitalTraces.visible}`);
      console.log(`  Número de trazas: ${this.orbitalTraces.children.length}`);
      
      this.orbitalTraces.children.forEach((trace, index) => {
        const userData = trace.userData;
        console.log(`  Traza ${index}: ${userData['satelliteName']} (${userData['pointCount']} puntos)`);
      });
    } else {
      console.log('[ORBITAL-TRACES-V2] No hay trazas orbitales creadas');
    }
  }

  // 🎯 NUEVO MÉTODO: Crear traza orbital circular basada en posición actual
  private createCircularOrbitTrace(satellitePosition: THREE.Vector3, index: number): THREE.Line | null {
    try {
      const points: THREE.Vector3[] = [];
      const earthCenter = new THREE.Vector3(0, 0, 0);
      
      // Calcular el radio orbital (distancia desde el centro de la Tierra)
      const orbitalRadius = satellitePosition.distanceTo(earthCenter);
      
      // Verificar que el radio sea razonable (satélites LEO: ~0.11-0.12 en nuestra escala)
      if (orbitalRadius < 0.105 || orbitalRadius > 0.25) {
        console.warn(`[ORBITAL-TRACES-V2] Satélite ${index}: Radio orbital fuera de rango: ${orbitalRadius.toFixed(4)}`);
        return null;
      }

      // Crear un plano orbital basado en la posición actual
      // Asumimos órbita circular en el plano que pasa por la posición actual
      const numPoints = 64; // Círculo suave con 64 puntos
      
      // Vector normal al plano orbital (simplificado: usamos la posición como normal)
      const normal = satellitePosition.clone().normalize();
      
      // Crear dos vectores perpendiculares en el plano orbital
      const tempVector = new THREE.Vector3(0, 1, 0);
      if (Math.abs(normal.dot(tempVector)) > 0.9) {
        tempVector.set(1, 0, 0); // Cambiar si son casi paralelos
      }
      
      const tangent1 = new THREE.Vector3().crossVectors(normal, tempVector).normalize();
      const tangent2 = new THREE.Vector3().crossVectors(normal, tangent1).normalize();
      
      // Generar puntos del círculo orbital
      for (let i = 0; i < numPoints; i++) {
        const angle = (i / numPoints) * Math.PI * 2;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        
        // Punto en el círculo orbital
        const point = new THREE.Vector3()
          .addScaledVector(tangent1, cos * orbitalRadius)
          .addScaledVector(tangent2, sin * orbitalRadius);
        
        // Verificar que el punto sea válido
        if (!isNaN(point.x) && !isNaN(point.y) && !isNaN(point.z) &&
            isFinite(point.x) && isFinite(point.y) && isFinite(point.z)) {
          points.push(point);
        }
      }
      
      // Cerrar el círculo
      if (points.length > 0) {
        points.push(points[0].clone());
      }
      
      // Crear la geometría solo si tenemos suficientes puntos
      if (points.length >= numPoints * 0.8) { // Al menos 80% de los puntos
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(geometry, this.orbitalTraceMaterial!);
        
        // Metadata
        line.userData = {
          satelliteIndex: index,
          satelliteName: `SAT-${index + 1}`,
          orbitalRadius: orbitalRadius,
          pointCount: points.length,
          traceType: 'circular'
        };
        
        console.log(`[ORBITAL-TRACES-V2] ✅ Traza circular creada para SAT-${index + 1}: radio=${orbitalRadius.toFixed(4)}, puntos=${points.length}`);
        return line;
      } else {
        console.warn(`[ORBITAL-TRACES-V2] ⚠️ Insuficientes puntos válidos para satélite ${index}: ${points.length}/${numPoints}`);
        return null;
      }
    } catch (error) {
      console.warn(`[ORBITAL-TRACES-V2] Error creando traza circular para satélite ${index}:`, error);
      return null;
    }
  }

  // 🎯 NUEVO: Extraer elementos orbitales del TLE (formato manual robusto)
  private extractOrbitalElements(sat: any, index: number): any | null {
    try {
      if (!sat.line1 || !sat.line2) {
        console.warn(`[TLE-PARSER] Satélite ${index}: TLE incompleto`);
        return null;
      }

      const line1 = sat.line1;
      const line2 = sat.line2;

      // Validar longitud de líneas TLE
      if (line1.length !== 69 || line2.length !== 69) {
        console.warn(`[TLE-PARSER] Satélite ${index}: Longitud TLE incorrecta`);
        return null;
      }

      // PARSEO MANUAL DE ELEMENTOS ORBITALES
      const elements: any = {
        // Línea 1
        satelliteNumber: parseInt(line1.substring(2, 7)),
        epoch: parseFloat(line1.substring(18, 32)),
        meanMotionDot: parseFloat(line1.substring(33, 43)),
        meanMotionDotDot: parseFloat(line1.substring(44, 52)),
        bstar: parseFloat(line1.substring(53, 61)),
        
        // Línea 2  
        inclination: parseFloat(line2.substring(8, 16)), // grados
        raan: parseFloat(line2.substring(17, 25)), // ascensión nodo, grados
        eccentricity: parseFloat('0.' + line2.substring(26, 33)), // sin punto decimal
        argumentOfPeriapsis: parseFloat(line2.substring(34, 42)), // grados
        meanAnomaly: parseFloat(line2.substring(43, 51)), // grados
        meanMotion: parseFloat(line2.substring(52, 63)), // rev/día
        
        // Datos calculados
        name: this.extractSatelliteName(sat, index)
      };

      // Calcular semi-eje mayor desde el movimiento medio
      // a³ = (GM * T²) / (4π²) donde T = 1440 min / meanMotion
      const GM = 398600.4418; // km³/s² (constante gravitacional * masa Tierra)
      const minutesPerDay = 1440;
      const period = minutesPerDay / elements.meanMotion; // minutos
      const periodSeconds = period * 60; // segundos
      
      const semiMajorAxis = Math.pow((GM * periodSeconds * periodSeconds) / (4 * Math.PI * Math.PI), 1/3);
      elements.semiMajorAxis = semiMajorAxis; // km

      // Calcular altura del perigeo y apogeo
      const earthRadius = 6371; // km
      elements.perigeeHeight = semiMajorAxis * (1 - elements.eccentricity) - earthRadius;
      elements.apogeeHeight = semiMajorAxis * (1 + elements.eccentricity) - earthRadius;

      console.log(`[TLE-PARSER] ${elements.name}:`);
      console.log(`  Inclinación: ${elements.inclination.toFixed(2)}°`);
      console.log(`  Excentricidad: ${elements.eccentricity.toFixed(6)}`);
      console.log(`  Semi-eje mayor: ${elements.semiMajorAxis.toFixed(1)} km`);
      console.log(`  Altura perigeo: ${elements.perigeeHeight.toFixed(1)} km`);
      console.log(`  Altura apogeo: ${elements.apogeeHeight.toFixed(1)} km`);
      console.log(`  Período: ${period.toFixed(1)} min`);

      return elements;
    } catch (error) {
      console.error(`[TLE-PARSER] Error parseando satélite ${index}:`, error);
      return null;
    }
  }

  // 🎯 MÉTODO DE DIAGNÓSTICO: Analizar elementos orbitales de los TLEs actuales
  public analyzeTLEOrbitalElements(): void {
    console.log('[TLE-ORBITAL-ANALYSIS] 🔍 Analizando elementos orbitales de los TLEs...');
    
    const sats = this.tle.getAllSatrecs();
    console.log(`[TLE-ORBITAL-ANALYSIS] Procesando ${sats.length} satélites...`);
    
    sats.forEach((sat, index) => {
      const elements = this.extractOrbitalElements(sat, index);
      
      if (elements) {
        console.log(`\n[TLE-ORBITAL-ANALYSIS] === ${elements.name} ===`);
        console.log(`  📊 Altura del perigeo: ${elements.perigeeHeight.toFixed(1)} km`);
        console.log(`  📊 Altura del apogeo: ${elements.apogeeHeight.toFixed(1)} km`);
        console.log(`  📊 Excentricidad: ${elements.eccentricity.toFixed(6)} ${this.getEccentricityCategory(elements.eccentricity)}`);
        console.log(`  📊 Inclinación: ${elements.inclination.toFixed(2)}° ${this.getInclinationCategory(elements.inclination)}`);
        console.log(`  📊 Período orbital: ${(1440 / elements.meanMotion).toFixed(1)} minutos`);
        console.log(`  📊 Velocidad orbital promedio: ${this.calculateOrbitalVelocity(elements.semiMajorAxis).toFixed(2)} km/s`);
        
        // Análisis de la época del TLE
        const epochAge = this.calculateEpochAge(elements.epoch);
        console.log(`  ⏰ Época del TLE: ${epochAge.toFixed(1)} días ${epochAge > 30 ? '🔴 (MUY ANTIGUO)' : epochAge > 7 ? '🟡 (ANTIGUO)' : '🟢 (RECIENTE)'}`);
        
        // Análisis del coeficiente de drag
        if (elements.bstar < -0.0001) {
          console.log(`  🚨 ALERTA: Coeficiente de drag muy alto (${elements.bstar.toExponential(2)}) - POSIBLE DEORBITADO`);
        }
      }
    });
  }

  // Helper: Categorizar excentricidad
  private getEccentricityCategory(eccentricity: number): string {
    if (eccentricity < 0.01) return '🔵 (Circular)';
    if (eccentricity < 0.1) return '🟢 (Ligeramente elíptica)';
    if (eccentricity < 0.3) return '🟡 (Moderadamente elíptica)';
    return '🔴 (Muy elíptica)';
  }

  // Helper: Categorizar inclinación
  private getInclinationCategory(inclination: number): string {
    if (inclination < 10) return '🔵 (Ecuatorial)';
    if (inclination < 30) return '🟢 (Baja)';
    if (inclination < 60) return '🟡 (Media)';
    if (inclination < 90) return '🟠 (Alta)';
    if (inclination < 110) return '🔴 (Polar)';
    return '🟣 (Retrógrada)';
  }

  // Helper: Calcular velocidad orbital promedio
  private calculateOrbitalVelocity(semiMajorAxis: number): number {
    const GM = 398600.4418; // km³/s²
    return Math.sqrt(GM / semiMajorAxis);
  }

 

  // Helper: Calcular edad de la época del TLE
  private calculateEpochAge(epoch: number): number {
    // Convertir época a fecha actual
    const year = Math.floor(epoch / 1000) + 2000;
    const dayOfYear = epoch % 1000;
    const epochDate = new Date(year, 0, dayOfYear);
    const now = new Date();
    return (now.getTime() - epochDate.getTime()) / (1000 * 60 * 60 * 24);
  }

  // 🎯 MÉTODO SIMPLE: Calcular offset para etiquetas
  private calculateSmartLabelOffset(position: THREE.Vector3, index: number, cameraDistance: number): THREE.Vector3 {
    // Dirección desde el centro de la Tierra hacia el satélite
    const directionFromEarth = position.clone().normalize();
    
    // Offset base dependiente del zoom de la cámara
    const baseOffset = cameraDistance < 0.15 ? 0.01 : 0.02;
    
    // Aplicar offset simple hacia afuera
    return directionFromEarth.multiplyScalar(baseOffset);
  }

  // 🎯 NUEVOS MÉTODOS PÚBLICOS: Control de puntos de referencia
  public toggleReferencePoints(): void {
    if (this.referencePointsMesh) {
      this.referencePointsMesh.visible = !this.referencePointsMesh.visible;
      console.log(`[REFERENCE] Puntos de referencia ${this.referencePointsMesh.visible ? 'mostrados' : 'ocultados'}`);
    } else {
      console.log('[REFERENCE] No hay puntos de referencia creados');
    }
  }

  public listReferencePoints(): void {
    console.log('[REFERENCE] 📍 Puntos de referencia geográficos:');
    this.REFERENCE_POINTS.forEach((point, index) => {
      const position = this.geographicToCartesian(point.lat, point.lon, 5);
      console.log(`  ${index + 1}. ${point.name}:`);
      console.log(`     Coordenadas: lat=${point.lat}°, lon=${point.lon}°`);
      console.log(`     Posición 3D: (${position.x.toFixed(4)}, ${position.y.toFixed(4)}, ${position.z.toFixed(4)})`);
      console.log(`     Color: #${point.color.toString(16)}`);
    });
  }

  public hideReferencePoints(): void {
    if (this.referencePointsMesh) {
      this.referencePointsMesh.visible = false;
      console.log('[REFERENCE] Puntos de referencia ocultados');
    }
  }

  public showReferencePoints(): void {
    if (this.referencePointsMesh) {
      this.referencePointsMesh.visible = true;
      console.log('[REFERENCE] Puntos de referencia mostrados');
    } else {
      console.log('[REFERENCE] Creando puntos de referencia...');
      this.createReferencePoints();
    }
  }

  // 🎯 PASO 2: Método para evaluar el sistema de coordenadas actual
  public evaluateCoordinateSystem(): void {
    console.log('[COORDS-EVAL] 🔍 Evaluando sistema de coordenadas actual...');
    console.log('[COORDS-EVAL] Estado: Tierra sin rotaciones, coordenadas estándar');
    
    // Evaluar puntos de referencia específicos
    const testPoints = [
      { name: "Greenwich (0,0)", lat: 0, lon: 0, expected: "Frente a la cámara inicial" },
      { name: "Greenwich Observatorio", lat: 51.4769, lon: 0.0005, expected: "Norte de Europa" },
      { name: "Polo Norte", lat: 90, lon: 0, expected: "Arriba (Y+)" },
      { name: "Polo Sur", lat: -90, lon: 0, expected: "Abajo (Y-)" },
      { name: "Pacífico (0,-90)", lat: 0, lon: -90, expected: "Lado izquierdo" },
      { name: "Índico (0,90)", lat: 0, lon: 90, expected: "Lado derecho" },
      { name: "Antípoda Greenwich (0,180)", lat: 0, lon: 180, expected: "Parte trasera" }
    ];
    
    console.log('[COORDS-EVAL] 📍 Posiciones calculadas vs esperadas:');
    testPoints.forEach(point => {
      const pos = this.geographicToCartesian(point.lat, point.lon, 0);
      console.log(`  ${point.name}:`);
      console.log(`    Calculado: (${pos.x.toFixed(4)}, ${pos.y.toFixed(4)}, ${pos.z.toFixed(4)})`);
      console.log(`    Esperado: ${point.expected}`);
    });
    
    // Información sobre la textura
    console.log('[COORDS-EVAL] 🌍 Información de la textura:');
    if (this.earthTexture) {
      console.log(`    flipY: ${this.earthTexture.flipY}`);
      console.log(`    wrapS: ${this.earthTexture.wrapS === THREE.ClampToEdgeWrapping ? 'ClampToEdge' : 'Repeat'}`);
      console.log(`    wrapT: ${this.earthTexture.wrapT === THREE.ClampToEdgeWrapping ? 'ClampToEdge' : 'Repeat'}`);
    }
    
    // Estado de la malla de la Tierra
    if (this.earthMesh) {
      console.log('[COORDS-EVAL] 🌐 Rotaciones de la Tierra:');
      console.log(`    X: ${this.earthMesh.rotation.x.toFixed(4)} rad (${THREE.MathUtils.radToDeg(this.earthMesh.rotation.x).toFixed(2)}°)`);
      console.log(`    Y: ${this.earthMesh.rotation.y.toFixed(4)} rad (${THREE.MathUtils.radToDeg(this.earthMesh.rotation.y).toFixed(2)}°)`);
      console.log(`    Z: ${this.earthMesh.rotation.z.toFixed(4)} rad (${THREE.MathUtils.radToDeg(this.earthMesh.rotation.z).toFixed(2)}°)`);
    }
    
    console.log('[COORDS-EVAL] 💡 Para rotar manualmente la Tierra:');
    console.log('[COORDS-EVAL]    starlinkVisualizer.rotateEarth(x, y, z) // en grados');
  }

  // 🎯 MÉTODO AUXILIAR: Rotar la Tierra manualmente para pruebas
  public rotateEarth(xDeg: number, yDeg: number, zDeg: number): void {
    if (this.earthMesh) {
      this.earthMesh.rotation.x = THREE.MathUtils.degToRad(xDeg);
      this.earthMesh.rotation.y = THREE.MathUtils.degToRad(yDeg);
      this.earthMesh.rotation.z = THREE.MathUtils.degToRad(zDeg);
      
      // También rotar wireframe y grid
      if (this.earthWireframe) {
        this.earthWireframe.rotation.x = THREE.MathUtils.degToRad(xDeg);
        this.earthWireframe.rotation.y = THREE.MathUtils.degToRad(yDeg);
        this.earthWireframe.rotation.z = THREE.MathUtils.degToRad(zDeg);
      }
      if (this.earthGrid) {
        this.earthGrid.rotation.x = THREE.MathUtils.degToRad(xDeg);
        this.earthGrid.rotation.y = THREE.MathUtils.degToRad(yDeg);
        this.earthGrid.rotation.z = THREE.MathUtils.degToRad(zDeg);
      }
      
      console.log(`[COORDS] Tierra rotada a: X=${xDeg}°, Y=${yDeg}°, Z=${zDeg}°`);
    }
  }

  // 🎯 NUEVOS MÉTODOS: Control de posición del UE
  public moveUETo(lat: number, lon: number, alt: number = 0): void {
    console.log(`[UE-MOVE] 📍 Moviendo UE a: lat=${lat}°, lon=${lon}°, alt=${alt}km`);
    
    // Actualizar las propiedades del componente
    this.userLat = lat;
    this.userLon = lon;
    
    // Calcular nueva posición usando nuestro sistema de coordenadas
    const position = this.geographicToCartesian(lat, lon, alt);
    
    if (this.ueMesh) {
      this.ueMesh.position.copy(position);
      console.log(`[UE-MOVE] ✅ UE posicionado en: (${position.x.toFixed(4)}, ${position.y.toFixed(4)}, ${position.z.toFixed(4)})`);
      
      // Verificar que el UE esté visible
      const distanceFromCenter = position.distanceTo(new THREE.Vector3(0, 0, 0));
      console.log(`[UE-MOVE] Distancia desde centro: ${distanceFromCenter.toFixed(4)} (Tierra radio: 0.1)`);
      
      // Hacer el UE más grande para que sea más visible
      if (this.ueMesh.scale.x < 2) {
        this.ueMesh.scale.set(2, 2, 2);
        console.log(`[UE-MOVE] UE escalado para mejor visibilidad`);
      }
    }
  }

  // 🎯 MÉTODO DE PRUEBA: Probar ubicaciones conocidas
  public testUELocations(): void {
    console.log('[UE-TEST] 🌍 Probando ubicaciones conocidas para verificar calibración...');
    
    const testLocations = [
      { name: "Madrid, España", lat: 40.4168, lon: -3.7038, description: "Capital de España" },
      { name: "Nueva York, EE.UU.", lat: 40.7128, lon: -74.0060, description: "Gran manzana" },
      { name: "Tokio, Japón", lat: 35.6762, lon: 139.6503, description: "Capital japonesa" },
      { name: "Sydney, Australia", lat: -33.8688, lon: 151.2093, description: "Hemisferio sur" },
      { name: "Ciudad de México", lat: 19.4326, lon: -99.1332, description: "América Central" },
      { name: "Londres, Reino Unido", lat: 51.5074, lon: -0.1278, description: "Cerca de Greenwich" },
      { name: "Cairo, Egipto", lat: 30.0444, lon: 31.2357, description: "Norte de África" },
      { name: "Mumbai, India", lat: 19.0760, lon: 72.8777, description: "Costa oeste de India" },
      { name: "São Paulo, Brasil", lat: -23.5505, lon: -46.6333, description: "Sudamérica" },
      { name: "Moscú, Rusia", lat: 55.7558, lon: 37.6176, description: "Europa del Este" }
    ];
    
    console.log('[UE-TEST] 📋 Ubicaciones de prueba disponibles:');
    testLocations.forEach((location, index) => {
      console.log(`  ${index + 1}. ${location.name} (${location.lat}°, ${location.lon}°) - ${location.description}`);
    });
    
    console.log('[UE-TEST] 💡 Para probar una ubicación específica:');
    console.log('[UE-TEST]    starlinkVisualizer.moveUETo(lat, lon)');
    console.log('[UE-TEST] 💡 Ejemplos:');
    console.log('[UE-TEST]    starlinkVisualizer.moveUETo(40.4168, -3.7038)  // Madrid');
    console.log('[UE-TEST]    starlinkVisualizer.moveUETo(40.7128, -74.0060) // Nueva York');
    console.log('[UE-TEST]    starlinkVisualizer.moveUETo(-33.8688, 151.2093) // Sydney');
    
    // Mover automáticamente a Madrid como ejemplo
    console.log('[UE-TEST] 🚀 Moviendo automáticamente a Madrid como demostración...');
    this.moveUETo(40.4168, -3.7038, 10); // 10km de altitud para visibilidad
  }

  // 🎯 MÉTODO DE VERIFICACIÓN: Verificar múltiples puntos
  public verifyCalibrationPoints(): void {
    console.log('[CALIBRATION-VERIFY] 🔍 Verificando calibración con múltiples puntos...');
    
    const verificationPoints = [
      { name: "Greenwich (0°, 0°)", lat: 0, lon: 0, expected: "Centro frontal" },
      { name: "Antípoda Greenwich (0°, 180°)", lat: 0, lon: 180, expected: "Centro trasero" },
      { name: "Polo Norte (90°, 0°)", lat: 90, lon: 0, expected: "Arriba" },
      { name: "Polo Sur (-90°, 0°)", lat: -90, lon: 0, expected: "Abajo" },
      { name: "90°E (0°, 90°)", lat: 0, lon: 90, expected: "Derecha" },
      { name: "90°W (0°, -90°)", lat: 0, lon: -90, expected: "Izquierda" },
      { name: "45°N, 45°E", lat: 45, lon: 45, expected: "Noreste" },
      { name: "45°S, 135°W", lat: -45, lon: -135, expected: "Suroeste" }
    ];
    
    console.log('[CALIBRATION-VERIFY] 📍 Verificando puntos clave:');
    verificationPoints.forEach(point => {
      const pos = this.geographicToCartesian(point.lat, point.lon, 0);
      const distance = pos.distanceTo(new THREE.Vector3(0, 0, 0));
      console.log(`[CALIBRATION-VERIFY] ${point.name}:`);
      console.log(`    Posición: (${pos.x.toFixed(4)}, ${pos.y.toFixed(4)}, ${pos.z.toFixed(4)})`);
      console.log(`    Distancia: ${distance.toFixed(4)} - Esperado: ~0.1`);
      console.log(`    Orientación esperada: ${point.expected}`);
    });
    
    // Verificar que los puntos estén en la superficie de la esfera
    const positions = verificationPoints.map(p => this.geographicToCartesian(p.lat, p.lon, 0));
    const distances = positions.map(pos => pos.distanceTo(new THREE.Vector3(0, 0, 0)));
    const avgDistance = distances.reduce((sum, d) => sum + d, 0) / distances.length;
    const maxDeviation = Math.max(...distances.map(d => Math.abs(d - avgDistance)));
    
    console.log('[CALIBRATION-VERIFY] 📊 Estadísticas:');
    console.log(`    Distancia promedio: ${avgDistance.toFixed(6)}`);
    console.log(`    Desviación máxima: ${maxDeviation.toFixed(6)}`);
    console.log(`    Radio esperado: 0.100000`);
    console.log(`    Error: ${Math.abs(avgDistance - 0.1).toFixed(6)}`);
    
    if (Math.abs(avgDistance - 0.1) < 0.001) {
      console.log('[CALIBRATION-VERIFY] ✅ Calibración correcta - errores dentro del rango esperado');
    } else {
      console.log('[CALIBRATION-VERIFY] ⚠️ Posible problema de calibración detectado');
    }
  }

  // 🎯 MÉTODO SIMPLE: Conversión de coordenadas geográficas ESTÁNDAR (sin offsets)
  private geographicToCartesian(lat: number, lon: number, alt: number = 0): THREE.Vector3 {
    const R = 6371; // Radio de la Tierra en km
    const radius = (R + alt) / R * 0.1; // Normalizado a escala del simulador
    
    // 🎯 NUEVO: Conversión esférica estándar SIN calibración artificial
    // Coordenadas esféricas estándar: lat/lon -> x,y,z
    const phi = THREE.MathUtils.degToRad(90 - lat);   // Colatitud (0 = polo norte, 90 = ecuador)
    const theta = THREE.MathUtils.degToRad(lon);      // Longitud (0 = Greenwich, + hacia este)
    
    // Conversión estándar esférica a cartesiana
    const x = radius * Math.sin(phi) * Math.cos(theta);
    const y = radius * Math.cos(phi);                 // Y hacia arriba (polo norte)
    const z = radius * Math.sin(phi) * Math.sin(theta);
    
    return new THREE.Vector3(x, y, z);
  }

  // 🎯 NUEVO: Crear traza orbital sincronizada con posición real del satélite
  private createSynchronizedOrbitTrace(elements: any, satellitePosition: THREE.Vector3, index: number): THREE.Line | null {
    try {
      const points: THREE.Vector3[] = [];
      
      console.log(`[SYNC-ORBIT] Creando órbita sincronizada para ${elements.name}:`);
      console.log(`  Posición actual: (${satellitePosition.x.toFixed(4)}, ${satellitePosition.y.toFixed(4)}, ${satellitePosition.z.toFixed(4)})`);
      console.log(`  RAAN: ${elements.raan.toFixed(2)}°, ArgPer: ${elements.argumentOfPeriapsis.toFixed(2)}°`);
      console.log(`  Inclinación: ${elements.inclination.toFixed(2)}°, Excentricidad: ${elements.eccentricity.toFixed(6)}`);

      // Convertir la posición actual a sistema sin transformaciones para obtener coordenadas ECI
      const workingPosition = satellitePosition.clone();
      
      // Deshacer las transformaciones del simulador para obtener coordenadas originales
      const calibrationAngleRad = THREE.MathUtils.degToRad(-this.CALIBRATION_OFFSET_DEGREES);
      workingPosition.applyAxisAngle(new THREE.Vector3(0, 1, 0), calibrationAngleRad);
      workingPosition.applyAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
      
      // Calcular el radio orbital desde la posición actual
      const orbitalRadius = workingPosition.length();
      console.log(`  Radio orbital calculado: ${orbitalRadius.toFixed(6)} (unidades simulador)`);
      
      // Convertir elementos a radianes
      const inc = THREE.MathUtils.degToRad(elements.inclination);
      const raan = THREE.MathUtils.degToRad(elements.raan);
      const argPer = THREE.MathUtils.degToRad(elements.argumentOfPeriapsis);
      
      // Número de puntos para la órbita
      const numPoints = 120;
      
      // Generar puntos de la órbita elíptica
      for (let i = 0; i <= numPoints; i++) {
        const E = (i / numPoints) * 2 * Math.PI; // Anomalía eccéntrica
        
        // Para simplificar y asegurar que pase por la posición actual,
        // creamos una órbita circular en el plano correcto
        const angle = E;
        
        // Coordenadas en el plano orbital (órbita circular)
        const x_orb = orbitalRadius * Math.cos(angle);
        const y_orb = orbitalRadius * Math.sin(angle);
        const z_orb = 0;
        
        // Matrices de rotación para orientar el plano orbital
        // Rotación 1: Argumento del periapsis
        const x1 = x_orb * Math.cos(argPer) - y_orb * Math.sin(argPer);
        const y1 = x_orb * Math.sin(argPer) + y_orb * Math.cos(argPer);
        const z1 = z_orb;
        
        // Rotación 2: Inclinación
        const x2 = x1;
        const y2 = y1 * Math.cos(inc) - z1 * Math.sin(inc);
        const z2 = y1 * Math.sin(inc) + z1 * Math.cos(inc);
        
        // Rotación 3: Ascensión del nodo (RAAN)
        const x3 = x2 * Math.cos(raan) - y2 * Math.sin(raan);
        const y3 = x2 * Math.sin(raan) + y2 * Math.cos(raan);
        const z3 = z2;
        
        // Crear posición en coordenadas ECI
        const pos = new THREE.Vector3(x3, y3, z3);
        
        // Aplicar las mismas transformaciones que los satélites
        pos.applyAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
        
        // Aplicar calibración geográfica
        const calibrationAngleRad2 = THREE.MathUtils.degToRad(this.CALIBRATION_OFFSET_DEGREES);
        pos.applyAxisAngle(new THREE.Vector3(0, 1, 0), calibrationAngleRad2);
        
        // Verificar que las coordenadas sean válidas
        if (!isNaN(pos.x) && !isNaN(pos.y) && !isNaN(pos.z) &&
            isFinite(pos.x) && isFinite(pos.y) && isFinite(pos.z)) {
          points.push(pos);
        }
      }
      
      // Verificar que al menos un punto esté cerca de la posición del satélite
      let minDistance = Infinity;
      let closestPoint = -1;
      points.forEach((point, idx) => {
        const distance = point.distanceTo(satellitePosition);
        if (distance < minDistance) {
          minDistance = distance;
          closestPoint = idx;
        }
      });
      
      console.log(`  Punto más cercano al satélite: índice ${closestPoint}, distancia ${minDistance.toFixed(6)}`);
      
      // Crear la geometría si tenemos suficientes puntos
      if (points.length >= numPoints * 0.8) {
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(geometry, this.orbitalTraceMaterial!);
        
        // Metadata
        line.userData = {
          satelliteIndex: index,
          satelliteName: elements.name,
          orbitalElements: elements,
          pointCount: points.length,
          traceType: 'synchronized',
          minDistanceToSatellite: minDistance,
          orbitalRadius: orbitalRadius
        };
        
        console.log(`[SYNC-ORBIT] ✅ Órbita sincronizada creada para ${elements.name}: ${points.length} puntos, distancia min: ${minDistance.toFixed(6)}`);
        return line;
      } else {
        console.warn(`[SYNC-ORBIT] ⚠️ Insuficientes puntos válidos para ${elements.name}: ${points.length}/${numPoints}`);
        return null;
      }
    } catch (error) {
      console.error(`[SYNC-ORBIT] Error creando órbita sincronizada para satélite ${index}:`, error);
      return null;
    }
  }
}
