# 🌍 Guía de Actualización de Texturas de la Tierra

## Opciones de Texturas Profesionales

### 1. NASA Blue Marble Next Generation
- **URL**: https://visibleearth.nasa.gov/collection/1484/blue-marble
- **Resolución**: 8K, 4K, 2K disponibles
- **Proyección**: Equirectangular (perfecta para esferas)
- **Características**: Sin nubes, colores naturales

### 2. Natural Earth Data
- **URL**: https://www.naturalearthdata.com/
- **Tipos**: Raster y vectorial
- **Resoluciones**: 10m, 50m, 110m
- **Ventaja**: Datos geográficos precisos

### 3. GEBCO Bathymetry (Relieve oceánico)
- **URL**: https://www.gebco.net/
- **Características**: Topografía y batimetría
- **Formato**: Datos de elevación reales

### 4. Sentinel-2 Cloudless
- **URL**: https://s2maps.eu/
- **Características**: Imágenes satelitales sin nubes
- **Actualización**: Datos recientes

## Implementación Recomendada

### Opción A: NASA Blue Marble (Recomendado)
```typescript
// En createEarth()
const loader = new THREE.TextureLoader();
this.earthTexture = await new Promise<THREE.Texture>((resolve) => {
  loader.load('assets/earth_8k.jpg', resolve); // Textura NASA 8K
});

// Configuración correcta para proyección equirectangular
this.earthTexture.wrapS = THREE.ClampToEdgeWrapping;
this.earthTexture.wrapT = THREE.ClampToEdgeWrapping;
this.earthTexture.minFilter = THREE.LinearFilter;
this.earthTexture.magFilter = THREE.LinearFilter;
```

### Opción B: Múltiples Texturas Combinadas
```typescript
// Textura base + normal map + specular map
const baseTexture = loader.load('assets/earth_day_8k.jpg');
const normalTexture = loader.load('assets/earth_normal_8k.jpg');
const specularTexture = loader.load('assets/earth_specular_8k.jpg');

const earthMaterial = new THREE.MeshPhongMaterial({
  map: baseTexture,
  normalMap: normalTexture,
  specularMap: specularTexture,
  shininess: 0.1
});
```

### Opción C: Shader Personalizado (Avanzado)
```glsl
// Fragment shader para Earth con atmósfera
varying vec3 vNormal;
varying vec2 vUv;

uniform sampler2D dayTexture;
uniform sampler2D nightTexture;
uniform vec3 sunDirection;

void main() {
  vec3 dayColor = texture2D(dayTexture, vUv).rgb;
  vec3 nightColor = texture2D(nightTexture, vUv).rgb;
  
  float cosineAngle = dot(normalize(vNormal), sunDirection);
  float mixAmount = smoothstep(-0.2, 0.2, cosineAngle);
  
  vec3 color = mix(nightColor, dayColor, mixAmount);
  gl_FragColor = vec4(color, 1.0);
}
```

## Corrección de Coordenadas

### Sistema de Coordenadas Astronómicas
```typescript
// Conversión correcta de coordenadas geográficas a cartesianas
private geographicToCartesian(lat: number, lon: number, alt: number = 0): THREE.Vector3 {
  const R = 6371; // Radio de la Tierra en km
  const radius = (R + alt) / R * 0.1; // Normalizado a escala del simulador
  
  const phi = THREE.MathUtils.degToRad(90 - lat); // Colatitud
  const theta = THREE.MathUtils.degToRad(lon + 180); // Longitud ajustada
  
  const x = radius * Math.sin(phi) * Math.cos(theta);
  const y = radius * Math.cos(phi);
  const z = radius * Math.sin(phi) * Math.sin(theta);
  
  return new THREE.Vector3(x, y, z);
}
```

## Calibración con Datos Reales

### Validación con Coordenadas Conocidas
```typescript
// Puntos de referencia para validación
const referencePoints = [
  { name: "Greenwich", lat: 51.4769, lon: 0.0005 },
  { name: "Polo Norte", lat: 90, lon: 0 },
  { name: "Polo Sur", lat: -90, lon: 0 },
  { name: "Línea Internacional de Fecha", lat: 0, lon: 180 },
  { name: "Antípoda Greenwich", lat: -51.4769, lon: 179.9995 }
];

// Verificar que estos puntos se muestren correctamente
```

## Enlaces de Descarga

### NASA Blue Marble (Recomendado)
- **4K**: https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200407.3x5400x2700.jpg
- **8K**: https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73938/world.topo.bathy.200407.3x10800x5400.jpg

### Natural Earth
- **Raster 10m**: https://www.naturalearthdata.com/http//www.naturalearthdata.com/download/10m/raster/NE1_HR_LC_SR_W.zip

### GEBCO Grid
- **2023 Grid**: https://download.gebco.net/
