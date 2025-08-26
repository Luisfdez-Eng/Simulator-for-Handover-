# 🛰️ Advanced Starlink Handover Simulator

Real‑time 3D simulator of Starlink constellation handovers built with Angular, Three.js and ML‑assisted selection logic.

![Starlink Simulator](https://img.shields.io/badge/Starlink-Simulator-blue?style=for-the-badge&logo=satellite)
![Angular](https://img.shields.io/badge/Angular-16+-red?style=for-the-badge&logo=angular)
![Three.js](https://img.shields.io/badge/Three.js-3D-green?style=for-the-badge&logo=three.js)

## ✨ Key Features
<img width="1905" height="1061" alt="image" src="https://github.com/user-attachments/assets/6915a77c-94af-49e4-ad1f-07a79f01e41d" />

### 🌍 Realistic 3D Earth
- High‑res textured sphere (64×64 segments)
- Accurate astronomical / geographic transform chain
- Real‑time rotation driven by GMST (sidereal time)
- Latitude/longitude reference grid & wireframe overlay

### 🛰️ Massive Satellite Simulation
- Efficient rendering of ~6,000 Starlink satellites
- Live TLE (Two‑Line Element) orbital data (CelesTrak)
- SGP4 propagation offloaded to Web Workers
- Distance‑aware dynamic scaling (0.1×–3×)

### 🏷️ Smart Label System
- Overlap‑avoidance with adaptive offset placement
- Progressive cap by zoom level (50/75/100/150 labels)
- Hybrid placement: 70% radial + 30% camera bias for readability
- Clear visual identification without UI clutter

### 📡 ML‑Assisted Handover Engine
- Multi‑factor scoring: RSSI proxy, elevation, range, availability
- Configurable hysteresis & cooldown to reduce churn
- Real‑time highlight of current serving satellite

### 🎮 Advanced Controls
- Zero‑inertia orbital camera for precision
- Zoom‑adaptive sensitivity
- Automatic detailed view threshold
- Intuitive mouse navigation & scroll zoom

### ⏰ Dual Time Modes
- Real Time: synchronized with current epoch
- Simulation: accelerated timeline for analysis
- Seamless live switching between modes
- Astronomically correct Earth rotation

### 🗺️ Global Geolocation Module (New)
- Expanded world city dataset (hundreds of major cities)
- Fast client‑side fuzzy search with incremental filtering
- Floating dropdown overlay (no layout shift) with auto up/down placement
- Outside click + ESC dismissal for city & satellite lists
- Accurate UE coordinate placement after geodetic basis fix

### 🧠 Adaptive Propagation Lead (New)
- Worker tracks round‑trip latency & applies predictive time lead
- Smooths jitter using EMA -> improved visual temporal coherence

### 🧩 Modular UI Architecture (New)
- Top banner + right vertical dock + independent flyout panels
- Detachable logic for Geo, Link, Metrics, Config (extensible stubs)
- Overlay dropdowns rendered at document root to avoid nested scrollbars

### ⚡ Performance Optimisation
- Web Workers for heavy orbital math
- InstancedMesh for batched GPU draws
- Frustum culling & chunked updates
- Dynamic label & mesh scaling

## 🚀 Tech Stack
- Frontend: Angular 16+ (strict TypeScript)
- 3D Engine: Three.js (WebGL, InstancedMesh)
- Orbit Propagation: satellite.js (SGP4)
- Concurrency: Web Workers
- Fonts: Orbitron, Exo 2, Rajdhani
- Tooling: Angular CLI
- Version Control: Git / SourceTree

## 📦 Installation

### Prerequisites
- Node.js 16+
- Angular CLI 16+
- Git

### Steps
```bash
git clone https://github.com/your-user/handover-simulator-3.git
cd handover-simulator-3
npm install
ng serve
# Open http://localhost:4200
```

### Production Build
```bash
ng build --configuration production
# Output in /dist/
```

## 🎛️ User Controls
### 3D Navigation
- Mouse drag: orbit camera
- Scroll: zoom (auto enters detailed mode)
- Detailed mode triggers enhanced labeling

### Time Modes
- Real Time: live ephemeris alignment
- Simulation: accelerated for experiments

### Geo / Handover Config
- Latitude / Longitude (user equipment position)
- ML parameters: hysteresis & cooldown
- Label & rendering toggles

## 🔧 Project Architecture
```
src/
├── app/
│   ├── components/
│   │   └── starlink-visualizer/
│   │       ├── starlink-visualizer.component.ts      # Core logic & UI state
│   │       ├── starlink-visualizer.component.html    # Template (modular dock + flyouts)
│   │       ├── starlink-visualizer.component.css     # Styles (glass, overlays)
│   │       └── orbit-controls.ts                     # Camera controls
│   ├── services/
│   │   ├── tle-loader.service.ts                     # TLE loading & caching
│   │   ├── ml-handover.service.ts                    # ML handover scoring
│   │   └── city-loader.service.ts (future)           # Large city dataset loader
│   └── workers/
│       └── orbital.worker.ts                         # SGP4 propagation + latency lead
├── assets/
│   ├── earth_continents_bw.png                       # Earth texture
│   ├── gp.txt                                        # Starlink TLE source
│   ├── cities.json                                   # Expanded city list
│   └── orbital.worker.js                             # Built worker bundle
└── styles.css                                        # Global futuristic styling
```

## 🛰️ Satellite Data
- Source: CelesTrak / Space-Track.org
- Format: Standard TLE
- Volume: ~6k active Starlink spacecraft
- Accuracy: SGP4 physical propagation

## 🤖 ML / Decision Logic
### Handover Factors
```text
Distance (km)
Elevation angle (°)
Simulated SNR (dB)
Handover history & cooldown window
Link quality composite score
Predicted visibility duration
```
### Quality Metrics
- RSSI proxy: -120 to -60 dBm
- Elevation: 0–90°
- Distance: ~400–2000 km window
- Availability: estimated line‑of‑sight time

## 📊 Performance
### Implemented Optimisations
- InstancedMesh batched rendering
- Web Worker SGP4 computation
- Frustum culling (view cone filtering)
- Dynamic scaling by zoom level
- Label cap & adaptive density
- Chunked update scheduling
### Indicative Benchmarks (modern hardware)
- 60 FPS steady
- ~150 MB memory footprint
- <3 s cold start to first frame

## 🔬 Astronomical Accuracy
### Coordinate System
- Reference: J2000 frame
- Earth rotation: GMST derivation per frame
- Geodetic (lat/lon) ↔ ECEF ↔ Scene mapping (corrected basis)
- Polar handling & normalization
### Validation Waypoints
- Greenwich (0°, 51.48°)
- Madrid (-3.70°, 40.42°)
- Sydney (151.21°, -33.87°)
- Poles ±90° latitude
### Time Handling
- Real time via system clock
- Simulation via controlled increments
- Millisecond precision for propagation

## 🎨 User Interface
### Futuristic Styling
- Cyan / neon green palette (#00ffff / #00ff00 accents)
- Sci‑fi typography set
- Soft glass / translucency panels
- Real‑time feedback indicators
- Smooth transitions for state changes
### Responsive
- Scales to varied resolutions & 4K
- Mobile / touch friendly interaction (in progress)
- Layout decoupled via floating overlays

## 🧩 Modular Dock & Flyouts (Details)
- Vertical dock buttons spawn independent flyout panels
- Floating city & satellite dropdowns positioned at viewport level
- Outside click + ESC uniformly closes open lists (accessibility)
- Automatic reposition if near viewport edge (opens upward when needed)

## 🛠️ Development
### NPM Scripts
```bash
ng serve          # Dev server
ng build          # Production build
ng test           # Unit tests
ng lint           # Linting
ng e2e            # End-to-end tests
```
### Commit Convention
```
🎉 Initial commit
✨ Add: Feature
🐛 Fix: Bug fix
📝 Docs: Documentation
🎨 Style: UI / styling
⚡ Perf: Performance
🔧 Config: Configuration
🚀 Deploy: Deployment
```

## 📝 Roadmap
### Current Release (v1.1)
- ✅ 3D visualization of 6k+ satellites
- ✅ Real TLE ingestion & SGP4 propagation
- ✅ ML handover scoring engine
- ✅ Dual time modes (real/sim)
- ✅ Smart label capping & overlap avoidance
- ✅ Modular dock + flyout UI overhaul
- ✅ Expanded global city geolocation search
- ✅ Floating dropdowns with outside click / ESC dismissal
- ✅ Adaptive worker latency lead smoothing

### Upcoming
- 🔄 Advanced configuration panel
- 🔄 Real‑time performance metrics overlay
- 🔄 Simulation data export (JSON/CSV)
- 🔄 VR / AR exploratory mode
- 🔄 REST API for remote control
- 🔄 Predictive handover analytics
- 🔄 Weather data integration
- 🔄 Persistent user preferences (local storage)

## 🤝 Contributing
1. Fork repository
2. Create feature branch (`git checkout -b feature/awesome`)
3. Commit (`git commit -m '✨ Add: Awesome'`)
4. Push (`git push origin feature/awesome`)
5. Open Pull Request
### Guidelines
- Keep 60 FPS performance target
- Document complex math / transforms
- Add unit tests for new logic
- Follow strict TypeScript practices

## 📄 License
MIT License – see [LICENSE](LICENSE) for details.

## 👨‍💻 Author
**Simulator Developer**
- GitHub: [@your-user](https://github.com/your-user)
- LinkedIn: [Your Profile](https://linkedin.com/in/your-profile)

## 🙏 Acknowledgements
- CelesTrak: Updated TLE data
- Three.js Community: 3D docs & examples
- satellite.js: Accurate SGP4 implementation
- Angular Team: Robust framework
- NASA: Public domain Earth textures

---

⭐ If you find this project useful, please give it a star! ⭐

## 🔗 Useful Links
- [Three.js Docs](https://threejs.org/docs/)
- [satellite.js GitHub](https://github.com/shashwatak/satellite-js)
- [CelesTrak TLE Data](https://celestrak.com/)

- [Angular Documentation](https://angular.io/docs)
