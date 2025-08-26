import { Component, OnInit, OnDestroy } from '@angular/core';
// ✅ Aseguramos importaciones de Three.js y OrbitControls para disponer de tipos y exponerlos en window
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader';
import { TleLoaderService, SatData } from '../../services/tle-loader.service';
import { MLHandoverService, SatelliteMetrics } from '../../services/ml-handover.service';
import * as satellite from 'satellite.js';

enum ViewFrame { EarthFixed = 'earthfixed', Inertial = 'inertial' }
// Modos de visualización de órbitas
enum OrbitMode { Inertial = 'inertial', GroundTrack = 'groundtrack' }

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
  private lastPropagateSend = 0;
  private lastLatencyMs = 0;
  // === Compensación de retardo ===
  private latencyEmaMs = 60; // EMA de latencia (~ms)
  private predictionLeadFactor = 1.0; // Factor multiplicador sobre la EMA para pedir tiempo futuro
  private readonly MAX_LEAD_MS = 400; // Tope duro para no sobre-extrapolar
  private lastPropTargetTimeMs = 0; // Último instante (unix ms) pedido al worker
  private satellitesSnapshot: { index: number; eci_km: { x: number; y: number; z: number }; gmst: number; visible: boolean; lon?: number; lat?: number; height?: number }[] = [];

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

  private SAT_SCALE = 1200; // Escala satélites
  private simulatedDate = new Date(); // Tiempo referencia último propagate
  private useRealTime = true; // Siempre tiempo real
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
  private axesHelper: THREE.AxesHelper | null = null;
  // ===== Earth render mode (classic sphere vs GLB model) =====
  public earthMode: 'classic' | 'glb' = 'glb'; // Ahora por defecto GLB
  private earthRoot: THREE.Object3D | null = null;   // Nodo root actual (malla clásica o GLB cargado)
  private cloudLayer: THREE.Object3D | null = null;  // (nubes eliminadas de uso)
  // Nubes eliminadas (showClouds eliminado)
  private readonly EARTH_ROT_RATE = 2 * Math.PI / 86164; // rad/s (día sideral)
  private lastFrameTime: number | null = null; // Para delta de rotación real
  // Ajustes visuales de la textura (simple post-proceso en canvas)
  // Ajustes visuales (solo aplicables a GLB, el modo clásico se deja intacto)
  // Eliminados brillo/contraste y almacenamiento de imágenes originales
  private readonly EARTH_BASE_YAW = Math.PI;    // 180° para alinear Greenwich con +X
  // Escala fija para etiqueta de satélite seleccionado cuando las etiquetas globales están ocultas
  private readonly SELECTED_LABEL_FIXED_SCALE = { x: 0.28, y: 0.075 };
  // === PBR / Environment ===
  private envHdrLoaded = false;                 // Evita recargar HDR
  public glbPbrMode: boolean = true;            // público para binding (checkbox)
  // Ajustes avanzados PBR
  public pbrEnvMapIntensity = 3.0;  // Defaults según captura
  public pbrRoughnessDelta = 0.8;
  public pbrMetalnessDelta = -0.5;
  private originalPbrParams: { material: any; roughness: number; metalness: number; envMapIntensity?: number }[] = [];
  // Rim light eliminado
  // Persistencia
  private readonly STORAGE_KEY = 'sviz.settings.v1';
  private texAdjustDebounceTimer: any = null;
  // Exposición pública (wrapper) para template sin exponer renderer directamente
  public get exposure(): number { return this.renderer ? this.renderer.toneMappingExposure : 1.0; }
  public set exposure(v: number) { if (this.renderer) { this.onExposureChange(v); } }

  // 🎯 NUEVO: Sistema de selección y tracking de satélites
  private selectedSatelliteIndex: number | null = null; // Índice del satélite seleccionado
  private selectedSatelliteMesh: THREE.Mesh | null = null; // 🎯 NUEVO: Mesh separado para satélite seleccionado
  private selectedSatellitePosition: THREE.Vector3 | null = null; // 🎯 ANTI-PARPADEO: Cache de posición
  private selectedSatelliteLine: THREE.Object3D | null = null; // 🎯 Ahora un grupo con cilindro + marcador superficie
  private raycaster = new THREE.Raycaster(); // Para detección de clics en satélites
  private mouse = new THREE.Vector2(); // Posición del mouse normalizada
  private isMouseDown = false; // Flag para controlar interacciones de mouse
  private mouseDownTime = 0; // Tiempo cuando se presionó el mouse
  private readonly CLICK_TIME_THRESHOLD = 200; // Tiempo máximo para considerar un clic (ms)

  // Frame de vista actual (preparado para Fase B). Actualmente todo el pipeline es EarthFixed (ECF)
  // TODO Fase B: Cambiar a ViewFrame.Inertial cuando worker devuelva ECI y eliminar rotación en toSceneFromECF
  private viewFrame: ViewFrame = ViewFrame.EarthFixed;

  // Contadores para logging controlado (validación de pipeline de coordenadas)
  private lastLogFrame: number = -1;
  private readonly LOG_EVERY_N_FRAMES = 60; // ~1 segundo si ~60fps
  private debugLogs = true; // Permite desactivar logs de validación

  // Estado de órbitas
  private activeOrbitMode: OrbitMode | null = null;
  private activeOrbitSatIndex: number | null = null;
  private activeOrbitGroup: THREE.Group | null = null;
  private lastGroundTrackGenFrame = -1;

  // Constantes de transformación (Fase B)
  private readonly KM_TO_SCENE = 0.1 / 6371; // Escala única km->escena
  // ROT_X_* eliminados: rotación global -π/2 retirada definitivamente.
  // Inversión global de la componente longitudinal (Este/Oeste). Usar -1 para invertir signo de la longitud.
  private readonly LONGITUDE_SIGN = -1;

  //region Contructor [rgba(255, 0, 0, 0.1)]
  constructor(
    public tle: TleLoaderService,
    private ml: MLHandoverService
  ) { }
  async ngOnInit() {
    this.selectedConstellation = 'starlink';
    // Cargar ajustes persistidos antes de inicializar escena
    this.loadSettingsFromStorage();
    await this.tle.loadConstellation(this.selectedConstellation); // carga inicial
    this.initThree();
    this.initializeLabelSystem();
    // Crear Tierra según modo persistido
    if (this.earthMode === 'glb') {
      await this.createEarthFromGLB();
    } else {
      await this.createEarth();
    }
    this.createSatellites();
    this.createUE();
    // Aplicar configuración inicial (ocultar grid/ejes si están por defecto apagados)
    this.applyConfig();
    this.animate();
    // Exponer referencia para debugging manual en consola del navegador
    (window as any).ngRef = this; // ⚠️ Sólo para desarrollo
    // Exponer THREE para que los snippets manuales en consola no fallen con "THREE is not defined"
    (window as any).THREE = THREE;
    // Helpers de depuración para órbitas
    (window as any).genOrbit = (i: number, m: 'groundtrack' | 'inertial' = 'groundtrack') => this.generateInstantOrbit(i, m === 'inertial' ? OrbitMode.Inertial : OrbitMode.GroundTrack);
    // También colgamos en la instancia para ngRef.genOrbit()
    (this as any).genOrbit = (i: number, m: 'groundtrack' | 'inertial' = 'groundtrack') => this.generateInstantOrbit(i, m === 'inertial' ? OrbitMode.Inertial : OrbitMode.GroundTrack);
    (window as any).clearOrbit = () => this.clearOrbitalTraces();
    (window as any).orbitInfo = () => this.getActiveOrbitInfo();
    (window as any).setOrbitMode = (m: 'groundtrack' | 'inertial') => this.setOrbitMode(m);
    // Helpers de modo de Tierra (GLB / classic)
    ;(window as any).setEarthMode = (m: 'classic' | 'glb') => this.setEarthMode(m);
    ;(window as any).nudgeEarthYaw = (d: number) => this.nudgeEarthYaw(d);
  // Helpers eliminados: nubes / brillo / contraste
  ;(window as any).setGlbPbrMode = (v: boolean) => { this.glbPbrMode = v; console.log('[GLB-PBR] glbPbrMode ->', v); if (this.earthMode==='glb') this.setEarthMode('glb'); };
  ;(window as any).setExposure = (e: number) => { this.renderer.toneMappingExposure = e; console.log('[RENDERER] exposure ->', e); };
    if ((window as any).ngRef) {
      console.log('[DEBUG] Componente StarlinkVisualizer expuesto como window.ngRef');
      console.log('[DEBUG] THREE expuesto como window.THREE');
      console.log('[DEBUG] Orbit helpers: genOrbit(i,mode), clearOrbit(), setOrbitMode(mode), orbitInfo()');
    }
  }
  ngOnDestroy() {
    cancelAnimationFrame(this.frameId);
    this.clearSatelliteLabels();
    this.deselectSatellite(); // 🎯 NUEVO: Limpiar selección de satélite e indicador
    this.renderer.domElement.remove();
    if ((window as any).ngRef === this) {
      delete (window as any).ngRef;
      console.log('[DEBUG] window.ngRef limpiado');
    }
  }
  private controls!: OrbitControls;

  // ========= Config Panel State =========
  public showConfigPanel = false;
  public cfg = {
    showGrid: false,
    showAxes: false,
    showLabels: true,
    satColor: '#ff0000',
    orbitColor: '#1f8f00'
  };
  public satelliteColorPalette: string[] = ['#ff0000', '#00ff00', '#00c8ff', '#ffaa00', '#ffffff', '#ff00ff', '#00ffa8'];
  public orbitColorPalette: string[] = ['#00ff00', '#ff0000', '#00c8ff', '#ffaa00', '#ffffff', '#ff00ff', '#00ffa8'];
  public customSatColor: string = '#ff0000';
  public customOrbitColor: string = '#00ff00';

  private initThree() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.001, 100);
    this.camera.position.set(0, 0, 0.5); // Más cerca y centrada
    this.camera.lookAt(0, 0, 0);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // Configuración de color/tone mapping (soporte r152+ y fallback)
    try {
      if ((this.renderer as any).outputColorSpace !== undefined) (this.renderer as any).outputColorSpace = (THREE as any).SRGBColorSpace; else (this.renderer as any).outputEncoding = THREE.sRGBEncoding;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.2;
      console.log('[RENDERER] sRGB + ACES exposure=1.2');
    } catch(e){ console.warn('[RENDERER] No se pudo configurar colorSpace/tonemapping', e); }
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

    // 🎯 NUEVO: Event listeners para selección de satélites
    this.setupSatelliteSelectionListeners();

    // Añadir helper de ejes
    if (this.cfg.showAxes) {
      this.axesHelper = new THREE.AxesHelper(0.2);
      this.axesHelper.name = '__axesHelper';
      this.scene.add(this.axesHelper);
    }
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  // Luces base (afectan sólo a materiales Standard/Physical)
  const hemi = new THREE.HemisphereLight(0xffffff, 0x202030, 0.9); hemi.name='__hemiLight'; this.scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.6); dir.position.set(1,1,1); dir.name='__dirLight'; this.scene.add(dir);
  }
  //endregion

  //region Camera Controls [rgba(0, 255, 17, 0.17)]
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
  private setupSatelliteSelectionListeners() {
    // Event listeners para selección de satélites con mouse
    this.renderer.domElement.addEventListener('mousedown', this.onMouseDown.bind(this));
    this.renderer.domElement.addEventListener('mouseup', this.onMouseUp.bind(this));
    this.renderer.domElement.addEventListener('mousemove', this.onMouseMove.bind(this));

    //console.log('[SELECTION] Event listeners para selección de satélites configurados');
  }
  private onMouseDown(event: MouseEvent) {
    this.isMouseDown = true;
    this.mouseDownTime = performance.now();
    this.updateMousePosition(event);
  }
  private onMouseUp(event: MouseEvent) {
    if (!this.isMouseDown) return;

    const clickDuration = performance.now() - this.mouseDownTime;

    //console.log(`[SELECTION] 🖱️ Mouse up - duración: ${clickDuration.toFixed(0)}ms`);

    // Solo procesar como clic si fue un click rápido (no un drag)
    if (clickDuration < this.CLICK_TIME_THRESHOLD) {
      // 🎯 NUEVO: Prevenir que los OrbitControls interfieran
      event.preventDefault();
      event.stopPropagation();

      this.updateMousePosition(event);

      // 🎯 NUEVO: Añadir un pequeño delay para asegurar que el raycasting funcione
      setTimeout(() => {
        this.handleSatelliteSelection();
      }, 10);
    } else {
      //console.log(`[SELECTION] 🔄 Drag detectado (${clickDuration.toFixed(0)}ms) - no se selecciona`);
    }

    this.isMouseDown = false;
  }
  private onMouseMove(event: MouseEvent) {
    this.updateMousePosition(event);
  }
  private updateMousePosition(event: MouseEvent) {
    // Convertir coordenadas de mouse a coordenadas normalizadas (-1 a +1)
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }
  //endregion



  //region Satellite Indicator, Selection & Search [rgba(198, 255, 11, 0.23)]
  private handleSatelliteSelection() {
    //console.log('[SELECTION] 🎯 Intentando seleccionar satélite...');

    if (!this.satsMesh) {
      //console.log('[SELECTION] ❌ No hay satsMesh disponible');
      return;
    }

    if (!this.isDetailedView) {
      //console.log('[SELECTION] ❌ No estás en vista detallada. Haz zoom para seleccionar satélites.');
      return;
    }

    //console.log(`[SELECTION] 🔍 Mouse en: (${this.mouse.x.toFixed(3)}, ${this.mouse.y.toFixed(3)})`);

    // Configurar raycaster con tolerancia ampliada
    this.raycaster.setFromCamera(this.mouse, this.camera);

    // 🎯 NUEVO: Ampliar el threshold del raycaster para facilitar la selección
    this.raycaster.params.Points = { threshold: 0.05 }; // Más tolerante
    this.raycaster.params.Line = { threshold: 0.005 };

    //console.log(`[SELECTION] 📡 Raycaster configurado desde cámara hacia: (${this.raycaster.ray.direction.x.toFixed(3)}, ${this.raycaster.ray.direction.y.toFixed(3)}, ${this.raycaster.ray.direction.z.toFixed(3)})`);

    // Detectar intersecciones con los satélites
    const intersections = this.raycaster.intersectObject(this.satsMesh);

    //console.log(`[SELECTION] 🎯 Intersecciones encontradas: ${intersections.length}`);

    if (intersections.length > 0) {
      const intersection = intersections[0];
      const satelliteIndex = intersection.instanceId;

      console.log(`[SELECTION] ✅ Intersección detectada:`, {
        instanceId: satelliteIndex,
        distance: intersection.distance.toFixed(4),
        point: intersection.point
      });

      if (satelliteIndex !== undefined && satelliteIndex !== null) {
        this.selectSatellite(satelliteIndex);
      } else {
        console.log('[SELECTION] ❌ instanceId undefined o null');
      }
    } else {
      // 🎯 NUEVO: Método alternativo por proximidad si raycasting falla
      console.log('[SELECTION] 🔍 Raycasting falló, intentando selección por proximidad...');
      const proximityResult = this.selectByProximity();

      if (!proximityResult) {
        console.log('[SELECTION] 🌌 Clic en área vacía - deseleccionando');
        this.deselectSatellite();
      }
    }
  }
  private selectByProximity(): boolean {
    if (!this.satsMesh) return false;

    const tempMatrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const screenPosition = new THREE.Vector3();
    const mouseVector = new THREE.Vector2(this.mouse.x, this.mouse.y);

    let closestDistance = Infinity;
    let closestIndex = -1;
    const maxProximityDistance = 0.05; // Tolerancia en coordenadas de pantalla

    // Iterar sobre todos los satélites visibles
    for (let i = 0; i < this.satsMesh.count; i++) {
      this.satsMesh.getMatrixAt(i, tempMatrix);
      position.setFromMatrixPosition(tempMatrix);

      // Proyectar posición 3D a coordenadas de pantalla
      screenPosition.copy(position);
      screenPosition.project(this.camera);

      // Calcular distancia 2D en pantalla
      const distance2D = mouseVector.distanceTo(new THREE.Vector2(screenPosition.x, screenPosition.y));

      if (distance2D < maxProximityDistance && distance2D < closestDistance) {
        closestDistance = distance2D;
        closestIndex = i;
      }
    }

    if (closestIndex >= 0) {
      console.log(`[SELECTION] 🎯 Selección por proximidad: satélite ${closestIndex} (distancia: ${closestDistance.toFixed(4)})`);
      this.selectSatellite(closestIndex);
      return true;
    }

    return false;
  }
  private selectSatellite(index: number) {
    if (index < 0 || index >= this.tle.getAllSatrecs().length) return;
    console.log(`[SELECTION] 🛰️ Seleccionando satélite ${index}`);

    // Deseleccionar satélite anterior si existe
    this.deselectSatellite();

    // Establecer nuevo satélite seleccionado
    this.selectedSatelliteIndex = index;
    console.log(`[SELECTION] 📌 selectedSatelliteIndex establecido a: ${this.selectedSatelliteIndex}`);

    // 🎯 NUEVO ENFOQUE: Crear mesh separado verde en lugar de cambiar colores
    this.createSelectedSatelliteIndicator(index);

    // 🎯 NUEVO: Crear línea del satélite hacia la Tierra
    this.createSatelliteToEarthLine(index);

    // 🔄 Generar órbita inmediata del satélite seleccionado (usa modo activo o groundtrack por defecto)
    const modeToUse = this.activeOrbitMode ?? OrbitMode.GroundTrack;
    console.log(`[ORBIT] Generando órbita inicial modo=${modeToUse} sat=${index}`);
    this.generateInstantOrbit(index, modeToUse);

    // Obtener información del satélite
    const sats = this.tle.getAllSatrecs();
    if (sats[index]) {
      const satName = this.extractSatelliteName(sats[index], index);
      console.log(`[SELECTION] ✅ Satélite seleccionado: ${satName} (índice: ${index})`);
      // Mostrar etiqueta del seleccionado aunque labels estén desactivadas
      if (!this.cfg.showLabels) {
        this.clearSatelliteLabels();
        this.ensureSelectedLabel(index);
      }

      // 🎯 NUEVO: Mostrar posición actual del satélite
      if (this.satsMesh) {
        const tempMatrix = new THREE.Matrix4();
        const position = new THREE.Vector3();
        this.satsMesh.getMatrixAt(index, tempMatrix);
        position.setFromMatrixPosition(tempMatrix);
        console.log(`[SELECTION] 📍 Posición: (${position.x.toFixed(4)}, ${position.y.toFixed(4)}, ${position.z.toFixed(4)})`);
      }
    } else {
      console.log(`[SELECTION] ❌ No se encontró información del satélite ${index}`);
    }
  }

  // ========= Buscador / Filtrado =========
  public searchQuery: string = '';
  public filteredResults: { index: number; label: string }[] = [];
  public showSearchDropdown = false;
  public selectedConstellation: string = 'starlink';
  // Sugerencias incrementales
  private suggestionMode = false;
  private allSuggestionResults: { index: number; label: string }[] = [];
  private suggestionBatchSize = 80;
  private suggestionVisibleCount = 0;

  public onSearchChange() {
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) {
      this.suggestionMode = true;
      // No retornar temprano si ya tenemos sugerencias: asegurar visible
      this.prepareSuggestions();
      return;
    }
    this.suggestionMode = false;
    const sats = this.tle.getAllSatrecs();
    const results: { index: number; label: string }[] = [];
    for (let i = 0; i < sats.length; i++) {
      const label = this.tle.getDisplayName(i).toLowerCase();
      if (label.includes(q) || this.tle.extractNoradId(sats[i].line1)?.toLowerCase().includes(q)) {
        results.push({ index: i, label: this.tle.getDisplayName(i) });
        if (results.length >= 50) break; // límite
      }
    }
    this.filteredResults = results;
    this.showSearchDropdown = results.length > 0;
  }
  public pickSearchResult(idx: number) {
    this.selectSatellite(idx);
    this.showSearchDropdown = false;
  }
  // Mostrar primeras 10 sugerencias al enfocar si no hay búsqueda
  public onSearchFocus() {
    if (this.searchQuery.trim() !== '') { this.onSearchChange(); return; }
    this.suggestionMode = true;
    this.prepareSuggestions();
  }
  private prepareSuggestions() {
    const sats = this.tle.getAllSatrecs();
    this.allSuggestionResults = [];
    for (let i = 0; i < sats.length; i++) {
      this.allSuggestionResults.push({ index: i, label: this.tle.getDisplayName(i) });
    }
    this.suggestionVisibleCount = Math.min(this.suggestionBatchSize, this.allSuggestionResults.length);
    this.filteredResults = this.allSuggestionResults.slice(0, this.suggestionVisibleCount);
    this.showSearchDropdown = true;
  }
  public onSearchScroll(ev: any) {
    if (!this.suggestionMode) return;
    const el = ev.target as HTMLElement;
    const threshold = 24; // px antes del final
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - threshold) {
      if (this.suggestionVisibleCount < this.allSuggestionResults.length) {
        const prev = this.suggestionVisibleCount;
        this.suggestionVisibleCount = Math.min(this.suggestionVisibleCount + this.suggestionBatchSize, this.allSuggestionResults.length);
        // Añadir los nuevos sin recrear todo
        this.filteredResults = this.allSuggestionResults.slice(0, this.suggestionVisibleCount);
        if (this.debugLogs) console.log(`[SEARCH] Expand sugerencias ${prev} -> ${this.suggestionVisibleCount}`);
      }
    }
  }
  public async changeConstellation(newConstellation: string) {
    const prevSelected = this.selectedConstellation;
    const prevActive = this.tle.getActiveConstellation();
    console.log(`[CONST] changeConstellation() inicio -> prevSelected=${prevSelected} prevActive=${prevActive} new=${newConstellation}`);
    // Asegurar manifiesto actualizado (por si se editó en runtime)
    await this.tle.forceReloadManifest?.();
    this.selectedConstellation = newConstellation;
    await this.reloadConstellation();
    console.log(`[CONST] changeConstellation() fin -> active=${this.tle.getActiveConstellation()} sats=${this.tle.getAllSatrecs().length}`);
  }
  public async onConstellationSelectClick() {
    if (this.tle.forceReloadManifest) {
      try {
        await this.tle.forceReloadManifest();
      } catch (e) {
        console.warn('[CONST] Error al refrescar manifiesto en click', e);
      }
    }
  }
  private async reloadConstellation() {
    // Limpiar selección/órbitas/labels/resultados
    this.deselectSatellite();
    this.clearOrbitalTraces();
    this.clearSatelliteLabels();
    this.filteredResults = []; this.searchQuery = ''; this.showSearchDropdown = false;

    // Terminar worker previo
    if (this.worker) { this.worker.terminate(); this.worker = null; }

    // Eliminar malla satélites previa
    if (this.satsMesh) {
      this.scene.remove(this.satsMesh);
      this.satsMesh.geometry.dispose();
      (this.satsMesh.material as any).dispose?.();
      this.satsMesh = null;
    }

    console.log(`[CONST] Cargando constelación '${this.selectedConstellation}'`);
    await this.tle.loadConstellation(this.selectedConstellation);
    console.log(`[CONST] Satélites cargados = ${this.tle.getAllSatrecs().length}`);
    // Reset de tiempo simulación para evitar desfaces visuales entre constelaciones diferentes
    this.simulatedDate = new Date();
    this.lastWorkerFrameDate = new Date(this.simulatedDate);
    this.workerBusy = false;
    this.loadingFirstFrame = true;
    this.createSatellites();
    if (this.tle.getAllSatrecs().length === 0) {
      console.warn('[CONST] No se cargaron satélites. Revisa nombre de archivo en constellations.json');
    }
    // Forzar refresco UI
    this.updateCameraControls();
  }
  private deselectSatellite() {
    if (this.selectedSatelliteIndex === null) return;

    console.log(`[SELECTION] 🔄 Deseleccionando satélite ${this.selectedSatelliteIndex}`);

    // 🎯 NUEVO: Eliminar mesh del satélite seleccionado
    this.removeSelectedSatelliteIndicator();

    // 🎯 NUEVO: Eliminar línea del satélite hacia la Tierra
    this.removeSatelliteToEarthLine();

    // 🎯 ANTI-PARPADEO: Limpiar cache de posición
    this.selectedSatellitePosition = null;
    // Si la órbita activa pertenece a este satélite, limpiar
    if (this.activeOrbitSatIndex === this.selectedSatelliteIndex) {
      this.clearOrbitalTraces();
    }
    this.selectedSatelliteIndex = null;
  }
  private createSelectedSatelliteIndicator(index: number) {
    if (!this.satsMesh) return;

    console.log(`[SELECTION-INDICATOR] 🟢 Creando indicador verde para satélite ${index}`);

    // Obtener posición del satélite seleccionado
    const tempMatrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    this.satsMesh.getMatrixAt(index, tempMatrix);
    position.setFromMatrixPosition(tempMatrix);

    // 🎯 SOLUCION Z-FIGHTING: Crear geometría ligeramente más grande y separada
    const geometry = new THREE.SphereGeometry(0.0008);
    const material = new THREE.MeshBasicMaterial({
      color: this.cfg.orbitColor || '#00ff00',
      transparent: false,
      opacity: 1.0,
      depthTest: true,
      depthWrite: true
    });

    // Crear mesh del indicador
    this.selectedSatelliteMesh = new THREE.Mesh(geometry, material);

    // 🎯 SOLUCION Z-FIGHTING: Posicionar ligeramente hacia la cámara
    const directionToCamera = this.camera.position.clone().sub(position).normalize();
    const offsetPosition = position.clone().add(directionToCamera.multiplyScalar(0.0001));
    this.selectedSatelliteMesh.position.copy(offsetPosition);

    // 🎯 ANTI-PARPADEO: Inicializar cache de posición
    this.selectedSatellitePosition = position.clone();

    // 🎯 SOLUCION Z-FIGHTING: Render order más alto para que se dibuje después
    this.selectedSatelliteMesh.renderOrder = 1;

    // Añadir a la escena
    this.scene.add(this.selectedSatelliteMesh);

    console.log(`[SELECTION-INDICATOR] ✅ Indicador verde creado en posición: (${offsetPosition.x.toFixed(4)}, ${offsetPosition.y.toFixed(4)}, ${offsetPosition.z.toFixed(4)})`);
  }
  private createSatelliteToEarthLine(index: number) {
    if (!this.satsMesh) return;
    // Eliminar previa si existiera
    this.removeSatelliteToEarthLine();
    const tempMatrix = new THREE.Matrix4();
    const satPos = new THREE.Vector3();
    this.satsMesh.getMatrixAt(index, tempMatrix);
    satPos.setFromMatrixPosition(tempMatrix);
    const earthCenter = new THREE.Vector3(0,0,0);
    const dist = satPos.distanceTo(earthCenter);
    const earthRadius = 0.1;
    if (dist <= earthRadius) return; // seguridad
    const dirToCenter = earthCenter.clone().sub(satPos).normalize();
    const surfacePoint = satPos.clone().add(dirToCenter.clone().multiplyScalar(dist - earthRadius));
    // Longitud del segmento atmosférico
    const segmentLength = satPos.distanceTo(surfacePoint);
    // Grupo contenedor
    const group = new THREE.Group();
    // Cilindro orientado: eje Y local será la dirección
    const radius = Math.min(0.00035, segmentLength * 0.18); // grosor relativo + límite
    const cylGeo = new THREE.CylinderGeometry(radius, radius, segmentLength, 12, 1, true);
    const cylMat = new THREE.MeshBasicMaterial({ color: this.cfg.orbitColor || '#00ff00', transparent: true, opacity: 0.9, depthTest: false, depthWrite: false });
    const cylinder = new THREE.Mesh(cylGeo, cylMat);
    // Posicionar centro del cilindro en mitad del segmento
    const mid = satPos.clone().add(surfacePoint).multiplyScalar(0.5);
    cylinder.position.copy(mid);
    // Orientar: cilindro por defecto apunta a +Y. Crear quaternion desde +Y hacia vector (surfacePoint - satPos)
    const up = new THREE.Vector3(0,1,0);
    const segDir = surfacePoint.clone().sub(satPos).normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(up, segDir);
    cylinder.setRotationFromQuaternion(quat);
    group.add(cylinder);
    // Marcador en superficie
    const markerGeo = new THREE.SphereGeometry(radius*1.15, 10, 10);
    const markerMat = new THREE.MeshBasicMaterial({ color: this.cfg.orbitColor || '#00ff00', transparent: true, opacity: 0.85, depthTest: false, depthWrite: false });
    const marker = new THREE.Mesh(markerGeo, markerMat);
    marker.position.copy(surfacePoint);
    group.add(marker);
    group.renderOrder = 2; // detrás del indicador seleccionado pero sobre Tierra
    this.scene.add(group);
    this.selectedSatelliteLine = group;
  }
  private removeSelectedSatelliteIndicator() {
    if (this.selectedSatelliteMesh) {
      console.log(`[SELECTION-INDICATOR] 🗑️ Eliminando indicador verde`);
      this.scene.remove(this.selectedSatelliteMesh);

      // Limpiar geometría y material
      this.selectedSatelliteMesh.geometry.dispose();
      if (this.selectedSatelliteMesh.material instanceof THREE.Material) {
        this.selectedSatelliteMesh.material.dispose();
      }
      this.selectedSatelliteMesh = null;
    }
  }
  private removeSatelliteToEarthLine() {
    if (!this.selectedSatelliteLine) return;
    this.selectedSatelliteLine.traverse(obj => {
      const mesh:any = obj;
      if (mesh.isMesh) {
        mesh.geometry?.dispose?.();
        if (Array.isArray(mesh.material)) mesh.material.forEach((m:any)=>m.dispose?.()); else mesh.material?.dispose?.();
      }
    });
    this.scene.remove(this.selectedSatelliteLine);
    this.selectedSatelliteLine = null;
  }
  private updateSatelliteToEarthLine(satellitePosition: THREE.Vector3) {
    if (!this.selectedSatelliteLine) return;
    try {
      const earthCenter = new THREE.Vector3(0,0,0);
      const dist = satellitePosition.distanceTo(earthCenter);
      const earthRadius = 0.1;
      if (dist <= earthRadius) return; // seguridad
      const surfacePoint = satellitePosition.clone().add(
        earthCenter.clone().sub(satellitePosition).normalize().multiplyScalar(dist - earthRadius)
      );
      const segmentLength = satellitePosition.distanceTo(surfacePoint);
      // Buscar cilindro dentro del grupo
  let cylinder: THREE.Mesh<any, any> | null = null;
  this.selectedSatelliteLine.children.forEach(c => { const m:any = c as any; if (m.isMesh && m.geometry?.type === 'CylinderGeometry') cylinder = m as THREE.Mesh; });
      if (!cylinder) return;
      // Re-crear geometría (simple y barato para un objeto)
      const radius = Math.min(0.00035, segmentLength * 0.18);
      const newGeo = new THREE.CylinderGeometry(radius, radius, segmentLength, 12, 1, true);
      const cyl = cylinder as THREE.Mesh;
      (cyl as any).geometry?.dispose?.();
      (cyl as any).geometry = newGeo;
      const mid = satellitePosition.clone().add(surfacePoint).multiplyScalar(0.5);
      cyl.position.copy(mid);
      const up = new THREE.Vector3(0,1,0);
      const segDir = surfacePoint.clone().sub(satellitePosition).normalize();
      cyl.setRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(up, segDir));
      // Superficie marker
  let marker: THREE.Mesh<any, any> | null = null;
  this.selectedSatelliteLine.children.forEach(c => { const m:any = c as any; if (m.isMesh && m.geometry?.type === 'SphereGeometry') marker = m as THREE.Mesh; });
      if (marker) {
        const mark = marker as THREE.Mesh;
        mark.position.copy(surfacePoint);
        // Si el radio cambió sustancialmente, recrear
        const mr:any = mark;
        if (Math.abs((mr.geometry.parameters?.radius ?? 0) - radius*1.15) / (radius*1.15) > 0.2) {
          mr.geometry.dispose();
          mr.geometry = new THREE.SphereGeometry(radius*1.15, 10, 10);
        }
      }
    } catch(e) {
      console.warn('[SATELLITE-LINE] Error actualizando cilindro', e);
    }
  }
  private updateSelectedSatelliteIndicator() {
    if (this.selectedSatelliteIndex === null || !this.selectedSatelliteMesh || !this.selectedSatellitePosition) {
      return;
    }

    try {
      // Obtener nueva posición del satélite seleccionado
      const tempMatrix = new THREE.Matrix4();
      const position = new THREE.Vector3();
      if (this.satsMesh) {
        this.satsMesh.getMatrixAt(this.selectedSatelliteIndex, tempMatrix);
        position.setFromMatrixPosition(tempMatrix);
      }

      // 🎯 ANTI-PARPADEO: Validar que la posición sea válida
      if (position.length() === 0 || !isFinite(position.x) || !isFinite(position.y) || !isFinite(position.z)) {
        // Si la posición no es válida, usar la última posición conocida
        if (this.selectedSatellitePosition) {
          position.copy(this.selectedSatellitePosition);
        } else {
          // Si no hay posición válida, ocultar temporalmente el indicador
          this.selectedSatelliteMesh.visible = false;
          return;
        }
      } else {
        // Posición válida - asegurar que el indicador sea visible y guardar cache
        this.selectedSatelliteMesh.visible = true;
        this.selectedSatellitePosition = position.clone();
      }

      // 🎯 SOLUCION Z-FIGHTING: Mantener offset hacia la cámara en cada actualización
      const directionToCamera = this.camera.position.clone().sub(position).normalize();

      // 🎯 ANTI-PARPADEO: Validar dirección hacia cámara
      if (!isFinite(directionToCamera.x) || !isFinite(directionToCamera.y) || !isFinite(directionToCamera.z)) {
        // Si la dirección no es válida, usar offset fijo hacia arriba
        directionToCamera.set(0, 0, 1);
      }

      const offsetPosition = position.clone().add(directionToCamera.multiplyScalar(0.00001));

      // Actualizar posición del indicador con offset
      this.selectedSatelliteMesh.position.copy(offsetPosition);

      // 🎯 NUEVO: Actualizar línea hacia la Tierra
      this.updateSatelliteToEarthLine(position);
    } catch (error) {
      // 🎯 ANTI-PARPADEO: En caso de error, mantener indicador visible en última posición conocida
      console.warn(`[SELECTION-INDICATOR] Error actualizando posición: ${error}`);
      if (this.selectedSatellitePosition && this.selectedSatelliteMesh) {
        this.selectedSatelliteMesh.visible = true;
        const directionToCamera = this.camera.position.clone().sub(this.selectedSatellitePosition).normalize();
        const offsetPosition = this.selectedSatellitePosition.clone().add(directionToCamera.multiplyScalar(0.0001));
        this.selectedSatelliteMesh.position.copy(offsetPosition);

        // 🎯 NUEVO: También actualizar línea con posición cacheada
        this.updateSatelliteToEarthLine(this.selectedSatellitePosition);
      }
    }
  }
  //endregion



  //region SGP4 Orbit Generation [rgba(78, 9, 241, 0.33)]
  public setOrbitMode(mode: OrbitMode | 'inertial' | 'groundtrack') {
    const newMode = mode as OrbitMode;
    this.activeOrbitMode = newMode;
    if (this.selectedSatelliteIndex != null) {
      this.generateInstantOrbit(this.selectedSatelliteIndex, newMode);
    }
  }  public getActiveOrbitInfo(): { mode: OrbitMode | null; satIndex: number | null; pointCount: number } {
    return {
      mode: this.activeOrbitMode,
      satIndex: this.activeOrbitSatIndex,
      pointCount: (this.activeOrbitGroup && (this.activeOrbitGroup.children.find(c => (c as any).isLine) as any)?.geometry?.attributes?.position?.count) || 0
    };
  }
  public clearOrbitalTraces() {
    if (this.activeOrbitGroup) {
      this.scene.remove(this.activeOrbitGroup);
      this.activeOrbitGroup.traverse(obj => {
        const m: any = obj;
        if (m.geometry) m.geometry.dispose?.();
        if (m.material) {
          if (Array.isArray(m.material)) m.material.forEach((mm: any) => mm.dispose?.()); else m.material.dispose?.();
        }
      });
      this.activeOrbitGroup = null;
    }
    this.activeOrbitSatIndex = null;
  }
  public generateInstantOrbit(satelliteIndex: number, mode: OrbitMode = OrbitMode.GroundTrack, options?: { N?: number; periods?: number }) {
    const satDataArr = this.tle.getAllSatrecs();
    if (satelliteIndex < 0 || satelliteIndex >= satDataArr.length) { console.warn('[ORBIT] Índice inválido'); return; }
    const satData = satDataArr[satelliteIndex];
    if (!satData || !satData.satrec) { console.warn('[ORBIT] satrec no disponible'); return; }
    const rawSatrec: any = satData.satrec;
    const baseDate = this.useRealTime ? new Date() : this.simulatedDate;
    const nRadPerMin = rawSatrec.no_kozai || rawSatrec.no; // rad/min
    let periodMin: number;
    if (nRadPerMin && isFinite(nRadPerMin)) periodMin = (2 * Math.PI) / nRadPerMin; else periodMin = 1440 / 15;
    const T_ms = periodMin * 60 * 1000;
    const N = options?.N ?? 720;
    const periods = options?.periods ?? 1;
    const points = this.sampleOrbitECI(rawSatrec, baseDate, T_ms, N, mode, periods);
    this.drawOrbit(points, satelliteIndex, mode);
    this.activeOrbitMode = mode;
    this.activeOrbitSatIndex = satelliteIndex;
  }
  private generateDynamicOrbit(satelliteIndex: number) {
    if (this.activeOrbitMode !== OrbitMode.GroundTrack) return;
    if (satelliteIndex !== this.activeOrbitSatIndex) return;
    if (this.frameId - this.lastGroundTrackGenFrame < 120) return;
    this.lastGroundTrackGenFrame = this.frameId;
    this.generateInstantOrbit(satelliteIndex, OrbitMode.GroundTrack);
  }
  private sampleOrbitECI(satrec: any, t0: Date, T_ms: number, N: number, mode: OrbitMode, periods = 1): THREE.Vector3[] {
    const pts: THREE.Vector3[] = [];
    const totalSamples = Math.max(2, N * periods);
    const warn = { range: false };
    const radii: number[] = [];
    // Congelamos GMST inicial para lograr cierre en modo "groundtrack" (interpretado aquí como órbita a altura fija relativa a la Tierra inicial)
    const gmst0 = satellite.gstime(t0);
    for (let i = 0; i <= totalSamples; i++) {
      const t_i = new Date(t0.getTime() + (i / totalSamples) * T_ms * periods);
      const prop = satellite.propagate(satrec as any, t_i);
      if (!prop || !prop.position) continue;
      const eci: any = prop.position; // cast para acceder a x,y,z sin conflicto de tipos union
      let pScene: THREE.Vector3;
      const gmst_i = satellite.gstime(t_i);
      if (mode === OrbitMode.GroundTrack) {
        // Usar gmst inicial para todas las muestras -> órbita cerrada y sin deriva aparente
        const ecf = this.eciToEcfLocal({ x: eci.x, y: eci.y, z: eci.z }, gmst0);
        pScene = this.ecfToScene(ecf);
      } else {
        // Órbita inercial: si frame EarthFixed la mostramos "tal cual" en espacio EN ECI (sin rotar por gmst)
        const eciVec = (this.viewFrame === ViewFrame.Inertial) ? { x: eci.x, y: eci.y, z: eci.z } : { x: eci.x, y: eci.y, z: eci.z };
        // Si quisiéramos verla en EarthFixed podríamos aplicar rotación para que gire con la Tierra; por ahora dejamos ECI puro
        const ecfOrEci = (this.viewFrame === ViewFrame.EarthFixed) ? { x: eciVec.x, y: eciVec.y, z: eciVec.z } : eciVec;
        pScene = this.ecfToScene(ecfOrEci as any);
      }
      const r = pScene.length();
      if (!isFinite(r) || r <= 0) { if (!warn.range) console.warn('[ORBIT-RANGE] r inválido', r); warn.range = true; continue; }
      // Relajamos filtro inferior para diagnóstico (antes 0.101)
      if ((r < 0.095 || r > 0.55) && !warn.range) { console.warn('[ORBIT-RANGE] r fuera', r.toFixed(5)); warn.range = true; }
      pts.push(pScene);
      radii.push(r);
    }
    if (mode === OrbitMode.Inertial && this.viewFrame === ViewFrame.Inertial && pts.length > 4) {
      const gap = pts[0].distanceTo(pts[pts.length - 1]);
      if (this.debugLogs) console.log('[ORBIT]', { mode, samples: pts.length, gap: gap.toFixed(6) });
      if (gap < 0.002) pts.push(pts[0].clone());
    } else if (this.debugLogs && pts.length > 1) {
      const gap = pts[0].distanceTo(pts[pts.length - 1]);
      console.log('[ORBIT]', { mode, samples: pts.length, gap: gap.toFixed(6), closed: false });
    }
    if (this.debugLogs && radii.length) {
      const minR = Math.min(...radii).toFixed(6);
      const maxR = Math.max(...radii).toFixed(6);
      console.log(`[ORBIT] sampleOrbitECI done mode=${mode} samples=${pts.length} r[min,max]=[${minR},${maxR}]`);
    }
    return pts;
  }
  private drawOrbit(points: THREE.Vector3[], satelliteIndex: number, mode: OrbitMode) {
    if (this.selectedSatelliteIndex !== satelliteIndex) return;
    this.clearOrbitalTraces();
    if (!points.length) return;
    console.log(`[ORBIT-DRAW] mode=${mode} satelliteIndex=${satelliteIndex} points=${points.length}`);
    const group = new THREE.Group();
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const color = this.cfg.orbitColor || '#00ff00';
    const mat = new THREE.LineBasicMaterial({ color, linewidth: 1, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geom, mat); (line as any).isLine = true; group.add(line);
    //const markerGeom = new THREE.SphereGeometry(0.0015, 10, 10);
    //const markerMat = new THREE.MeshBasicMaterial({ color });
    //const marker = new THREE.Mesh(markerGeom, markerMat);
    //marker.position.copy(points[0]); group.add(marker);
    this.scene.add(group); this.activeOrbitGroup = group;
  }
  //endregion



  //region Labels Management[rgba(146, 96, 238, 0.3)]
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
    if (!this.isDetailedView || !this.satsMesh) { this.clearSatelliteLabels(); return; }
    if (!this.cfg.showLabels) { // Solo mantener etiqueta del seleccionado
      this.clearSatelliteLabels();
      if (this.selectedSatelliteIndex != null) this.ensureSelectedLabel(this.selectedSatelliteIndex);
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
  private ensureSelectedLabel(index: number) {
    if (!this.satsMesh) return;
    const sats = this.tle.getAllSatrecs();
    if (index < 0 || index >= sats.length) return;
    // Obtener posición actual
    const tempMatrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    this.satsMesh.getMatrixAt(index, tempMatrix);
    position.setFromMatrixPosition(tempMatrix);
    const cameraDistance = this.camera.position.distanceTo(new THREE.Vector3(0, 0, 0));
    const sat = sats[index];
    // Crear etiqueta única si no existe ya
    if (!this.satLabels.some(l => l.userData && l.userData['satIndex'] === index)) {
      const name = this.extractSatelliteName(sat, index);
      const texture = this.createTextTexture(name);
      const spriteMaterial = new THREE.SpriteMaterial({
        map: texture, transparent: true, alphaTest: 0.01, depthTest: false, depthWrite: false, sizeAttenuation: false
      });
      const sprite = new THREE.Sprite(spriteMaterial);
      if (!this.cfg.showLabels) {
        // Modo etiquetas ocultas: tamaño fijo independiente del zoom
        sprite.scale.set(this.SELECTED_LABEL_FIXED_SCALE.x, this.SELECTED_LABEL_FIXED_SCALE.y, 1);
        sprite.userData['fixedScale'] = true;
      } else {
        const scale = this.calculateLabelScale(cameraDistance);
        sprite.scale.set(scale.x, scale.y, 1);
      }
      sprite.position.copy(position.clone().add(new THREE.Vector3(0, 0.0008, 0)));
      sprite.userData['satIndex'] = index;
      sprite.userData['satellitePosition'] = position.clone();
      this.scene.add(sprite);
      this.satLabels.push(sprite);
    }
  }
  private updateExistingLabelsScale() {
    const cameraDistance = this.camera.position.distanceTo(new THREE.Vector3(0, 0, 0));
    const scaleFactor = this.calculateLabelScale(cameraDistance);

    this.satLabels.forEach((label, index) => {
      // Actualizar escala
      if (label.userData && label.userData['fixedScale']) {
        // Mantener escala constante (solo actualizar posición)
      } else {
        label.scale.set(scaleFactor.x, scaleFactor.y, 1);
      }

      // 🎯 NUEVO: También actualizar posición para mantener proximidad
      if (label.userData && label.userData['satellitePosition']) {
        // Refrescar posición del satélite (especialmente para la etiqueta fija seleccionada)
        let satellitePosition = label.userData['satellitePosition'] as THREE.Vector3;
        const satIdxForUpdate = label.userData['satIndex'];
        if (typeof satIdxForUpdate === 'number' && this.satsMesh) {
          const m = new THREE.Matrix4();
          const p = new THREE.Vector3();
          this.satsMesh.getMatrixAt(satIdxForUpdate, m); p.setFromMatrixPosition(m);
          satellitePosition = p; // actualizar
          label.userData['satellitePosition'] = p.clone();
        }
        const satIndexForOffset = label.userData['satIndex'] || index;
        const newOffset = this.calculateSmartLabelOffset(satellitePosition, satIndexForOffset, cameraDistance);
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

    // 🎯 NUEVO: Actualizar posición del indicador del satélite seleccionado
    this.updateSelectedSatelliteIndicator();

    // 🎯 ELIMINADO: Ya no necesitamos restaurar colores porque usamos mesh separado
    // this.restoreColorsAfterMatrixUpdate();
  }
  // Ajuste ligero de brillo y contraste en una textura existente (canvas intermedio)
  private processEarthTexture(tex: THREE.Texture, brightness: number, contrast: number): THREE.Texture {
    try {
      const image = tex.image as HTMLImageElement | HTMLCanvasElement;
      if (!image) return tex;
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); if (!ctx) return tex;
      ctx.drawImage(image, 0, 0);
      const imgData = ctx.getImageData(0,0,canvas.width, canvas.height);
      const data = imgData.data;
      // Contraste: fórmula estándar ((x-128)*c+128) donde c = contrast
      const c = contrast;
      for (let i=0;i<data.length;i+=4){
        // brillo
        data[i]   = Math.min(255, Math.max(0, data[i]*brightness));
        data[i+1] = Math.min(255, Math.max(0, data[i+1]*brightness));
        data[i+2] = Math.min(255, Math.max(0, data[i+2]*brightness));
        // contraste
        data[i]   = Math.min(255, Math.max(0, (data[i]-128)*c + 128));
        data[i+1] = Math.min(255, Math.max(0, (data[i+1]-128)*c + 128));
        data[i+2] = Math.min(255, Math.max(0, (data[i+2]-128)*c + 128));
      }
      ctx.putImageData(imgData,0,0);
      const newTex = new THREE.CanvasTexture(canvas);
      newTex.encoding = THREE.sRGBEncoding;
      newTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      newTex.needsUpdate = true;
      // Liberar anterior
      tex.dispose();
      return newTex;
    } catch(e){
      console.warn('[EARTH] processEarthTexture error', e); return tex;
    }
  }
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

    //console.log(`[LABEL-OFFSET] Sat ${index}: offset=${baseOffset.toFixed(6)}, zoom=${cameraDistance.toFixed(3)}`);

    return finalOffset;
  }
  //endregion



  //region Coordinates methods  [rgba(96, 238, 210, 0.1)]
  
  
  public logSelectedSatelliteGeodetic() {
    if (this.selectedSatelliteIndex == null || !this.satsMesh) {
      console.warn('[SAT GEO] Ningún satélite seleccionado');
      return;
    }
    const temp = new THREE.Matrix4();
    const pScene = new THREE.Vector3();
    this.satsMesh.getMatrixAt(this.selectedSatelliteIndex, temp);
    pScene.setFromMatrixPosition(temp);
    const ecf = { x: pScene.x / this.KM_TO_SCENE, y: (pScene.z / this.KM_TO_SCENE) * this.LONGITUDE_SIGN, z: pScene.y / this.KM_TO_SCENE };
    const r = Math.sqrt(ecf.x * ecf.x + ecf.y * ecf.y + ecf.z * ecf.z);
    const lat = Math.asin(ecf.z / r);
    const lon = Math.atan2(ecf.y, ecf.x);
    console.log('[SAT GEO]', { index: this.selectedSatelliteIndex, lonDeg: THREE.MathUtils.radToDeg(lon).toFixed(3), latDeg: THREE.MathUtils.radToDeg(lat).toFixed(3), ecf });
  }
  public compareSelectedSatelliteLonOffset() {
    if (this.selectedSatelliteIndex == null) { console.warn('No hay satélite seleccionado'); return; }
    const sat = this.satellitesSnapshot[this.selectedSatelliteIndex];
    if (!sat) { console.warn('Sat no encontrado'); return; }
    if (sat.lon == null) { console.warn('Sat sin lon del worker'); return; }
    const ecf = this.eciToEcfLocal({ x: sat.eci_km.x, y: sat.eci_km.y, z: sat.eci_km.z }, sat.gmst); // NO aplicar LONGITUDE_SIGN aquí
    const lonLocal = Math.atan2(ecf.y, ecf.x);
    const dLon = ((lonLocal - sat.lon + Math.PI) % (2 * Math.PI)) - Math.PI;
    const toDeg = (rad: number) => THREE.MathUtils.radToDeg(rad).toFixed(3);
    console.log('[SAT LON OFFSET]', { index: sat.index, workerLonDeg: toDeg(sat.lon), localLonDeg: toDeg(lonLocal), deltaLonDeg: toDeg(dLon) });
  }
  private eciToEcfLocal(eci: { x: number, y: number, z: number }, gmst: number) {
    // ECF = R3(-gmst) * ECI  (rotación activa -gmst sobre Z)
    const cosG = Math.cos(gmst);
    const sinG = Math.sin(gmst);
    return { x: eci.x * cosG + eci.y * sinG, y: -eci.x * sinG + eci.y * cosG, z: eci.z };
  }
  private toSceneFromECI(eciKm: { x: number; y: number; z: number }, gmst: number): THREE.Vector3 {
    const ecf = (this.viewFrame === ViewFrame.EarthFixed) ? this.eciToEcfLocal(eciKm, gmst) : eciKm;
    return this.ecfToScene(ecf);
  }
  private ecfToScene(ecf: { x: number; y: number; z: number }): THREE.Vector3 {
    return new THREE.Vector3(
      ecf.x * this.KM_TO_SCENE,
      ecf.z * this.KM_TO_SCENE,
      ecf.y * this.LONGITUDE_SIGN * this.KM_TO_SCENE
    );
  }
  private geoECEF_Yup(latDeg: number, lonDeg: number, altitudeKm = 0): { x: number; y: number; z: number } {
  // CORRECCIÓN: Esta función generaba un sistema inconsistente (usaba Y como eje polar y Z como Este-Oeste)
  // mientras que todo el pipeline (ECI->ECF, logSelectedSatelliteGeodetic) asume ECF estándar:
  //   x: lat=0, lon=0 (ecuador / Greenwich)
  //   y: lat=0, lon=+90°E
  //   z: eje polar (Norte)
  // Esto provocaba que al introducir (lat, lon) el UE apareciera desplazado (ej: Madrid terminaba en África oriental).
  // Implementamos ahora la fórmula ECEF estándar (esfera) coherente con el resto.
  const R = 6371; // km (modelo esférico suficiente aquí)
  const lat = THREE.MathUtils.degToRad(latDeg);
  const lon = THREE.MathUtils.degToRad(lonDeg);
  const r = R + altitudeKm;
  const cosLat = Math.cos(lat);
  const sinLat = Math.sin(lat);
  const cosLon = Math.cos(lon);
  const sinLon = Math.sin(lon);
  const x = r * cosLat * cosLon;
  const y = r * cosLat * sinLon;  // Este positivo
  const z = r * sinLat;           // Norte positivo
  return { x, y, z };
  }
  private geographicToCartesian(latDeg: number, lonDeg: number, altKm: number = 0): THREE.Vector3 {
    const ecf = this.geoECEF_Yup(latDeg, lonDeg, altKm);
    return this.ecfToScene(ecf);
  }
  public setViewFrame(frame: 'earthfixed' | 'inertial') {
    if (frame === 'earthfixed') this.viewFrame = ViewFrame.EarthFixed; else this.viewFrame = ViewFrame.Inertial;
    console.log(`[VIEW-FRAME] Cambiado a ${this.viewFrame}`);
    // Reset rotación tierra si cambiamos a EarthFixed
    if (this.viewFrame === ViewFrame.EarthFixed && this.earthRoot) this.earthRoot.rotation.y = this.EARTH_BASE_YAW;
    // Regenerar órbita seleccionada para evitar distorsión anterior
    if (this.selectedSatelliteIndex != null && this.activeOrbitMode) {
      this.generateInstantOrbit(this.selectedSatelliteIndex, this.activeOrbitMode);
    }
  // Reatachar UE
  this.updateUserPosition();
  }
  public setDebugLogs(enabled: boolean) {
    this.debugLogs = enabled;
    console.log(`[DEBUG-LOGS] ${enabled ? 'Activados' : 'Desactivados'}`);
  }
  //endregion



  //region Create & update Elements [rgba(68, 255, 0, 0.18)]

  private async createEarth() {
    const geo = new THREE.SphereGeometry(0.1, 64, 64); // 🎯 Resolución alta para suavidad
    const EARTH_BASE_LON_ROT_RAD = Math.PI; // 180° para alinear Greenwich con +X con textura estándar

    // � NASA BLUE MARBLE: Textura profesional con calibración astronómica
    const loader = new THREE.TextureLoader();
  // Modo clásico: NO alterar brillo/contraste; textura tal cual
  const originalImageHolder: { img?: HTMLImageElement } = {};
    this.earthTexture = await new Promise<THREE.Texture>((resolve, reject) => {
      loader.load(
        'assets/blue_marble_nasa_proper.jpg', // 🎯 NUEVA: Blue Marble NASA calibrada
        (texture) => {
          console.log('[EARTH] Blue Marble NASA calibrada cargada exitosamente');
          originalImageHolder.img = texture.image as HTMLImageElement;
          resolve(texture);
        },
        (progress) => {
          console.log('[EARTH] Progreso de carga:', (progress.loaded / progress.total * 100).toFixed(2) + '%');
        },
        (error) => {
          console.error('[EARTH] Error cargando Blue Marble NASA:', error);
          // Fallback a texturas de respaldo en orden de preferencia
          loader.load('assets/earth_4k_hd.jpg',
            (texture2) => { originalImageHolder.img = texture2.image as HTMLImageElement; resolve(texture2); },
            undefined,
            () => loader.load('assets/earth_continents_bw.png', (texture3) => { originalImageHolder.img = texture3.image as HTMLImageElement; resolve(texture3); }, undefined, reject)
          );
        }
      );
    });

    // 🎯 CONFIGURACIÓN OPTIMIZADA PARA PROYECCIÓN EQUIRECTANGULAR NASA
    // Ajuste A: activamos RepeatWrapping en S para permitir flip horizontal y corrección E/W
    this.earthTexture.wrapS = THREE.RepeatWrapping; // Permitimos repetición para poder usar repeat.x = -1
    this.earthTexture.wrapT = THREE.ClampToEdgeWrapping; // Sin repetición vertical
    this.earthTexture.minFilter = THREE.LinearMipmapLinearFilter; // 🎯 MEJORADO: Mejor filtrado para zoom
    this.earthTexture.magFilter = THREE.LinearFilter; // Filtrado para magnificación
    this.earthTexture.generateMipmaps = true; // Mipmaps para mejor rendimiento
    this.earthTexture.flipY = true; // 🎯 CORREGIDO: Blue Marble NASA SÍ necesita flip para orientación correcta
    this.earthTexture.encoding = THREE.sRGBEncoding; // 🎯 NUEVO: Encoding correcto para colores naturales
    this.earthTexture.anisotropy = this.renderer.capabilities.getMaxAnisotropy(); // 🎯 NUEVO: Filtrado anisotrópico máximo

    console.log(`[EARTH] 🎯 Filtrado anisotrópico activado: ${this.earthTexture.anisotropy}x para máxima nitidez en zoom`);

    // --- ORIENTACIÓN FINAL ROBUSTA (SIN MIRROR) ---
    // Estrategia definitiva: mantener matemática ECEF estándar (x,y,z) y NO espejar la textura.
    // Solo aplicamos un offset longitudinal paramétrico para alinear Greenwich con +X.
    this.earthTexture.wrapS = THREE.RepeatWrapping;
    this.earthTexture.repeat.x = 1; // inversión única para corregir espejo global
    // Aplicar offset base configurable (en grados convertido a fracción)
    this.earthTexture.offset.x = 0; // sin offset base
    this.earthTexture.needsUpdate = true;
    console.log('[EARTH] ✅ Textura sin mirror. Offset base lon0=0 -> offset.x=0');


    // Post-proceso sencillo de brillo/contraste (sólo si tenemos imagen original)
    try {
      if (originalImageHolder.img) {
  // (Ajuste brillo/contraste eliminado)
      }
    } catch (e) {
      console.warn('[EARTH] Post-proceso de textura falló, usando textura original', e);
    }

    // 🎯 MATERIAL: seguimos con MeshBasic para mantener rendimiento y evitar dependencia de luces
    const mat = new THREE.MeshBasicMaterial({ map: this.earthTexture, transparent: false, opacity: 1.0, side: THREE.FrontSide });

    this.earthMesh = new THREE.Mesh(geo, mat);

    // 🎯 Rotación base fija (ya no es necesario llamar setEarthGeometryLonRotation(180) manualmente)
    this.earthMesh.rotation.set(0, 0, 0); // eliminamos rotación base acumulativa

  this.scene.add(this.earthMesh);
  // Unificar referencia para gestión de modos (classic)
  this.earthRoot = this.earthMesh;
    // Wireframe moderno
    const wireframe = new THREE.WireframeGeometry(geo);
    this.earthWireframe = new THREE.LineSegments(wireframe, new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 }));
    // Aplicar misma rotación al wireframe
    this.earthWireframe.rotation.set(0, 0, 0);
    this.earthWireframe.renderOrder = 1;
  this.scene.add(this.earthWireframe);
    // Visibilidad inicial conforme a la config (showGrid=false => oculto)
    this.earthWireframe.visible = this.cfg.showGrid;
    if (this.earthGrid) this.earthGrid.visible = this.cfg.showGrid;
  }

  // =================== EARTH GLB MODE ===================
  // Carga alternativa de Tierra usando GLB sin alterar pipeline de coordenadas (radio final 0.1 como classic)
  private async createEarthFromGLB() {
    console.log('[EARTH-GLB] Iniciando carga GLB');
    const loader = new GLTFLoader();
    return new Promise<void>((resolve) => {
      loader.load(
        'assets/models/earth/earth.glb',
        (gltf) => {
          try {
            const root = gltf.scene || gltf.scenes[0];
            if (!root) throw new Error('Escena GLB vacía');
            root.position.set(0,0,0);
            root.rotation.set(0,this.EARTH_BASE_YAW,0); // Aplicar yaw base igual que modo clásico
            // Calcular bounding box para escalar a radio=0.1 (calibración identica a esfera clásica)
            const box = new THREE.Box3().setFromObject(root);
            const size = box.getSize(new THREE.Vector3());
            // Aproximar radio desde el tamaño diagonal / 2 o usar componente mayor
            const approxRadius = size.length() / 2 || Math.max(size.x,size.y,size.z)/2 || 1;
            const scale = 0.185 / approxRadius;
            root.scale.setScalar(scale);
            // Ajustes de materiales
            const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
            // (Imágenes originales eliminadas)
            root.traverse(obj => {
              const mesh = obj as any;
              if (mesh.material) {
                const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                materials.forEach((m: any) => {
      if (!this.glbPbrMode) return; // En modo plano convertiremos despues
                  if (m.map) {
                    m.map.encoding = THREE.sRGBEncoding;
                    m.map.anisotropy = maxAniso;
                    m.map.needsUpdate = true;
                    // (almacenamiento de imagen original eliminado)
                  }
                  if (m.emissiveMap) {
                    m.emissiveMap.encoding = THREE.sRGBEncoding;
                    m.emissiveMap.anisotropy = maxAniso;
                    m.emissiveMap.needsUpdate = true;
                    // (almacenamiento de imagen original eliminado)
                  }
                  m.needsUpdate = true;
                });
              }
            });
    if (!this.glbPbrMode) { this.convertGlbMaterialsToBasic(root, maxAniso); console.log('[EARTH-GLB] Materiales convertidos a MeshBasic (modo plano)'); } else { this.loadEnvironmentIfNeeded(); }
            // Aplicar ajustes iniciales (1.0 => sin cambio). Si usuario modificó antes, reaplicar.
            // (Ajuste brillo/contraste eliminado)
            
            // Detectar capas de nubes / atmósfera por nombre
            this.cloudLayer = null;
            root.traverse(o => {
              if (!this.cloudLayer && /cloud|atmos/i.test(o.name)) this.cloudLayer = o;
            });
            // (Nubes eliminadas)
            root.frustumCulled = true;
            this.scene.add(root);
            this.earthRoot = root;
            this.earthMesh = null; // No hay esfera clásica
            // Ocultar wireframe grid si existían del modo anterior
            if (this.earthWireframe) { this.scene.remove(this.earthWireframe); this.earthWireframe.geometry.dispose(); (this.earthWireframe.material as any).dispose?.(); this.earthWireframe = null; }
            console.log('[EARTH-GLB] Cargado y escalado. Radio target=0.1');
            // Captura parámetros PBR originales
            this.originalPbrParams = [];
            if (this.glbPbrMode) {
              root.traverse(o => {
                const mesh:any = o;
                if (mesh.material) {
                  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                  mats.forEach((m:any) => {
                    if (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) {
                      this.originalPbrParams.push({ material: m, roughness: m.roughness ?? 0.5, metalness: m.metalness ?? 0.0, envMapIntensity: m.envMapIntensity });
                    }
                  });
                }
              });
            }
            this.updateToneMappingForMode();
            if (this.glbPbrMode) this.applyPbrAdjustments();
          } catch (e) {
            console.error('[EARTH-GLB] Error procesando GLB, fallback a modo clásico', e);
            this.setEarthMode('classic');
          }
          resolve();
        },
        undefined,
        (err) => {
          console.error('[EARTH-GLB] Fallo cargando GLB:', err);
          console.warn('[EARTH-GLB] Fallback a modo clásico');
          this.setEarthMode('classic');
          resolve();
        }
      );
    });
  }

  // Elimina la Tierra actual (classic o GLB) liberando recursos.
  private destroyEarth() {
    if (this.earthRoot) {
      const toDispose: THREE.Object3D[] = [];
      this.earthRoot.traverse(o => { toDispose.push(o); });
      toDispose.forEach(o => {
        const mesh = o as any;
        if (mesh.geometry) mesh.geometry.dispose?.();
        if (mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach((m: any) => m && m.dispose && m.dispose());
        }
      });
      this.scene.remove(this.earthRoot);
      this.earthRoot = null;
    }
    if (this.earthWireframe) {
      this.scene.remove(this.earthWireframe);
      this.earthWireframe.geometry.dispose();
      (this.earthWireframe.material as any).dispose?.();
      this.earthWireframe = null;
    }
    // No tocamos earthGrid porque no se usa actualmente (placeholder)
    this.earthMesh = null;
    this.earthTexture = null;
    this.cloudLayer = null;
  }

  public async setEarthMode(mode: 'classic'|'glb') {
    if (mode === this.earthMode) { console.log('[EARTH] Modo ya activo:', mode); return; }
    console.log('[EARTH] Cambiando modo ->', mode);
    this.destroyEarth();
    if (mode === 'classic') {
      await this.createEarth();
      this.earthMode = 'classic';
      // Reaplicar config de grid/wireframe
      this.applyConfig();
  this.updateToneMappingForMode();
    } else {
      await this.createEarthFromGLB();
  // Si el GLB falló y se hizo fallback, earthRoot será la esfera clásica
  this.earthMode = (this.earthRoot && !(this.earthRoot as any).isMesh) ? 'glb' : (this.earthRoot ? (this.earthRoot === this.earthMesh ? 'classic':'glb') : 'classic');
  if (this.earthMode === 'classic') this.applyConfig();
  this.updateToneMappingForMode();
    }
  }

  public nudgeEarthYaw(delta: number) { if (this.earthRoot) this.earthRoot.rotation.y += delta; }
  // Nubes eliminadas
  // toggleAutoRotate redefinido más abajo
  // Controles de auto-rotar y velocidad eliminados
  public onEarthModeChange(val: string) { const mode = (val === 'glb') ? 'glb' : 'classic'; this.setEarthMode(mode); this.saveSettings(); }
  // PBR métodos redefinidos más abajo
  public onPbrParamsChange() { this.applyPbrAdjustments(); this.saveSettings(); }
  public resetPbrAdjustments() {
    // Restaurar baseline solicitado (3.0, 0.8, -0.5)
    this.pbrEnvMapIntensity = 3.0;
    this.pbrRoughnessDelta = 0.8;
    this.pbrMetalnessDelta = -0.5;
    this.applyPbrAdjustments();
    this.saveSettings();
  }
  // toggleRimLight eliminado de UI
  // API pública para ajustar brillo/contraste GLB
  // (Métodos brillo/contraste eliminados)
  public onExposureChange(e: number) { this.renderer.toneMappingExposure = e; this.saveSettings(); }
  // --- Utilidades PBR / Environment ---
  private convertGlbMaterialsToBasic(root: THREE.Object3D, maxAniso: number) {
    root.traverse(o => {
      const mesh: any = o;
      if (mesh.isMesh && mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const converted: any[] = [];
        mats.forEach((m:any) => {
          const baseMap = m.map || null;
          const basic = new THREE.MeshBasicMaterial({ map: baseMap, transparent: !!m.transparent });
          if (basic.map) { basic.map.encoding = THREE.sRGBEncoding; basic.map.anisotropy = maxAniso; basic.map.needsUpdate = true; }
          converted.push(basic); if (m.dispose) m.dispose();
        });
        mesh.material = Array.isArray(mesh.material) ? converted : converted[0];
      }
    });
  }
  private loadEnvironmentIfNeeded() {
    if (this.envHdrLoaded || !this.glbPbrMode) return;
    const hdrPath = 'assets/env/studio_small_08_1k.hdr';
    new RGBELoader().load(hdrPath, tex => {
      tex.mapping = THREE.EquirectangularReflectionMapping;
      this.scene.environment = tex;
      console.log('[ENV] HDRI cargado', hdrPath);
      this.envHdrLoaded = true;
  this.applyPbrAdjustments();
    }, undefined, err => console.warn('[ENV] Error HDRI', hdrPath, err));
  }
  private updateToneMappingForMode() {
    if (!this.renderer) return;
    if (this.earthMode === 'glb' && this.glbPbrMode) {
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 2.0; // Fijo solicitado
    } else {
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.0;
    }
    console.log('[RENDERER] ToneMapping -> mode='+this.earthMode+' pbr='+this.glbPbrMode+' exposure='+this.renderer.toneMappingExposure);
    this.saveSettings();
  }

  private applyPbrAdjustments() {
    if (!this.earthRoot || !this.glbPbrMode) return;
    if (!this.originalPbrParams.length) return;
    this.originalPbrParams.forEach(entry => {
      const m:any = entry.material;
      if (!(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial)) return;
      m.roughness = THREE.MathUtils.clamp(entry.roughness + this.pbrRoughnessDelta, 0,1);
      m.metalness = THREE.MathUtils.clamp(entry.metalness + this.pbrMetalnessDelta, 0,1);
      m.envMapIntensity = (entry.envMapIntensity ?? 1) * this.pbrEnvMapIntensity;
      m.needsUpdate = true;
    });
  }

  // =================== Persistencia ===================
  private loadSettingsFromStorage() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY); if (!raw) return;
      const obj = JSON.parse(raw);
      if (obj.earthMode) this.earthMode = obj.earthMode === 'glb' ? 'glb' : 'classic';
      if (typeof obj.glbPbrMode === 'boolean') this.glbPbrMode = obj.glbPbrMode;
  // brillo/contraste eliminados
  // showClouds eliminado
  // autoRotate/earthRotateSpeed obsoletos (ignorados si existen)
  // Exposición ya fija para GLB PBR y 1.0 para classic
      console.log('[PERSIST] Ajustes cargados');
  if (typeof obj.pbrEnvMapIntensity === 'number') this.pbrEnvMapIntensity = obj.pbrEnvMapIntensity;
  if (typeof obj.pbrRoughnessDelta === 'number') this.pbrRoughnessDelta = obj.pbrRoughnessDelta;
  if (typeof obj.pbrMetalnessDelta === 'number') this.pbrMetalnessDelta = obj.pbrMetalnessDelta;
  // timeMultiplier obsoleto
    } catch(e){ console.warn('[PERSIST] Error cargando settings', e); }
  }
  private saveSettings() {
    try {
      const data = {
        earthMode: this.earthMode,
        glbPbrMode: this.glbPbrMode,
  // brightness/contrast eliminados
  // showClouds eliminado
  // autoRotateEarth y earthRotateSpeed eliminados
  // exposure omitido (ya fijo por modo)
        pbrEnvMapIntensity: this.pbrEnvMapIntensity,
        pbrRoughnessDelta: this.pbrRoughnessDelta,
        pbrMetalnessDelta: this.pbrMetalnessDelta,
  // timeMultiplier eliminado
      };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
    } catch(e){ /* ignorar */ }
  }

  
  private createSatellites() {
    const sats = this.tle.getAllSatrecs();
    console.log(`[INIT] Creando ${sats.length} satélites`);

    // Tamaño razonable y color rojo puro
    const geometry = new THREE.SphereGeometry(0.0004);
    const material = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: false,
      opacity: 1.0
    });
    this.satsMesh = new THREE.InstancedMesh(geometry, material, sats.length);

    // 🎯 SOLUCION Z-FIGHTING: Render order más bajo para satélites originales
    this.satsMesh.renderOrder = 0;

    // 🎯 ELIMINADO: Ya no necesitamos buffer de colores porque usamos mesh separado para selección
    // const colors = new Float32Array(sats.length * 3);
    // for (let i = 0; i < sats.length; i++) { ... }
    // this.satsMesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);

    this.scene.add(this.satsMesh);
    // Aplicar color configurado inmediatamente
    this.updateSatelliteBaseColor();

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
        console.log('[WORKER] TLEs ready (propagación inicial ya recibida por chunks)');
        this.workerBusy = false; // permitir siguiente ciclo normal
      }
      else if (data.type === 'debug') {
        const debugMsg = data.payload;
        console.log('[WORKER-DEBUG]', debugMsg);
      }
      else if (data.type === 'propagation_chunk') {
        // data.payload: { chunk, offset }
        try {
          this.updateSatellitePositionsChunk(data.payload.chunk, data.payload.offset);
        } catch (e) {
          console.warn('[WORKER] Error procesando chunk', e);
        }
        if (this.loadingFirstFrame) {
          this.firstFrameReceived += data.payload.chunk.length;
          if (this.firstFrameSatCount > 0) {
            this.loadingProgress = Math.min(100, Math.round((this.firstFrameReceived / this.firstFrameSatCount) * 100));
          }
          if (this.firstFrameReceived % 500 === 0 || this.loadingProgress === 100) {
            console.log(`[CHUNK] Progreso: ${this.firstFrameReceived}/${this.firstFrameSatCount} (${this.loadingProgress}%)`);
          }
        }
      }
      else if (data.type === 'propagation_complete' || data.type === 'propagation_result') {
        // Actualizar posiciones
        this.updateSatellitePositions(data.payload);
        // Latencia medida envío->recepción
        const nowPerf = performance.now();
        this.lastLatencyMs = nowPerf - this.lastPropagateSend;
        // Actualizar EMA (suavizado fuerte)
        this.latencyEmaMs = 0.9 * this.latencyEmaMs + 0.1 * this.lastLatencyMs;
        // Edad efectiva del snapshot respecto al instante objetivo que pedimos
        const ageMs = Date.now() - this.lastPropTargetTimeMs; // positivo => vamos por detrás
        if (Math.abs(ageMs) > 25) {
          if (ageMs > 25) {
            // Vamos detrás -> aumentar factor suavemente
            this.predictionLeadFactor = Math.min(this.predictionLeadFactor * 1.05, 2.0);
          } else if (ageMs < -25) {
            // Vamos demasiado adelantados -> reducir
            this.predictionLeadFactor = Math.max(this.predictionLeadFactor * 0.94, 0.5);
          }
        }
        if (this.frameId % 600 === 0) {
          console.log(`[PERF] lat=${this.lastLatencyMs.toFixed(1)}ms ema=${this.latencyEmaMs.toFixed(1)}ms age=${ageMs.toFixed(1)}ms leadFactor=${this.predictionLeadFactor.toFixed(2)}`);
        }
        if (this.loadingFirstFrame) {
          this.loadingFirstFrame = false;
          this.loadingProgress = 100;
          this.loadingEndTime = performance.now();
          this.loadingElapsedMs = this.loadingEndTime - this.loadingStartTime;
          console.log(`[LOAD] Primer frame completo en ${this.loadingElapsedMs.toFixed(0)} ms.`);
        }
  // Siempre tiempo real
  this.simulatedDate = new Date();
        this.lastWorkerFrameDate = new Date(this.simulatedDate);
        this.workerBusy = false;
      }
    };

    // Enviar los TLEs al worker
    console.log('[WORKER] Enviando TLEs iniciales');
	// Enviar TLEs iniciales pidiendo ya una propagación ligeramente adelantada
    this.lastPropagateSend = performance.now();
    const initLeadMs = Math.min(this.latencyEmaMs * this.predictionLeadFactor, this.MAX_LEAD_MS);
    this.lastPropTargetTimeMs = Date.now() + initLeadMs;
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
    // Se posiciona correctamente vía updateUserPosition según frame
    if (this.viewFrame === ViewFrame.Inertial && this.earthRoot) {
      this.earthRoot.add(this.ueMesh);
    } else {
      this.scene.add(this.ueMesh);
    }
    this.updateUserPosition();
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

    // 🎯 ELIMINADO: No llamar updateSatelliteColors() en cada frame
    // Solo se llama cuando hay cambios de selección

    // 🎯 ASEGURAR: Métricas siempre null para mantener interfaz limpia
    this.currentMetrics = null;

    // Enviar al worker las nuevas posiciones a calcular
    const frustumPlanes = this.updateFrustum();
    this.workerBusy = true; // Bloquear hasta la siguiente respuesta
    this.lastPropagateSend = performance.now();
    const leadMs = Math.min(this.latencyEmaMs * this.predictionLeadFactor, this.MAX_LEAD_MS);
    const targetTimeMs = Date.now() + leadMs;
    this.lastPropTargetTimeMs = targetTimeMs;
    this.worker.postMessage({
      type: 'propagate',
      payload: {
        date: new Date(targetTimeMs).toISOString(),
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

    // 🎯 ANTI-PARPADEO: Actualizar indicador de selección en cada frame para máxima suavidad
    this.updateSelectedSatelliteIndicator();

    // 🔄 Regeneración dinámica de groundtrack (cada ~2s) si procede
    if (this.activeOrbitMode === OrbitMode.GroundTrack && this.selectedSatelliteIndex != null) {
      this.generateDynamicOrbit(this.selectedSatelliteIndex);
    }

    // Rotación de la Tierra en modo INERTIAL para visual real; en modo EarthFixed no rotamos (ECEF ya aplicado).
    if (this.viewFrame === ViewFrame.Inertial && this.earthRoot) {
      const now = performance.now();
      if (this.lastFrameTime == null) this.lastFrameTime = now;
      const dtSec = (now - this.lastFrameTime) / 1000;
      this.lastFrameTime = now;
      this.earthRoot.rotation.y += this.EARTH_ROT_RATE * dtSec; // Y rota este globo
    }

    this.renderer.render(this.scene, this.camera);
  };
  private updateSatellitePositions(satellites: { index: number; eci_km: { x: number; y: number; z: number }; gmst: number; visible: boolean; lon?: number; lat?: number; height?: number }[]) {
    if (!this.satsMesh) return;
    this.satellitesSnapshot = satellites;

    const cameraDistance = this.camera.position.distanceTo(new THREE.Vector3(0, 0, 0));
    const scale = this.calculateSatelliteScale(cameraDistance);
    satellites.forEach((sat) => {
      if (!sat.visible) return;
      const pos = this.toSceneFromECI(sat.eci_km, sat.gmst);
      const r = pos.length();
      // Validación rango
      if (this.debugLogs && (r < 0.101 || r > 0.5) && this.frameId % this.LOG_EVERY_N_FRAMES === 0) {
        console.warn(`[SAT-RANGE] r fuera de rango: r=${r.toFixed(6)} idx=${sat.index}`);
      }
      this.instanceMatrix.makeScale(scale, scale, scale);
      this.instanceMatrix.setPosition(pos.x, pos.y, pos.z);
      this.satsMesh!.setMatrixAt(sat.index, this.instanceMatrix);
    });

    if (this.satsMesh.instanceMatrix) {
      this.satsMesh.instanceMatrix.needsUpdate = true;
    }

    // 🎯 NUEVO: Actualizar posición del indicador del satélite seleccionado
    this.updateSelectedSatelliteIndicator();

    // 🎯 ELIMINADO: Ya no necesitamos restaurar colores porque usamos mesh separado
    // this.restoreColorsAfterMatrixUpdate();

    // Logging controlado (solo una vez cada LOG_EVERY_N_FRAMES frames y sólo en el update completo)
    if (this.debugLogs && this.frameId % this.LOG_EVERY_N_FRAMES === 0 && this.lastLogFrame !== this.frameId) {
      const targetIndex = this.selectedSatelliteIndex !== null ? this.selectedSatelliteIndex : 0;
      if (this.satsMesh && targetIndex < this.satsMesh.count) {
        const m = new THREE.Matrix4();
        const p = new THREE.Vector3();
        this.satsMesh.getMatrixAt(targetIndex, m);
        p.setFromMatrixPosition(m);
        const r = p.length();
        console.log(`[SAT] pos(scene)=(${p.x.toFixed(6)},${p.y.toFixed(6)},${p.z.toFixed(6)}) r=${r.toFixed(6)}`);
      }
      this.lastLogFrame = this.frameId;
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

    if (!this.ueMesh) return;
    if (this.viewFrame === ViewFrame.Inertial && this.earthRoot) {
      if (this.ueMesh.parent !== this.earthRoot) {
        this.ueMesh.parent?.remove(this.ueMesh);
        this.earthRoot.add(this.ueMesh);
      }
      // En modo inercial la Tierra rota, así que anclamos UE a la Tierra para que rote con ella.
      this.ueMesh.position.copy(position);
    } else {
      if (this.ueMesh.parent !== this.scene) {
        this.ueMesh.parent?.remove(this.ueMesh);
        this.scene.add(this.ueMesh);
      }
      this.ueMesh.position.copy(position);
    }
    if (this.debugLogs && this.frameId % 120 === 0) {
      console.log(`[UE-POS] lat=${this.userLat} lon=${this.userLon} frame=${this.viewFrame} -> (${position.x.toFixed(4)}, ${position.y.toFixed(4)}, ${position.z.toFixed(4)})`);
    }
  }
  private updateSatellitePositionsChunk(chunk: { index: number; eci_km: { x: number; y: number; z: number }; gmst: number; visible: boolean; lon?: number; lat?: number; height?: number }[], offset: number) {
    if (!this.satsMesh) return;
    // merge chunk into snapshot
    chunk.forEach(s => { this.satellitesSnapshot[s.index] = s; });

    const cameraDistance = this.camera.position.distanceTo(new THREE.Vector3(0, 0, 0));
    const scale = this.calculateSatelliteScale(cameraDistance);
    chunk.forEach((sat) => {
      if (!sat.visible) return;
      const pos = this.toSceneFromECI(sat.eci_km, sat.gmst);
      const r = pos.length();
      if (this.debugLogs && (r < 0.101 || r > 0.5) && this.frameId % this.LOG_EVERY_N_FRAMES === 0) {
        console.warn(`[SAT-RANGE] r fuera de rango: r=${r.toFixed(6)} idx=${sat.index}`);
      }
      this.instanceMatrix.makeScale(scale, scale, scale);
      this.instanceMatrix.setPosition(pos.x, pos.y, pos.z);
      this.satsMesh!.setMatrixAt(sat.index, this.instanceMatrix);
    });

    if (this.satsMesh.instanceMatrix) {
      this.satsMesh.instanceMatrix.needsUpdate = true;
    }

    // 🎯 NUEVO: Actualizar posición del indicador del satélite seleccionado
    this.updateSelectedSatelliteIndicator();

    // 🎯 ELIMINADO: Ya no necesitamos restaurar colores porque usamos mesh separado
    // this.restoreColorsAfterMatrixUpdate();

    // Logging alternativo: si todavía no se ha logueado este frame (puede llegar primero un chunk)
    if (this.debugLogs && this.frameId % this.LOG_EVERY_N_FRAMES === 0 && this.lastLogFrame !== this.frameId && offset === 0) {
      const targetIndex = this.selectedSatelliteIndex !== null ? this.selectedSatelliteIndex : 0;
      if (this.satsMesh && targetIndex < this.satsMesh.count) {
        const m = new THREE.Matrix4();
        const p = new THREE.Vector3();
        this.satsMesh.getMatrixAt(targetIndex, m);
        p.setFromMatrixPosition(m);
        const r = p.length();
        console.log(`[SAT] pos(scene)=(${p.x.toFixed(6)},${p.y.toFixed(6)},${p.z.toFixed(6)}) r=${r.toFixed(6)}`);
      }
      this.lastLogFrame = this.frameId;
    }
  }

  //endregion


  //region Configuration panel rgba(255, 191, 0, 1))]

  public toggleConfigPanel() { this.showConfigPanel = !this.showConfigPanel; }
  public applyConfig() {
    // Grid
    if (this.earthGrid) this.earthGrid.visible = this.cfg.showGrid;
    if (this.earthWireframe) this.earthWireframe.visible = this.cfg.showGrid; // opcional vincular también
    // Axes Helper (creamos uno si no existe y user lo activa)
    const axesExisting = this.scene.children.find(c => c.type === 'AxesHelper');
    if (this.cfg.showAxes && !axesExisting) {
      const axesHelper = new THREE.AxesHelper(0.2);
      axesHelper.name = '__axesHelper';
      this.scene.add(axesHelper);
    } else if (!this.cfg.showAxes && axesExisting) {
      this.scene.remove(axesExisting);
    }
    // Color satélites
    this.updateSatelliteBaseColor();
    // Color órbita / indicadores
    this.updateActiveOrbitColors();
    // Etiquetas
    if (!this.cfg.showLabels) {
      // Limpiar todas menos la seleccionada (si hay)
      const selectedIdx = this.selectedSatelliteIndex;
      this.clearSatelliteLabels();
      if (selectedIdx != null) this.ensureSelectedLabel(selectedIdx);
    } else {
      // Forzar regeneración inmediata
      this.updateSatelliteLabels();
    }
  }
  private updateSatelliteBaseColor() {
    if (!this.satsMesh) return;
    const mat = this.satsMesh.material as THREE.MeshBasicMaterial;
    if (mat && mat.color) {
      mat.color.set(this.cfg.satColor);
      mat.needsUpdate = true;
    }
  }
  public setSatelliteColor(c: string) { this.cfg.satColor = c; this.updateSatelliteBaseColor(); }
  public setOrbitColor(c: string) { this.cfg.orbitColor = c; this.updateActiveOrbitColors(); this.updateSelectedSatelliteIndicatorColor(); }
  public setCustomSatelliteColor() { this.cfg.satColor = this.customSatColor; this.updateSatelliteBaseColor(); }
  public setCustomOrbitColor() { this.cfg.orbitColor = this.customOrbitColor; this.updateActiveOrbitColors(); this.updateSelectedSatelliteIndicatorColor(); }

  private updateActiveOrbitColors() {
    if (this.activeOrbitGroup) {
      this.activeOrbitGroup.traverse(obj => {
        const m: any = obj;
        if (m.isLine && m.material && m.material.color) {
          m.material.color.set(this.cfg.orbitColor);
          m.material.needsUpdate = true;
        }
        if (m.isMesh && m.material && m.material.color && m.geometry?.type === 'SphereGeometry') {
          // marcador de inicio
          m.material.color.set(this.cfg.orbitColor);
          m.material.needsUpdate = true;
        }
      });
    }
    // Línea satélite->Tierra
    if (this.selectedSatelliteLine) {
      this.selectedSatelliteLine.traverse(obj => {
        const mesh:any = obj;
        if (mesh.isMesh && mesh.material && mesh.material.color) {
          mesh.material.color.set(this.cfg.orbitColor);
          mesh.material.needsUpdate = true;
        }
      });
    }
  }

  private updateSelectedSatelliteIndicatorColor() {
    if (this.selectedSatelliteMesh && (this.selectedSatelliteMesh.material as any)?.color) {
      (this.selectedSatelliteMesh.material as any).color.set(this.cfg.orbitColor);
      (this.selectedSatelliteMesh.material as any).needsUpdate = true;
    }
  }
  //endregion

}
