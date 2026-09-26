/*
 * L'ENVOI SUR LE DÉPÔT NE SE FABRIQUE PLUS AVEC UNE SORTIE DE GIT.
 *
 * L'étape « Envoi sur le dépôt » lisait la branche suivie ainsi :
 *
 *     const suivie = (await runCommand(cwd, 'git rev-parse … @{u}')).out.trim();
 *     const commande = suivie.includes('/') ? `git push ${suivie.split('/')…}` : …
 *
 * `runCommand` rend la sortie standard ET la sortie d'erreur COLLÉES, et son
 * `ok` n'était pas regardé. Quand la branche locale n'a pas de référence de
 * suivi, git écrit « fatal: upstream branch 'refs/heads/dev' not stored as a
 * remote-tracking branch » — un texte qui contient des barres obliques. Le
 * `includes('/')` était donc vrai, et TOUT LE MESSAGE DE GIT partait comme
 * arguments d'un `git push` passé à `bash -lc` : chaque mot devenait un
 * refspec (« src refspec upstream/branch/HEAD/not/stored… does not match any »)
 * et deux lignes du message étaient même exécutées par le shell (« Command:
 * command not found »). C'est la panne du 07/09/2026 sur Maestria60+, tombée à
 * 17 %.
 *
 * Trois règles, pures (ni git, ni disque, ni réseau), donc contrôlables seules :
 *
 *  1. une sortie de commande n'est acceptée que si la commande a RÉUSSI et que
 *     ce qu'elle rend est vraiment UN NOM DE BRANCHE ;
 *  2. l'envoi se construit en ARGUMENTS SÉPARÉS, jamais en chaîne de shell ;
 *  3. rien de douteux ne part : on s'arrête avec une phrase claire.
 */

/** Ce qu'une lecture de branche rend : l'issue de la commande et son texte. */
export interface LectureDeBranche {
  /** La commande git a-t-elle réussi ? Une sortie d'échec n'est jamais lue. */
  ok: boolean;
  /** Ce qu'elle a écrit (sortie standard uniquement, jamais l'erreur). */
  sortie: string;
}

/** Le plan d'envoi : soit des arguments sûrs, soit un refus motivé. */
export type PlanDEnvoi =
  | {
      ok: true;
      /** Les arguments de `git`, un par case — jamais une chaîne à découper. */
      arguments: string[];
      /** La commande telle qu'on l'affiche dans le fil de la publication. */
      commande: string;
      /** L'envoi pose-t-il lui-même la branche amont (premier envoi) ? */
      poseLAmont: boolean;
    }
  | { ok: false; raison: string };

/** Le distant visé quand la branche locale n'a pas encore d'amont. */
export const DISTANT_PAR_DEFAUT = 'origin';

/**
 * EST-CE VRAIMENT UN NOM DE BRANCHE ?
 *
 * Les règles de `git check-ref-format`, ramenées à ce qu'un message d'erreur ne
 * peut pas franchir : une seule ligne, aucun espace, aucun des signes que le
 * shell ou git interprètent, pas de `..`, pas de tiret en tête (ce serait une
 * option), et pas `HEAD` (une copie de travail détachée n'a pas de branche).
 */
export function estNomDeBrancheValide(nom: string): boolean {
  if (typeof nom !== 'string') return false;
  const valeur = nom.trim();
  if (!valeur || valeur.length > 255) return false;
  if (valeur === 'HEAD') return false;
  if (/\s/.test(valeur)) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(valeur)) return false;
  if (/[~^:?*[\]\\@{}$'"`;|&()<>!#]/.test(valeur)) return false;
  if (valeur.includes('..')) return false;
  if (valeur.startsWith('-') || valeur.startsWith('/') || valeur.startsWith('.')) return false;
  if (valeur.endsWith('/') || valeur.endsWith('.') || valeur.endsWith('.lock')) return false;
  return true;
}

/** Un nom de dépôt distant : un nom de branche, en plus court et sans barre. */
export function estNomDeDistantValide(nom: string): boolean {
  return estNomDeBrancheValide(nom) && !nom.includes('/');
}

/** Une lecture n'est retenue que si elle a réussi ET tient sur une seule ligne. */
function valeurLue(lecture: LectureDeBranche | undefined): string | null {
  if (!lecture?.ok) return null;
  const lignes = (lecture.sortie ?? '')
    .split('\n')
    .map((ligne) => ligne.trim())
    .filter(Boolean);
  if (lignes.length !== 1) return null;
  return lignes[0];
}

/**
 * LA COMMANDE D'ENVOI, BÂTIE SUR LA BRANCHE RÉELLE.
 *
 * Deux situations, et une seule sortie de secours :
 *
 *  - la branche locale SUIT une branche distante (`origin/dev`) : on vise
 *    explicitement ce couple. Viser la branche suivie plutôt que « le même nom »
 *    est indispensable quand la copie a été remise sur `archive/main` : la règle
 *    « simple » de git refuserait l'envoi ;
 *  - elle n'a PAS d'amont (premier envoi d'une branche neuve, référence de suivi
 *    jamais rapatriée) : on pose l'amont nous-mêmes sur le distant du projet,
 *    au lieu de laisser git rendre un conseil que le code réingérait ;
 *  - tout le reste — lecture en échec, copie détachée, texte qui n'est pas un
 *    nom de branche — s'ARRÊTE avec une phrase claire. On n'envoie pas « au cas
 *    où ».
 */
export function planDEnvoi(input: {
  suivie?: LectureDeBranche;
  locale?: LectureDeBranche;
  distant?: string;
}): PlanDEnvoi {
  const distant = input.distant?.trim() || DISTANT_PAR_DEFAUT;
  if (!estNomDeDistantValide(distant)) {
    return { ok: false, raison: `Le dépôt distant visé (« ${distant} ») n’est pas un nom utilisable.` };
  }

  const suivie = valeurLue(input.suivie);
  if (suivie) {
    const coupure = suivie.indexOf('/');
    const distantSuivi = coupure > 0 ? suivie.slice(0, coupure) : '';
    const brancheSuivie = coupure > 0 ? suivie.slice(coupure + 1) : '';
    if (estNomDeDistantValide(distantSuivi) && estNomDeBrancheValide(brancheSuivie)) {
      const args = ['push', distantSuivi, `HEAD:refs/heads/${brancheSuivie}`];
      return { ok: true, arguments: args, commande: `git ${args.join(' ')}`, poseLAmont: false };
    }
    return {
      ok: false,
      raison: `La branche suivie lue (« ${suivie} ») n’est pas un couple « distant/branche » : rien n’est envoyé.`,
    };
  }

  const locale = valeurLue(input.locale);
  if (!locale) {
    return {
      ok: false,
      raison: 'Impossible de lire le nom de la branche courante : rien n’est envoyé.',
    };
  }
  if (!estNomDeBrancheValide(locale)) {
    return {
      ok: false,
      raison:
        locale === 'HEAD'
          ? 'La copie de travail n’est sur aucune branche (HEAD détaché) : rien n’est envoyé.'
          : `Ce que git rend pour la branche courante (« ${locale} ») n’est pas un nom de branche : rien n’est envoyé.`,
    };
  }
  const args = ['push', '-u', distant, `HEAD:refs/heads/${locale}`];
  return { ok: true, arguments: args, commande: `git ${args.join(' ')}`, poseLAmont: true };
}

/** Combien de lignes de sortie brute restent affichées sous la cause. */
export const LIGNES_DE_SORTIE_GARDEES = 40;

/**
 * REGROUPER CE QUI SE RÉPÈTE.
 *
 * Un envoi mal formé rendait des DIZAINES de lignes « error: src refspec … does
 * not match any » : la cause utile — la première ligne — était noyée. Les
 * lignes identiques qui se suivent sont comptées en une seule, et la sortie est
 * plafonnée : on garde le début et la fin, on dit combien de lignes manquent.
 */
export function grouperLignesRepetees(sortie: string, lignesGardees = LIGNES_DE_SORTIE_GARDEES): string {
  const lignes = (sortie ?? '').split('\n').map((ligne) => ligne.trimEnd());
  const groupes: { texte: string; nombre: number }[] = [];
  for (const ligne of lignes) {
    const dernier = groupes[groupes.length - 1];
    if (dernier && dernier.texte === ligne) {
      dernier.nombre += 1;
      continue;
    }
    groupes.push({ texte: ligne, nombre: 1 });
  }
  const rendues = groupes.map((groupe) =>
    groupe.nombre > 1 ? `${groupe.texte}   (× ${groupe.nombre})` : groupe.texte,
  );
  if (rendues.length <= lignesGardees) return rendues.join('\n');
  const tete = rendues.slice(0, lignesGardees - 5);
  const queue = rendues.slice(-5);
  return [...tete, `… ${rendues.length - lignesGardees + 5} lignes de plus, non affichées`, ...queue].join('\n');
}

/**
 * LA PREMIÈRE CAUSE UTILE d'un envoi tombé.
 *
 * Git écrit d'abord ce qui compte (`fatal:`, `error:`, `! [rejected]`,
 * `remote:`) et ensuite ses conseils. On rend la première ligne qui explique,
 * et à défaut la première ligne non vide.
 */
export function causeDEchecDEnvoi(sortie: string): string {
  const lignes = (sortie ?? '')
    .split('\n')
    .map((ligne) => ligne.trim())
    .filter(Boolean);
  const parlante = lignes.find((ligne) =>
    /^(fatal:|error:|remote:\s*(error|fatal)|!\s*\[rejected\]|ssh:|Permission denied)/i.test(ligne),
  );
  return parlante ?? lignes[0] ?? '';
}

/**
 * CE QUE LE TIROIR DE PUBLICATION AFFICHE QUAND L'ENVOI TOMBE.
 *
 * Trois blocs, dans cet ordre : la commande RÉELLEMENT lancée, la cause en
 * clair, puis la sortie brute — regroupée — pour qui veut tout lire.
 */
export function resumeDEchecDEnvoi(input: { commande: string; sortie: string }): string {
  const cause = causeDEchecDEnvoi(input.sortie);
  const brut = grouperLignesRepetees((input.sortie ?? '').trim());
  return [
    `Commande lancée : ${input.commande}`,
    cause ? `Cause : ${cause}` : 'Cause : la commande n’a rien écrit.',
    '',
    brut || '(sortie vide)',
  ].join('\n');
}

/**
 * UN ENVOI REFUSÉ PARCE QUE LE DÉPÔT DISTANT A AVANCÉ.
 *
 * `! [rejected] HEAD -> dev (non-fast-forward)` ou `(fetch first)` : la branche
 * distante porte des enregistrements que la copie locale n'a pas (un autre
 * poste, une fusion faite sur GitHub). Rejouer le même envoi échoue à
 * l'identique — ProjetA a échoué six fois de suite le 24-25.09.2026 avant que le
 * départ automatique n'abandonne. Ce refus-là se RÉPARE (récupérer, fusionner,
 * renvoyer) ; tous les autres restent des pannes nommées.
 */
export function envoiRefuseCarLeDistantAAvance(sortie: string): boolean {
  return /non-fast-forward|\(fetch first\)|Updates were rejected because the (remote contains work|tip of your current branch is behind)/i.test(
    sortie ?? '',
  );
}

/** Le distant et la branche visés par un plan d'envoi (`push <distant> HEAD:refs/heads/<branche>`). */
export function cibleDuPlanDEnvoi(args: readonly string[]): { distant: string; branche: string } | null {
  const refspec = args[args.length - 1] ?? '';
  const distant = args[args.length - 2] ?? '';
  const prefixe = 'HEAD:refs/heads/';
  if (!refspec.startsWith(prefixe)) return null;
  const branche = refspec.slice(prefixe.length);
  if (!estNomDeDistantValide(distant) || !estNomDeBrancheValide(branche)) return null;
  return { distant, branche };
}

/**
 * LE RATTRAPAGE, COMMANDE PAR COMMANDE : récupérer la branche distante, la
 * FUSIONNER (jamais un rebase, qui réécrirait les fusions du lot ; jamais un
 * envoi forcé, qui effacerait le travail d'un autre), puis renvoyer. Un heurt
 * pendant la fusion l'annule (`merge --abort`) : le dossier partagé reste
 * propre, et l'échec dit pourquoi.
 */
export function commandesDeRattrapage(cible: { distant: string; branche: string }): {
  recuperer: string[];
  fusionner: string[];
  annuler: string[];
} {
  const suivie = `refs/remotes/${cible.distant}/${cible.branche}`;
  return {
    recuperer: ['fetch', cible.distant, `+refs/heads/${cible.branche}:${suivie}`],
    fusionner: ['merge', '--no-edit', suivie],
    annuler: ['merge', '--abort'],
  };
}
