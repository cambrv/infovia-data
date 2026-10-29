import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePublication } from '../scripts/validation.mjs';

function publication() {
  const report = { provincia: 'EL ORO', via: 'Ruta de prueba', estado: 'CERRADA', observaciones: 'Observación íntegra' };
  const snapshot = { proveedor: 'Portal Ecuador', fuente: 'https://portalecuador.com/estado-vias',
    experimental: true, completo: true, consultado_en: new Date().toISOString(), total: 1, vias: [report] };
  const geometry = { ...snapshot, totalReportes: 1, matched: 0, ambiguous: 0, unmatched: 1, features: [],
    resultados: [{ reportId: 'test:1', report, matchStatus: 'unmatched', geometryId: null }] };
  return { snapshot, geometry };
}

test('publica un reporte completo aunque aún no tenga geometría verificada', () => {
  const { snapshot, geometry } = publication();
  const view = validatePublication(snapshot, geometry);
  assert.deepEqual(view.snapshot.vias, snapshot.vias);
  assert.equal(view.links.get('test:1').geometry, null);
});

test('rechaza una reducción brusca, una extracción parcial y fechas antiguas', () => {
  const { snapshot, geometry } = publication();
  assert.throws(() => validatePublication(snapshot, geometry, { total: 10 }), /Reducción/);
  assert.throws(() => validatePublication({ ...snapshot, partial: true }, geometry));
  assert.throws(() => validatePublication({ ...snapshot, consultado_en: '2020-01-01T00:00:00Z' }, geometry), /antigua/);
});

test('no mezcla reportes ni fechas procedentes de diferentes extracciones', () => {
  const { snapshot, geometry } = publication();
  const modified = structuredClone(geometry);
  modified.resultados[0].report.observaciones = 'Otra extracción';
  assert.throws(() => validatePublication(snapshot, modified), /diferentes/);
  assert.throws(() => validatePublication(snapshot, { ...geometry, consultado_en: '2020-01-01T00:00:00Z' }), /diferentes/);
});

test('no permite publicar asociaciones confirmadas sin coordenadas verificadas', () => {
  const { snapshot, geometry } = publication();
  geometry.matched = 1;
  geometry.unmatched = 0;
  geometry.resultados[0].matchStatus = 'matched';
  geometry.resultados[0].geometryId = 'inventada';
  assert.throws(() => validatePublication(snapshot, geometry), /geometría/);
});
