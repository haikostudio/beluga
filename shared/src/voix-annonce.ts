/**
 * Ce que l'assistant DIT à voix haute aux moments clés (PLAN §22, mémoire n°35).
 *
 * La voix se déclenche seule à trois instants déjà signalés ailleurs : une tâche
 * terminée (motif de notification « tache-terminee »), une publication finie ou
 * en échec, et une décision attendue (le compte d'« attention » qui monte). Ici
 * on ne fabrique QUE la phrase — courte, écrite pour l'oreille : l'important
 * d'abord, sans jargon. La lecture elle-même (Piper) et l'onde sonore vivent
 * côté web.
 *
 * LA VOIX A UNE PERSONNALITÉ, posée ICI et nulle part ailleurs (voir la carte
 * « Voix personnalisée Chris ») : une développeuse fullstack exécutive qui pilote
 * les tâches à l'intérieur de HaikoDev et parle à l'utilisateur comme à une
 * connaissance, en l'appelant par son prénom, « Chris », d'un ton naturel et
 * humain — jamais un robot qui récite. Elle tutoie, comme une collègue proche.
 * Les phrases restent COURTES mais disent vraiment ce qui vient de se passer, et
 * elles VARIENT d'une tâche à l'autre pour ne plus sonner comme un modèle figé.
 */

/** Le prénom auquel la voix s'adresse. Un seul endroit : on ne le répète pas. */
export const NOM_UTILISATEUR = 'Chris';

/** Le nombre de signes au-delà duquel on ne lit plus : une annonce reste brève. */
export const VOIX_LONGUEUR_MAX = 240;

/**
 * Le titre d'une carte arrive souvent précédé d'un emoji de genre (« ✅ Mon
 * titre ») : à l'oreille il ne dit rien, on le retire. On enlève de même les
 * guillemets qui entoureraient déjà le titre, pour ne pas les redoubler.
 */
export function nettoyerPourVoix(titre: string): string {
  return titre
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/^["«»“”\s]+|["«»“”\s]+$/gu, '')
    .trim();
}

/**
 * Un choix de variante STABLE pour un titre donné : la même tâche redit toujours
 * la même phrase (une réécoute ne surprend pas), mais deux tâches différentes
 * tombent le plus souvent sur des tournures différentes. On somme les signes du
 * texte plutôt que de tirer au hasard, pour rester déterministe — donc testable.
 */
function variante<T>(graine: string, choix: readonly T[]): T {
  let somme = 0;
  for (const c of graine) somme = (somme + c.codePointAt(0)!) % 100000;
  return choix[somme % choix.length];
}

/**
 * On garde la plus longue variante qui tienne sous `VOIX_LONGUEUR_MAX`. Un titre
 * à rallonge ne doit pas faire déborder l'annonce ; à défaut on retombe sur la
 * dernière, la plus courte (toujours prévue sans nom).
 */
function sousLaBorne(candidates: readonly string[]): string {
  return candidates.find((p) => p.length <= VOIX_LONGUEUR_MAX) ?? candidates[candidates.length - 1];
}

/**
 * « Chris, ça y est : « X » est bouclé. » et variantes — ou une phrase sans nom
 * de tâche quand on ne l'a pas. La voix dit ce qui vient d'être fait et s'adresse
 * à Chris.
 */
export function phraseFinDeTache(titre?: string): string {
  const propre = titre ? nettoyerPourVoix(titre) : '';
  if (!propre) {
    return variante(titre ?? '', [
      `Voilà, ${NOM_UTILISATEUR}, c'est fini.`,
      `Ça y est, ${NOM_UTILISATEUR}, la tâche est bouclée.`,
      `C'est bon, ${NOM_UTILISATEUR}, j'ai terminé.`,
    ]);
  }
  return sousLaBorne([
    variante(propre, [
      `Ça y est, ${NOM_UTILISATEUR} : « ${propre} », c'est fait.`,
      `Voilà, ${NOM_UTILISATEUR}, « ${propre} » est bouclé.`,
      `${NOM_UTILISATEUR}, j'ai fini « ${propre} », c'est prêt.`,
      `C'est terminé, ${NOM_UTILISATEUR} — « ${propre} » est en place.`,
    ]),
    // Repli court si le titre est trop long pour la tournure ci-dessus.
    `Ça y est, ${NOM_UTILISATEUR}, c'est fait.`,
  ]);
}

/**
 * « Chris, c'est en ligne : « X » est publié. » — ou sans titre si on n'en a pas.
 */
export function phraseFinDePublication(titre?: string): string {
  const propre = titre ? nettoyerPourVoix(titre) : '';
  if (!propre) return `Ça y est, ${NOM_UTILISATEUR}, la mise en ligne est passée.`;
  return sousLaBorne([
    `Ça y est, ${NOM_UTILISATEUR} : « ${propre} » est en ligne.`,
    `Ça y est, ${NOM_UTILISATEUR}, la mise en ligne est passée.`,
  ]);
}

/**
 * « Chris, la mise en ligne de « X » a coincé. » — ou sans titre si on n'en a
 * pas. On garde le ton naturel, mais on dit clairement qu'il faut y regarder.
 */
export function phraseEchecDePublication(titre?: string): string {
  const propre = titre ? nettoyerPourVoix(titre) : '';
  if (!propre) return `${NOM_UTILISATEUR}, la mise en ligne a coincé, il faut y jeter un œil.`;
  return sousLaBorne([
    `${NOM_UTILISATEUR}, la mise en ligne de « ${propre} » a coincé, il faut y jeter un œil.`,
    `${NOM_UTILISATEUR}, la mise en ligne a coincé, il faut y jeter un œil.`,
  ]);
}

/** De quoi parle la décision : la tâche concernée, à défaut le projet. */
export interface ContexteDecision {
  /** Le titre de la tâche, quand la décision est née dans son travail. */
  tache?: string;
  /** Le nom du projet où la décision arrive. */
  projet?: string;
}

/**
 * L'annonce d'une décision attendue. Le nombre reste petit : une décision, ou
 * plusieurs. On ne récite pas un chiffre — « plusieurs » se dit mieux à voix
 * haute et vieillit bien si d'autres arrivent le temps de la phrase.
 *
 * Quand on sait DE QUOI il s'agit, on le dit pour qu'on comprenne sans regarder
 * l'écran : la tâche d'abord (le plus précis), sinon le projet. On garde le
 * repli le plus court qui tienne sous `VOIX_LONGUEUR_MAX` — un titre à rallonge
 * ne doit pas faire déborder l'annonce ; à défaut, la phrase générique. La voix
 * s'adresse à Chris et lui demande son avis, jamais un « votre réponse » de
 * standardiste.
 */
export function phraseDecisionAttendue(nouvelles: number, contexte?: ContexteDecision): string {
  const plusieurs = nouvelles > 1;
  const tache = contexte?.tache ? nettoyerPourVoix(contexte.tache) : '';
  const projet = contexte?.projet ? nettoyerPourVoix(contexte.projet) : '';

  const candidates: string[] = [];
  if (tache) {
    candidates.push(
      plusieurs
        ? `${NOM_UTILISATEUR}, plusieurs décisions t'attendent, dont la tâche « ${tache} ».`
        : `${NOM_UTILISATEUR}, j'ai besoin de ton avis sur « ${tache} ».`,
    );
  }
  if (projet) {
    candidates.push(
      plusieurs
        ? `${NOM_UTILISATEUR}, plusieurs décisions t'attendent, dont le projet ${projet}.`
        : `${NOM_UTILISATEUR}, le projet ${projet} attend ta décision.`,
    );
  }
  candidates.push(
    plusieurs
      ? `${NOM_UTILISATEUR}, plusieurs décisions t'attendent.`
      : `${NOM_UTILISATEUR}, une décision t'attend.`,
  );

  return sousLaBorne(candidates);
}

/**
 * La phrase à lire pour un motif de notification, ou `null` quand ce motif ne
 * se dit pas à voix haute. La fin d'une tâche et la fin d'une publication
 * (réussie ou en échec) parlent par cette voie. La décision attendue, elle,
 * passe par le compte d'attention (sinon on la dirait deux fois), et le reste —
 * quota, redémarrage — n'est pas une parole d'assistant.
 */
export function phraseVocaleDeNotification(motif: string | undefined, titre?: string): string | null {
  if (motif === 'tache-terminee') return phraseFinDeTache(titre);
  if (motif === 'publication-terminee') return phraseFinDePublication(titre);
  if (motif === 'publication-echec') return phraseEchecDePublication(titre);
  return null;
}
