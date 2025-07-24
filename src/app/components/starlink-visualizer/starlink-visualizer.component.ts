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
    this.createSatellites();
    this.createUE();
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
    const rectX = x - bgWidth / 2;
    const rectY = y - bgHeight / 2;

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
      maxLabels = 50;
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
      if (distanceToCamera < visibilityRadius && distanceToCenter > 0.102) { // 🎯 REDUCIDO para mostrar satélites más bajos
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
      new THREE.MeshBasicMaterial({ color: 0xFFA500 })
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

      const semiMajorAxis = Math.pow((GM * periodSeconds * periodSeconds) / (4 * Math.PI * Math.PI), 1 / 3);
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

  /* 
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
*/
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
  private calculateSmartLabelOffset(satellitePosition: THREE.Vector3, index: number, cameraDistance: number): THREE.Vector3 {
    // Offset base muy pequeño para mantener las etiquetas pegadas
    let baseOffset = 0.0001; // Mucho más pequeño que antes

    // Ajustar offset según el zoom - más cerca = offset más pequeño
    if (cameraDistance <= 0.12) {
      baseOffset = 0.0008; // SúPER pegado en zoom máximo
    } else if (cameraDistance <= 0.15) {
      baseOffset = 0.0008;  // Muy pegado en zoom alto
    } else if (cameraDistance <= 0.2) {
      baseOffset = 0.0002; // Pegado en zoom medio
    } else {
      baseOffset = 0.0002;  // Ligeramente separado en zoom bajo
    }

    // Calcular dirección desde el centro de la Tierra hacia el satélite
    const earthCenter = new THREE.Vector3(0, 0, 0);
    const directionFromEarth = satellitePosition.clone().sub(earthCenter).normalize();

    // Calcular dirección hacia la cámara desde el satélite
    const directionToCamera = this.camera.position.clone().sub(satellitePosition).normalize();

    // Combinar ambas direcciones para posicionar la etiqueta "hacia fuera" del satélite
    // pero también visible hacia la cámara
    const combinedDirection = directionFromEarth.clone()
      .multiplyScalar(0.7) // 70% hacia fuera de la Tierra
      .add(directionToCamera.multiplyScalar(0.3)); // 30% hacia la cámara

    combinedDirection.normalize();

    // Aplicar una pequeña variación angular para evitar solapamientos exactos
    // Solo cuando hay muchos satélites muy cerca
    const variationAngle = (index % 4) * (Math.PI / 8); // Variación de 0°, 22.5°, 45°, 67.5°
    const rotationAxis = new THREE.Vector3(0, 0, 1); // Rotar alrededor del eje Z

    // Solo aplicar variación si estamos en zoom muy cercano y podría haber crowding
    if (cameraDistance <= 0.13) {
      combinedDirection.applyAxisAngle(rotationAxis, variationAngle * 0.3); // Variación sutil
    }

    // Calcular el offset final
    const finalOffset = combinedDirection.multiplyScalar(baseOffset);

    console.log(`[LABEL-OFFSET] Sat ${index}: offset=${baseOffset.toFixed(6)}, zoom=${cameraDistance.toFixed(3)}`);

    return finalOffset;
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


  // 🎯 MÉTODO SIMPLE: Conversión de coordenadas geográficas CORREGIDA
  private geographicToCartesian(lat: number, lon: number, alt: number = 0): THREE.Vector3 {
    const R = 6371; // Radio de la Tierra en km
    const radius = (R + alt) / R * 0.1; // Normalizado a escala del simulador

    // 🚨 CORRECCIÓN FINAL: Intercambiar X y Z para alinear con textura Three.js
    // Coordenadas esféricas estándar: lat/lon -> x,y,z
    const phi = THREE.MathUtils.degToRad(90 - lat);   // Colatitud (0 = polo norte, 90 = ecuador)
    const theta = THREE.MathUtils.degToRad(lon + 90);      // Longitud (0 = Greenwich, + hacia este)

    // ✅ FÓRMULA CORREGIDA: Intercambio X ↔ Z para alinear correctamente
    const x = radius * Math.sin(phi) * Math.sin(theta);   // X = sin(theta) para longitudes correctas
    const y = radius * Math.cos(phi);                     // Y hacia arriba (polo norte) 
    const z = radius * Math.sin(phi) * Math.cos(theta);   // Z = cos(theta) para profundidad correcta

    return new THREE.Vector3(x, y, z);
  }



}
