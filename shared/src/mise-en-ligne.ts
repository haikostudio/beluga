/**
 * Publier, c'est METTRE EN LIGNE — pas seulement fusionner.
 *
 * La publication savait mettre en ligne dans deux cas seulement : le projet
 * avait une commande de publication, ou c'était HaikoDev lui-même. Pour tout
 * autre projet, elle fusionnait, enregistrait, envoyait sur le dépôt… puis
 * annonçait « Publication terminée » sans avoir rien mis en ligne. Les cartes
 * étaient archivées comme déployées et la carte suivante reproposait de tout
 * publier : le tableau mentait (constaté le 04/08/2026 sur le projet Root,
 * dont les sept étapes étaient toutes « ignorées » pour un résultat « réussi »).
 *
 * Cette règle décide, AVANT de toucher à quoi que ce soit, comment le projet
 * peut être mis en ligne — et refuse la publication quand la réponse est
 * « d'aucune façon ». Règle pure : aucune base, aucun disque, donc rejouable.
 */

/** Ce dont le projet dispose réellement pour être mis en ligne. */
export type MoyensDeMiseEnLigne = {
  /** Commande de publication renseignée dans les réglages du projet. */
  commande?: string;
  /** Le projet est HaikoDev : il sait se construire et s'installer lui-même. */
  estHaikoDev?: boolean;
  /** Le projet a un script `build` dans son package.json. */
  scriptBuild?: boolean;
  /** Nom du service système qui fait tourner ce dossier, s'il y en a un. */
  service?: string;
  /** Un serveur web sert ce dossier TEL QUEL (site statique). */
  dossierServi?: boolean;
  /**
   * Le NOM de l'environnement visé (« Production », « Dev client »…), quand le
   * projet en a plusieurs. Il ne change RIEN au choix du plan : il sert à ce
   * qu'un refus dise DE QUEL environnement il parle — « la production n'a aucun
   * moyen d'être mise en ligne » n'est pas la même phrase que « ce projet ».
   */
  environnement?: string;
};

export type Construction = 'commande' | 'npm' | 'aucune';
export type Installation = 'commande' | 'haikodev' | 'dossier-servi' | 'service' | 'aucune';
export type Redemarrage = 'demon' | 'service' | 'commande' | 'aucun';

export type PlanDeMiseEnLigne = {
  /** Faux : ce projet ne peut PAS être mis en ligne, la publication doit refuser. */
  possible: boolean;
  construction: Construction;
  installation: Installation;
  redemarrage: Redemarrage;
  /** Une phrase pour le compte rendu : ce qui va être fait, ou ce qui manque. */
  raison: string;
  /** Le nom de l'environnement jugé, quand il y en avait un. */
  environnement?: string;
};

/**
 * Comment ce projet peut-il être mis en ligne ?
 *
 * Quatre chemins, du plus explicite au plus deviné :
 * 1. une commande de publication : elle fait foi, elle porte tout ;
 * 2. HaikoDev : construction, installation dans le dossier servi, redémarrage ;
 * 3. un service système sur le dossier : construire puis relancer le service,
 *    c'est lui qui sert le code neuf ;
 * 4. un dossier servi tel quel par un serveur web : les fichiers en place SONT
 *    le site, il n'y a rien à déplacer — mais il y a bien mise en ligne.
 *
 * Aucun des quatre : la publication n'a aucun moyen d'agir. Elle échoue en le
 * disant, plutôt que de se déclarer réussie sans rien avoir fait.
 */
export function planDeMiseEnLigne(moyens: MoyensDeMiseEnLigne): PlanDeMiseEnLigne {
  const environnement = moyens.environnement?.trim() || undefined;
  const plan = planSansEnvironnement(moyens);
  return environnement ? { ...plan, environnement } : plan;
}

function planSansEnvironnement(moyens: MoyensDeMiseEnLigne): PlanDeMiseEnLigne {
  const commande = moyens.commande?.trim();
  if (commande) {
    return {
      possible: true,
      construction: 'commande',
      installation: 'commande',
      redemarrage: 'commande',
      raison: 'La commande de publication du projet porte la mise en ligne de bout en bout.',
    };
  }

  if (moyens.estHaikoDev) {
    return {
      possible: true,
      construction: 'npm',
      installation: 'haikodev',
      redemarrage: 'demon',
      raison: 'HaikoDev se construit, installe son interface dans le dossier servi et redémarre son serveur.',
    };
  }

  if (moyens.service) {
    return {
      possible: true,
      construction: moyens.scriptBuild ? 'npm' : 'aucune',
      installation: 'service',
      redemarrage: 'service',
      raison: `Le service ${moyens.service} fait tourner ce dossier : ${
        moyens.scriptBuild ? 'construction puis relance' : 'relance'
      } du service, c'est elle qui met le code neuf en ligne.`,
    };
  }

  if (moyens.dossierServi) {
    return {
      possible: true,
      construction: moyens.scriptBuild ? 'npm' : 'aucune',
      installation: 'dossier-servi',
      redemarrage: 'aucun',
      raison:
        'Un serveur web sert ce dossier tel quel : les fichiers en place sont la version en ligne, il n’y a rien à déplacer ni à relancer.',
    };
  }

  /*
   * Aucun des quatre chemins. Le refus NOMME l'environnement visé quand il y en
   * a un : avec plusieurs environnements, « ce projet n'a aucun moyen » ne dit
   * pas lequel il faut aller régler.
   */
  const nomme = moyens.environnement?.trim();
  return {
    possible: false,
    construction: 'aucune',
    installation: 'aucune',
    redemarrage: 'aucun',
    raison: nomme
      ? `L’environnement « ${nomme} » n’a aucun moyen d’être mis en ligne : pas de commande de publication, aucun service système sur le dossier du projet, et ce dossier n’est servi par aucun serveur web. Renseignez la commande de publication de cet environnement dans les réglages du projet — sans elle, publier ne ferait que fusionner du code.`
      : 'Ce projet n’a aucun moyen d’être mis en ligne : pas de commande de publication, aucun service système sur son dossier, et son dossier n’est servi par aucun serveur web. Renseignez la commande de publication dans les réglages du projet — sans elle, publier ne ferait que fusionner du code.',
  };
}

/** L'état d'une étape de publication, tel que le tableau de bord l'affiche. */
export type EtatEtape = 'todo' | 'running' | 'done' | 'failed' | 'skipped';

/**
 * Quelque chose est-il RÉELLEMENT parti en ligne ?
 *
 * Le verdict final ne se lit pas sur l'absence d'erreur mais sur au moins une
 * étape de mise en ligne menée à son terme. Sept étapes « ignorées » ne font
 * pas une publication, même quand rien n'a planté.
 */
export function miseEnLigneReelle(etapes: {
  build: EtatEtape;
  publish: EtatEtape;
  restart: EtatEtape;
}): boolean {
  return etapes.publish === 'done' || etapes.restart === 'done' || etapes.build === 'done';
}

/**
 * Le MESSAGE court d'une publication qui tombe.
 *
 * Le message brut recopiait l'exception (« La construction a échoué : rien
 * n'est mis en ligne. ») sans nommer le PROJET, l'étape tombée, ni où lire le
 * détail. On rend une phrase qui dit les trois : de quel projet il s'agit, à
 * quelle étape la publication s'est arrêtée, et où regarder ensuite.
 *
 * Règle pure : l'appelant a déjà résolu le LIBELLÉ de l'étape (« Construction »,
 * « Vérification du code »…) ; celui-ci reste ignorant des clés du serveur.
 *
 * @param projet le nom du projet, quand il est connu.
 * @param etape  le libellé de l'étape tombée, quand une étape précise a échoué.
 * @param raison le message d'erreur, déjà en français.
 */
export function messageEchecPublication(input: {
  projet?: string;
  etape?: string;
  raison: string;
}): string {
  const quoi = input.projet?.trim() ? `Publication de « ${input.projet.trim()} »` : 'Publication';
  const ou = input.etape?.trim() ? ` à l’étape « ${input.etape.trim()} »` : '';
  const raison = input.raison?.trim() || 'raison inconnue';
  return `${quoi} interrompue${ou} : ${raison} — voir le détail dans le bloc de publication du projet.`;
}
