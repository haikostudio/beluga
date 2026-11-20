/*
 * LES TÂCHES DU PROJET, SUR TÉLÉPHONE, DANS LA FEUILLE QUI MONTE DU BAS (décision du 13/11/2026 : « le bouton en haut
 * à gauche pour les tâches doit ouvrir la liste dans un tiroir plutôt que changer de page »). Le bouton « Tâches » du
 * haut (le nom du projet, `BoutonDuNomQuiOuvreLesTaches`) l'ouvre ; la même feuille que Publier ou Fichiers, à hauteur fixe. Toucher une tâche
 * l'ouvre et referme la feuille. La liste n'est montée que feuille ouverte. Repère `data-feuille-des-taches`.
 *
 * « NOUVEL ARTEFACT » EN PIED (carte « Icônes, contrastes et artefacts », 15/11/2026, capture #32d4) : un bouton
 * pleine largeur collé en bas, HORS de la zone qui défile, crée une carte dans le projet DE LA FEUILLE (le même geste
 * que le « + » d'une ligne de projet), referme la feuille et ouvre sa conversation. Il dit son attente dès le clic et
 * ne se double pas. Repère `data-nouvel-artefact-feuille-taches`.
 *
 * LES LIGNES DE LA COLONNE (décision de l'utilisateur du 16/11/2026, capture #3836) : icône d'état, titre, heure à
 * droite — plus de nom de branche ni de badge encadré (`formatColonne`). La recherche et le filtre restent en tête.
 *
 * LA TÂCHE OÙ L'ON SE TROUVE EST EN BLEU (demande du 20/11/2026, capture #5c98d, maquette #11b0) : la feuille reçoit
 * `carteOuverte`, et sa ligne prend le même repère que dans la colonne de l'ordinateur — titre au bleu de l'important, fond
 * léger `.ligne-ouverte-de-colonne` (sauf une tâche qui attend une réponse). Repère `[data-ouvert]` sur la ligne.
 */
import * as React from 'react';
import type { Card } from '@beluga/shared';
import { ListeDesAgents } from '@/components/liste-des-agents';
import { CLASSE_BOUTON_PLEINE_LARGEUR } from '@/components/menu-du-bas';
import { creerCarteAgent } from '@/components/tiroir-nouvel-agent';
import { Drawer, EnteteDeFeuille } from '@/components/ui';
import { Loader2, Plus } from '@/components/ui/icones';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';

export function FeuilleDesTaches({
  projectId,
  carteOuverte,
  ouvert,
  onFermer,
  onOuvrir,
  onCree,
}: {
  projectId: string | null;
  /** La tâche affichée derrière la feuille : sa ligne s'allume en bleu. */
  carteOuverte?: string | null;
  ouvert: boolean;
  onFermer: () => void;
  onOuvrir: (card: Card) => void;
  /** La carte vient de naître (pour que l'appelant la suive, comme après le « + » de la colonne). */
  onCree?: (cardId: string) => void;
}) {
  const [creation, setCreation] = React.useState(false);
  if (!projectId) return null;
  const creer = async () => {
    if (creation) return;
    setCreation(true);
    try {
      const ok = await creerCarteAgent(projectId, (id) => onCree?.(id));
      if (ok) onFermer();
    } finally {
      setCreation(false);
    }
  };
  return (
    <Drawer feuille hauteurFixe open={ouvert} onClose={onFermer}>
      <EnteteDeFeuille titre={t('Tâches')} droite={null} />
      <div className="flex min-h-0 flex-1 flex-col" data-feuille-des-taches={projectId}>
        {ouvert ? (
          <ListeDesAgents
            projectId={projectId}
            carteOuverte={carteOuverte}
            pleinePage
            formatColonne
            onOuvrir={(card) => {
              onFermer();
              onOuvrir(card);
            }}
          />
        ) : null}
      </div>
      <div className="shrink-0 px-[var(--marge-de-page,1rem)] pt-2" style={{ paddingBottom: 'var(--pied-natif, calc(env(safe-area-inset-bottom) + 0.75rem))' }}>
        <button
          type="button"
          onClick={() => void creer()}
          disabled={creation}
          aria-busy={creation || undefined}
          className={cn(CLASSE_BOUTON_PLEINE_LARGEUR, 'bg-controle-doux text-text active:bg-controle-doux-survol [&>svg]:[scale:1]')}
          data-nouvel-artefact-feuille-taches={projectId}
        >
          {creation ? <Loader2 className="animate-spin" /> : <Plus />}
          <span className="min-w-0 truncate">{t('Nouvel artefact')}</span>
        </button>
      </div>
    </Drawer>
  );
}
