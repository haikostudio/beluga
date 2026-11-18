/**
 * LES NIVEAUX D'UN MICRO, pour les ondes — la conversation en direct (`direct-codex.ts`) et la voix jouée
 * (`voix.ts`). L'ancienne découpe en tranches envoyées à `/api/transcribe` a disparu avec l'écoute permanente
 * (carte « Veille privée et réveil », 16/11/2026) : le mot de réveil est reconnu sur l'appareil.
 */

/**
 * Les niveaux entendus À UN ANALYSEUR à l'instant, un par barre demandée (0 à
 * 1). `null` quand aucun micro n'est ouvert — la ligne d'ondes retombe alors sur
 * son animation régulière.
 */
export function lireNiveaux(
  analyseur: AnalyserNode | null,
  donnees: Uint8Array | null,
  nombre: number,
): number[] | null {
  if (!analyseur || !donnees) return null;
  analyseur.getByteFrequencyData(donnees);
  const bins = donnees.length;
  const utile = Math.max(nombre, Math.floor(bins * 0.7));
  const niveaux: number[] = [];
  for (let i = 0; i < nombre; i += 1) {
    const debut = Math.floor((i * utile) / nombre);
    const fin = Math.max(debut + 1, Math.floor(((i + 1) * utile) / nombre));
    let somme = 0;
    for (let j = debut; j < fin; j += 1) somme += donnees[j];
    niveaux.push(Math.min(1, somme / (fin - debut) / 255));
  }
  return niveaux;
}
