import * as React from 'react';
import type { EtatDuBoutonDeConfiguration } from '@beluga/shared';

/**
 * CE QUE LES DEUX GESTES DE PUBLICATION ONT À DIRE HORS DE LEUR BOUTON.
 *
 * Sur téléphone, « Déployer » et « Mise en production » n'ont plus ni pied de
 * colonne ni bande en bas de l'écran (demande du 11/10/2026) : ce sont deux
 * lignes du menu à trois points de la barre d'en-tête. Or le contenu d'un menu
 * est DÉMONTÉ tant qu'il est fermé : ce qu'on doit voir sans l'ouvrir — combien
 * de versions attendent, l'avancement d'une publication, son échec — ne peut
 * pas y vivre.
 *
 * Les deux composants de publication restent donc montés là où ils l'étaient
 * (ils portent leurs pages, leurs contrôles et leur confirmation), bouton
 * caché, et DISENT ici leur état. Le bouton à trois points et ses deux lignes
 * le lisent, et ouvrent la page du geste par `ouvrir` — la MÊME que le bouton
 * d'origine. Rien n'est recopié, rien ne part d'ici : une ligne de menu ouvre
 * une page — ou la conversation de l'agent de configuration, ou la confirmation
 * de la mise en production —, elle ne lance jamais une publication.
 */
export type GesteDePublication = 'deploiement' | 'production';

export interface SignalDePublication {
  /** Ce qui attend : les cartes du lot, ou les versions en retard sur la production. */
  compte: number;
  /** La phrase de cet écart, déjà traduite (« 3 versions de retard »). */
  resume?: string;
  /** La production est en retard sur ce qui est prêt à partir. */
  enRetard: boolean;
  /** L'avancement de la publication en cours ou tout juste finie ; `null` au repos. */
  pourcent: number | null;
  enRoute: boolean;
  tombee: boolean;
  /**
   * LA LIGNE MÈNE À L'AGENT DE CONFIGURATION (22/10/2026) : sans procédure, ou
   * tant que cet agent travaille ou attend une réponse. La ligne le dit (roue,
   * bulle de question, étincelles) et `ouvrir` ouvre sa conversation.
   */
  agent?: EtatDuBoutonDeConfiguration | null;
}

export type SignalLu = SignalDePublication & { ouvrir: () => void };

const signaux = new Map<string, SignalLu>();
const abonnes = new Set<() => void>();

const cleDe = (projectId: string, geste: GesteDePublication) => `${projectId}:${geste}`;
const prevenir = () => abonnes.forEach((abonne) => abonne());
const sAbonner = (abonne: () => void) => {
  abonnes.add(abonne);
  return () => {
    abonnes.delete(abonne);
  };
};

/**
 * DIRE SON ÉTAT, tant qu'on est monté sans bouton. `signal` à `null` : le geste
 * garde son bouton à lui (barre d'en-tête sur ordinateur) et n'a rien à dire.
 */
export function useSignalerLaPublication(
  projectId: string,
  geste: GesteDePublication,
  signal: SignalDePublication | null,
  ouvrir: () => void,
): void {
  /* Le geste d'ouverture change à chaque rendu : on n'en garde que le dernier,
     pour ne redire l'état que lorsqu'il CHANGE. */
  const dernierOuvrir = React.useRef(ouvrir);
  dernierOuvrir.current = ouvrir;
  const empreinte = signal ? JSON.stringify(signal) : null;
  React.useEffect(() => {
    if (!empreinte) return;
    const cle = cleDe(projectId, geste);
    signaux.set(cle, { ...(JSON.parse(empreinte) as SignalDePublication), ouvrir: () => dernierOuvrir.current() });
    prevenir();
    return () => {
      signaux.delete(cle);
      prevenir();
    };
  }, [projectId, geste, empreinte]);
}

/** L'état d'un geste de publication du projet affiché ; `null` s'il porte son propre bouton. */
export function useSignalDePublication(projectId: string | null | undefined, geste: GesteDePublication): SignalLu | null {
  return React.useSyncExternalStore(sAbonner, () => (projectId ? signaux.get(cleDe(projectId, geste)) ?? null : null));
}
