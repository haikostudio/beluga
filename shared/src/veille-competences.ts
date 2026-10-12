/**
 * LA VEILLE DES SOURCES DE COMPÉTENCES : une fois par semaine, de nuit.
 *
 * Des collections de compétences circulent sur GitHub et sur le web. Un agent
 * d'ANALYSE les cherche, LIT leur contenu, les compare au pool et ne propose que
 * celles qui valent d'être importées. Comme l'auto-amélioration (voir
 * `auto-amelioration.ts`, dont elle reprend la mécanique), elle ne modifie rien :
 * chaque source retenue devient une carte « À planifier », et l'import — qui
 * sert ensuite TOUS les projets — reste le geste de la carte acceptée.
 *
 * X n'est jamais exploré : la connexion automatisée y est refusée et menace le
 * compte. Un nom ou un lien vu là-bas se donne à la main à un agent, qui le
 * vérifie à la source (`CRITERES_DE_SOURCE`).
 *
 * Les règles vivent ici, sans base ni disque, et se testent seules.
 */

/** L'étiquette de chaque carte posée par la veille. */
export const LABEL_VEILLE_COMPETENCES = 'veille compétences';

/** Le jour du passage : le dimanche (`Date.getDay()`), la nuit la plus calme. */
export const JOUR_DE_LA_VEILLE = 0;

/**
 * Heure de départ : 1 h, avant l'auto-amélioration de 3 h. Une fenêtre de deux
 * heures : 1 h et 2 h. Une fois l'attente d'une place engagée, elle ne bloque plus.
 */
export const HEURE_DE_LA_VEILLE = 1;
export const FENETRE_DE_LA_VEILLE_HEURES = 2;

/** Un passage par semaine : six jours d'écart au moins, pour qu'un passage tardif ne saute pas le suivant. */
export const PERIODE_DE_LA_VEILLE_MS = 6 * 24 * 60 * 60 * 1000;

/** Quatre sources au plus par passage : chaque carte reçoit un cadrage, et rien n'est gratuit. */
export const SOURCES_MAX_PAR_PASSAGE = 4;

/** La mémoire des sources déjà examinées : plafonnée, les plus anciennes tombent. */
export const SOURCES_VUES_MAX = 400;

/** Combien de noms de fiches du pool sont dits à l'agent (le reste se cherche avec « memoire »). */
export const FICHES_DU_POOL_MAX = 150;

export type RaisonDeSauterLaVeille = 'projet-absent' | 'deja-passee' | 'pas-l-heure' | 'travail-en-cours';

export type DecisionDeLaVeille = { lancer: true } | { lancer: false; raison: RaisonDeSauterLaVeille };

/** Cette heure, ce jour-là, tombe-t-elle dans la fenêtre de la veille ? */
export function creneauDeLaVeille(jour: number, heure: number): boolean {
  for (let pas = 0; pas < FENETRE_DE_LA_VEILLE_HEURES; pas += 1) {
    if (jour === JOUR_DE_LA_VEILLE && heure === HEURE_DE_LA_VEILLE + pas) return true;
  }
  return false;
}

/**
 * La veille part-elle maintenant ? Même ordre de refus que le rendez-vous de
 * nuit : le projet, la périodicité, le créneau (sauf attente déjà engagée),
 * puis la place — seul refus qui se rejoue. `autreRendezVousEnCours` garde un
 * seul agent de nuit à la fois (l'auto-amélioration passe d'abord).
 */
export function decisionDeLaVeille(input: {
  projetPresent: boolean;
  dernierPassage?: number;
  maintenant: number;
  jourCourant: number;
  heureCourante: number;
  placeLibre: boolean;
  autreRendezVousEnCours: boolean;
  enAttenteDepuis?: number;
  attenteMaxMs: number;
}): DecisionDeLaVeille {
  if (!input.projetPresent) return { lancer: false, raison: 'projet-absent' };
  if (input.dernierPassage !== undefined && input.maintenant - input.dernierPassage < PERIODE_DE_LA_VEILLE_MS) {
    return { lancer: false, raison: 'deja-passee' };
  }
  const dejaEnAttente = input.enAttenteDepuis !== undefined && input.maintenant - input.enAttenteDepuis < input.attenteMaxMs;
  if (!dejaEnAttente && !creneauDeLaVeille(input.jourCourant, input.heureCourante)) {
    return { lancer: false, raison: 'pas-l-heure' };
  }
  if (!input.placeLibre || input.autreRendezVousEnCours) return { lancer: false, raison: 'travail-en-cours' };
  return { lancer: true };
}

export function raisonDeLaVeilleDite(raison: RaisonDeSauterLaVeille): string {
  switch (raison) {
    case 'projet-absent':
      return 'aucun projet pour porter la veille';
    case 'deja-passee':
      return 'la veille de cette semaine a déjà eu lieu';
    case 'pas-l-heure':
      return 'ce n’est pas le créneau (dimanche, vers 1 h)';
    case 'travail-en-cours':
      return 'aucune place libre, la veille attend';
  }
}

/** Le titre de la conversation du passage, daté. */
export function titreDeLaVeille(date: Date): string {
  const jour = date.toLocaleDateString('fr-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `Veille des compétences — semaine du ${jour}`;
}

export function descriptionDeLaVeille(): string {
  return (
    'Un agent d’analyse cherche sur GitHub et sur le web de nouvelles sources de compétences, lit leur contenu et les compare au pool. ' +
    `Il ne modifie ni n’importe rien : chaque source retenue devient une carte à part, dans « Planifié », étiquetée « ${LABEL_VEILLE_COMPETENCES} ».` +
    '\n\nCette carte suit le tour lui-même : sa conversation montre ce que l’agent a lu et écarté, et une panne s’y dit en clair.'
  );
}

export function rapportDeLaVeille(titres: readonly string[]): string {
  if (!titres.length) return 'Veille tenue : aucune source assez pertinente cette semaine.';
  return `Veille tenue : ${titres.length} source(s) proposée(s) dans « Planifié » — ${titres.map((t) => `« ${t} »`).join(', ')}.`;
}

/* ------------------------------------------------------------------ */
/* LA MÉMOIRE DES SOURCES DÉJÀ EXAMINÉES                                */
/* ------------------------------------------------------------------ */

/**
 * Les dépôts GitHub nommés dans un texte, ramenés à « github.com/proprio/depot »
 * en minuscules — une forme unique pour comparer. Les sous-chemins, les `.git`
 * finaux et la ponctuation de fin sont retirés.
 */
export function sourcesCitees(texte: string): string[] {
  const trouvees = new Set<string>();
  const motif = /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/g;
  for (const m of texte.matchAll(motif)) {
    const depot = m[2]!.replace(/\.git$/i, '').replace(/[.]+$/, '');
    if (!depot) continue;
    trouvees.add(`github.com/${m[1]!.toLowerCase()}/${depot.toLowerCase()}`);
  }
  return [...trouvees];
}

/** Ajoute les nouvelles sources à la mémoire, sans doublon, en gardant les plus récentes sous le plafond. */
export function fusionnerSourcesVues(anciennes: readonly string[], nouvelles: readonly string[]): string[] {
  const sans = anciennes.filter((s) => !nouvelles.includes(s));
  return [...sans, ...nouvelles].slice(-SOURCES_VUES_MAX);
}

/* ------------------------------------------------------------------ */
/* LA CONSIGNE                                                          */
/* ------------------------------------------------------------------ */

/** Ce qui fait qu'une source vaut une carte. Une liste ici : la consigne l'affiche, un test la vérifie. */
export const CRITERES_DE_SOURCE = [
  'elle contient de VRAIES compétences (un dossier par compétence avec un SKILL.md), pas une simple liste de liens ni un dépôt d’exemples',
  'tu as OUVERT et LU plusieurs fiches : elles donnent un mode d’emploi précis (quand l’utiliser, quoi faire, quoi éviter), pas des généralités',
  'ce qu’elle apporte manque au pool : un sujet que les fiches existantes ne couvrent pas, ou une méthode nettement meilleure',
  'elle est vivante et sérieuse : modifiée récemment, un propriétaire identifiable, une licence qui permet de la réutiliser',
  'rien de dangereux : aucune fiche qui télécharge et lance du code distant, désactive une protection ou demande des identifiants',
] as const;

export interface EntreesDeLaConsigneDeVeille {
  /** Noms de fiches du pool (maison et importées), plafonnés. */
  fichesDuPool: readonly string[];
  /** Adresses des bibliothèques DÉJÀ importées. */
  bibliothequesImportees: readonly string[];
  /** Sources déjà examinées lors des passages précédents (proposées, écartées ou importées). */
  sourcesVues: readonly string[];
}

export function consigneDeVeilleDeCompetences(entrees: EntreesDeLaConsigneDeVeille): string {
  const pool = entrees.fichesDuPool.slice(0, FICHES_DU_POOL_MAX);
  const plus = entrees.fichesDuPool.length - pool.length;
  const importees = entrees.bibliothequesImportees.length
    ? entrees.bibliothequesImportees.map((a) => `- ${a}`).join('\n')
    : '- (aucune)';
  const vues = entrees.sourcesVues.length ? entrees.sourcesVues.map((a) => `- ${a}`).join('\n') : '- (aucune)';
  return `VEILLE DES SOURCES DE COMPÉTENCES.

C'est la nuit, personne ne t'attend. Ton travail : trouver sur GITHUB et sur le WEB des collections de compétences d'agent (dossiers avec un SKILL.md) qui méritent d'entrer dans le pool de Beluga Build, où elles serviront ensuite à tous les projets. Tu cherches avec « gh » (gh search repos, gh api, gh repo view) et avec la recherche web : « agent skills », « SKILL.md », « claude code skills », « codex skills », listes « awesome », collections d'éditeurs et de communautés.

N'EXPLORE PAS X : la connexion automatisée y est refusée et menace le compte. Si une page web cite un fil de X, tu ne suis que les liens qui mènent à un dépôt ou à un site.

POUR CHAQUE SOURCE CANDIDATE, tu LIS son contenu réel — pas seulement son README ni son nombre d'étoiles — et tu ne la retiens que si TOUT ceci est vrai :
${CRITERES_DE_SOURCE.map((c) => `- ${c}`).join('\n')}

CE QUI EST DÉJÀ CHEZ NOUS — ne le reproposer sous aucune forme.
Bibliothèques déjà importées :
${importees}
Sources déjà examinées lors des semaines passées :
${vues}
Fiches du pool (${entrees.fichesDuPool.length}) : ${pool.join(', ') || '(vide)'}${plus > 0 ? `, et ${plus} autres — cherche-les avec l'outil « memoire », geste « chercher »` : ''}.

TU NE MODIFIES ET N'IMPORTES RIEN. Aucun fichier écrit dans le pool, aucune commande « importer ». Tu lis, tu compares, tu proposes. Les dépôts que tu clones pour les lire vont dans un dossier temporaire, que tu supprimes ensuite.

CHAQUE SOURCE RETENUE DEVIENT UNE PROPOSITION avec l'outil « propose_task », étiquetée « ${LABEL_VEILLE_COMPETENCES} ». Beluga Build la pose lui-même dans « Planifié » dès ton tour fini ; le LANCEMENT — donc l'import — reste un geste de l'utilisateur. Chaque proposition porte :
- un titre qui nomme la source (« Importer les compétences de <dépôt> ») ;
- la description : l'adresse complète du dépôt (https://github.com/proprio/depot) et le sous-dossier à importer s'il y en a un, ce que l'import ferait (« outil « competences », action « importer » ») ;
- le champ « contexte », ta SYNTHÈSE d'analyse : d'où ça vient, ce que tu as lu (les fiches ouvertes, par nom), ce que ça apporte que le pool n'a pas, ce qui recoupe l'existant, la licence, la date de la dernière modification, les réserves ;
- le champ « intro » : deux phrases simples, sans jargon, pour un lecteur non technique.

${SOURCES_MAX_PAR_PASSAGE} SOURCES AU PLUS, ET SEULEMENT CE QUI A UNE VRAIE VALEUR. C'est un plafond, pas un objectif : une semaine sans rien de pertinent est une semaine normale, tu le dis en une ligne. Dans le doute, tu n'en proposes pas.

TA RÉPONSE FINALE tient en quelques lignes : ce que tu as examiné, ce que tu as retenu, ce que tu as écarté et pourquoi. NOMME CHAQUE SOURCE EXAMINÉE par son adresse complète (https://github.com/proprio/depot), retenue ou non : c'est ainsi que la veille de la semaine suivante saura ne pas la rouvrir.`;
}

/**
 * La demande de cadrage de la carte d'une source proposée. Même déroulé que
 * pour une carte de l'auto-amélioration — personne devant l'écran, aucune
 * question avec « ask_user », jamais de plan — mais le sujet est un import.
 */
export function demandeDeCadrageDeLaVeille(
  carte: { title: string; description?: string; briefing?: string },
  nomDuProjet: string,
): string {
  const description = String(carte.description ?? '').trim();
  const analyse = String(carte.briefing ?? '').trim();
  return `CETTE DEMANDE VIENT DE LA VEILLE HEBDOMADAIRE DES SOURCES DE COMPÉTENCES, pas d'une personne au clavier. Un agent d'analyse a cherché sur GitHub et le web pour ${nomDuProjet} et a posé cette carte : c'est SA trouvaille que tu cadres maintenant.

TITRE POSÉ PAR LA VEILLE : ${carte.title}
${description ? `\nCE QUI EST PROPOSÉ :\n${description}\n` : ''}${analyse ? `\nCE QUE L'AGENT A ANALYSÉ :\n${analyse}\n` : ''}
DÉROULE TON PROCESSUS HABITUEL DE CADRAGE : garde le titre s'il dit juste le besoin, ouvre la mémoire des sujets touchés (compétences, bibliothèques importées), écris la carte en entier (description et niveau), puis RENDS CE QUE TU AS COMPRIS avec « rendre_comprehension » — ET ARRÊTE-TOI LÀ. N'appelle jamais « rendre_plan ».

VÉRIFIE L'ANALYSE avant de la reprendre : ouvre toi-même le dépôt et quelques fiches, confirme qu'il s'agit bien de compétences, que le recoupement avec le pool est exact (« memoire », geste « chercher »), et que la licence permet l'import. N'importe RIEN toi-même : l'import est la tâche que l'utilisateur lancera.

NE POSE AUCUNE QUESTION AVEC « ask_user » : personne n'est devant l'écran. Ce que seul l'utilisateur peut trancher (importer tout le dépôt ou un sous-dossier, garder ou écarter une partie) se PRÉPARE dans le champ « questions » de « rendre_comprehension », avec la réponse que tu conseilles. « hypotheses » reste vide.`;
}
