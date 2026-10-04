/**
 * LE RATTRAPAGE DES COMPÉTENCES — ce que chaque projet a déjà appris sans l'écrire.
 *
 * Décision de l'utilisateur (2026-10-02) : chaque projet apprend de son propre
 * travail — interface, fonctionnement, structure, technologies — et la fiche
 * s'écrit dès la fin d'une carte (consigne du rôle de tâche,
 * `server/src/runtime.ts`). Ce qui a été fait AVANT cette règle n'a laissé
 * aucune fiche : environ 2 400 cartes terminées sur 24 projets. Le rattrapage
 * pose UNE carte par projet actif, et toutes partent ensemble — un agent par
 * projet, l'ordonnanceur les échelonne selon la place et le quota.
 *
 * Rien ici ne touche la base : le démon relève les projets et leurs cartes
 * (`server/src/rattrapage-competences.ts`), ces règles décident et rédigent.
 */

/** Le titre de la carte posée dans chaque projet. */
export const TITRE_RATTRAPAGE = 'Rattrapage des compétences';

/** L'étiquette qui reconnaît une carte de rattrapage — et empêche d'en poser deux. */
export const LABEL_RATTRAPAGE = 'rattrapage-competences';

/** Les colonnes où une carte compte comme du travail FAIT, donc à relire. */
export const COLONNES_DU_TRAVAIL_FAIT = ['done', 'deploy', 'archived', 'report'] as const;

/** Au-delà, l'agent lit les cartes par lots plutôt que d'un bloc : son contexte n'est pas sans fond. */
export const CARTES_PAR_LOT = 150;

/** Ce que le démon sait d'un projet candidat. */
export interface ProjetCandidat {
  id: string;
  nom: string;
  archive?: boolean;
  regroupement?: boolean;
  /** Les cartes terminées du projet (colonnes `COLONNES_DU_TRAVAIL_FAIT`). */
  cartesFaites: number;
  /** Une carte de rattrapage y attend ou y travaille déjà. */
  rattrapageOuvert?: boolean;
}

export interface ChoixDuRattrapage {
  retenus: ProjetCandidat[];
  ecartes: { projet: ProjetCandidat; raison: string }[];
}

/**
 * QUELS PROJETS REÇOIVENT LEUR CARTE. Tous les projets actifs, sauf trois cas,
 * chacun DIT : un projet mis de côté, un regroupement (il n'a pas de dépôt à
 * lui — ses membres reçoivent chacun leur carte), et un projet qui n'a encore
 * rien terminé (rien à relire). Un projet qui a déjà sa carte de rattrapage
 * ouverte n'en reçoit pas une seconde : deux clics ne doublent pas le travail.
 */
export function projetsDuRattrapage(projets: readonly ProjetCandidat[]): ChoixDuRattrapage {
  const retenus: ProjetCandidat[] = [];
  const ecartes: ChoixDuRattrapage['ecartes'] = [];
  for (const projet of projets) {
    if (projet.archive) ecartes.push({ projet, raison: 'mis de côté' });
    else if (projet.regroupement) ecartes.push({ projet, raison: 'regroupement : ses projets reçoivent chacun leur carte' });
    else if (projet.rattrapageOuvert) ecartes.push({ projet, raison: 'une carte de rattrapage y est déjà ouverte' });
    else if (projet.cartesFaites <= 0) ecartes.push({ projet, raison: 'aucune carte terminée à relire' });
    else retenus.push(projet);
  }
  return { retenus, ecartes };
}

/** La phrase courte posée en description de la carte, lisible par l'utilisateur. */
export function descriptionDuRattrapage(projet: { nom: string; cartesFaites: number }): string {
  return (
    `Relire les ${projet.cartesFaites} carte(s) déjà terminées de « ${projet.nom} » et écrire les compétences qu'elles ` +
    `ont apprises sans les noter : l'interface d'abord, puis le fonctionnement, la structure et les technologies. ` +
    `Aucun code ne change.`
  );
}

/**
 * LA DEMANDE DE L'AGENT DE RATTRAPAGE. Il travaille dans SON projet, en accès
 * complet, mais sa seule sortie est l'outil « competences » : il ne modifie
 * aucun code. Elle lui donne de quoi relire SANS passer par l'écran — la base
 * en lecture seule, le compte rendu de chaque carte, le changelog, le dépôt —
 * et l'ordre de priorité voulu par l'utilisateur : l'interface d'abord.
 */
export function consigneDeRattrapage(entree: {
  projet: { id: string; nom: string; chemin?: string; cartesFaites: number };
  /** Le fichier de la base du démon, à ouvrir en LECTURE SEULE. */
  base: string;
}): string {
  const { projet, base } = entree;
  const colonnes = COLONNES_DU_TRAVAIL_FAIT.map((c) => `'${c}'`).join(', ');
  const requete =
    `SELECT id, title, description, json_extract(data,'$.closureDoc') AS compte_rendu, ` +
    `datetime(COALESCE(done_at, updated_at)/1000, 'unixepoch') AS fini FROM cards ` +
    `WHERE project_id='${projet.id}' AND column_key IN (${colonnes}) ORDER BY COALESCE(done_at, updated_at)`;
  const parLots =
    projet.cartesFaites > CARTES_PAR_LOT
      ? ` ${projet.cartesFaites} cartes, c'est trop pour un seul bloc : lis-les par lots de ${CARTES_PAR_LOT} (« LIMIT ${CARTES_PAR_LOT} OFFSET … »), ` +
        `note les sujets au fil des lots dans le « brouillon » de la carte (outil « memoire », geste « brouillon »), et n'ouvre ` +
        `les comptes rendus que des cartes du sujet que tu rédiges.`
      : '';
  return [
    `TU RATTRAPES LES COMPÉTENCES DU PROJET « ${projet.nom} » : tout ce que son travail passé a appris sans l'écrire. ` +
      `Le but : la prochaine fois qu'on demandera ici un composant, un écran ou un mécanisme déjà fait, l'agent saura d'emblée ` +
      `TOUT ce qui a été réalisé avant — chaque fonctionnalité, chaque choix tranché, chaque piège déjà payé.`,
    `1. RELIS CE QUI A ÉTÉ FAIT — ${projet.cartesFaites} carte(s) terminée(s). La base du démon, en LECTURE SEULE ` +
      `(jamais d'écriture) : sqlite3 -readonly ${base} "${requete}". Le compte rendu de chaque carte est le fichier ` +
      `nommé dans « compte_rendu » (quand il existe). Lis aussi le changelog du projet (outil « memoire », geste « lire », ` +
      `fiche « changelog »), l'histoire du dépôt (git log)${projet.chemin ? ` dans ${projet.chemin}` : ''}, sa structure et ` +
      `ses fichiers de dépendances (package.json, composer.json…).${parLots}`,
    `2. REGROUPE PAR SUJET, DANS CET ORDRE : d'abord l'INTERFACE — chaque écran ou composant qui revient (barre de ` +
      `sélection, tableau, formulaire, navigation, filtre, fenêtre…) et l'expérience qu'il offre ; puis le FONCTIONNEMENT ` +
      `(chaque mécanique, chaque enchaînement) ; puis la STRUCTURE du projet (où vit quoi, comment on lance, comment on ` +
      `vérifie, comment on met en ligne) ; puis les TECHNOLOGIES et leurs pièges.`,
    `3. ÉCRIS UNE FICHE PAR SUJET QUI COMPTE — un sujet revenu sur plusieurs cartes, ou un composant central. Outil ` +
      `« competences », action « ecrire », « projets » = « ${projet.nom} », « carte » = l'identifiant de la carte qui ` +
      `l'a le plus marqué. Pour un composant d'interface, la fiche est l'INVENTAIRE de tout ce qu'il sait faire et de ` +
      `chaque choix tranché, avec les cartes qui l'ont apporté en preuve — de quoi le refaire ou l'étendre sans rien ` +
      `perdre. Une fiche « structure et technologies » résume le projet pour qui le découvre. AVANT d'écrire, regarde ` +
      `le pool (« competences », action « lister ») : une fiche qui existe déjà se COMPLÈTE sous son nom — relis-la puis ` +
      `réécris-la ENTIÈRE, l'écriture remplace son texte. Une leçon qui vaut AUSSI hors de ce projet (une bibliothèque, ` +
      `un service, une façon de faire qui ne dépend pas de ce code) donne EN PLUS une fiche commune, « projets » laissé ` +
      `vide, sans rien de propre à « ${projet.nom} ».`,
    `4. TU NE TOUCHES À AUCUN CODE et tu n'enregistres rien dans le dépôt : ta seule sortie est l'outil « competences ». ` +
      `Une fiche refusée te dit pourquoi (section « Vérification » manquante, description qui ne dit pas QUAND s'en ` +
      `servir) : corrige-la et réécris-la. Termine par la liste des fiches créées et complétées, une ligne chacune.`,
  ].join('\n\n');
}
