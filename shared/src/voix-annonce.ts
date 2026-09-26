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
 * LA VOIX A UNE PERSONNALITÉ, posée ICI et nulle part ailleurs : une développeuse
 * fullstack exécutive qui pilote les tâches à l'intérieur de Beluga Build et parle à
 * l'utilisateur comme à une connaissance, en l'appelant par son PRÉNOM, d'un ton
 * naturel et humain — jamais un robot qui récite. Elle tutoie. Le prénom par
 * défaut est « Chris » (`NOM_UTILISATEUR`) mais il est RÉGLABLE : toutes les
 * phrases prennent un prénom en option.
 *
 * Deux ressorts gardent la voix vivante plutôt que figée :
 *  - la VARIÉTÉ : chaque annonce (fin de tâche, publication, décision) tire sa
 *    tournure d'un petit choix, de façon STABLE pour une même entrée — une
 *    réécoute ne surprend pas, mais deux tâches différentes ne se ressemblent
 *    pas.
 *  - le MOMENT : passé le soir, les phrases se font plus BRÈVES (`estSoir`).
 *
 * Enfin, quand on a le vrai texte de la réponse de l'agent, `phraseDepuisReponse`
 * en tire un résumé humain (« ce qui est fait ») plutôt que de réciter le seul
 * titre. Aucune génération payante : on lit ce que l'agent a déjà écrit.
 */

/** Le prénom auquel la voix s'adresse par défaut. Réglable, voir `VoixOptions`. */
export const NOM_UTILISATEUR = 'Chris';

/** Le nombre de signes au-delà duquel on ne lit plus : une annonce reste brève. */
export const VOIX_LONGUEUR_MAX = 240;

/**
 * Ce qui personnalise une phrase : le prénom (à défaut « Chris ») et l'heure du
 * jour (0–23), qui décide du ton — plus bref le soir. Sans heure, on parle du
 * ton neutre de journée.
 */
export interface VoixOptions {
  /** Le prénom à dire ; vide ou absent retombe sur `NOM_UTILISATEUR`. */
  nom?: string;
  /** L'heure locale (0–23) : passé le soir, les phrases raccourcissent. */
  heure?: number;
}

/** Le prénom effectif : celui réglé, sinon « Chris ». */
function nomDe(opts?: VoixOptions): string {
  const nom = opts?.nom?.trim();
  return nom || NOM_UTILISATEUR;
}

/** Le soir (20 h → 7 h) : la voix se fait plus brève. Sans heure, jour neutre. */
function estSoir(opts?: VoixOptions): boolean {
  const h = opts?.heure;
  if (h == null || !Number.isFinite(h)) return false;
  return h >= 20 || h < 7;
}

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
 * Un choix de variante STABLE pour une graine donnée : la même entrée redit
 * toujours la même phrase (une réécoute ne surprend pas), mais deux entrées
 * différentes tombent le plus souvent sur des tournures différentes. On somme
 * les signes plutôt que de tirer au hasard, pour rester déterministe — donc
 * testable.
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
 * « Chris, ça y est : « X », c'est fait. » et variantes — ou une phrase sans nom
 * de tâche quand on ne l'a pas. Le soir, la tournure est plus courte.
 */
export function phraseFinDeTache(titre?: string, opts?: VoixOptions): string {
  const nom = nomDe(opts);
  const soir = estSoir(opts);
  const propre = titre ? nettoyerPourVoix(titre) : '';

  if (!propre) {
    return soir
      ? variante(titre ?? '', [`C'est fait, ${nom}.`, `Fini, ${nom}.`])
      : variante(titre ?? '', [
          `Voilà, ${nom}, c'est fini.`,
          `Ça y est, ${nom}, la tâche est bouclée.`,
          `C'est bon, ${nom}, j'ai terminé.`,
        ]);
  }

  const pool = soir
    ? [`${nom}, « ${propre} » est fait.`, `C'est bouclé, ${nom} : « ${propre} ».`]
    : [
        `Ça y est, ${nom} : « ${propre} », c'est fait.`,
        `Voilà, ${nom}, « ${propre} » est bouclé.`,
        `${nom}, j'ai fini « ${propre} », c'est prêt.`,
        `C'est terminé, ${nom} — « ${propre} » est en place.`,
      ];

  return sousLaBorne([
    variante(propre, pool),
    // Repli court si le titre est trop long pour la tournure ci-dessus.
    soir ? `C'est fait, ${nom}.` : `Ça y est, ${nom}, c'est fait.`,
  ]);
}

/** « Chris, « X » est en ligne. » et variantes — ou sans titre si on n'en a pas. */
export function phraseFinDePublication(titre?: string, opts?: VoixOptions): string {
  const nom = nomDe(opts);
  const soir = estSoir(opts);
  const propre = titre ? nettoyerPourVoix(titre) : '';

  if (!propre) return `Ça y est, ${nom}, la mise en ligne est passée.`;

  const pool = soir
    ? [`${nom}, « ${propre} » est en ligne.`]
    : [
        `Ça y est, ${nom} : « ${propre} » est en ligne.`,
        `${nom}, « ${propre} » est publié.`,
        `C'est en ligne, ${nom} : « ${propre} ».`,
      ];

  return sousLaBorne([variante(propre, pool), `Ça y est, ${nom}, la mise en ligne est passée.`]);
}

/**
 * « Chris, la mise en ligne de « X » a coincé. » et variantes — ou sans titre.
 * On garde le ton naturel, mais on dit clairement qu'il faut y regarder.
 */
export function phraseEchecDePublication(titre?: string, opts?: VoixOptions): string {
  const nom = nomDe(opts);
  const soir = estSoir(opts);
  const propre = titre ? nettoyerPourVoix(titre) : '';

  if (!propre) return `${nom}, la mise en ligne a coincé, il faut y jeter un œil.`;

  const pool = soir
    ? [`${nom}, « ${propre} » a coincé à la mise en ligne.`]
    : [
        `${nom}, la mise en ligne de « ${propre} » a coincé, il faut y jeter un œil.`,
        `${nom}, « ${propre} » n'est pas passé en ligne, à regarder.`,
      ];

  return sousLaBorne([variante(propre, pool), `${nom}, la mise en ligne a coincé, il faut y jeter un œil.`]);
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
 * l'écran : la tâche d'abord (le plus précis), sinon le projet. La tournure
 * VARIE (choix stable sur le repère cité), et le soir elle raccourcit. On garde
 * le repli le plus court qui tienne sous `VOIX_LONGUEUR_MAX`. La voix s'adresse à
 * Chris et lui demande son avis, jamais un « votre réponse » de standardiste.
 */
export function phraseDecisionAttendue(nouvelles: number, contexte?: ContexteDecision, opts?: VoixOptions): string {
  const nom = nomDe(opts);
  const soir = estSoir(opts);
  const plusieurs = nouvelles > 1;
  const tache = contexte?.tache ? nettoyerPourVoix(contexte.tache) : '';
  const projet = contexte?.projet ? nettoyerPourVoix(contexte.projet) : '';

  const candidates: string[] = [];
  if (tache) {
    if (plusieurs) {
      candidates.push(`${nom}, plusieurs décisions t'attendent, dont la tâche « ${tache} ».`);
    } else if (soir) {
      candidates.push(`${nom}, « ${tache} » attend ta décision.`);
    } else {
      candidates.push(
        variante(tache, [
          `${nom}, j'ai besoin de ton avis sur « ${tache} ».`,
          `${nom}, « ${tache} » attend ta décision.`,
          `${nom}, une décision à prendre sur « ${tache} ».`,
        ]),
      );
    }
  }
  if (projet) {
    if (plusieurs) {
      candidates.push(`${nom}, plusieurs décisions t'attendent, dont le projet ${projet}.`);
    } else if (soir) {
      candidates.push(`${nom}, le projet ${projet} attend ta décision.`);
    } else {
      candidates.push(
        variante(projet, [
          `${nom}, le projet ${projet} attend ta décision.`,
          `${nom}, il y a une décision à prendre sur ${projet}.`,
        ]),
      );
    }
  }
  candidates.push(
    plusieurs ? `${nom}, plusieurs décisions t'attendent.` : `${nom}, une décision t'attend.`,
  );

  return sousLaBorne(candidates);
}

/**
 * À partir du VRAI texte de la réponse de l'agent, une phrase parlée qui dit ce
 * qui vient d'être fait — pas le seul titre. On lit la section « Ce qui est
 * fait » et on en tire la première idée, nettoyée pour l'oreille (ni puce, ni
 * gras, ni chemin de fichier). Rien n'est généré à la demande : on résume ce que
 * l'agent a déjà écrit, donc aucune facturation.
 *
 * Rend `null` quand on ne peut rien tirer de propre (section absente, résumé
 * vide, trop court ou trop long) : l'appelant retombe alors sur la phrase par
 * titre. Le SOIR, on rend aussi `null` — le ton bref préfère la courte phrase par
 * titre à un résumé qui s'étire.
 */
export function phraseDepuisReponse(texte: string | undefined, opts?: VoixOptions): string | null {
  if (!texte || estSoir(opts)) return null;
  const nom = nomDe(opts);
  const resume = resumeDeCeQuiEstFait(texte);
  if (!resume) return null;

  const frame = variante(resume, [
    (r: string) => `${nom}, c'est fait. ${r}`,
    (r: string) => `${nom}, voilà. ${r}`,
    (r: string) => `C'est bon, ${nom}. ${r}`,
  ]);
  const phrase = frame(resume);
  return phrase.length <= VOIX_LONGUEUR_MAX ? phrase : null;
}

/** La première idée de la section « Ce qui est fait », prête pour l'oreille. */
function resumeDeCeQuiEstFait(texte: string): string | null {
  // La section porte le titre « Ce qui est fait », avec ou sans numéro.
  const debut = texte.match(/^#{1,6}[ \t]*(?:\d+\.[ \t]*)?Ce qui est fait[ \t]*$/im);
  if (!debut || debut.index == null) return null;
  const apres = texte.slice(debut.index + debut[0].length);
  // On s'arrête au titre suivant : on ne lit que cette section.
  const fin = apres.search(/^#{1,6}[ \t]/m);
  const corps = fin === -1 ? apres : apres.slice(0, fin);

  // La première ligne qui porte du texte (souvent une puce).
  const ligne = corps
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!ligne) return null;

  const propre = nettoyerLignePourVoix(ligne);
  const phrase = premierePhrase(propre);
  // Trop court n'apprend rien ; on laisse alors le titre parler.
  if (phrase.length < 8) return null;
  // Trop long ne tiendra pas dans une annonce, même seul.
  if (phrase.length > VOIX_LONGUEUR_MAX - 20) return null;
  return phrase;
}

/** Retire puce, gras, code et liens d'une ligne Markdown, garde le texte. */
function nettoyerLignePourVoix(ligne: string): string {
  return ligne
    .replace(/^[-*+•]\s+/, '') // puce
    .replace(/^\d+[.)]\s+/, '') // numéro de liste
    .replace(/`([^`]*)`/g, '$1') // code entre accents graves
    .replace(/\*\*([^*]+)\*\*/g, '$1') // gras
    .replace(/\*([^*]+)\*/g, '$1') // italique
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // lien : garde le libellé
    .replace(/\s+/g, ' ')
    .trim();
}

/** La première phrase d'un texte (jusqu'au premier point qui clôt vraiment). */
function premierePhrase(texte: string): string {
  const m = texte.match(/^.*?[.!?](?=\s|$)/);
  return (m ? m[0] : texte).trim();
}

/**
 * La phrase à lire pour un motif de notification, ou `null` quand ce motif ne
 * se dit pas à voix haute. La fin d'une tâche et la fin d'une publication
 * (réussie ou en échec) parlent par cette voie. La décision attendue, elle,
 * passe par le compte d'attention (sinon on la dirait deux fois), et le reste —
 * quota, redémarrage — n'est pas une parole d'assistant.
 */
export function phraseVocaleDeNotification(motif: string | undefined, titre?: string, opts?: VoixOptions): string | null {
  if (motif === 'tache-terminee') return phraseFinDeTache(titre, opts);
  if (motif === 'publication-terminee') return phraseFinDePublication(titre, opts);
  if (motif === 'publication-echec') return phraseEchecDePublication(titre, opts);
  return null;
}
