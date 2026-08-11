/**
 * LE TYPE DE CIBLE D'UNE MISE EN PRODUCTION.
 *
 * La mise en production ne suivait qu'un seul chemin : un PROMPT réglé, suivi
 * par un agent — refusée sans lui. Certains projets n'ont besoin de rien de
 * tout cela : un projet local n'a nulle part où envoyer le code, et beaucoup
 * d'hébergements clients ne demandent qu'un dépôt de fichiers par SSH ou par
 * FTP, sans qu'il faille écrire un prompt pour le décrire.
 *
 * Quatre types, réglés sur `MiseEnProduction.type` :
 *  - `aucune`    — projet local : rien n'est transféré, seule la branche est
 *                  fusionnée, enregistrée et envoyée ;
 *  - `ssh`       — les fichiers construits sont déposés sur un serveur par
 *                  SSH (SFTP/rsync), avec une commande de fin facultative ;
 *  - `ftp`       — les fichiers construits sont déposés par FTP (ou FTPS) ;
 *  - `consigne`  — le fonctionnement d'AVANT ce réglage, intact : un agent
 *                  suit le PROMPT réglé dans les paramètres du projet.
 *
 * Type absent = `consigne` : c'est l'état de tous les projets existants, et
 * leur comportement ne change donc pas d'un signe.
 *
 * Règles PURES : ni base, ni disque, ni réseau.
 */

export type TypeCibleMiseEnProduction = 'aucune' | 'ssh' | 'ftp' | 'consigne';

/** Ce qu'il faut pour déposer les fichiers sur un serveur par SSH. */
export type AccesSSH = {
  hote?: string;
  port?: number;
  utilisateur?: string;
  motDePasse?: string;
  /** La clé privée elle-même (texte), quand l'accès se fait par clé plutôt que mot de passe. */
  cle?: string;
  dossierDistant?: string;
  /** Le dossier construit à transférer, quand le nom usuel (`dist`, `build`…) ne convient pas. */
  dossierConstruit?: string;
  /** Une commande lancée sur le serveur, une fois les fichiers arrivés (redémarrer un service…). */
  commandeFin?: string;
};

/** Ce qu'il faut pour déposer les fichiers sur un serveur par FTP. */
export type AccesFTP = {
  hote?: string;
  port?: number;
  utilisateur?: string;
  motDePasse?: string;
  dossierDistant?: string;
  dossierConstruit?: string;
  /** FTPS (chiffré) plutôt que le FTP en clair, quand le serveur l'accepte. */
  securise?: boolean;
};

export type ReglageCibleMiseEnProduction = {
  type?: TypeCibleMiseEnProduction;
  ssh?: AccesSSH;
  ftp?: AccesFTP;
  /** L'adresse publique à contrôler après un transfert SSH ou FTP. */
  prodUrl?: string;
};

/** Le type retenu pour ce projet : celui réglé, sinon `consigne` — l'état d'avant ce réglage. */
export function typeCibleReglee(reglage: ReglageCibleMiseEnProduction | undefined): TypeCibleMiseEnProduction {
  return reglage?.type ?? 'consigne';
}

function texte(valeur: unknown): string {
  return typeof valeur === 'string' ? valeur.trim() : '';
}

/** Les champs d'accès qui manquent encore pour un type donné, nommés en français. */
export function champsManquants(type: 'ssh' | 'ftp', acces: AccesSSH | AccesFTP | undefined): string[] {
  const manquants: string[] = [];
  if (!texte(acces?.hote)) manquants.push('adresse du serveur');
  if (!texte(acces?.utilisateur)) manquants.push('identifiant');
  if (!texte(acces?.dossierDistant)) manquants.push('dossier de destination');
  if (type === 'ssh') {
    const ssh = acces as AccesSSH | undefined;
    if (!texte(ssh?.motDePasse) && !texte(ssh?.cle)) manquants.push('mot de passe ou clé');
  } else {
    if (!texte((acces as AccesFTP | undefined)?.motDePasse)) manquants.push('mot de passe');
  }
  return manquants;
}

/**
 * Le refus d'une MISE EN PRODUCTION, avant même de cliquer, ou `null` quand
 * rien ne bloque.
 *
 * - `aucune`   : jamais refusé, il n'y a rien à régler ;
 * - `ssh`/`ftp`: refusé tant que les champs d'accès nécessaires manquent ;
 * - `consigne` (ou type absent) : refusé sans PROMPT réglé, exactement comme
 *   avant ce réglage — un prompt fait d'espaces n'en est pas un.
 */
export function refusCibleMiseEnProduction(reglage: ReglageCibleMiseEnProduction & { prompt?: string } | undefined): string | null {
  const type = typeCibleReglee(reglage);
  if (type === 'aucune') return null;
  if (type === 'ssh' || type === 'ftp') {
    const manquants = champsManquants(type, type === 'ssh' ? reglage?.ssh : reglage?.ftp);
    if (!manquants.length) return null;
    return `La cible ${type.toUpperCase()} de mise en production n’est pas complète : ${manquants.join(', ')} manquant(s). Réglez-les dans le bloc « Mise en production » des réglages du projet.`;
  }
  return texte(reglage?.prompt)
    ? null
    : 'Aucun prompt de mise en production n’est réglé pour ce projet : rien n’est mis en production. Écrivez-le dans le bloc « Mise en production » des réglages du projet.';
}

/** L'état du réglage, dit en une ligne sous le bloc des paramètres. */
export function mentionCibleMiseEnProduction(reglage: ReglageCibleMiseEnProduction | undefined): string {
  const type = typeCibleReglee(reglage);
  if (type === 'aucune') return 'Projet local : rien n’est transféré, la branche est seulement fusionnée et envoyée.';
  if (type === 'ssh' || type === 'ftp') {
    const acces = type === 'ssh' ? reglage?.ssh : reglage?.ftp;
    const manquants = champsManquants(type, acces);
    if (manquants.length) return `Cible ${type.toUpperCase()} incomplète : ${manquants.join(', ')} manquant(s).`;
    const port = acces?.port ? `:${acces.port}` : '';
    return `Cible ${type.toUpperCase()} réglée : ${texte(acces?.utilisateur)}@${texte(acces?.hote)}${port}${
      texte(acces?.dossierDistant) ? ` → ${texte(acces?.dossierDistant)}` : ''
    }.`;
  }
  return 'Type « Consigne libre » : un agent suit le prompt réglé ci-dessous.';
}

/** La phrase d'annonce, avant le clic, pour un type SSH/FTP/Aucune (le type « consigne » garde la sienne). */
export function raisonCibleMiseEnProduction(reglage: ReglageCibleMiseEnProduction | undefined): string {
  const type = typeCibleReglee(reglage);
  if (type === 'aucune') {
    return 'Projet local : le lot sera fusionné, enregistré et envoyé sur le dépôt, mais rien n’est transféré ailleurs.';
  }
  const acces = type === 'ssh' ? reglage?.ssh : reglage?.ftp;
  const port = acces?.port ? `:${acces.port}` : '';
  return `Les fichiers construits seront déposés par ${type?.toUpperCase()} sur ${texte(acces?.hote)}${port}${
    texte(acces?.dossierDistant) ? ` (${texte(acces?.dossierDistant)})` : ''
  }.`;
}
