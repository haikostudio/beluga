/**
 * TRADUIRE UN REFUS DU BAC À SABLE EN PHRASE CLAIRE.
 *
 * Le chef d'orchestre travaille dans un bac à sable (`bwrap`) : son dossier de
 * travail est écrivable, le PROJET est monté en lecture seule, et l'élévation
 * de privilèges y est coupée. C'est la frontière voulue
 * (`shared/src/bridage-chef.ts`), pas un droit oublié.
 *
 * Le problème n'était donc pas la frontière, mais ce que l'utilisateur en
 * LISAIT. Une commande qui tentait d'écrire dans le projet rendait un message
 * système brut — « EROFS: read-only file system », « Read-only file system »,
 * « sudo: … no new privileges » — que le chef reprenait à son compte en
 * annonçant « je n'ai pas les droits ». Un utilisateur qui a tout accordé lit
 * alors un refus d'autorisation là où il n'y en a aucune, et ne sait pas quoi
 * faire ensuite (11/08/2026).
 *
 * Ces règles sont PURES : elles reconnaissent la nature d'un refus dans la
 * sortie d'une commande et rendent la phrase à afficher, avec la ROUTE à
 * prendre. Aucune base, aucun disque — donc rejouables seules.
 */

/** Ce qui a réellement bloqué, quand quelque chose a bloqué. */
export type NatureDuRefus =
  /** Une écriture dans le projet, monté en lecture seule pour le chef. */
  | 'projet-en-lecture-seule'
  /** Une écriture AILLEURS que dans le dossier de travail (dossier système…). */
  | 'ecriture-hors-espace'
  /** Une commande qui réclame l'administration de la machine (`sudo`). */
  | 'administration-refusee'
  /** Le bac à sable lui-même n'a pas pu démarrer : VRAIE panne du serveur. */
  | 'bac-a-sable-absent';

/**
 * Les empreintes d'un refus, du plus précis au plus général. L'ordre compte :
 * un bac à sable qui ne démarre pas se plaint AUSSI de permissions, et serait
 * sinon confondu avec une écriture refusée.
 */
const EMPREINTES: Array<{ nature: NatureDuRefus; motif: RegExp }> = [
  // `bwrap` qui échoue : aucune commande du chef ne peut tourner.
  { nature: 'bac-a-sable-absent', motif: /^\s*bwrap:.*(permission denied|not permitted|no permissions)/im },
  { nature: 'bac-a-sable-absent', motif: /(clone|unshare)\s*\(.*\)\s*failed.*(permission|not permitted)/i },
  // L'élévation de privilèges, coupée dans le bac à sable.
  { nature: 'administration-refusee', motif: /^\s*sudo:.*(no new privileges|sudo\.conf is owned|must be owned by uid|no tty|askpass|a password is required|not allowed)/im },
  { nature: 'administration-refusee', motif: /interactive authentication required/i },
  // Une écriture refusée dans un dossier monté en lecture seule.
  { nature: 'projet-en-lecture-seule', motif: /\bEROFS\b/ },
  { nature: 'projet-en-lecture-seule', motif: /:\s*read-only file system\b/i },
  // Une écriture refusée AILLEURS : le montage n'est pas en cause, c'est le
  // dossier visé qui n'appartient pas à l'espace écrivable du chef.
  { nature: 'ecriture-hors-espace', motif: /\bEACCES:\s*permission denied\b/i },
  { nature: 'ecriture-hors-espace', motif: /\bEPERM:\s*operation not permitted\b/i },
];

/**
 * La nature d'un refus lu dans la sortie d'une commande, ou `null` quand rien
 * n'y ressemble. On ne cherche que des formes d'ERREUR (préfixe `bwrap:`,
 * `sudo:`, codes `EROFS` / `EACCES:` / `EPERM:`, `… : Read-only file system`) :
 * une sortie qui se
 * contente de CITER ces mots — un `grep` dans un journal, par exemple — n'est
 * pas un refus.
 */
export function natureDuRefus(sortie: string): NatureDuRefus | null {
  const texte = sortie ?? '';
  if (!texte.trim()) return null;
  for (const { nature, motif } of EMPREINTES) {
    if (motif.test(texte)) return nature;
  }
  return null;
}

/**
 * La phrase montrée à l'utilisateur : la cause RÉELLE, puis la route à prendre.
 * Jamais « pas les droits » — ce n'est pas une autorisation qui manque.
 */
export function expliquerRefus(nature: NatureDuRefus, projet?: string): string {
  const ou = projet ? ` (${projet})` : '';
  switch (nature) {
    case 'projet-en-lecture-seule':
      return (
        `Ce n'est pas une autorisation qui manque : le projet${ou} est monté en LECTURE SEULE pour le ` +
        `chef d'orchestre, et cette commande a voulu y écrire. Construire, installer, publier ou ` +
        `modifier ce projet passe par une carte : son agent de tâche, lui, travaille en accès complet.`
      );
    case 'ecriture-hors-espace':
      return (
        `Ce n'est pas une autorisation qui manque : le chef d'orchestre n'écrit que dans SON dossier ` +
        `de travail, et cette commande a voulu écrire ailleurs sur la machine. Le geste est possible, ` +
        `mais il revient à un agent de tâche, ouvert par une carte.`
      );
    case 'administration-refusee':
      return (
        `Ce n'est pas une autorisation qui manque : cette commande réclame l'administration de la ` +
        `machine, que le bac à sable du chef d'orchestre coupe. Une carte confiée à un agent de ` +
        `tâche la lancera à sa place.`
      );
    case 'bac-a-sable-absent':
      return (
        `PANNE DU SERVEUR : le bac à sable du chef d'orchestre n'a pas pu démarrer, donc aucune de ses ` +
        `commandes ne peut tourner. Le réglage système « kernel.apparmor_restrict_unprivileged_userns=0 » ` +
        `(/etc/sysctl.d/99-haikodev-userns.conf) est à remettre en place.`
      );
  }
}

/**
 * LA CONSIGNE D'ESPACE DU CHEF BRIDÉ, envoyée à chacun de ses tours.
 *
 * Elle fait DEUX choses que le seul bac à sable ne peut pas faire :
 *   1. elle nomme d'AVANCE ce qui échouera (construire, installer, déployer,
 *      redémarrer, écrire dans le projet), pour que le chef ne l'essaie pas —
 *      c'est en essayant qu'il rapportait un refus ;
 *   2. elle lui INTERDIT le mot « droits » pour décrire sa frontière, et lui
 *      donne la phrase de remplacement. L'utilisateur qui a tout accordé lisait
 *      « je n'ai pas les droits » comme une autorisation manquante.
 *
 * Une consigne générale du serveur qui dirait de lancer un script de
 * publication ne s'applique pas au chef : elle est écartée NOMMÉMENT ici.
 */
export function consigneEspaceDuChef(dossierDeTravail: string, projet: string): string {
  return (
    `TON ESPACE DE TRAVAIL : tu peux lancer des commandes (sondages, études, analyses) et ` +
    `écrire tes brouillons dans ${dossierDeTravail} — c'est le SEUL dossier où tu as le droit ` +
    `d'écrire. Le projet (${projet}) est monté en LECTURE SEULE : lis-y tout ce qu'il te faut, mais ` +
    `toute écriture y échoue. Modifier le code du projet n'est pas ton rôle : tu l'ouvres en carte ` +
    `confiée à un agent de tâche.\n` +
    `CE QUI ÉCHOUERA, DONC CE QUE TU N'ESSAIES PAS : construire, installer des dépendances, ` +
    `lancer un script de déploiement ou de publication, redémarrer un service, écrire un fichier ` +
    `du projet. Toutes ces commandes écrivent hors de ton dossier de travail ou réclament ` +
    `l'administration de la machine, et ton bac à sable les refuse (« Read-only file system », ` +
    `« EROFS », « EACCES », « sudo »). Si une consigne générale du serveur te dit de lancer un ` +
    `script de publication, elle ne s'applique PAS à toi : tu proposes une carte, et c'est son ` +
    `agent qui lance.\n` +
    `NE DIS JAMAIS « je n'ai pas les droits », « accès refusé » ni « permission manquante » : rien ` +
    `ne te manque, c'est ta frontière, et l'utilisateur t'a bien tout accordé. Dis « ce geste revient ` +
    `à un agent de tâche », nomme en une phrase ce qu'il faut lancer, et propose la carte.`
  );
}

/**
 * Le détail d'une étape, réécrit pour être lisible. La sortie d'origine est
 * GARDÉE dessous : l'explication s'ajoute, elle ne remplace jamais ce que le
 * système a réellement dit. Rend `null` quand il n'y a rien à expliquer — à
 * l'appelant de laisser alors le détail intact.
 */
export function detailDuRefus(sortie: string | undefined, projet?: string): string | null {
  const nature = natureDuRefus(sortie ?? '');
  if (!nature) return null;
  return `${expliquerRefus(nature, projet)}\n\n${(sortie ?? '').trim()}`;
}
