# Gestión de Constelaciones

Añadir nuevas constelaciones sin tocar código.

## Archivo de manifiesto
`src/assets/constellations.json`

Formato:
```json
{
  "constellations": [
    { "name": "starlink", "file": "gp_starlink.txt", "label": "Starlink" },
    { "name": "oneweb",  "file": "gp_oneweb.txt",  "label": "OneWeb" }
  ]
}
```
- `name`: identificador interno (lowercase, sin espacios)
- `file`: nombre del fichero TLE dentro de `src/assets/`
- `label`: texto a mostrar en la UI (opcional; cae a `name` si falta)

## Pasos para añadir una nueva constelación
1. Copia un fichero TLE a `src/assets/` con nombre `gp_<constelacion>.txt` (ej: `gp_oneweb.txt`).
2. Asegúrate que cada satélite tiene 3 líneas: `NAME` + `LINE1` + `LINE2`.
3. Edita `constellations.json` y añade la entrada:
```json
{ "name": "oneweb", "file": "gp_oneweb.txt", "label": "OneWeb" }
```
4. Guardar y recargar la aplicación. La nueva constelación aparecerá en el selector automáticamente.

## Fallbacks
Si el fichero indicado falla, el sistema intenta también:
1. `assets/gp_<name>.txt` (heurística)
2. `assets/gp.txt` (legacy)

## Búsqueda
El buscador indexa (case-insensitive):
- Nombre (line0)
- NORAD ID extraído de la línea 1 (columnas 3–7)

Límite de 50 resultados para evitar saturar la lista.

## Nota sobre tamaño
Para conjuntos muy grandes considera dividir por familias orbitales para acelerar carga inicial.

---
© Proyecto Handover Simulator
