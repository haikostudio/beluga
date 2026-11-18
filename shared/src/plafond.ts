/**
 * UNE ATTENTE DU DÉMON A TOUJOURS UNE FIN (15/11/2026).
 *
 * Trois nuits de suite (09/11, 13–14/11, 15/11), toutes les préparations de
 * tour du démon sont restées pendues à l'étape « démarrage du moteur » jusqu'au
 * filet de cinq minutes, « Relancer » repartait et repend, et seul un
 * redémarrage forcé levait l'état. L'étape couvrait une dizaine d'attentes
 * (catalogue des moteurs, copie de travail, repères git, guide des services,
 * jeton GitHub), dont une PROMESSE PARTAGÉE — le relevé du catalogue, unique en
 * vol — qu'un seul exécutable resté sourd suffisait à figer pour tous les tours
 * suivants, jusqu'à la fin du processus.
 *
 * D'où la règle : une attente du chemin de lancement ne s'attend jamais sans
 * plafond. Passé le délai, elle rend un REPLI dit en clair (la valeur connue,
 * une valeur vide) ou une erreur qui NOMME l'étape — jamais un silence.
 *
 * Pur : ni base ni disque, seulement un minuteur (`server/src/test/plafond.test.ts`).
 */

/** L'erreur d'une attente arrivée à son plafond : elle porte l'étape et le délai. */
export class AttenteDepassee extends Error {
  readonly etape: string;
  readonly plafondMs: number;
  constructor(etape: string, plafondMs: number) {
    super(phraseDAttenteDepassee(etape, plafondMs));
    this.name = 'AttenteDepassee';
    this.etape = etape;
    this.plafondMs = plafondMs;
  }
}

/** « 45 s », « 2 min » : le délai dit en mots courants. */
export function dureeEnMots(ms: number): string {
  const secondes = Math.round(ms / 1000);
  if (secondes < 120) return `${secondes} s`;
  return `${Math.round(secondes / 60)} min`;
}

/** La phrase d'une étape restée sans réponse, telle qu'elle s'écrit dans le fil. */
export function phraseDAttenteDepassee(etape: string, plafondMs: number): string {
  return `La préparation de ce tour est restée bloquée à l’étape « ${etape} » (aucune réponse en ${dureeEnMots(plafondMs)}) : le tour s’arrête ici, rien n’a été envoyé au moteur.`;
}

/**
 * Attend `promesse` au plus `plafondMs`. Passé ce délai, rend `repli()` — ou,
 * sans repli, rejette une `AttenteDepassee` qui nomme `etape`. La promesse
 * d'origine qui finirait par échouer APRÈS le plafond est absorbée : elle ne
 * devient jamais un rejet non traité.
 *
 * `auPlafond` est appelé une fois, au moment où le délai tombe (pour le dire au
 * journal du démon) ; jamais quand la promesse répond à temps.
 */
export function attendreAuPlus<T>(
  promesse: Promise<T>,
  plafondMs: number,
  etape: string,
  options: { repli?: () => T; auPlafond?: (etape: string, plafondMs: number) => void } = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let fini = false;
    const minuteur = setTimeout(() => {
      if (fini) return;
      fini = true;
      try {
        options.auPlafond?.(etape, plafondMs);
      } catch {
        /* un journal qui tombe ne retient pas le tour */
      }
      if (options.repli) {
        try {
          resolve(options.repli());
        } catch (err) {
          reject(err);
        }
      } else {
        reject(new AttenteDepassee(etape, plafondMs));
      }
    }, plafondMs);
    promesse.then(
      (valeur) => {
        if (fini) return;
        fini = true;
        clearTimeout(minuteur);
        resolve(valeur);
      },
      (err) => {
        if (fini) return;
        fini = true;
        clearTimeout(minuteur);
        reject(err);
      },
    );
  });
}

/**
 * LES PLAFONDS DU CHEMIN DE LANCEMENT, un seul endroit. Chacun est très
 * au-dessus de la durée normale mesurée (une étape saine répond en moins d'une
 * seconde, une copie de travail recréée en quelques secondes), et la somme
 * reste sous le filet de cinq minutes (`PLAFOND_PREPARATION_MS`) : c'est
 * l'étape qui parle, plus le filet anonyme.
 */
export const PLAFONDS_DU_LANCEMENT = {
  /** Le catalogue des moteurs, quand aucun relevé n'existe encore. */
  catalogue: 10_000,
  /** La copie de travail de la carte, recréée si elle a disparu. */
  copieDeTravail: 120_000,
  /** Les copies des dépôts annexes. */
  copiesAnnexes: 120_000,
  /** Les repères git d'avant le tour (dépôt de la carte, dossier partagé). */
  repereGit: 30_000,
  /** Le guide des services ouverts à l'agent. */
  guideDesServices: 10_000,
  /** Le jeton GitHub posé dans l'environnement de l'agent. */
  jetonGithub: 15_000,
} as const;

/** Le plafond d'un moteur au relevé du catalogue (version + liste des modèles). */
export const PLAFOND_RELEVE_D_UN_MOTEUR_MS = 40_000;
