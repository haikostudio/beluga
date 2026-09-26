/**
 * LA PUBLICATION, EN DEUX MÉCANISMES SIMPLES — règles pures.
 *
 * Refonte du 22/09/2026 : tout l'ancien mécanisme (procédures rédigées, agents
 * de dépannage, versions préparées d'avance, cibles SSH/FTP, miroir public) a
 * été retiré. Il reste :
 *
 *  1. LE DÉPLOIEMENT — identique pour tous les projets, tous sur ce serveur,
 *     SANS AGENT : fusionner les branches du lot dans la branche de travail,
 *     enregistrer, envoyer, lancer la commande de mise à jour du projet (s'il
 *     en a une), relancer son service (s'il en a un). Chaque étape a une durée
 *     MAXIMALE ; au-delà elle s'arrête et le dit. Une étape réussie n'est
 *     jamais rejouée, et rien ne se « répare » tout seul.
 *
 *  2. LA MISE EN PRODUCTION — un PROCESSUS écrit une fois par un agent qui
 *     interroge l'utilisateur (« Initialiser la mise en production »), puis
 *     déroulé TEL QUEL, sans agent, à chaque clic : fusion de la branche de
 *     travail dans la branche de production, envoi, puis chaque étape du
 *     processus, dans l'ordre, arrêt net à la première qui échoue.
 */

/* ------------------------------------------------------------------ */
/* Le déploiement                                                      */
/* ------------------------------------------------------------------ */

/**
 * LES DURÉES MAXIMALES DU DÉPLOIEMENT. Courtes, et c'est voulu : l'ancien
 * plafond de 30 minutes laissait une publication figée afficher « en cours »
 * une demi-heure durant (ProjetB, 22/09/2026).
 */
export const DELAIS_DU_DEPLOIEMENT_MS = {
  /** Une branche à fusionner. */
  fusion: 60_000,
  /** Lire l'état du dépôt, enregistrer. */
  enregistrement: 60_000,
  /** Envoyer sur le dépôt distant. */
  envoi: 90_000,
  /** La commande de mise à jour du projet (construction, script du projet). */
  miseAJour: 10 * 60_000,
  /**
   * Le redémarrage d'un service et sa réponse. Dix minutes, comme la mise à
   * jour : plusieurs services CONSTRUISENT le site à leur démarrage (ProjetB,
   * HaikoNote…) — le port ne répond qu'une fois la construction finie.
   */
  redemarrage: 10 * 60_000,
  /**
   * L'attente d'une construction servie encore plus vieille que le code : le
   * service la refait peut-être en ce moment (un script de démarrage qui
   * reconstruit, alors que systemd le dit déjà « actif »).
   */
  reconstruction: 5 * 60_000,
  /** Le contrôle de l'adresse du projet. */
  adresse: 20_000,
} as const;

/** Les réglages du déploiement d'un projet : deux choix, rien d'autre. */
export type ReglageDeDeploiement = {
  /** La commande lancée dans le dossier après l'envoi (« npm run build », un script du projet…). */
  commande?: string;
  /** Le ou les services système à relancer ensuite, séparés par des espaces. */
  service?: string;
};

/** La commande de mise à jour RÉELLEMENT jouée : la réglée, sinon aucune. */
export function commandeDeMiseAJour(reglage: ReglageDeDeploiement | undefined): string | undefined {
  const commande = (reglage?.commande ?? '').trim();
  return commande || undefined;
}

/** Les services RÉELLEMENT relancés, dans l'ordre : les réglés, sinon aucun. */
export function servicesARelancer(reglage: ReglageDeDeploiement | undefined): string[] {
  return (reglage?.service ?? '')
    .split(/[\s,]+/)
    .map((service) => service.trim().replace(/\.service$/, ''))
    .filter(Boolean);
}

/** Le réglage « service » tel qu'on l'enregistre : les noms nettoyés, séparés par une espace. */
export function ecrireServices(saisie: string): string | undefined {
  return servicesARelancer({ service: saisie }).join(' ') || undefined;
}

/**
 * RIEN À RECONSTRUIRE : entre la dernière mise en ligne réussie et maintenant,
 * seuls des fichiers de documentation ont changé (ou rien du tout). La mise à
 * jour et le redémarrage sont alors sautés — « ce qui n'a pas changé ne se
 * reconstruit pas ».
 */
export function rienAReconstruire(fichiersChanges: readonly string[]): boolean {
  return fichiersChanges.map((f) => f.trim()).filter(Boolean).every((f) => /\.md$/i.test(f));
}

/**
 * Un nom de service acceptable : lettres, chiffres, tirets, points, @. Il part
 * dans une commande système : rien d'autre ne passe.
 */
export function serviceValide(service: string): boolean {
  return /^[A-Za-z0-9@._-]{1,100}$/.test(service);
}

/**
 * UN SERVICE ÉTEINT VOLONTAIREMENT NE SE RALLUME PAS AU DÉPLOIEMENT. Un projet
 * mis en veille s'éteint par `systemctl disable` (MEM-1110) ; `systemctl
 * restart` le relancerait quand même, en ressuscitant un site qu'on a coupé
 * exprès (ProjetE, Bluemangocloud, 22/09/2026). Désactivé ET arrêté : on
 * n'y touche pas. Désactivé mais lancé à la main : on le relance.
 */
export function serviceEteintVolontairement(activation: string, etat: string): boolean {
  return /^(disabled|masked)\b/.test(activation.trim()) && etat.trim() !== 'active';
}

/**
 * LES CONSTRUCTIONS QU'UN SERVICE SERT, lues dans son unité et son script de
 * démarrage : le fichier dont la date dit de quand date la version en ligne.
 *
 * Pourquoi : un service qui sert une construction (`node .output/server/index.mjs`,
 * `vite preview`…) repart sur l'ANCIENNE si personne ne la refait. Le
 * déploiement fusionnait, relançait, affichait « réussi », et le site montrait
 * encore le code du matin (HaikoFormations, 22/09/2026). Les chemins écrits
 * par une variable (`$SORTIE/…`) ne sont pas suivis : sans chemin sûr, on ne
 * conclut rien.
 */
export function constructionsServies(texte: string, dossierParDefaut: string): string[] {
  const lignes = texte
    .split('\n')
    .map((ligne) => ligne.trim())
    .filter((ligne) => ligne && !ligne.startsWith('#'));
  let dossier = dossierParDefaut;
  for (const ligne of lignes) {
    for (const cd of ligne.matchAll(/(?:^|[;&|]\s*|\bthen\s+)cd\s+(?:'([^'$]+)'|"([^"$]+)"|(\/[^\s;&|$'"]+))/g)) {
      dossier = cd[1] ?? cd[2] ?? cd[3] ?? dossier;
    }
  }
  const relatifs = new Set<string>();
  for (const ligne of lignes) {
    for (const m of ligne.matchAll(/(?:^|[\s'"=])((?:\/?[^\s'"$=]*\/)?\.output\/server\/index\.mjs)/g)) relatifs.add(m[1]);
    if (/\bvite\s+preview\b/.test(ligne)) relatifs.add('dist/index.html');
    if (/\bnuxt\s+preview\b/.test(ligne)) relatifs.add('.output/server/index.mjs');
    if (/\bnext\s+start\b/.test(ligne)) relatifs.add('.next/BUILD_ID');
  }
  const base = dossier.replace(/\/+$/, '');
  return [...new Set([...relatifs].map((r) => (r.startsWith('/') ? r : `${base}/${r.replace(/^\.\//, '')}`)))];
}

/**
 * LE SITE SERT-IL LE CODE QU'ON VIENT DE FUSIONNER ? Une construction servie
 * plus ancienne que le code déployé (la date du commit visé) dit que non : le
 * déploiement est alors un ÉCHEC, jamais un « réussi » menteur. Une
 * construction introuvable n'apprend rien (le service la refait peut-être
 * ailleurs).
 *
 * La référence est la date du CODE, pas le début du déploiement : une relance
 * sans nouvelle fusion trouve une construction faite avant le clic, mais bien
 * après le commit — elle sert le bon code (ProjetB, 25/09/2026 : chaque
 * « Relancer » échouait sur un site à jour). Sans date de commit lisible,
 * l'appelant retombe sur le début du déploiement.
 */
export function constructionPerimee(input: {
  constructions: readonly { chemin: string; modifieeLe?: number }[];
  dateDuCode: number;
}): string | undefined {
  const vieille = input.constructions.find((c) => c.modifieeLe !== undefined && c.modifieeLe < input.dateDuCode);
  if (!vieille) return undefined;
  const date = new Date(vieille.modifieeLe as number).toISOString().slice(0, 16).replace('T', ' à ');
  return (
    `Le site sert encore une construction du ${date} (UTC) — ${vieille.chemin} : le code fusionné n’y est pas. ` +
    'Réglez une commande de mise à jour qui reconstruit le site (par exemple « npm run build ») dans les réglages du déploiement du projet.'
  );
}

/** Ce que dit le déploiement d'un projet qui n'a ni commande ni service réglés. */
export const RECIT_SANS_MISE_A_JOUR =
  'Ni commande de mise à jour ni service réglés : le code est fusionné et envoyé, mais rien n’est reconstruit ni relancé. ' +
  'C’est suffisant si le site lit directement les fichiers du dossier ; sinon, réglez-les dans les réglages du déploiement.';

/**
 * LA RÉPONSE DE L'ÉCRAN AVANT LE CLIC : ce que le déploiement va faire, en une
 * phrase, calculée depuis les deux réglages.
 */
export function annonceDuDeploiement(input: {
  branche: string;
  commande?: string;
  service?: string;
  estBeluga?: boolean;
}): string {
  const morceaux = [`Fusion du lot dans « ${input.branche} », enregistrement et envoi`];
  if (input.estBeluga) {
    morceaux.push('construction de Beluga Build, installation, puis redémarrage dès que plus rien ne tourne');
  } else {
    if (input.commande) morceaux.push(`mise à jour par « ${input.commande} »`);
    const services = servicesARelancer({ service: input.service });
    if (services.length) morceaux.push(`redémarrage de ${services.join(', ')}`);
  }
  return `${morceaux.join(', ')}. Aucun agent n’intervient.`;
}

/* ------------------------------------------------------------------ */
/* Le processus de mise en production                                  */
/* ------------------------------------------------------------------ */

export type EtapeDuProcessus = {
  /** Ce que fait l'étape, en mots courants. */
  libelle: string;
  /** La commande exacte, jouée dans le dossier du projet. */
  commande: string;
  /** Sa durée maximale, en secondes. */
  delaiS: number;
};

export type ProcessusDeProduction = {
  /** Ce que l'agent a compris de la production, en quelques phrases. */
  resume?: string;
  /**
   * CE QUE L'AGENT A CONFIGURÉ, EN MOTS COURANTS : le texte qu'il écrit juste
   * avant le bloc du processus. L'onglet « Configuration » du tiroir le montre
   * tel quel, avant le bouton de mise en production.
   */
  explication?: string;
  etapes: EtapeDuProcessus[];
  /** Quand il a été écrit. */
  ecritLe?: number;
  /** Le message de l'agent qui l'a rendu : un même message ne s'enregistre qu'une fois. */
  depuisMessage?: string;
};

export const PROCESSUS_ETAPES_MAX = 20;
export const DELAI_ETAPE_DEFAUT_S = 300;
export const DELAI_ETAPE_MAX_S = 20 * 60;
export const RESUME_PROCESSUS_MAX = 1500;
export const EXPLICATION_PROCESSUS_MAX = 6000;

/** Un projet a-t-il un processus de mise en production ? */
export function aUnProcessus(projet: { miseEnProduction?: { processus?: ProcessusDeProduction } } | undefined): boolean {
  return (projet?.miseEnProduction?.processus?.etapes?.length ?? 0) > 0;
}

/** Normalise un processus reçu (de l'agent ou de l'écran) : bornes, textes, délais. */
export function normaliserProcessus(brut: unknown): { processus?: ProcessusDeProduction; erreur?: string } {
  if (!brut || typeof brut !== 'object') return { erreur: 'Le processus est vide.' };
  const objet = brut as { resume?: unknown; etapes?: unknown };
  if (!Array.isArray(objet.etapes) || objet.etapes.length === 0) {
    return { erreur: 'Le processus n’a aucune étape.' };
  }
  if (objet.etapes.length > PROCESSUS_ETAPES_MAX) {
    return { erreur: `Le processus a ${objet.etapes.length} étapes : ${PROCESSUS_ETAPES_MAX} au plus.` };
  }
  const etapes: EtapeDuProcessus[] = [];
  for (const [rang, e] of objet.etapes.entries()) {
    const etape = (e ?? {}) as { libelle?: unknown; commande?: unknown; delaiS?: unknown };
    const commande = typeof etape.commande === 'string' ? etape.commande.trim() : '';
    if (!commande) return { erreur: `L’étape ${rang + 1} n’a pas de commande.` };
    const libelle = (typeof etape.libelle === 'string' ? etape.libelle.trim() : '') || commande.slice(0, 80);
    const delai = Number(etape.delaiS);
    etapes.push({
      libelle: libelle.slice(0, 200),
      commande: commande.slice(0, 2000),
      delaiS: Number.isFinite(delai) && delai > 0 ? Math.min(Math.round(delai), DELAI_ETAPE_MAX_S) : DELAI_ETAPE_DEFAUT_S,
    });
  }
  const resume = typeof objet.resume === 'string' ? objet.resume.trim().slice(0, RESUME_PROCESSUS_MAX) : undefined;
  return { processus: { ...(resume ? { resume } : {}), etapes } };
}

export const DEBUT_PROCESSUS = '<<<PROCESSUS';
export const FIN_PROCESSUS = 'PROCESSUS>>>';

/**
 * LE PROCESSUS RENDU PAR L'AGENT D'INITIALISATION : un bloc JSON entre deux
 * repères. Ce qui précède le bloc est son explication en mots courants.
 */
export function lireProcessusRendu(texte: string): { processus?: ProcessusDeProduction; explication?: string; erreur?: string } {
  const debut = texte.lastIndexOf(DEBUT_PROCESSUS);
  if (debut < 0) return {};
  const fin = texte.indexOf(FIN_PROCESSUS, debut);
  if (fin < 0) return { erreur: 'Le bloc du processus n’est pas refermé.' };
  const explication = texte.slice(0, debut).trim().slice(0, EXPLICATION_PROCESSUS_MAX) || undefined;
  let brut: unknown;
  try {
    brut = JSON.parse(texte.slice(debut + DEBUT_PROCESSUS.length, fin).trim());
  } catch {
    return { explication, erreur: 'Le bloc du processus n’est pas un JSON lisible.' };
  }
  const lu = normaliserProcessus(brut);
  return lu.processus ? { processus: lu.processus, explication } : { explication, erreur: lu.erreur };
}

/** Le processus, lisible par un humain : c'est ce que montre la rubrique. */
export function processusEnTexte(processus: ProcessusDeProduction | undefined): string {
  if (!processus?.etapes?.length) return '';
  const lignes: string[] = [];
  if (processus.resume) lignes.push(processus.resume, '');
  processus.etapes.forEach((etape, rang) => {
    lignes.push(`${rang + 1}. ${etape.libelle} (${etape.delaiS} s au plus)`, `   $ ${etape.commande}`);
  });
  return lignes.join('\n');
}

/**
 * L'EXPLICATION À MONTRER dans l'onglet « Configuration ». Un processus écrit
 * avant qu'elle existe n'en a pas : on retombe alors sur son résumé, et le
 * détail des étapes reste à lire juste dessous — jamais un onglet vide.
 */
export function explicationDuProcessus(processus: ProcessusDeProduction | undefined): { texte: string; repli: boolean } {
  const explication = processus?.explication?.trim();
  if (explication) return { texte: explication, repli: false };
  return { texte: processus?.resume?.trim() ?? '', repli: true };
}

/** Le contexte donné à l'agent d'initialisation. */
export type ContexteDInitialisation = {
  projet: string;
  dossier: string;
  brancheTravail: string;
  brancheProduction: string;
  /** L'ancienne recette de mise en production, archivée lors de la refonte. */
  ancienneRecette?: string;
  /** Le processus actuel, quand on le refait. */
  actuel?: string;
  /** Les automatismes GitHub trouvés dans le dépôt. */
  automatismes?: string[];
};

/**
 * LE PROMPT DE L'AGENT D'INITIALISATION. Il ANALYSE puis INTERROGE : l'inverse
 * de l'ancien agent qui tranchait seul (MEM-1284, remplacée).
 */
export function promptInitialisationProduction(ctx: ContexteDInitialisation): string {
  return [
    `Tu prépares la MISE EN PRODUCTION du projet « ${ctx.projet} » (dossier ${ctx.dossier}).`,
    '',
    'Ce que Beluga Build fait déjà tout seul au clic sur « Mise en production », AVANT ton processus :',
    `- fusionner « ${ctx.brancheTravail} » dans « ${ctx.brancheProduction} » (avance rapide, sinon commit à deux parents, jamais de push forcé) ;`,
    `- envoyer « ${ctx.brancheProduction} » sur le dépôt distant (ce qui déclenche les automatismes GitHub branchés sur cette branche).`,
    'Puis il joue TON processus : une suite de commandes shell, dans le dossier du projet, SANS AGENT, arrêt net à la première qui échoue.',
    '',
    'TU AS L’ACCÈS COMPLET, SANS BRANCHE « tache/… » : tu travailles dans le dossier du projet, sur sa branche de travail. Tu peux modifier les fichiers du projet (configuration, scripts de déploiement, automatismes), préparer la machine de production (SSH, services, dossiers) et ranger dans le coffre-fort, une fiche par secret, tout accès que tu découvres.',
    `Ce que tu modifies dans le dépôt s’enregistre sur « ${ctx.brancheTravail} » : « git add » NOMMÉ fichier par fichier (jamais « git add -A » ni « git add . » — d’autres travaux vivent dans ce dossier), un seul commit par tour, poussé ; puis tu dis en clair ce que tu as changé.`,
    '',
    'Ta démarche, dans cet ordre :',
    '1. Analyse le projet : sa pile, sa construction, ses scripts de déploiement, ses automatismes GitHub, ses fichiers de configuration serveur. Le coffre-fort (outil coffre_fort) contient les accès : lis-le, ne recopie JAMAIS un secret dans une commande — réfère-toi aux fichiers ou variables déjà présents sur ce serveur.',
    '2. INTERROGE l’utilisateur avec l’outil ask_user sur tout ce qui décide du processus et que le projet ne dit pas avec certitude : où tourne la production (ce serveur, un autre serveur, un hébergeur, une procédure GitHub), comment on y accède, ce qu’il faut y faire, ce qu’on contrôle à la fin. Une question par appel, avec des choix quand c’est possible. Tu poses AU MOINS une question pour faire confirmer l’instance de production, même si tu crois la connaître.',
    '3. Prépare ce qui doit l’être (fichiers du projet, machine de production), sans jamais mettre en production.',
    '4. Quand tout est clair, rends ton EXPLICATION en mots simples, pour quelqu’un qui ne programme pas : où vit la production, ce que tu as configuré ou modifié, et ce que fera le bouton « Mise en production », étape par étape. Elle est affichée telle quelle dans l’onglet « Configuration ». Puis le processus dans ce bloc exact, en fin de réponse :',
    '',
    DEBUT_PROCESSUS,
    '{"resume": "…ce qu’est la production de ce projet, en deux phrases…", "etapes": [{"libelle": "Construire le site", "commande": "npm run build", "delaiS": 300}]}',
    FIN_PROCESSUS,
    '',
    'Règles du processus :',
    `- ${PROCESSUS_ETAPES_MAX} étapes au plus, chaque commande autonome (non interactive), relançable sans dégât, avec un délai réaliste (${DELAI_ETAPE_MAX_S} s au plus).`,
    '- Ni fusion ni envoi git : c’est déjà fait avant toi. Un déclenchement GitHub se fait par « gh workflow run … » puis « gh run watch … --exit-status » si le projet passe par là.',
    '- La dernière étape CONTRÔLE le résultat quand c’est possible (par exemple curl -fsS sur l’adresse publique).',
    '- Tu n’exécutes RIEN qui mette en production pendant ce tour : tu écris le processus, c’est l’utilisateur qui décidera du moment.',
    '',
    ctx.automatismes?.length ? `Automatismes GitHub présents : ${ctx.automatismes.join(', ')}.` : 'Aucun automatisme GitHub dans le dépôt.',
    ctx.actuel ? `\nProcessus actuel (à refaire) :\n${ctx.actuel}` : '',
    ctx.ancienneRecette
      ? `\nAncienne recette de mise en production (archivée à la refonte, peut être périmée — à faire confirmer) :\n${ctx.ancienneRecette}`
      : '',
  ]
    .filter((ligne) => ligne !== '')
    .join('\n');
}

/** La suite du dialogue : l'agent a déjà tout lu. */
export function promptSuiteInitialisation(message: string): string {
  return [
    `L’utilisateur écrit : ${message}`,
    '',
    consigneDeConfiguration(),
  ].join('\n');
}

/**
 * LE RAPPEL QUI ACCOMPAGNE CHAQUE MESSAGE écrit à l'agent de configuration
 * depuis la conversation du tiroir. Il continue la même session : il sait déjà
 * tout, mais le bloc du processus est ce qui met à jour l'onglet
 * « Configuration » — il doit le rendre en entier dès que le processus change.
 */
export function consigneDeConfiguration(): string {
  return [
    'Tu es l’agent de CONFIGURATION de la mise en production de ce projet : l’utilisateur te parle depuis le tiroir « Mise en production ».',
    `Tiens-en compte. S’il te manque quelque chose de décisif, pose-le avec ask_user. Si le processus change, rends ton explication en mots simples puis le bloc ${DEBUT_PROCESSUS} … ${FIN_PROCESSUS} COMPLET, en fin de réponse : c’est lui qui met à jour l’onglet « Configuration ». Sinon, réponds simplement.`,
    'Fichiers du projet modifiés : « git add » nommé fichier par fichier, un commit poussé sur la branche de travail, et dis ce que tu as changé. Tu ne lances JAMAIS la mise en production : seul le bouton de l’utilisateur le fait.',
  ].join('\n');
}
