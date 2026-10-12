import { client } from '@/lib/client';
import { t } from '@/lib/langue';

/**
 * RÉCUPÉRER LES NOUVEAUTÉS DU DÉPÔT PUBLIC, et dire ce qui en est sorti.
 *
 * Le démon tranche selon ce qu'est devenue l'installation
 * (`server/src/installation-copie.ts`) : sur une copie personnelle, une tâche
 * est posée dans le projet de l'application — l'écran le dit, et la tâche
 * attend d'être lancée ; sinon le code avance et se reconstruit, et c'est la
 * page « Installation » des réglages qui montre le travail.
 *
 * Ce geste vit ici, hors des écrans : le bandeau du haut et le bouton des
 * réglages font exactement la même chose.
 */
export async function recupererLesNouveautes(): Promise<'carte' | 'simple' | null> {
  const echec = t('Les nouveautés n’ont pas pu être récupérées.');
  try {
    const rendu = await client.call<{ ok: boolean; erreur?: string; mode?: 'carte' | 'simple'; cardId?: string }>(
      { type: 'installation.nouveautes.appliquer' },
      60_000,
    );
    if (!rendu.ok) {
      client.pushToast('error', rendu.erreur ?? echec);
      return null;
    }
    if (rendu.mode === 'carte') {
      client.pushToast(
        'success',
        t('Une tâche « Récupérer les nouveautés » vous attend dans le projet Beluga Build : lancez-la quand vous voulez.'),
        rendu.cardId,
      );
    }
    return rendu.mode ?? null;
  } catch (err: any) {
    client.pushToast('error', err?.message ?? echec);
    return null;
  }
}
