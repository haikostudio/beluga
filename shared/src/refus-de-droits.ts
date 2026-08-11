/**
 * TRADUIRE UN REFUS SYSTÈME EN PHRASE CLAIRE.
 *
 * Le chef d'orchestre a l'ACCÈS COMPLET à la machine : il construit, installe,
 * déploie, redémarre, administre. Sa seule frontière est de ne pas modifier
 * lui-même du code, et elle tient sur les outils d'édition, pas sur le disque
 * (`shared/src/bridage-chef.ts`). Le bac à sable qui l'enfermait a été retiré le
 * 11/08/2026 : il bloquait justement les gestes qu'on veut lui ouvrir.
 *
 * Restent les refus RÉELS, ceux de la machine elle-même : un fichier appartenant
 * à un autre compte, un `sudo` qui réclame un mot de passe, un reste de bac à
 * sable mal éteint. Le chef les rapportait en disant « je n'ai pas les droits » —
 * un utilisateur qui a tout accordé y lisait une autorisation refusée, alors que
 * la cause est ailleurs et se répare.
 *
 * Ces règles sont PURES : elles reconnaissent la nature d'un refus dans la
 * sortie d'une commande et rendent la phrase à afficher, avec la ROUTE à
 * prendre. Aucune base, aucun disque — donc rejouables seules.
 */

/** Ce qui a réellement bloqué, quand quelque chose a bloqué. */
export type NatureDuRefus =
  /** Un bac à sable resté allumé alors que le chef doit avoir l'accès complet. */
  | 'bac-a-sable-residuel'
  /** Un fichier qui appartient à un autre compte de la machine. */
  | 'fichier-d-un-autre-compte'
  /** L'administration de la machine, qui réclame un mot de passe ou un terminal. */
  | 'administration-a-configurer';

/**
 * Les empreintes d'un refus, du plus précis au plus général. L'ordre compte :
 * un reste de bac à sable se plaint AUSSI de permissions, et serait sinon
 * confondu avec un simple fichier mal possédé.
 */
const EMPREINTES: Array<{ nature: NatureDuRefus; motif: RegExp }> = [
  // Un bac à sable qui n'aurait pas dû être là : le chef a l'accès complet.
  { nature: 'bac-a-sable-residuel', motif: /^\s*bwrap:/im },
  { nature: 'bac-a-sable-residuel', motif: /\bEROFS\b/ },
  { nature: 'bac-a-sable-residuel', motif: /:\s*read-only file system\b/i },
  { nature: 'bac-a-sable-residuel', motif: /no new privileges/i },
  // L'administration : mot de passe, terminal ou règle `sudoers` à poser.
  { nature: 'administration-a-configurer', motif: /^\s*sudo:.*(no tty|askpass|a password is required|not allowed|sudo\.conf is owned|must be owned by uid)/im },
  { nature: 'administration-a-configurer', motif: /interactive authentication required/i },
  // Un fichier d'un autre compte : ni le montage ni le bridage, la possession.
  { nature: 'fichier-d-un-autre-compte', motif: /\bEACCES:\s*permission denied\b/i },
  { nature: 'fichier-d-un-autre-compte', motif: /\bEPERM:\s*operation not permitted\b/i },
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
    case 'bac-a-sable-residuel':
      return (
        `À RÉPARER SUR LE SERVEUR : cette commande a tourné dans un bac à sable, alors que le chef ` +
        `d'orchestre doit avoir l'accès complet${ou}. Un réglage de bac à sable est resté allumé ` +
        `quelque part (réglages du moteur, service système) : c'est lui qu'il faut éteindre, aucune ` +
        `autorisation ne manque.`
      );
    case 'fichier-d-un-autre-compte':
      return (
        `Ce n'est pas une autorisation qui manque : ce fichier appartient à un AUTRE compte de la ` +
        `machine, et le compte qui porte le démon ne peut pas le modifier. Il faut corriger sa ` +
        `possession, ou lancer la commande avec l'administration.`
      );
    case 'administration-a-configurer':
      return (
        `Ce n'est pas une autorisation qui manque : la commande d'administration réclame un mot de ` +
        `passe ou un terminal, qu'un tour automatique n'a pas. Le compte du démon a besoin d'une ` +
        `règle « sudoers » sans mot de passe pour ce geste précis.`
      );
  }
}

/**
 * LA CONSIGNE D'ESPACE DU CHEF, envoyée à chacun de ses tours.
 *
 * Elle dit sa frontière RÉELLE, qui tient en une phrase : tout lui est ouvert
 * sauf modifier lui-même du code. Elle nomme les gestes qu'il croyait interdits
 * — construire, installer, déployer, redémarrer, administrer la machine — parce
 * qu'un chef qui s'en croit privé s'arrête avant d'essayer, et rapporte un refus
 * qui n'existe pas. Elle nomme de même les gestes qui SORTENT de la machine —
 * requête réseau, GitHub, connexion SSH — et le fait qu'ils se font DANS LE TOUR,
 * sans carte : un chef qui ouvre une carte pour un `gh pr list` fait attendre
 * l'utilisateur une validation pour dix secondes de travail.
 *
 * Elle lui interdit aussi le vocabulaire des droits : ce mot a fait lire à
 * l'utilisateur, qui avait tout accordé, une autorisation manquante (11/08/2026).
 */
export function consigneEspaceDuChef(dossierDeTravail: string, projet: string): string {
  return (
    `TON ESPACE DE TRAVAIL : tu as l'ACCÈS COMPLET à cette machine. Tu lances les commandes que tu ` +
    `veux — sondages, études, construction, installation de dépendances, script de déploiement, ` +
    `redémarrage d'un service, commandes d'administration — et tu écris où tu veux sur le disque. ` +
    `Le projet (${projet}) t'est ouvert en entier ; ${dossierDeTravail} reste ton dossier à brouillons.\n` +
    `LA MACHINE ET LE DEHORS AUSSI, DANS LE TOUR EN COURS, SANS CARTE : requêtes réseau (curl, ` +
    `appels d'API), gestes GitHub (gh : dépôts, demandes de fusion, tickets), connexion SSH vers ` +
    `une autre machine, et création ou modification de cartes avec tes outils. Ces gestes-là se ` +
    `font TOUT DE SUITE : n'ouvre pas une carte pour ce que tu peux faire en dix secondes.\n` +
    `TA SEULE FRONTIÈRE : tu ne modifies pas TOI-MÊME le code. Les outils d'édition de fichiers ne ` +
    `te sont pas servis, et une modification de programme s'ouvre en carte confiée à un agent de ` +
    `tâche. Tout le reste t'est permis : n'annonce jamais qu'un geste t'est fermé sans l'avoir ` +
    `essayé.\n` +
    `NE DIS JAMAIS « je n'ai pas les droits », « accès refusé » ni « permission manquante » : ` +
    `l'utilisateur t'a tout accordé. Si une commande échoue vraiment, montre son message et dis ce ` +
    `qui bloque — jamais une autorisation qui manquerait.`
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
