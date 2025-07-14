# Script para eliminar archivos de caché de Angular del repositorio Git
# Ejecutar desde la carpeta del proyecto

Write-Host "🔧 Eliminando archivos de caché de Angular del repositorio..." -ForegroundColor Yellow

# Cambiar al directorio del proyecto
Set-Location "d:\Repos\Handover simulator"

# Verificar si Git está disponible
try {
    git --version
    Write-Host "✅ Git encontrado" -ForegroundColor Green
} catch {
    Write-Host "❌ Git no encontrado. Por favor usa SourceTree → Repository → Open in Terminal" -ForegroundColor Red
    exit 1
}

# Eliminar archivos de caché del índice (no del disco)
Write-Host "📝 Eliminando .angular/cache/ del índice de Git..." -ForegroundColor Cyan
git rm -r --cached .angular/cache/ 2>$null

# Añadir .gitignore actualizado
Write-Host "📝 Añadiendo .gitignore actualizado..." -ForegroundColor Cyan
git add .gitignore

# Hacer commit
Write-Host "💾 Haciendo commit..." -ForegroundColor Cyan
git commit -m "🗑️ Remove Angular cache files from repository - Removed large cache files that exceed GitHub limits - .gitignore already configured to prevent future tracking"

Write-Host "✅ ¡Completado! Ahora puedes hacer Push desde SourceTree" -ForegroundColor Green
Write-Host "📤 Ve a SourceTree y haz clic en 'Push'" -ForegroundColor Yellow

Read-Host "Presiona Enter para cerrar"
