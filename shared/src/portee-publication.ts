/**
 * DÉPLOYER, C'EST SUR CE SERVEUR ; METTRE EN PRODUCTION, C'EST AILLEURS.
 *
 * Les deux étapes de mise en ligne existaient déjà, mais RIEN ne disait où
 * chacune avait le droit d'aller. Le type de cible (SSH, FTP, consigne libre)
 * ne vit que sur la mise en production, sans que ce soit écrit nulle part ; et
 * la procédure de DÉPLOIEMENT, écrite par un agent puis suivie par un agent,
 * pouvait parfaitement décrire un envoi par SSH ou par FTP vers un serveur
 * extérieur — personne ne l'en empêchait.
 *
 * La règle d'or est désormais NOMMÉE et VÉRIFIÉE :
 *
 *  - le DÉPLOIEMENT a une portée `vps` : tout se passe sur cette machine —
 *    fusionner, enregistrer, envoyer sur le dépôt, puis rafraîchir l'instance
 *    qui tourne ici. Aucun transfert vers un serveur extérieur, jamais ;
 *  - la MISE EN PRODUCTION a une portée `externe` : c'est elle, et elle seule,
 *    qui peut passer par FTP, par SSH ou par un déploiement via GitHub. Elle ne
 *    part que sur une décision explicite — sa procédure est vide tant que
 *    personne ne l'a définie.
 *
 * Conséquence pour un projet NEUF, ou pour un projet dont personne n'a encore
 * écrit la procédure de déploiement : il part sur le DÉPLOIEMENT VPS par
 * défaut (`PROCEDURE_VPS_PAR_DEFAUT`, le déroulé constaté sur cette machine),
 * et il n'a AUCUNE mise en production tant qu'on ne la décide pas.
 *
 * Règles PURES : ni base, ni disque, ni réseau.
 */

import type { CiblePublication } from './etapes-publication.js';

/** Jusqu'où une étape a le droit d'aller. */
export type PorteeDePublication = 'vps' | 'externe';

/**
 * La portée d'une étape. Elle ne se règle pas, elle ne se devine pas : elle est
 * attachée à l'étape elle-même, une fois pour toutes.
 */
export function porteeDeLEtape(cible: CiblePublication): PorteeDePublication {
  return cible === 'dev' ? 'vps' : 'externe';
}

/** Cette étape a-t-elle le droit de sortir de ce serveur ? */
export function transfertExterneAutorise(cible: CiblePublication): boolean {
  return porteeDeLEtape(cible) === 'externe';
}

/** Ce que la portée d'une étape dit, en une ligne, sous le bloc de publication. */
export function mentionPortee(cible: CiblePublication): string {
  return cible === 'dev'
    ? 'Déploiement sur ce serveur : tout reste ici, rien n’est envoyé par FTP, par SSH ni via GitHub.'
    : 'Mise en production : c’est la seule étape qui peut sortir de ce serveur (FTP, SSH ou GitHub), et seulement si elle est définie.';
}

/* ------------------------------------------------------------------ */
/* Le déploiement VPS par défaut                                        */
/* ------------------------------------------------------------------ */

/**
 * LA PROCÉDURE DE DÉPLOIEMENT PAR DÉFAUT, celle de tout projet qui n'en a pas
 * écrit d'autre.
 *
 * Ce texte n'est PAS envoyé à un agent : il DÉCRIT, en français, le déroulé
 * constaté que HaikoDev exécute lui-même quand aucune procédure n'est écrite
 * (`shared/src/mise-en-ligne.ts`). Il sert à deux choses : le montrer dans le
 * tiroir plutôt qu'un vide qui laisse croire que rien n'est prévu, et donner à
 * l'agent qui rédigera la vraie procédure un point de départ juste.
 */
export const PROCEDURE_VPS_PAR_DEFAUT = [
  'Déploiement sur ce serveur (procédure par défaut, tant qu’aucune autre n’est écrite) :',
  '',
  '1. Fusionner les branches des tâches du lot dans la branche de déploiement du projet.',
  '2. Enregistrer et envoyer sur le dépôt.',
  '3. Construire le projet sur place, s’il a de quoi se construire.',
  '4. Rafraîchir l’instance qui tourne sur ce serveur : HaikoDev lui-même, sinon le service système du dossier, sinon le dossier servi tel quel par le serveur web.',
  '5. Contrôler l’adresse réglée pour le projet ; sans adresse réglée, le dire.',
  '',
  'Ce qu’il ne faut surtout pas faire : envoyer quoi que ce soit vers un serveur extérieur (FTP, SSH, déploiement via GitHub). Cela relève de la mise en production, jamais du déploiement.',
].join('\n');

/**
 * La procédure de DÉPLOIEMENT à AFFICHER : celle qui est écrite, sinon le
 * déploiement VPS par défaut. La mise en production, elle, n'a pas de défaut —
 * rien ne sort de ce serveur sans décision explicite.
 */
export function procedureAffichee(cible: CiblePublication, ecrite: string): string {
  const propre = (ecrite ?? '').trim();
  if (propre) return propre;
  return cible === 'dev' ? PROCEDURE_VPS_PAR_DEFAUT : '';
}

/* ------------------------------------------------------------------ */
/* Ce que l'agent qui rédige doit savoir                                */
/* ------------------------------------------------------------------ */

/**
 * Les lignes de contrainte glissées dans le prompt de l'agent qui écrit une
 * procédure : elles disent la portée de l'étape avant qu'il ne rédige, pour
 * qu'il n'invente pas un envoi par SSH dans un déploiement.
 */
export function contraintePortee(cible: CiblePublication): string[] {
  if (cible === 'dev') {
    return [
      'PORTÉE DE CETTE ÉTAPE : CE SERVEUR, ET RIEN D’AUTRE. Le projet vit ici : la procédure ne doit contenir AUCUN envoi vers une machine extérieure — pas de FTP, pas de SFTP, pas de scp, pas de rsync distant, pas de connexion SSH sortante, pas de déploiement déclenché via GitHub, pas de plateforme d’hébergement tierce.',
      'Tout ce qui sort de ce serveur relève de la MISE EN PRODUCTION, une étape séparée qui ne part que sur décision explicite. Si le projet ne peut se mettre en ligne que par un transfert extérieur, dis-le dans ton explication et écris quand même une procédure locale (construction et contrôle sur place).',
    ];
  }
  return [
    'PORTÉE DE CETTE ÉTAPE : L’EXTÉRIEUR. C’est la SEULE étape qui a le droit de sortir de ce serveur : FTP, SSH (scp, rsync, sftp) ou déploiement via GitHub sont permis ici, et nulle part ailleurs.',
    'Le déploiement quotidien, lui, reste sur ce serveur : n’y renvoie pas et ne le refais pas — le code est déjà en place ici quand cette procédure sert.',
  ];
}

/* ------------------------------------------------------------------ */
/* Le garde-fou : un déploiement qui voudrait sortir                    */
/* ------------------------------------------------------------------ */

/**
 * Les moyens de sortir de cette machine, repérés dans un texte de procédure.
 *
 * La liste est VOLONTAIREMENT étroite : on ne cherche que des gestes qui n'ont
 * aucun sens en local, pour ne pas prendre une procédure honnête en défaut.
 * `rsync` et `ssh` ne comptent que s'ils visent un hôte distant (`utilisateur@
 * machine`) ; `rsync` d'un dossier vers un autre sur place ne déclenche rien.
 */
const MOYENS_EXTERNES: { motif: RegExp; nom: string }[] = [
  { motif: /\bscp\b/i, nom: 'copie par scp' },
  { motif: /\bs?ftps?\b/i, nom: 'transfert FTP/SFTP' },
  { motif: /\blftp\b/i, nom: 'transfert FTP (lftp)' },
  { motif: /\bftps?:\/\//i, nom: 'adresse FTP' },
  { motif: /\bssh\s+[^\s@]+@/i, nom: 'connexion SSH sortante' },
  { motif: /\brsync\b[^\n]*\s[^\s@]+@[^\s]+:/i, nom: 'rsync vers un serveur distant' },
  { motif: /\bgh\s+workflow\s+run\b/i, nom: 'déclenchement d’un workflow GitHub' },
  { motif: /\bgh\s+release\s+create\b/i, nom: 'publication d’une version GitHub' },
  { motif: /\b(vercel|netlify|wrangler|fly|heroku|surge)\s+(deploy|publish|push)\b/i, nom: 'déploiement vers une plateforme tierce' },
  { motif: /\bdocker\s+push\b/i, nom: 'envoi d’une image Docker' },
];

/**
 * UNE LIGNE QUI INTERDIT LE FTP N'EST PAS UNE LIGNE QUI FAIT DU FTP.
 *
 * La procédure par défaut, comme celles que l'agent rédige, se termine par « ce
 * qu'il ne faut surtout pas faire : envoyer par FTP ou par SSH ». Lire le texte
 * d'un bloc y verrait un transfert et refuserait la publication pour la phrase
 * qui l'interdit. Le repérage se fait donc LIGNE PAR LIGNE, et une ligne qui
 * porte une négation est écartée.
 */
const NEGATIONS = /\b(pas|jamais|aucun[e]?s?|sans|interdit[e]?s?|proscrit[e]?s?|évite[rz]?|éviter|exclu[e]?s?|ni)\b/i;

/** Les moyens externes trouvés dans un texte, nommés en français, sans doublon. */
export function gestesExternes(texte: string): string[] {
  const propre = texte ?? '';
  if (!propre.trim()) return [];
  const trouves: string[] = [];
  for (const ligne of propre.split('\n')) {
    if (NEGATIONS.test(ligne)) continue;
    for (const moyen of MOYENS_EXTERNES) {
      if (moyen.motif.test(ligne) && !trouves.includes(moyen.nom)) trouves.push(moyen.nom);
    }
  }
  return trouves;
}

/**
 * LE REFUS D'UN DÉPLOIEMENT QUI VOUDRAIT SORTIR DE CE SERVEUR, ou `null` quand
 * rien ne cloche.
 *
 * Une procédure de déploiement est SUIVIE PAR UN AGENT : si elle décrit un
 * envoi par FTP ou par SSH, cet agent le fera. La règle d'or serait alors un
 * vœu. Le refus arrive donc AVANT le clic, il NOMME ce qui a été repéré et il
 * renvoie à l'étape qui a le droit de le faire.
 *
 * Une MISE EN PRODUCTION n'est jamais refusée ici : c'est son métier.
 */
export function refusPorteeDeLEtape(cible: CiblePublication, procedure: string): string | null {
  if (transfertExterneAutorise(cible)) return null;
  const gestes = gestesExternes(procedure);
  if (!gestes.length) return null;
  return (
    `La procédure de déploiement décrit un envoi hors de ce serveur (${gestes.join(', ')}) : le déploiement ` +
    'reste sur cette machine. Déplacez ces gestes dans la procédure de mise en production, la seule étape qui ' +
    'a le droit de sortir d’ici.'
  );
}
