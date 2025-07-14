# 🌟 Guía SourceTree - Simulador Handover Starlink

## 🚀 **PASO 1: Abrir SourceTree**

1. **Inicia SourceTree** desde el escritorio o menú inicio
2. Si es la primera vez, acepta los términos y configura tu cuenta

## 📁 **PASO 2: Crear Repositorio Local**

### Opción A: Usando "Create Local Repository"
1. En SourceTree, haz clic en **"+ Create"** → **"Create Local Repository"**
2. **Destination Path**: `D:\Repos\Handover simulator 3`
3. **Name**: `handover-simulator-3`
4. **Type**: Git
5. Haz clic en **"Create"**

### Opción B: Usar "Add Existing Local Repository"
1. En SourceTree, haz clic en **"+ Add"** → **"Add Existing Local Repository"**
2. Buscar la carpeta: `D:\Repos\Handover simulator 3`
3. Haz clic en **"Add"**

## 📝 **PASO 3: Hacer el Commit Inicial**

1. **Verifica que SourceTree detectó todos los archivos**:
   - ✅ README.md (actualizado)
   - ✅ .gitignore (configurado)
   - ✅ package.json
   - ✅ angular.json
   - ✅ tsconfig.json
   - ✅ src/ (todos los archivos del simulador)
   - ✅ Documentación adicional

2. **En la pestaña "File Status"**:
   - Deberías ver todos los archivos como "Unstaged files"
   - **NO** deberías ver:
     - `node_modules/` (excluido por .gitignore)
     - `.angular/` (excluido por .gitignore)
     - Archivos de build

3. **Seleccionar archivos para el commit**:
   - Haz clic en **"Stage All"** para agregar todos los archivos
   - O selecciona archivos individualmente y usa **"Stage Selected"**

4. **Escribir mensaje de commit**:
   ```
   🎉 Initial commit: Advanced Starlink Handover Simulator

   ✨ Features implemented:
   - 3D visualization with 6000+ satellites
   - Real-time orbital propagation (SGP4)
   - Smart label system with anti-overlap
   - ML-based handover decisions
   - Dual time modes (real-time vs simulation)
   - Geographic precision with coordinate conversion
   - Performance optimizations (Web Workers, InstancedMesh)
   
   🚀 Tech Stack: Angular 16+, Three.js, TypeScript
   📡 Data: Real TLE data from CelesTrak
   ⚡ Performance: 60 FPS with 6000+ rendered objects
   ```

5. **Hacer el commit**:
   - Haz clic en **"Commit"**

## 🌐 **PASO 4: Crear Repositorio en GitHub**

1. **Abre GitHub.com** en tu navegador
2. **Inicia sesión** en tu cuenta
3. Haz clic en **"+"** → **"New repository"**
4. **Configuración del repositorio**:
   - **Repository name**: `handover-simulator-3`
   - **Description**: `🛰️ Advanced Starlink Handover Simulator - 3D real-time visualization with ML-based decisions`
   - **Visibility**: Public (recomendado para portfolio)
   - **NO marques** "Add a README file" (ya lo tenemos)
   - **NO marques** "Add .gitignore" (ya lo tenemos)
   - **NO marques** "Choose a license" (puedes añadirlo después)
5. Haz clic en **"Create repository"**

## 🔗 **PASO 5: Conectar SourceTree con GitHub**

1. **En GitHub, copia la URL del repositorio**:
   - Debería ser algo como: `https://github.com/TU-USUARIO/handover-simulator-3.git`

2. **En SourceTree**:
   - Ve a **Repository** → **Repository Settings**
   - En la pestaña **"Remotes"**
   - Haz clic en **"Add"**
   - **Remote name**: `origin`
   - **URL/Path**: Pega la URL de GitHub
   - Haz clic en **"OK"**

## 📤 **PASO 6: Push al Repositorio Remoto**

1. **En SourceTree**:
   - Haz clic en **"Push"** en la barra de herramientas
   - Asegúrate de que esté seleccionado **"origin"**
   - Marca la casilla **"master"** (o **"main"**)
   - Haz clic en **"Push"**

2. **Autenticación**:
   - GitHub te pedirá autenticación
   - Usa tu **Personal Access Token** (recomendado)
   - O autoriza SourceTree para acceder a tu cuenta

## ✅ **PASO 7: Verificar en GitHub**

1. **Actualiza la página de tu repositorio en GitHub**
2. **Deberías ver**:
   - ✅ README.md con la documentación completa
   - ✅ Estructura del proyecto Angular
   - ✅ Badge de tecnologías y características
   - ✅ Documentación técnica detallada

## 🎯 **CONSEJOS PARA DESARROLLO FUTURO**

### Workflow Diario:
1. **Antes de trabajar**: `Pull` en SourceTree
2. **Después de cambios**: 
   - Stage files → Commit con mensaje descriptivo → Push
3. **Mensajes de commit**:
   ```
   ✨ Add: Nueva funcionalidad
   🐛 Fix: Corrección de bug
   📝 Docs: Actualización documentación
   ⚡ Perf: Optimización performance
   🎨 Style: Mejoras UI/UX
   🔧 Config: Cambios configuración
   ```

### Branches Recomendadas:
- **main/master**: Código estable
- **develop**: Desarrollo activo
- **feature/nombre**: Nuevas funcionalidades
- **hotfix/nombre**: Correcciones urgentes

## 🚨 **TROUBLESHOOTING**

### ❌ **Error: Large files detected (archivos de caché Angular)**
Si al hacer push obtienes errores como:
```
remote: error: File .angular/cache/... is XXX MB; this exceeds GitHub's file size limit
remote: error: GH001: Large files detected
```

**SOLUCIÓN**:
1. **En SourceTree** → **Repository** → **Open in Terminal**
2. **Ejecuta estos comandos**:
   ```bash
   git rm -r --cached .angular/cache/
   git add .gitignore
   git commit -m "🗑️ Remove Angular cache files from repository"
   ```
3. **Vuelve a SourceTree y haz Push**

**Alternativa con script**: Ejecuta `fix_git_cache.ps1` desde PowerShell

### Si no aparecen todos los archivos:
- Verifica que `.gitignore` esté configurado correctamente
- Refresca SourceTree (F5)

### Si el push falla:
- Verifica tu conexión a internet
- Confirma las credenciales de GitHub
- Intenta con Personal Access Token

### Si hay conflictos:
- Es normal en colaboración
- SourceTree tiene herramientas de merge visual

## 🎉 **¡COMPLETADO!**

Tu simulador avanzado de Starlink ahora está en GitHub con:
- ✅ Control de versiones completo
- ✅ Documentación profesional
- ✅ Configuración optimizada
- ✅ Listo para colaboración

**URL de tu repositorio**: `https://github.com/TU-USUARIO/handover-simulator-3`

---

🌟 **¡Felicitaciones! Tu proyecto está ahora profesionalmente versionado y documentado.**
