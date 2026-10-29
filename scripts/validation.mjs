import { validateSnapshot } from '../public/road-model.mjs';
import { adaptPortalSnapshot } from '../public/portal-view.mjs';

export function validatePublication(snapshot, geometry, previous) {
  validateSnapshot(snapshot);
  if (snapshot.completo !== true || snapshot.partial === true || snapshot.total < 1)
    throw new Error('No se publica una extracción vacía o parcial.');
  if (previous && snapshot.total < Math.ceil(previous.total * 0.8))
    throw new Error('Reducción sospechosa del total; se conserva la última publicación válida.');
  const time = Date.parse(snapshot.consultado_en);
  if (!Number.isFinite(time) || time > Date.now() + 60_000 || Date.now() - time > 10 * 60_000)
    throw new Error('Fecha de extracción inválida o demasiado antigua para publicar.');
  const view = adaptPortalSnapshot(geometry);
  if (view.snapshot.total !== snapshot.total || geometry.consultado_en !== snapshot.consultado_en ||
      JSON.stringify(view.snapshot.vias) !== JSON.stringify(snapshot.vias))
    throw new Error('Los reportes y las geometrías corresponden a extracciones diferentes.');
  return view;
}
