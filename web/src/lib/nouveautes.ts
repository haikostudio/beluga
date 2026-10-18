import { client } from '@/lib/client';
import { t } from '@/lib/langue';

/**
 * RÉCUPÉRER LES NOUVEAUTÉS DU DÉPÔT PUBLIC, et dire ce qui en est sorti.
 *
 * Le démon tranche selon ce qu'est devenue l'installation
 * (`server/src/installation-copie.ts`) : sur une copie personnelle, une tâche
 * est posée dans le projet de l'application ET lancée tout de suite : un agent
 * lit le journal des changements du dépôt public et met les nouveautés en place ; sinon le code avance et se reconstruit, et c'est la
 * page « Installation » des réglages qui montre le travail.
 *
 * Ce geste vit ici, hors des écrans : le bandeau du haut et le bouton des
 * réglages font exactement la même chose.
 */
export async function recupererLesNouveautes(): Promise<'carte' | 'simple' | null> {
  const echec = t('Les nouveautés n’ont pas pu être récupérées.');
  try {
    const rendu = await client.call<{
      ok: boolean;
      erreur?: string;
      mode?: 'carte' | 'simple';
      cardId?: string;
      lance?: boolean;
      erreurLancement?: string;
    }>(
      // « Mettre à jour » est le geste de l'utilisateur : l'agent part tout de suite.
      { type: 'installation.nouveautes.appliquer', lancer: true },
      60_000,
    );
    if (!rendu.ok) {
      client.pushToast('error', rendu.erreur ?? echec);
      return null;
    }
    if (rendu.mode === 'carte') {
      if (rendu.lance) {
        client.pushToast(
          'success',
          t('La mise à jour est lancée : un agent lit le journal des changements et met les nouveautés en place. Suivez la tâche dans le projet Beluga Build.'),
          rendu.cardId,
        );
      } else if (rendu.erreurLancement) {
        client.pushToast(
          'warning',
          t('La tâche de mise à jour est prête dans le projet Beluga Build, mais elle n’a pas pu partir : {raison}', { raison: rendu.erreurLancement }),
          rendu.cardId,
        );
      } else {
        client.pushToast(
          'success',
          t('Une tâche « Récupérer les nouveautés » vous attend dans le projet Beluga Build : lancez-la quand vous voulez.'),
          rendu.cardId,
        );
      }
    }
    return rendu.mode ?? null;
  } catch (err: any) {
    client.pushToast('error', err?.message ?? echec);
    return null;
  }
}
