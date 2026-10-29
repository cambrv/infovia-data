# InfoVia EC · Datos públicos

Extractor y publicación de los reportes públicos de [Portal Ecuador](https://portalecuador.com/estado-vias), que declara información de ECU 911. InfoVia EC es un proyecto independiente. No se consulta directamente el sitio de ECU 911.

El workflow se ejecuta aproximadamente cada 15 minutos (minutos 07, 22, 37 y 52). GitHub Actions puede retrasar ejecuciones. Si falla la extracción o su validación, permanece disponible la última publicación válida; consulta siempre `extractedAt`.

## Archivos públicos

- [Reportes](https://raw.githubusercontent.com/cambrv/infovia-data/main/data/portal-ecuador.json)
- [Reportes y geometrías](https://raw.githubusercontent.com/cambrv/infovia-data/main/data/portal-geometria.json)
- [Fecha y resumen de publicación](https://raw.githubusercontent.com/cambrv/infovia-data/main/data/manifest.json)

El navegador consulta estos archivos directamente, sin ejecutar funciones en Vercel ni depender de Render. El CDN puede tardar unos minutos en mostrar un commit nuevo.

## Catálogo geográfico

La primera ejecución recupera los mismos cinco archivos geográficos públicos del mapa, verifica sus hashes Git fijados en `catalog-sources.json` y crea `catalog/catalog.json.gz`. Las siguientes ejecuciones usan ese catálogo local comprimido y no vuelven a descargar esos archivos de Vercel. Las coordenadas, la procedencia y las clasificaciones geográficas se conservan.

El catálogo conserva la atribución y licencia declarada por cada fuente, incluida © OpenStreetMap contributors (ODbL). Las referencias geográficas no delimitan los kilómetros afectados ni confirman la circulación.

Para actualizar la cartografía, revisar primero los archivos y sus hashes fijados, retirar el catálogo comprimido y ejecutar el workflow. No se aceptan cambios de coordenadas silenciosos.

## Desarrollo

Node.js 22: `npm ci`, `npm test`, `npm run sync`. La publicación en GitHub solo ocurre desde el workflow después de validar por completo reportes y geometrías. No requiere tokens adicionales ni acceso al repositorio privado del sitio.
