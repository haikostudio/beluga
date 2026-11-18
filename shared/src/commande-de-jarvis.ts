/**
 * LA COMMANDE GÉNÉRALE DE JARVIS (décision de l'utilisateur, 17/11/2026 : « je veux qu'il puisse tout faire dans
 * Beluga, plus jamais « je ne peux pas » »). L'outil `beluga_commande` de l'assistant joue N'IMPORTE QUELLE commande
 * de l'interface (le protocole du navigateur, `ClientCommand`) par la MÊME porte que les boutons, au nom du compte qui
 * parle. Règles pures ici :
 *
 *   - une liste FERMÉE minimale : la session et l'authentification, la conversation vocale elle-même, le redémarrage
 *     du démon (qui passe par « assistant_gestes » « redemarrer », gardé par la règle « jamais pendant une publication
 *     ou une tâche ») ;
 *   - ce qui NE SE DÉFAIT PAS exige `confirme: true`, posé seulement après le « oui » dit à voix haute : mettre en
 *     production, payer, écrire à un client, supprimer (même liste que la consigne de la voix) ;
 *   - un résumé d'une ligne par famille, pour que Codex trouve la commande qu'il lui faut.
 */

/** Les commandes que Jarvis ne joue JAMAIS par cette porte, et pourquoi. */
const FERMEES: readonly { motif: RegExp; raison: string }[] = [
  { motif: /^(hello|ping|acks\.reclamer|ecran\.perimetre)$/, raison: 'commande de la connexion de l’écran, sans objet pour Jarvis' },
  { motif: /^(voix\.|jarvis\.)/, raison: 'la conversation vocale se pilote elle-même' },
  { motif: /^(comptes\.motDePasse|espace\.moi\.motDePasse|espace\.moi\.identifiant|installation\.secret)$/, raison: 'mot de passe ou secret de session : réservé à la personne elle-même' },
  {
    motif: /^daemon\.restart$/,
    raison: 'le redémarrage passe par « assistant_gestes » « redemarrer », qui attend la fin des publications et des tâches',
  },
];

/** Ce qui ne se défait pas : la nature, dite à voix haute avant le « oui ». */
const A_CONFIRMER: readonly { motif: RegExp; nature: string }[] = [
  { motif: /^production\.|^deploy\.verifierProduction$/, nature: 'une mise en production' },
  { motif: /^billing\.push$|^studio\.depense\.valider$|^studio\.credit$|^studio\.voix\.valider$/, nature: 'un paiement' },
  {
    motif: /^(espace\.fil\.envoyer|espace\.demande\.commenter|plaquettes\.publier|plaquettes\.repondre|marketing\.contenu\.publier|marketing\.message\.repondre)$/,
    nature: 'un message à un client',
  },
  {
    motif: /(delete|remove|supprimer|supprimerDefinitivement|retirer|corbeille|vider|delier|revoquer|oublier|effacer|abandon|purge)/i,
    nature: 'une suppression',
  },
];

export type VerdictDeCommande = { ok: true; aConfirmer?: string } | { ok: false; raison: string };

/**
 * Que fait-on d'une commande demandée par Jarvis ? Fermée : refusée, avec la raison. Irréversible : `aConfirmer`
 * nomme ce qu'il faut redire à voix haute (la porte la refuse tant que `confirme` n'est pas vrai). Un déploiement
 * n'est irréversible que vers la PRODUCTION (`cible`).
 */
export function verdictDeLaCommande(type: string, donnees: Record<string, unknown> = {}): VerdictDeCommande {
  const nom = (type ?? '').trim();
  if (!nom) return { ok: false, raison: 'Commande sans « type ».' };
  const fermee = FERMEES.find((f) => f.motif.test(nom));
  if (fermee) return { ok: false, raison: `« ${nom} » n’est pas jouable par Jarvis : ${fermee.raison}.` };
  if ((nom === 'deploy.start' || nom === 'deploy.retry') && donnees.cible === 'production') return { ok: true, aConfirmer: 'une mise en production' };
  const grave = A_CONFIRMER.find((c) => c.motif.test(nom));
  return grave ? { ok: true, aConfirmer: grave.nature } : { ok: true };
}

/** Le résumé d'une famille de commandes, en mots courants : ce que Codex lit dans « lister ». */
const FAMILLES: Record<string, string> = {
  account: 'comptes des moteurs (Claude, Codex, Cursor) : relier, renommer, ordonner',
  agent: 'un agent : lui écrire (agent.prompt), l’arrêter, le suspendre, le régler, repartir de zéro',
  agents: 'tous les agents : tout arrêter',
  assistant: 'l’assistant (Jarvis) : son agent, son nom',
  attachment: 'pièces jointes',
  attachments: 'pièces jointes d’un projet',
  backup: 'sauvegardes du serveur',
  backups: 'sauvegardes des sites',
  belugapass: 'Beluga Pass',
  billing: 'facturation',
  card: 'une carte : créer, modifier, déplacer, lancer (card.start), valider, programmer, supprimer',
  cards: 'listes de cartes',
  carte: 'une carte',
  chartes: 'chartes graphiques',
  cleApi: 'clés d’accès de services extérieurs',
  coffre: 'coffre-fort des identifiants',
  comment: 'commentaires de carte',
  communication: 'communication et réseaux sociaux',
  competence: 'compétences partagées',
  comprehension: 'compréhension d’une carte',
  compte: 'le compte de la personne (prénom, clés)',
  comptes: 'comptes des personnes (créer, droits, suspendre)',
  copieDeTest: 'copie de test',
  cursor: 'le moteur Cursor',
  daemon: 'le démon',
  deploy: 'déploiement et mise en production : lancer (deploy.start, cible dev|production), arrêter, dépanner, historique',
  deploys: 'liste des mises en ligne',
  donnees: 'export et import des données',
  engine: 'ordre des moteurs',
  engines: 'liste des moteurs',
  erreur: 'erreurs signalées',
  erreurs: 'erreurs signalées',
  espace: 'espace client : demandes, fils, accès des clients',
  extension: 'extension Chrome reliée',
  fichiers: 'fichiers du serveur',
  files: 'fichiers d’un projet',
  github: 'GitHub',
  group: 'groupes de projets de la colonne',
  installation: 'installation et réglages du serveur',
  juge: 'le juge rapide',
  marketing: 'atelier réseaux sociaux d’un projet',
  medias: 'médias fabriqués',
  memoire: 'mémoire des projets',
  memory: 'mémoire des projets',
  moteurs: 'moteurs des agents',
  ordinateur: 'ordinateurs reliés',
  plan: 'plan d’une carte',
  plaquettes: 'plaquettes clients',
  prefs: 'préférences de l’écran (prefs.set, dont les brouillons draft.<agent>)',
  procedure: 'procédure de déploiement d’un projet',
  process: 'processus d’un projet',
  production: 'mise en production',
  project: 'un projet : créer, ouvrir, modifier, archiver, supprimer',
  projects: 'liste des projets',
  projet: 'copies de travail d’un projet',
  proposal: 'cartes proposées par un agent : décider, valider',
  question: 'questions posées par un agent : répondre, annuler',
  queue: 'file d’attente des messages',
  quota: 'quotas des moteurs',
  realisation: 'mode réalisation',
  recherche: 'recherche globale',
  regroupement: 'projets réunis',
  relaisMac: 'relais du Mac',
  reprise: 'reprise sur un autre compte',
  securite: 'audits de sécurité',
  serveur: 'disque et ménage du serveur',
  services: 'services créés',
  servicesIa: 'services d’IA',
  settings: 'réglages généraux (settings.update)',
  sidebar: 'ordre de la colonne de gauche',
  slash: 'commandes « / »',
  statistiques: 'statistiques des visites',
  stats: 'statistiques d’usage',
  studio: 'Studio : visuels et vidéos',
  suites: 'suites proposées',
  surveillance: 'surveillance des sites',
  veilles: 'tâches récurrentes',
  visages: 'visages du Studio',
};

/** Le résumé d'une commande : celui de sa famille (le préfixe avant le premier point). */
export function resumeDeLaCommande(type: string): string {
  const famille = type.split('.')[0] ?? type;
  return FAMILLES[famille] ?? 'commande de l’interface';
}

/**
 * LE CATALOGUE rendu par « lister » : une ligne par commande, `type(champ, champ?)` — les champs suivis de « ? » sont
 * facultatifs —, rangées par famille avec le résumé de la famille. `filtre` garde les commandes dont le type ou le
 * résumé contient ce mot (sans accents ni casse).
 */
export function catalogueDesCommandes(commandes: readonly { type: string; champs: readonly string[] }[], filtre = ''): string {
  const plat = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const voulu = plat(filtre.trim());
  const parFamille = new Map<string, string[]>();
  for (const c of [...commandes].sort((a, b) => a.type.localeCompare(b.type))) {
    if (!verdictDeLaCommande(c.type).ok) continue;
    const resume = resumeDeLaCommande(c.type);
    if (voulu && !plat(`${c.type} ${resume}`).includes(voulu)) continue;
    const famille = c.type.split('.')[0] ?? c.type;
    const ligne = `${c.type}(${c.champs.join(', ')})${verdictDeLaCommande(c.type).ok && (verdictDeLaCommande(c.type) as { aConfirmer?: string }).aConfirmer ? ' — À CONFIRMER à voix haute' : ''}`;
    parFamille.set(famille, [...(parFamille.get(famille) ?? []), ligne]);
  }
  if (!parFamille.size) return voulu ? `Aucune commande ne parle de « ${filtre} ». Relance « lister » sans filtre.` : 'Aucune commande.';
  return [...parFamille.entries()]
    .map(([famille, lignes]) => `## ${famille} — ${FAMILLES[famille] ?? 'commande de l’interface'}\n${lignes.map((l) => `- ${l}`).join('\n')}`)
    .join('\n');
}
