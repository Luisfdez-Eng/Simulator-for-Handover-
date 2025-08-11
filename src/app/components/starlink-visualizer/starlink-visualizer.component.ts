import { Component, OnInit, OnDestroy } from '@angular/core';
// ✅ Aseguramos importaciones de Three.js y OrbitControls para disponer de tipos y exponerlos en window
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { TleLoaderService, SatData } from '../../services/tle-loader.service';
import { MLHandoverService, SatelliteMetrics } from '../../services/ml-handover.service';
import * as satellite from 'satellite.js';
/**
 * ================================== CONVENCIÓN COORDENADAS (Fase C – cerrada) ==================================
 * Fuente de datos (worker): ECI (km) + GMST por frame.
 * Modo EarthFixed (por defecto): ECI -> ECF aplicando rotación activa R3(-GMST) en eciToEcfLocal().
 * Sistema escena (Three.js, Y-up):
 *    scene.x = ecf.x
 *    scene.y = ecf.z          (eje polar)
 *    scene.z = ecf.y * LONGITUDE_SIGN (Este/Oeste controlado por un único interruptor)
 * Escala única: KM_TO_SCENE = 0.1 / 6371 (radio terrestre en escena = 0.1).
 * LONGITUDE_SIGN SOLO se aplica en el paso ecf -> scene (función ecfToScene()).
 * Helpers geográficos generan posiciones ECF (km) sin signo; luego se mapean vía ecfToScene().
 * Eliminados hacks históricos (rotación -π/2, theta+90, swaps de ejes en helpers).
 * Para invertir visualmente E/W ajustar LONGITUDE_SIGN (1 o -1) en un solo punto.
 * =============================================================================================
 */
// Eliminado import duplicado de OrbitControls via wrapper

// Enum de frame de vista para futura migración (Fase B)
// TODO Fase B: Integrar cambio dinámico entre EarthFixed e Inertial cuando el worker entregue ECI puro
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
  // Último snapshot recibido de satélites (con lat/lon si llega del worker)
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

  // 🎯 NUEVO: Sistema de selección y tracking de satélites
  private selectedSatelliteIndex: number | null = null; // Índice del satélite seleccionado
  private selectedSatelliteMesh: THREE.Mesh | null = null; // 🎯 NUEVO: Mesh separado para satélite seleccionado
  private selectedSatellitePosition: THREE.Vector3 | null = null; // 🎯 ANTI-PARPADEO: Cache de posición
  private selectedSatelliteLine: THREE.Line | null = null; // 🎯 NUEVO: Línea del satélite a la Tierra
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
    await this.tle.load();
    this.initThree();
    this.initializeLabelSystem();
    this.createEarth();
    this.createSatellites();
    this.createUE();
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

    // 🎯 NUEVO: Event listeners para selección de satélites
    this.setupSatelliteSelectionListeners();

    // Añadir helper de ejes
    const axesHelper = new THREE.AxesHelper(0.2);
    this.scene.add(axesHelper);
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
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



  //region Satellite Indicator & Selection [rgba(198, 255, 11, 0.23)]
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


  //region SGP4 Orbit Generation [rgba(78, 9, 241, 0.33)]
  /** Establece modo de órbita y regenera si hay satélite activo. */
  public setOrbitMode(mode: OrbitMode | 'inertial' | 'groundtrack') {
    const newMode = mode as OrbitMode;
    this.activeOrbitMode = newMode;
    if (this.selectedSatelliteIndex != null) {
      this.generateInstantOrbit(this.selectedSatelliteIndex, newMode);
    }
  }

  /** Información del estado de órbita activo. */
  public getActiveOrbitInfo(): { mode: OrbitMode | null; satIndex: number | null; pointCount: number } {
    return {
      mode: this.activeOrbitMode,
      satIndex: this.activeOrbitSatIndex,
      pointCount: (this.activeOrbitGroup && (this.activeOrbitGroup.children.find(c => (c as any).isLine) as any)?.geometry?.attributes?.position?.count) || 0
    };
  }

  /** Limpia órbita activa. */
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

  /** Genera órbita instantánea (una vez) para un satélite. */
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

  /** Regeneración ligera para groundtrack (cada ~2s). */
  private generateDynamicOrbit(satelliteIndex: number) {
    if (this.activeOrbitMode !== OrbitMode.GroundTrack) return;
    if (satelliteIndex !== this.activeOrbitSatIndex) return;
    if (this.frameId - this.lastGroundTrackGenFrame < 120) return;
    this.lastGroundTrackGenFrame = this.frameId;
    this.generateInstantOrbit(satelliteIndex, OrbitMode.GroundTrack);
  }

  /** Muestrea puntos orbitales propagando con SGP4 (satellite.js). */
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

  /** Dibuja línea orbital. */
  private drawOrbit(points: THREE.Vector3[], satelliteIndex: number, mode: OrbitMode) {
    if (this.selectedSatelliteIndex !== satelliteIndex) return;
    this.clearOrbitalTraces();
    if (!points.length) return;
  console.log(`[ORBIT-DRAW] mode=${mode} satelliteIndex=${satelliteIndex} points=${points.length}`);
    const group = new THREE.Group();
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const color = (mode === OrbitMode.Inertial) ? 0x00ff00 : 0x00ff00;
    const mat = new THREE.LineBasicMaterial({ color, linewidth: 1, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geom, mat); (line as any).isLine = true; group.add(line);
    const markerGeom = new THREE.SphereGeometry(0.0015, 10, 10);
    const markerMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const marker = new THREE.Mesh(markerGeom, markerMat);
    marker.position.copy(points[0]); group.add(marker);
    this.scene.add(group); this.activeOrbitGroup = group;
  }
  //endregion

  private createSelectedSatelliteIndicator(index: number) {
    if (!this.satsMesh) return;

    console.log(`[SELECTION-INDICATOR] 🟢 Creando indicador verde para satélite ${index}`);

    // Obtener posición del satélite seleccionado
    const tempMatrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    this.satsMesh.getMatrixAt(index, tempMatrix);
    position.setFromMatrixPosition(tempMatrix);

    // 🎯 SOLUCION Z-FIGHTING: Crear geometría ligeramente más grande y separada
    const geometry = new THREE.SphereGeometry(0.0008); // Más grande que el satélite original (0.0002)
    const material = new THREE.MeshBasicMaterial({
      color: 0x00ff00, // Verde brillante
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

    console.log(`[SATELLITE-LINE] 🌍 Creando línea del satélite ${index} hacia la Tierra`);

    // Obtener posición del satélite seleccionado
    const tempMatrix = new THREE.Matrix4();
    const satellitePosition = new THREE.Vector3();
    this.satsMesh.getMatrixAt(index, tempMatrix);
    satellitePosition.setFromMatrixPosition(tempMatrix);

    // Centro de la Tierra
    const earthCenter = new THREE.Vector3(0, 0, 0);

    // Calcular dirección del satélite hacia el centro de la Tierra
    const directionToEarth = earthCenter.clone().sub(satellitePosition).normalize();

    // Calcular punto en la superficie de la Tierra (radio = 0.1)
    const earthRadius = 0.1;
    const earthSurfacePoint = satellitePosition.clone().add(directionToEarth.multiplyScalar(satellitePosition.distanceTo(earthCenter) - earthRadius));

    // Crear geometría de línea
    const points = [
      satellitePosition.clone(),
      earthSurfacePoint.clone()
    ];

    const geometry = new THREE.BufferGeometry().setFromPoints(points);

    // Material de línea verde brillante
    const material = new THREE.LineBasicMaterial({
      color: 0x00ff00, // Verde brillante como el satélite
      linewidth: 2,
      transparent: true,
      opacity: 0.8
    });

    // Crear línea
    this.selectedSatelliteLine = new THREE.Line(geometry, material);
    this.selectedSatelliteLine.renderOrder = 2; // Renderizar después del satélite

    // Añadir a la escena
    this.scene.add(this.selectedSatelliteLine);

    console.log(`[SATELLITE-LINE] ✅ Línea creada desde satélite (${satellitePosition.x.toFixed(4)}, ${satellitePosition.y.toFixed(4)}, ${satellitePosition.z.toFixed(4)}) hacia superficie terrestre (${earthSurfacePoint.x.toFixed(4)}, ${earthSurfacePoint.y.toFixed(4)}, ${earthSurfacePoint.z.toFixed(4)})`);
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
    if (this.selectedSatelliteLine) {
      console.log(`[SATELLITE-LINE] 🗑️ Eliminando línea hacia la Tierra`);
      this.scene.remove(this.selectedSatelliteLine);

      // Limpiar geometría y material
      this.selectedSatelliteLine.geometry.dispose();
      if (this.selectedSatelliteLine.material instanceof THREE.Material) {
        this.selectedSatelliteLine.material.dispose();
      }
      this.selectedSatelliteLine = null;
    }
  }

  private updateSatelliteToEarthLine(satellitePosition: THREE.Vector3) {
    if (!this.selectedSatelliteLine) return;

    try {
      // Centro de la Tierra
      const earthCenter = new THREE.Vector3(0, 0, 0);

      // Calcular dirección del satélite hacia el centro de la Tierra
      const directionToEarth = earthCenter.clone().sub(satellitePosition).normalize();

      // Calcular punto en la superficie de la Tierra (radio = 0.1)
      const earthRadius = 0.1;
      const earthSurfacePoint = satellitePosition.clone().add(directionToEarth.multiplyScalar(satellitePosition.distanceTo(earthCenter) - earthRadius));

      // Actualizar puntos de la línea
      const points = [
        satellitePosition.clone(),
        earthSurfacePoint.clone()
      ];

      // Actualizar geometría
      this.selectedSatelliteLine.geometry.setFromPoints(points);
      this.selectedSatelliteLine.geometry.attributes['position'].needsUpdate = true;
    } catch (error) {
      console.warn(`[SATELLITE-LINE] Error actualizando línea: ${error}`);
    }
  }

  // 🎯 NUEVO: Actualizar posición del indicador del satélite seleccionado
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

    // 🎯 NUEVO: Actualizar posición del indicador del satélite seleccionado
    this.updateSelectedSatelliteIndicator();

    // 🎯 ELIMINADO: Ya no necesitamos restaurar colores porque usamos mesh separado
    // this.restoreColorsAfterMatrixUpdate();
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

    //console.log(`[LABEL-OFFSET] Sat ${index}: offset=${baseOffset.toFixed(6)}, zoom=${cameraDistance.toFixed(3)}`);

    return finalOffset;
  }
  //endregion


  //region Creation Elements & posicionamiento [rgba(96, 238, 210, 0.1)]
  private async createEarth() {
    const geo = new THREE.SphereGeometry(0.1, 64, 64); // 🎯 Resolución alta para suavidad
  const EARTH_BASE_LON_ROT_RAD = Math.PI; // 180° para alinear Greenwich con +X con textura estándar

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

    // 🎯 MATERIAL MEJORADO con configuración astronómica
    const mat = new THREE.MeshBasicMaterial({
      map: this.earthTexture,
      transparent: false,
      opacity: 1.0,
      side: THREE.FrontSide // Solo cara frontal para mejor rendimiento
    });

    this.earthMesh = new THREE.Mesh(geo, mat);

  // 🎯 Rotación base fija (ya no es necesario llamar setEarthGeometryLonRotation(180) manualmente)
  this.earthMesh.rotation.set(0, 0, 0); // eliminamos rotación base acumulativa

    this.scene.add(this.earthMesh);
    // Wireframe moderno
    const wireframe = new THREE.WireframeGeometry(geo);
    this.earthWireframe = new THREE.LineSegments(wireframe, new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 }));
  // Aplicar misma rotación al wireframe
  this.earthWireframe.rotation.set(0, 0, 0);
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
    this.earthGrid = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: 0xfffffff, opacity: 0.5, transparent: true }));
    // 🎯 PASO 2: Sin rotaciones forzadas - alineado con la Tierra
    this.earthGrid.rotation.x = 0;
    this.earthGrid.rotation.y = 0;
    this.earthGrid.rotation.z = 0;
    this.earthGrid.renderOrder = 2;
    this.scene.add(this.earthGrid);

  }

  //region Coordinate Pipeline (FINAL) [rgba(0,180,255,0.18)]
  /**
   * PIPELINE DEFINITIVO (Fase C):
   * 1. Worker -> ECI (km) + gmst.
   * 2. eciToEcfLocal: ECF = R3(-gmst) * ECI.
   * 3. Reorden a escena (Y-up Three.js):
   *      sceneX = ecf.x
   *      sceneY = ecf.z   (latitud / eje polar)
   *      sceneZ = ecf.y * LONGITUDE_SIGN (este/oeste)
   * 4. Escala: KM_TO_SCENE (radio terrestre = 0.1 unidades).
   * 5. Textura: repeat.x = -1 para corregir orientación visual; NO offsets ni rotaciones Y añadidas.
   * 6. Marcadores / usuario / cálculos inversos emplean la misma convención y LONGITUDE_SIGN.
   * Cambiar el sentido de las longitudes sólo requiere ajustar LONGITUDE_SIGN (1 o -1).
   */
  //endregion

  // Debug: obtiene lon/lat de un satélite seleccionado usando vector ECEF reconstruido desde escena
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
    const r = Math.sqrt(ecf.x*ecf.x + ecf.y*ecf.y + ecf.z*ecf.z);
    const lat = Math.asin(ecf.z / r);
    const lon = Math.atan2(ecf.y, ecf.x);
    console.log('[SAT GEO]', { index: this.selectedSatelliteIndex, lonDeg: THREE.MathUtils.radToDeg(lon).toFixed(3), latDeg: THREE.MathUtils.radToDeg(lat).toFixed(3), ecf });
  }

  // Nuevo: compara lon local reconstruida vs lon del worker (si el worker ya provee lon/lat)
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

  // Helper local mínimo para ECI->ECF (satellite.js ya está en el bundle principal vía dependencias)
  // Evita tocar el servicio. Sólo lo necesario (sin velocidad).
  private eciToEcfLocal(eci: { x: number, y: number, z: number }, gmst: number) {
  // ECF = R3(-gmst) * ECI  (rotación activa -gmst sobre Z)
  const cosG = Math.cos(gmst);
  const sinG = Math.sin(gmst);
  return { x:  eci.x * cosG + eci.y * sinG, y: -eci.x * sinG + eci.y * cosG, z: eci.z };
  }

  // Fase C: conversión ECI->ECF (si procede) y reorden a escena (X=ecf.x, Y=ecf.z, Z=ecf.y)
  private toSceneFromECI(eciKm: { x: number; y: number; z: number }, gmst: number): THREE.Vector3 {
    const ecf = (this.viewFrame === ViewFrame.EarthFixed) ? this.eciToEcfLocal(eciKm, gmst) : eciKm;
    return this.ecfToScene(ecf);
  }

  // ÚNICO punto donde se aplica LONGITUDE_SIGN al mapear ECF->Scene
  private ecfToScene(ecf: { x: number; y: number; z: number }): THREE.Vector3 {
    return new THREE.Vector3(
      ecf.x * this.KM_TO_SCENE,
      ecf.z * this.KM_TO_SCENE,
      ecf.y * this.LONGITUDE_SIGN * this.KM_TO_SCENE
    );
  }

  // Helper base único: devuelve coordenadas ECF (km) en convención Y-up estándar.
  private geoECEF_Yup(latDeg: number, lonDeg: number, altitudeKm = 0): { x: number; y: number; z: number } {
    const R = 6371; // km
    const lat = THREE.MathUtils.degToRad(latDeg);
    const lon = THREE.MathUtils.degToRad(lonDeg);
    const r = R + altitudeKm;
    const x = r * Math.cos(lat) * Math.cos(lon);
    const y = r * Math.sin(lat);       // eje polar
    const z = r * Math.cos(lat) * Math.sin(lon); // 90E -> +Z antes de LONGITUDE_SIGN (que se aplica solo en ecfToScene)
    return { x, y, z };
  }

  // (Mantener por compatibilidad interna) Devuelve posición en escena directamente usando el helper base.
  private geographicToCartesian(latDeg: number, lonDeg: number, altKm: number = 0): THREE.Vector3 {
    const ecf = this.geoECEF_Yup(latDeg, lonDeg, altKm);
    return this.ecfToScene(ecf);
  }

  // API pública para pruebas manuales
  public setViewFrame(frame: 'earthfixed' | 'inertial') {
    if (frame === 'earthfixed') this.viewFrame = ViewFrame.EarthFixed; else this.viewFrame = ViewFrame.Inertial;
    console.log(`[VIEW-FRAME] Cambiado a ${this.viewFrame}`);
  }

  public setDebugLogs(enabled: boolean) {
    this.debugLogs = enabled;
    console.log(`[DEBUG-LOGS] ${enabled ? 'Activados' : 'Desactivados'}`);
  }
  //endregion


  //region Debug Geo Markers [rgba(255,200,0,0.18)]
  
  public addGeoMarker(lonDeg: number, latDeg: number, color: number | string = 0x00ff00, size = 0.002, altitudeKm = 0): THREE.Mesh {
    const ecf = this.geoECEF_Yup(latDeg, lonDeg, altitudeKm); // km
    const scenePos = this.ecfToScene(ecf);
    const geom = new THREE.SphereGeometry(size, 16, 16);
    const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false });
    const marker = new THREE.Mesh(geom, mat);
    marker.position.copy(scenePos);
    marker.userData['__geoMarker'] = { lonDeg, latDeg };
    this.scene.add(marker);
    console.log(`[GEO-MARKER] lon=${lonDeg}° lat=${latDeg}° -> (${scenePos.x.toFixed(5)}, ${scenePos.y.toFixed(5)}, ${scenePos.z.toFixed(5)})`);
    return marker;
  }
  public addOrientationMarkers() {
    const created = [
      this.addGeoMarker(0, 0, 0x00ff00, 0.0025),   // Greenwich
      this.addGeoMarker(90, 0, 0xff0000, 0.0022),  // 90E
      this.addGeoMarker(-90, 0, 0x0000ff, 0.0022), // 90W
      this.addGeoMarker(180, 0, 0xff00ff, 0.0025), // 180
      this.addGeoMarker(0, 51.48, 0xffff00, 0.002) // Londres aproximado
    ];
    console.log('[GEO-MARKER] Marcadores de orientación creados', created);
    return created;
  }
  public addReferenceCityMarkers() {
    const cities = [
      { name: 'Greenwich', lon: 0, lat: 51.48, color: 0x00ff00 },
      { name: 'Lisboa', lon: -9.14, lat: 38.72, color: 0xffffff },
      { name: 'Madrid', lon: -3.70, lat: 40.42, color: 0xffaa00 },
      { name: 'Roma', lon: 12.50, lat: 41.90, color: 0x00aaff },
      { name: 'NuevaYork', lon: -74.01, lat: 40.71, color: 0xff0000 },
      { name: 'Tokio', lon: 139.69, lat: 35.69, color: 0xaa00ff }
    ];
    cities.forEach(c => {
      const m = this.addGeoMarker(c.lon, c.lat, c.color, 0.0022);
      (m.userData['label'] = c.name);
      console.log(`[CITY] ${c.name} lon=${c.lon} lat=${c.lat}`);
    });
    console.log('[CITY] Marcadores de ciudades añadidos.');
  }
  public resetCameraStandard() {
    this.camera.position.set(0.5, 0.0, 0.0); // sobre +X
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, 0);
    if ((this as any).controls) (this as any).controls.update();
    console.log('[CAMERA] Vista estándar aplicada (camera@+X, mirando al origen). Derecha pantalla = +Z (Este).');
  }
  public addLongitudeArc(lonDeg: number, color: number = 0x00ffff) {
    const lon = THREE.MathUtils.degToRad(lonDeg);
    const points: THREE.Vector3[] = [];
    const R = 0.1;
    for (let latDeg = -80; latDeg <= 80; latDeg += 5) {
      const lat = THREE.MathUtils.degToRad(latDeg);
      const x = R * Math.cos(lat) * Math.cos(lon);
      const y = R * Math.sin(lat);
      const z = R * Math.cos(lat) * Math.sin(lon);
      points.push(new THREE.Vector3(x, y, z));
    }
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color, linewidth: 1 });
    const line = new THREE.Line(geom, mat);
  (line.userData as any)['__lonArc'] = lonDeg;
    this.scene.add(line);
    console.log(`[LON-ARC] Longitud ${lonDeg}° añadida.`);
    return line;
  }
  public addEastTestArcs() {
    [0, 5, 10, 15, 20, 30].forEach((d,i) => this.addLongitudeArc(d, 0x00ffff + i * 1000));
    console.log('[LON-ARC] Arcos Este añadidos.');
  }
  public clearGeoMarkers() {
    const toRemove: THREE.Object3D[] = [];
  this.scene.traverse(o => { if (o.userData && o.userData['__geoMarker']) toRemove.push(o); });
    toRemove.forEach(o => {
      if ((o as any).geometry) (o as any).geometry.dispose();
      if ((o as any).material) {
        const mat = (o as any).material;
        if (Array.isArray(mat)) mat.forEach(m => m.dispose()); else mat.dispose();
      }
      this.scene.remove(o);
    });
    console.log(`[GEO-MARKER] Eliminados ${toRemove.length} marcadores`);
  }
  //endregion
  
  //region Create & update Elements [rgba(68, 255, 0, 0.18)]

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

    // 🎯 ELIMINADO: No llamar updateSatelliteColors() en cada frame
    // Solo se llama cuando hay cambios de selección

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

    // 🎯 ANTI-PARPADEO: Actualizar indicador de selección en cada frame para máxima suavidad
    this.updateSelectedSatelliteIndicator();

    // 🔄 Regeneración dinámica de groundtrack (cada ~2s) si procede
    if (this.activeOrbitMode === OrbitMode.GroundTrack && this.selectedSatelliteIndex != null) {
      this.generateDynamicOrbit(this.selectedSatelliteIndex);
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

    if (this.ueMesh) {
      this.ueMesh.position.copy(position);
      console.log(`[UE-POS] Usuario ubicado en: lat=${this.userLat}°, lon=${this.userLon}° -> (${position.x.toFixed(4)}, ${position.y.toFixed(4)}, ${position.z.toFixed(4)})`);
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
  // (Eliminada implementación duplicada de geographicToCartesian; usar la versión unificada más arriba)

  //endregion



  //region Geodesy [rgba(0, 17, 249, 0.28)]

  // Quick geodesy check helpers (Fase C)
  private quickCheckMarkers: THREE.Object3D[] = [];
  public quickCheckGeodesy() {
    this.clearQuickCheckMarkers();
    const tests = [
      { lat: 0, lon: 0, color: 0xffffff, label: 'EQ lon0' },
      { lat: 0, lon: 90, color: 0xff00ff, label: 'EQ lon90E' },
      { lat: 45, lon: 0, color: 0x00ffff, label: 'lat45 lon0' }
    ];
    tests.forEach(t => {
      const p = this.geographicToCartesian(t.lat, t.lon, 0);
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.002, 8, 8), new THREE.MeshBasicMaterial({ color: t.color }));
      m.position.copy(p);
      this.scene.add(m);
      this.quickCheckMarkers.push(m);
      console.log(`[CHECK] (${t.label}) = (${p.x.toFixed(4)}, ${p.y.toFixed(4)}, ${p.z.toFixed(4)})`);
    });
    console.log('[CHECK] Marcadores geodésicos creados. Usa clearQuickCheckMarkers().');
  }
  public clearQuickCheckMarkers() {
    this.quickCheckMarkers.forEach(o => {
      this.scene.remove(o);
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat: any = mesh.material;
      if (Array.isArray(mat)) {
        mat.forEach(m => m && m.dispose && m.dispose());
      } else if (mat && mat.dispose) {
        mat.dispose();
      }
    });
    this.quickCheckMarkers = [];
    console.log('[CHECK] Marcadores geodésicos eliminados.');
  }

  // TODO: revisar que Blue Marble NASA encaje con ECF estándar; ajustar map.offset.x si el meridiano de Greenwich no coincide visualmente.
  // TODO: cuando reintroduzcamos órbitas, usar sampleOrbitECI + toSceneFromECI con OrbitMode y ViewFrame.





  //  endregion

}
