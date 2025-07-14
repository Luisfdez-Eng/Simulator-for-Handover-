# 🚀 Guía Completa: Subir Proyecto a GitHub con SourceTree

## 📋 Prerrequisitos

### 1. Herramientas Necesarias
- ✅ **SourceTree**: https://www.sourcetreeapp.com/
- ✅ **Cuenta GitHub**: https://github.com/
- ✅ **Git instalado**: (SourceTree lo instala automáticamente)

## 🎯 Paso 1: Preparar el Proyecto Local

### 1.1 Crear archivo .gitignore
En la raíz de tu proyecto (`d:\Repos\Handover simulator 3\`), crea un archivo `.gitignore`:

```gitignore
# Dependencies
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Angular build outputs
/dist/
/tmp/
/out-tsc/
/bazel-out/

# IDEs and editors
/.idea/
.project
.classpath
.c9/
*.launch
.settings/
*.sublime-workspace
.vscode/
!.vscode/settings.json
!.vscode/tasks.json
!.vscode/launch.json
!.vscode/extensions.json

# System files
.DS_Store
Thumbs.db

# Angular cache
.angular/cache/

# Environment variables
.env
.env.local
.env.production

# Logs
logs/
*.log

# Runtime data
pids/
*.pid
*.seed
*.pid.lock

# Coverage directory used by tools like istanbul
coverage/
*.lcov

# Dependency directories
jspm_packages/

# Optional npm cache directory
.npm

# Optional eslint cache
.eslintcache

# Output of 'npm pack'
*.tgz

# Yarn Integrity file
.yarn-integrity

# Build files
build/
```

### 1.2 Crear README.md profesional
```markdown
# 🛰️ Simulador Avanzado de Handover de Starlink

Un simulador 3D en tiempo real de handovers de satélites Starlink usando Angular, Three.js y algoritmos ML.

## ✨ Características

- 🌍 Visualización 3D realista de la Tierra con texturas precisas
- 🛰️ Renderizado optimizado de ~6000 satélites Starlink
- 📡 Simulación de handovers con algoritmos ML
- ⏰ Sincronización con tiempo real astronómico
- 🎮 Controles de cámara adaptativos sin inercia
- 🏷️ Sistema inteligente de etiquetas dinámicas
- 🔧 Web Workers para cálculos orbitales SGP4

## 🚀 Tecnologías

- **Frontend**: Angular 16+ con TypeScript
- **3D Engine**: Three.js con WebGL
- **Cálculos Orbitales**: satellite.js (SGP4)
- **Performance**: Web Workers, InstancedMesh
- **UI**: CSS moderno con Google Fonts

## 📦 Instalación

```bash
git clone https://github.com/tu-usuario/handover-simulator-3.git
cd handover-simulator-3
npm install
ng serve
```

## 🛠️ Desarrollo

```bash
# Servidor de desarrollo
ng serve

# Build de producción
ng build --prod

# Tests
ng test
```

## 📝 Licencia

MIT License - ver archivo LICENSE para detalles.
```

## 🎯 Paso 2: Configurar SourceTree

### 2.1 Abrir SourceTree
1. Abrir SourceTree
2. Si es primera vez, configurar nombre y email:
   - `Tools` → `Options` → `General`
   - Nombre completo: `Tu Nombre`
   - Email: `tu.email@gmail.com`

### 2.2 Conectar con GitHub
1. En SourceTree: `Tools` → `Options` → `Authentication`
2. Click `Add`
3. Hosting Service: `GitHub`
4. Auth Type: `OAuth`
5. Click `Refresh OAuth Token`
6. Autorizar en el navegador

## 🎯 Paso 3: Inicializar Repositorio Local

### 3.1 Crear repositorio desde SourceTree
1. En SourceTree: `File` → `New` → `Create Local Repository`
2. Destination Path: `d:\Repos\Handover simulator 3`
3. Name: `handover-simulator-3`
4. Type: `Git`
5. Click `Create`

### 3.2 Hacer primer commit
1. SourceTree detectará automáticamente todos los archivos
2. En la pestaña `File Status`:
   - Seleccionar todos los archivos en `Unstaged files`
   - Click `Stage All`
3. En el campo de commit message escribir:
   ```
   🎉 Initial commit: Simulador Avanzado de Handover Starlink
   
   - Visualización 3D con Three.js
   - Sistema de etiquetas inteligente
   - Sincronización tiempo real
   - Algoritmos ML para handover
   - Web Workers para performance
   ```
4. Click `Commit`

## 🎯 Paso 4: Crear Repositorio en GitHub

### 4.1 Desde GitHub Web
1. Ir a https://github.com/
2. Click `New repository` (botón verde)
3. Repository name: `handover-simulator-3`
4. Description: `🛰️ Simulador 3D de Handovers Starlink con Angular y Three.js`
5. Visibility: `Public` (o Private si prefieres)
6. ❌ **NO** marcar "Add a README file" (ya lo tienes local)
7. ❌ **NO** marcar "Add .gitignore" (ya lo tienes local)
8. Click `Create repository`

### 4.2 Copiar URL del repositorio
GitHub te mostrará la URL, algo como:
```
https://github.com/tu-usuario/handover-simulator-3.git
```

## 🎯 Paso 5: Conectar Local con GitHub

### 5.1 Agregar remote en SourceTree
1. En SourceTree, click `Repository` → `Repository Settings`
2. Pestaña `Remotes`
3. Click `Add`
4. Remote name: `origin`
5. URL: `https://github.com/tu-usuario/handover-simulator-3.git`
6. Click `OK`

### 5.2 Push inicial
1. En SourceTree, click `Push` (botón con flecha hacia arriba)
2. Seleccionar `master` o `main` branch
3. Marcar `Push all tags`
4. Click `Push`

## 🎯 Paso 6: Verificación

### 6.1 Comprobar en GitHub
1. Refrescar tu repositorio en GitHub
2. Deberías ver todos tus archivos
3. El README.md se mostrará automáticamente

### 6.2 Clonar en otra ubicación (opcional)
Para verificar que todo funciona:
```bash
git clone https://github.com/tu-usuario/handover-simulator-3.git test-clone
cd test-clone
npm install
ng serve
```

## 🔄 Workflow Diario

### Hacer cambios y commit
1. Modificar archivos en tu proyecto
2. En SourceTree aparecerán en `Unstaged files`
3. Seleccionar archivos → `Stage Selected`
4. Escribir mensaje de commit descriptivo:
   ```
   ✨ Add: Sistema de validación geográfica
   
   - Puntos de referencia en ciudades principales
   - Conversión precisa lat/lon a cartesiano
   - Marcadores visuales para calibración
   ```
5. Click `Commit`

### Subir cambios a GitHub
1. Click `Push`
2. Seleccionar branch
3. Click `Push`

### Buenas prácticas de commits
```
🎉 Initial commit
✨ Add: Nueva funcionalidad
🐛 Fix: Corrección de bug
📝 Docs: Actualizar documentación
🎨 Style: Mejoras visuales
⚡ Perf: Optimización de performance
🔧 Config: Cambios de configuración
🚀 Deploy: Preparar para producción
```

## 🛡️ Consejos de Seguridad

### Archivos a NO subir (ya en .gitignore)
- ❌ `node_modules/`
- ❌ `.env` files con API keys
- ❌ Archivos de configuración local
- ❌ Builds temporales

### Información sensible
Si tienes API keys o configuraciones sensibles:
1. Crear archivo `.env` (ya en .gitignore)
2. Usar variables de entorno
3. Documentar en README qué variables son necesarias

## 🚨 Troubleshooting

### Error: "Repository not found"
- Verificar URL del repositorio
- Comprobar permisos en GitHub
- Re-autenticar SourceTree con GitHub

### Error: "Permission denied"
- Verificar autenticación OAuth
- Regenerar token en GitHub si es necesario

### Archivos muy grandes
- Usar Git LFS para archivos >100MB
- Optimizar assets (imágenes, etc.)

## 📚 Recursos Adicionales

- [Git Cheat Sheet](https://training.github.com/downloads/github-git-cheat-sheet/)
- [SourceTree Documentation](https://support.atlassian.com/sourcetree/)
- [GitHub Guides](https://guides.github.com/)
- [Conventional Commits](https://www.conventionalcommits.org/)
