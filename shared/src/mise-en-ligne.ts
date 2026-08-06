/**
 * Déployer, c'est RAFRAÎCHIR L'INSTANCE DE DEV — pas seulement fusionner.
 *
 * La publication DEVINAIT comment mettre en ligne par cinq chemins successifs :
 * une consigne écrite, une commande de publication, HaikoDev lui-même, le
 * service système, le dossier servi. Aucun des cinq, et elle refusait : il
 * fallait donc régler un environnement pour qu'un projet puisse seulement
 * partir. Le déploiement est maintenant UNE seule chose, toujours disponible et
 * sans réglage : fusionner, enregistrer, envoyer sur le dépôt, puis rafraîchir
 * l'instance de dev du projet sur ce serveur.
 *
 * Cette règle dit COMMENT ce rafraîchissement se fait, à partir de ce qu'on
 * CONSTATE sur la machine — jamais à partir d'un réglage. Règle pure : aucune
 * base, aucun disque, donc rejouable.
 */

/** Ce qu'on a constaté sur la machine à propos de ce projet. */
export type MoyensDeMiseEnLigne = {
  /** Le projet est HaikoDev : il sait se construire et s'installer lui-même. */
  estHaikoDev?: boolean;
  /** Le projet a un script `build` dans son package.json. */
  scriptBuild?: boolean;
  /** Nom du service système qui fait tourner ce dossier, s'il y en a un. */
  service?: string;
  /** Un serveur web sert ce dossier TEL QUEL (site statique). */
  dossierServi?: boolean;
};

export type Construction = 'npm' | 'aucune';
export type Installation = 'haikodev' | 'service' | 'dossier-servi' | 'aucune';
export type Redemarrage = 'demon' | 'service' | 'aucun';

export type PlanDeMiseEnLigne = {
  construction: Construction;
  installation: Installation;
  redemarrage: Redemarrage;
  /** Une phrase pour le compte rendu : ce qui va être fait, en français. */
  raison: string;
};

/**
 * Comment l'instance de dev de ce projet se rafraîchit-elle sur ce serveur ?
 *
 * Trois cas, tous CONSTATÉS, aucun réglé :
 * 1. HaikoDev : construction, installation dans le dossier servi, redémarrage ;
 * 2. un service système sur le dossier : construire s'il y a de quoi, puis
 *    relancer le service — c'est lui qui sert le code neuf ;
 * 3. un dossier servi tel quel par un serveur web : les fichiers en place SONT
 *    le site, il n'y a rien à déplacer ni à relancer.
 *
 * Aucun des trois n'est plus un refus : le lot est quand même fusionné,
 * enregistré et envoyé sur le dépôt — ce qui est du travail réel — et le plan le
 * DIT plutôt que d'éteindre le bouton. Rien n'est simplement relancé ici.
 */
export function planDeMiseEnLigne(moyens: MoyensDeMiseEnLigne): PlanDeMiseEnLigne {
  const construction: Construction = moyens.scriptBuild ? 'npm' : 'aucune';

  if (moyens.estHaikoDev) {
    return {
      construction: 'npm',
      installation: 'haikodev',
      redemarrage: 'demon',
      raison: 'HaikoDev se construit, installe son interface dans le dossier servi et redémarre son serveur.',
    };
  }

  if (moyens.service) {
    return {
      construction,
      installation: 'service',
      redemarrage: 'service',
      raison: `Le service ${moyens.service} fait tourner ce dossier : ${
        construction === 'npm' ? 'construction puis relance' : 'relance'
      } du service, c'est elle qui met le code neuf en ligne.`,
    };
  }

  if (moyens.dossierServi) {
    return {
      construction,
      installation: 'dossier-servi',
      redemarrage: 'aucun',
      raison:
        'Un serveur web sert ce dossier tel quel : les fichiers en place sont la version en ligne, il n’y a rien à déplacer ni à relancer.',
    };
  }

  return {
    construction,
    installation: 'aucune',
    redemarrage: 'aucun',
    raison:
      construction === 'npm'
        ? 'Aucune instance de dev n’a été trouvée sur ce serveur pour ce projet : le lot est fusionné, construit, enregistré et envoyé sur le dépôt, mais il n’y a rien à relancer ici.'
        : 'Aucune instance de dev n’a été trouvée sur ce serveur pour ce projet : le lot est fusionné, enregistré et envoyé sur le dépôt, mais il n’y a rien à construire ni à relancer ici.',
  };
}

/** L'état d'une étape de publication, tel que le tableau de bord l'affiche. */
export type EtatEtape = 'todo' | 'running' | 'done' | 'failed' | 'skipped';

/**
 * Quelque chose a-t-il RÉELLEMENT eu lieu ?
 *
 * Le verdict final ne se lit pas sur l'absence d'erreur mais sur au moins une
 * étape menée à son terme. Sept étapes « ignorées » ne font pas un déploiement,
 * même quand rien n'a planté — un projet sans dépôt git et sans instance de dev
 * doit le dire, pas faire avancer ses cartes.
 *
 * La fusion, l'enregistrement et l'envoi comptent désormais : déployer, c'est
 * d'abord porter le lot sur la branche principale et le mettre à l'abri sur le
 * dépôt. Un projet sans instance sur ce serveur a donc quand même déployé.
 */
export function miseEnLigneReelle(etapes: {
  merge?: EtatEtape;
  commit?: EtatEtape;
  push?: EtatEtape;
  build: EtatEtape;
  publish: EtatEtape;
  restart: EtatEtape;
}): boolean {
  return Object.values(etapes).some((etat) => etat === 'done');
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
