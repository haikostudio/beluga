/**
 * « Cet envoi va-t-il mettre la production à jour ? »
 *
 * La publication envoie sur GitHub AVANT de mettre en ligne : l'étape « Envoi
 * sur le dépôt » pousse la branche principale, et l'étape de fusion pousse même
 * la branche courante quand du travail y traînait. Sur un projet client dont le
 * serveur se redéploie TOUT SEUL à chaque envoi, ce simple envoi met la
 * production à jour — pendant que HaikoDev annonce seulement « publication en
 * cours ».
 *
 * Un projet peut donc DÉCLARER que sa branche principale déclenche un
 * déploiement chez le client. Quand c'est le cas, la publication s'arrête avant
 * d'avoir touché au dépôt et pose une décision : elle nomme le projet, la
 * branche, les enregistrements concernés et ce que l'envoi va mettre en ligne.
 * Rien ne part tant que le clic n'est pas donné.
 *
 * L'attente est posée AVANT la fusion, et non entre « Enregistrement » et
 * « Envoi » : la fusion elle-même pousse la branche courante, et un refus doit
 * laisser le lot ENTIER — pas à moitié fusionné sur la principale. Les sept
 * étapes et leur ordre ne bougent pas ; elles ne commencent simplement pas.
 *
 * Règle pure : aucune base, aucun disque, aucun réseau — donc rejouable telle
 * quelle.
 */

/** Ce qu'on sait au moment de décider si l'on doit demander l'accord. */
export interface EnvoiSurveille {
  /** Le projet déclare que sa branche principale déclenche une mise en ligne. */
  deployeSurEnvoi?: boolean;
  /** Le projet a-t-il un dépôt distant ? Sans lui, rien ne part nulle part. */
  aUnDepotDistant?: boolean;
  /** Le projet est-il un dépôt git ? Sans dépôt, il n'y a pas d'envoi. */
  estUnDepot?: boolean;
  /** L'accord de l'utilisateur, déjà donné pour CE lancement. */
  accord?: boolean;
}

/**
 * Faut-il s'arrêter et demander avant d'envoyer ?
 *
 * Un projet qui n'a rien déclaré ne change EN RIEN : c'est la déclaration seule
 * qui allume l'attente. Pas de dépôt, pas de dépôt distant, ou accord déjà
 * donné : on part sans rien demander.
 */
export function envoiDemandeAccord(envoi: EnvoiSurveille): boolean {
  if (!envoi.deployeSurEnvoi) return false;
  if (envoi.estUnDepot === false) return false;
  if (envoi.aUnDepotDistant === false) return false;
  return envoi.accord !== true;
}

/** Combien d'enregistrements sont nommés dans la décision ; le reste est compté. */
export const ENREGISTREMENTS_NOMMES_MAX = 5;

/**
 * Les titres des enregistrements qui partiraient, lus dans une ou plusieurs
 * sorties de `git log --format=%s`. Un même enregistrement peut apparaître dans
 * deux branches du lot : on ne le compte qu'une fois, sinon la décision
 * annoncerait plus de travail qu'il n'en part.
 */
export function enregistrementsAEnvoyer(sorties: string[]): string[] {
  const vus = new Set<string>();
  const titres: string[] = [];
  for (const sortie of sorties) {
    for (const ligne of (sortie ?? '').split('\n')) {
      const titre = ligne.trim();
      if (!titre || vus.has(titre)) continue;
      vus.add(titre);
      titres.push(titre);
    }
  }
  return titres;
}

/** Ce que l'utilisateur doit avoir sous les yeux pour trancher. */
export interface EnvoiAJuger {
  /** Le nom du projet, tel qu'il s'affiche dans la colonne de gauche. */
  projet: string;
  /** La branche qui part — celle qui déclenche le déploiement chez le client. */
  branche: string;
  /** Les titres des enregistrements concernés, le plus récent d'abord. */
  enregistrements: string[];
  /** Combien de cartes du lot partent avec cet envoi. */
  cartes?: number;
  /** L'adresse publique du projet, quand elle est connue. */
  adresse?: string;
  /** Du travail non enregistré traîne dans le dossier : il partira avec. */
  travauxEnCours?: boolean;
}

/**
 * Le texte de la décision. Il dit QUATRE choses, dans cet ordre : ce que
 * l'envoi déclenche, ce qui part, ce que cela remplace, et que rien n'a encore
 * bougé. Une décision qui ne dit pas ce qu'elle engage n'est pas une décision.
 */
export function texteDeLAttente(envoi: EnvoiAJuger): string {
  const lignes: string[] = [];
  lignes.push(
    `Le projet « ${envoi.projet} » se déploie tout seul : envoyer sur « ${envoi.branche} » met la version en ligne à jour.`,
  );

  const nombre = envoi.enregistrements.length;
  if (nombre) {
    const nommes = envoi.enregistrements.slice(0, ENREGISTREMENTS_NOMMES_MAX);
    const reste = nombre - nommes.length;
    lignes.push(`${nombre} enregistrement${nombre > 1 ? 's' : ''} partirai${nombre > 1 ? 'ent' : 't'} :`);
    for (const titre of nommes) lignes.push(`- ${titre}`);
    if (reste > 0) lignes.push(`- … et ${reste} autre${reste > 1 ? 's' : ''}.`);
  } else {
    lignes.push('Aucun enregistrement nouveau n’a été repéré, mais l’envoi relancerait tout de même le déploiement.');
  }

  if (envoi.cartes) {
    lignes.push(`${envoi.cartes} carte${envoi.cartes > 1 ? 's' : ''} du lot part${envoi.cartes > 1 ? 'ent' : ''} avec.`);
  }
  if (envoi.travauxEnCours) {
    lignes.push('Des travaux en cours, non encore enregistrés, seraient enregistrés puis envoyés eux aussi.');
  }
  if (envoi.adresse) {
    lignes.push(`C’est ${envoi.adresse} qui sera remplacé.`);
  }

  lignes.push('Rien n’est parti pour l’instant : ni fusion, ni enregistrement, ni envoi.');
  return lignes.join('\n');
}

/** Le titre court de la décision, pour la notification et le message court. */
export function titreDeLAttente(projet: string): string {
  return `« ${projet} » attend votre accord avant d’envoyer`;
}

/**
 * Ce qui s'écrit quand l'utilisateur dit non. Un refus n'est pas un échec : le
 * lot reste entier, à sa place, et repartira au prochain coup.
 */
export function raisonDuRefus(projet: string, branche: string): string {
  return `Envoi refusé : rien n’a été envoyé sur « ${branche} » du projet « ${projet} ». Le lot reste entier, à déployer.`;
}

/** Le début des mentions d'envoi : c'est lui qui permet de les reconnaître. */
const DEBUT_MENTION_ENVOI = 'Envoi sur ';

/**
 * Ce qui s'écrit SUR CHAQUE CARTE du lot pendant l'attente. La décision se
 * prend dans le bloc de publication — un triangle par carte ferait annoncer une
 * décision et en montrer dix —, mais la carte doit dire pourquoi elle ne part
 * pas : sans un mot, elle semble bloquée sans raison.
 */
export function mentionDAttenteSurCarte(branche: string): string {
  return `${DEBUT_MENTION_ENVOI}« ${branche} » : votre accord est attendu, rien n’est parti.`;
}

/**
 * Ce qui s'écrit SUR CHAQUE CARTE du lot après un refus. Court : la carte n'a
 * que quelques lignes pour le dire, et la raison complète est dans le bloc de
 * publication.
 */
export function mentionDeRefusSurCarte(branche: string): string {
  return `${DEBUT_MENTION_ENVOI}« ${branche} » refusé : rien n’est parti, la carte reste à déployer.`;
}

/**
 * Cette phrase posée sur une carte parle-t-elle d'un envoi ? Un envoi accordé
 * plus tard doit EFFACER la mention : la garder ferait lire « en attente » ou
 * « refusé » sur une carte en train de partir en ligne. Toute autre raison
 * d'attente (dossier occupé, plus de place) n'est jamais touchée.
 */
export function estMentionDEnvoi(texte: string | undefined): boolean {
  return Boolean(texte?.startsWith(DEBUT_MENTION_ENVOI));
}
