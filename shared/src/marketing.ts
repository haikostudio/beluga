/**
 * L'ATELIER MARKETING — les règles pures, sans base ni réseau.
 *
 * Chaque projet a UN agent marketing attitré (`server/src/assistant-marketing.ts`)
 * qui étudie le produit, écrit sa CONFIGURATION (nature, hébergement, sources
 * de ventes, façon de poser le script de suivi) et sa FICHE commerciale, puis
 * rédige des CONTENUS à valider. Ici : ce que ces objets valent, les étapes
 * d'un contenu et qui peut les franchir, le calcul du Guide, les chiffres
 * montrés selon la nature du produit, l'attribution d'une vente au contenu qui
 * l'a amenée, le verdict d'un test à deux versions, le script de suivi et la
 * phrase de confidentialité.
 *
 * TROIS PRINCIPES QUI NE BOUGENT PAS.
 *  1. **RIEN NE PART SANS UN GESTE HUMAIN.** L'agent ne dépose qu'en
 *     « Brouillon » ou « À valider » ; « Prêt », « Programmé » et « Publié »
 *     sont des gestes de l'utilisateur (`transitionPermise`).
 *  2. **LE SUIVI EST ANONYME ET SANS COOKIE.** Aucun nom, aucune adresse, aucun
 *     visiteur reconnu d'un jour à l'autre (`extraitDeSuivi`,
 *     `jugerEvenementDeSuivi`).
 *  3. **LE SCRIPT N'EST JAMAIS POSÉ EN CACHETTE.** Il passe par une carte, un
 *     geste annoncé dans une plateforme, ou une marche à suivre — toujours avec
 *     la phrase de confidentialité (`phraseDeConfidentialite`).
 */

/* ------------------------------------------------------------------ */
/* Vocabulaire                                                         */
/* ------------------------------------------------------------------ */

export const LABEL_MARKETING = 'marketing';

/**
 * UNE CARTE DE L'AGENT MARKETING NE VIT QUE DANS L'OUTIL MARKETING (demande du
 * 26/09/2026). Son analyse, le plan de la semaine, la pose du suivi : ces
 * cartes ne paraissent ni sur le tableau du projet, ni sur « En route », ni
 * sur les tableaux de bord — elles se suivent dans l'onglet Contenus de
 * l'atelier. Leurs QUESTIONS, elles, alertent toujours (cloche, triangle) :
 * seule la carte est retirée des listes, jamais la décision qu'elle attend.
 */
export function estCarteMarketing(carte: { labels?: readonly string[] | null } | null | undefined): boolean {
  return !!carte?.labels?.includes(LABEL_MARKETING);
}

export const NATURES_PRODUIT = ['site', 'boutique', 'app', 'saas'] as const;
export type NatureProduit = (typeof NATURES_PRODUIT)[number];

export const GENRES_HEBERGEMENT = ['beluga', 'serveur-distant', 'hebergeur', 'plateforme'] as const;
export type GenreHebergement = (typeof GENRES_HEBERGEMENT)[number];

export const SOURCES_VENTES = ['suivi', 'stripe', 'shopify', 'woocommerce', 'compta'] as const;
export type SourceVentes = (typeof SOURCES_VENTES)[number];

export const METHODES_SUIVI = ['carte-code', 'plateforme', 'manuel'] as const;
export type MethodeSuivi = (typeof METHODES_SUIVI)[number];

export const ETATS_SUIVI = ['absent', 'pose', 'verifie'] as const;
export type EtatSuivi = (typeof ETATS_SUIVI)[number];

/**
 * LE CATALOGUE DES CANAUX — tout ce qui peut amener un client, pas seulement
 * trois réseaux. L'utilisateur est débutant : l'écran Canaux les montre TOUS,
 * rangés par famille, et l'agent dit pour chacun s'il convient au produit
 * (`RecommandationCanal`). L'ordre est celui de l'affichage.
 */
export const FAMILLES_CANAL = ['reseaux', 'direct', 'recherche', 'payant', 'relais'] as const;
export type FamilleCanal = (typeof FAMILLES_CANAL)[number];

export interface CanalDuCatalogue {
  cle: string;
  famille: FamilleCanal;
  /** Le nom affiché : un nom propre ne se traduit pas, le reste passe par le dictionnaire. */
  libelle: string;
  /** À quoi il sert, en une phrase pour un débutant. */
  description: string;
  /** Un contenu peut-il y être rédigé et daté dans le calendrier ? */
  publiable: boolean;
}

export const CATALOGUE_CANAUX: readonly CanalDuCatalogue[] = [
  { cle: 'linkedin', famille: 'reseaux', libelle: 'LinkedIn', description: 'Le réseau des professionnels : idéal pour vendre à des entreprises ou des indépendants.', publiable: true },
  { cle: 'facebook', famille: 'reseaux', libelle: 'Facebook', description: 'Un large public, des groupes par passion ou par région, souvent plus de 35 ans.', publiable: true },
  { cle: 'instagram', famille: 'reseaux', libelle: 'Instagram', description: 'Des images et des vidéos courtes : parfait quand le produit se montre bien.', publiable: true },
  { cle: 'tiktok', famille: 'reseaux', libelle: 'TikTok', description: 'Des vidéos courtes et spontanées, un public jeune, une portée qui peut exploser.', publiable: true },
  { cle: 'youtube', famille: 'reseaux', libelle: 'YouTube', description: 'Des vidéos longues qui expliquent ou démontrent, et qu’on retrouve des années après.', publiable: true },
  { cle: 'x', famille: 'reseaux', libelle: 'X', description: 'Des messages courts, l’actualité et les milieux tech, médias ou politiques.', publiable: true },
  { cle: 'threads', famille: 'reseaux', libelle: 'Threads', description: 'Des messages courts, reliés à Instagram, un ton plus détendu.', publiable: true },
  { cle: 'pinterest', famille: 'reseaux', libelle: 'Pinterest', description: 'Des idées en images (déco, mode, cuisine, mariage) qui mènent vers les sites.', publiable: true },
  { cle: 'reddit', famille: 'reseaux', libelle: 'Reddit', description: 'Des communautés par sujet, exigeantes : on y aide avant de vendre.', publiable: true },
  { cle: 'courriel', famille: 'direct', libelle: 'Lettre d’information', description: 'Des courriels réguliers à ceux qui se sont inscrits : le canal qui vend le plus, et qui vous appartient.', publiable: true },
  { cle: 'bouche-a-oreille', famille: 'direct', libelle: 'Bouche-à-oreille et parrainage', description: 'Vos clients contents en amènent d’autres, surtout si on les y invite ou les récompense.', publiable: false },
  { cle: 'site', famille: 'recherche', libelle: 'Référencement et blog', description: 'Des pages et des articles qui répondent aux questions des gens, pour être trouvé sur Google sans payer.', publiable: true },
  { cle: 'google-business', famille: 'recherche', libelle: 'Fiche Google (Maps)', description: 'La fiche qui s’affiche sur Google Maps : indispensable pour un commerce ou un service local.', publiable: true },
  { cle: 'annuaires', famille: 'recherche', libelle: 'Annuaires, comparateurs et places de marché', description: 'Être listé là où les gens comparent avant d’acheter (annuaires, comparateurs, magasins d’applications).', publiable: false },
  { cle: 'publicite-recherche', famille: 'payant', libelle: 'Publicité sur Google', description: 'Apparaître en tête quand quelqu’un cherche exactement ce que vous vendez. On paie au clic.', publiable: true },
  { cle: 'publicite-reseaux', famille: 'payant', libelle: 'Publicité sur les réseaux', description: 'Montrer une annonce à un public choisi (âge, région, intérêts) sur Facebook, Instagram, LinkedIn…', publiable: true },
  { cle: 'communautes', famille: 'relais', libelle: 'Communautés et lancements', description: 'Forums, groupes spécialisés, Product Hunt : présenter le produit à ceux qu’il passionne.', publiable: true },
  { cle: 'partenariats', famille: 'relais', libelle: 'Partenariats et affiliation', description: 'D’autres marques ou créateurs qui parlent de vous à leur public, contre une commission ou un échange.', publiable: false },
  { cle: 'presse', famille: 'relais', libelle: 'Presse et blogs', description: 'Un article dans un média ou chez un blogueur : de la crédibilité et des visites d’un coup.', publiable: true },
  { cle: 'evenements', famille: 'relais', libelle: 'Salons et événements', description: 'Rencontrer les clients en vrai : salons, marchés, conférences, ateliers.', publiable: false },
];

export const CLES_CANAUX = CATALOGUE_CANAUX.map((c) => c.cle);

/** Le nom de chaque famille, en tête de son groupe sur l'écran Canaux. */
export const LIBELLE_FAMILLE_CANAL: Readonly<Record<FamilleCanal, string>> = {
  reseaux: 'Réseaux sociaux',
  direct: 'Contact direct',
  recherche: 'Être trouvé',
  payant: 'Publicité',
  relais: 'Relais et rencontres',
};

/**
 * LE PARCOURS PAS À PAS D'UN CANAL — la base, écrite une fois, valable pour
 * tous les produits : par où passer, dans l'ordre, pour qu'un débutant sache
 * quoi faire. L'agent la COMPLÈTE par ses conseils propres au produit
 * (`RecommandationCanal.premierPas` et `.etapes`), il ne la remplace pas.
 * Chaque texte est traduit dans le dictionnaire, comme la description du canal.
 */
export interface EtapeDeParcours {
  titre: string;
  detail: string;
}

export const PARCOURS_DES_CANAUX: Readonly<Record<string, readonly EtapeDeParcours[]>> = {
  linkedin: [
    { titre: 'Créer le compte', detail: 'Créez une page entreprise depuis votre profil personnel, qui reste la voix principale.' },
    { titre: 'Soigner le profil', detail: 'Un titre qui dit ce que vous apportez, une photo nette et un lien vers le site.' },
    { titre: 'Publier un premier contenu', detail: 'Racontez un problème concret de vos clients et comment vous le résolvez, en quelques paragraphes courts.' },
    { titre: 'Tenir le rythme', detail: 'Deux publications par semaine, et commentez chaque jour quelques messages de votre milieu.' },
    { titre: 'Mesurer et ajuster', detail: 'Regardez chaque mois quels messages amènent des visites ou des contacts, et refaites-en de semblables.' },
  ],
  facebook: [
    { titre: 'Créer le compte', detail: 'Créez une page pour votre activité, distincte de votre profil personnel.' },
    { titre: 'Soigner le profil', detail: 'Photo de couverture, description courte, horaires ou lien vers le site : tout ce qu’un curieux cherche.' },
    { titre: 'Échanger avec le public', detail: 'Rejoignez deux ou trois groupes où vos clients se retrouvent, et aidez avant de parler de vous.' },
    { titre: 'Tenir le rythme', detail: 'Une à deux publications par semaine, avec une photo ou une courte vidéo à chaque fois.' },
    { titre: 'Mesurer et ajuster', detail: 'Les statistiques de la page disent ce qui plaît : gardez ce qui fait réagir, abandonnez le reste.' },
  ],
  instagram: [
    { titre: 'Créer le compte', detail: 'Créez un compte professionnel : il donne les statistiques et un bouton de contact.' },
    { titre: 'Soigner le profil', detail: 'Une bio d’une phrase qui dit pour qui vous êtes, et un lien vers votre site.' },
    { titre: 'Publier un premier contenu', detail: 'Commencez par neuf publications soignées pour que la grille donne envie dès la première visite.' },
    { titre: 'Tenir le rythme', detail: 'Trois publications par semaine, dont des vidéos courtes, et des stories presque chaque jour.' },
    { titre: 'Mesurer et ajuster', detail: 'Chaque mois, repérez les publications les plus enregistrées et partagées, et déclinez-les.' },
  ],
  tiktok: [
    { titre: 'Créer le compte', detail: 'Créez un compte professionnel et regardez une semaine de vidéos de votre sujet pour en saisir le ton.' },
    { titre: 'Publier un premier contenu', detail: 'Une vidéo de 15 à 30 secondes, filmée au téléphone, qui montre le produit en action dès la première seconde.' },
    { titre: 'Tenir le rythme', detail: 'Trois à cinq vidéos par semaine : la régularité compte plus que la perfection.' },
    { titre: 'Échanger avec le public', detail: 'Répondez aux commentaires, parfois par une nouvelle vidéo : c’est ce qui fait revenir.' },
    { titre: 'Mesurer et ajuster', detail: 'Regardez combien de temps on reste sur chaque vidéo, et gardez les débuts qui retiennent le mieux.' },
  ],
  youtube: [
    { titre: 'Créer le compte', detail: 'Créez une chaîne au nom du produit, avec une bannière et une description claire.' },
    { titre: 'Trouver les sujets', detail: 'Listez les questions que vos clients tapent dans une recherche : chacune peut devenir une vidéo.' },
    { titre: 'Publier un premier contenu', detail: 'Une démonstration de 3 à 8 minutes, avec un titre qui reprend la question et une miniature lisible.' },
    { titre: 'Tenir le rythme', detail: 'Une vidéo tous les quinze jours suffit, et découpez-en des extraits courts pour les autres réseaux.' },
    { titre: 'Mesurer et ajuster', detail: 'Suivez le taux de clics sur la miniature et la durée de visionnage, puis améliorez-les.' },
  ],
  x: [
    { titre: 'Créer le compte', detail: 'Créez le compte au nom du produit, avec une bio claire et un lien vers le site.' },
    { titre: 'Observer d’abord', detail: 'Suivez les personnes qui comptent dans votre milieu et lisez ce qui les fait réagir.' },
    { titre: 'Publier un premier contenu', detail: 'Un fil de quelques messages qui raconte ce que vous construisez et pourquoi.' },
    { titre: 'Tenir le rythme', detail: 'Un message par jour et des réponses aux autres : ici, la conversation compte plus que l’annonce.' },
  ],
  threads: [
    { titre: 'Créer le compte', detail: 'Ouvrez Threads depuis votre compte Instagram : le profil et les abonnés suivent.' },
    { titre: 'Publier un premier contenu', detail: 'Présentez-vous simplement et posez une question à votre public.' },
    { titre: 'Tenir le rythme', detail: 'Quelques messages courts par semaine, sur un ton détendu, et répondez à chacun.' },
    { titre: 'Mesurer et ajuster', detail: 'Gardez les sujets qui lancent des conversations, et renvoyez-les vers Instagram ou le site.' },
  ],
  pinterest: [
    { titre: 'Créer le compte', detail: 'Créez un compte professionnel et reliez-le à votre site pour que vos épingles portent votre nom.' },
    { titre: 'Soigner le profil', detail: 'Ouvrez quelques tableaux thématiques, nommés comme les gens cherchent.' },
    { titre: 'Publier un premier contenu', detail: 'Des images verticales avec un court texte dessus, chacune menant vers une page précise du site.' },
    { titre: 'Tenir le rythme', detail: 'Quelques épingles par semaine, régulièrement : elles continuent d’amener des visites pendant des mois.' },
  ],
  reddit: [
    { titre: 'Observer d’abord', detail: 'Trouvez deux ou trois communautés de votre sujet et lisez leurs règles avant tout.' },
    { titre: 'Échanger avec le public', detail: 'Répondez utilement pendant quelques semaines, sans lien vers vous : la confiance se gagne ainsi.' },
    { titre: 'Publier un premier contenu', detail: 'Partagez une expérience honnête ou un retour d’expérience, là où les règles l’autorisent.' },
    { titre: 'Mesurer et ajuster', detail: 'Notez quelles questions reviennent : elles donnent des idées de contenus et d’améliorations.' },
  ],
  courriel: [
    { titre: 'Choisir l’outil', detail: 'Choisissez un outil d’envoi de lettres (gratuit au début) et reliez-le au site.' },
    { titre: 'Récolter des inscriptions', detail: 'Posez un formulaire d’inscription sur le site, avec une bonne raison de s’inscrire.' },
    { titre: 'Écrire l’accueil', detail: 'Un premier courriel automatique qui remercie, se présente et donne quelque chose d’utile.' },
    { titre: 'Tenir le rythme', detail: 'Une lettre toutes les deux semaines, toujours le même jour, avec un seul message principal.' },
    { titre: 'Mesurer et ajuster', detail: 'Regardez le taux d’ouverture et les clics, et essayez d’autres objets de message.' },
  ],
  'bouche-a-oreille': [
    { titre: 'Inviter à recommander', detail: 'Après une bonne expérience, demandez simplement au client s’il connaît quelqu’un que ça aiderait.' },
    { titre: 'Récompenser', detail: 'Offrez un petit avantage au client qui recommande et à celui qui arrive.' },
    { titre: 'Préparer le dossier', detail: 'Donnez-leur de quoi parler de vous : un lien à partager, une phrase toute prête.' },
    { titre: 'Suivre les résultats', detail: 'Demandez à chaque nouveau client comment il vous a connu, et notez-le.' },
  ],
  site: [
    { titre: 'Trouver les sujets', detail: 'Listez les questions que vos clients se posent avant d’acheter : chacune est un article possible.' },
    { titre: 'Publier un premier contenu', detail: 'Un article qui répond vraiment à une question, avec la question en titre.' },
    { titre: 'Tenir le rythme', detail: 'Un article par semaine ou tous les quinze jours, et reliez les articles entre eux.' },
    { titre: 'Mesurer et ajuster', detail: 'Inscrivez le site dans l’outil gratuit de Google pour voir sur quelles recherches il apparaît.' },
  ],
  'google-business': [
    { titre: 'Créer le compte', detail: 'Créez ou réclamez la fiche de votre activité, puis validez-la avec le code reçu.' },
    { titre: 'Soigner le profil', detail: 'Horaires, adresse, catégorie juste et une dizaine de photos réelles.' },
    { titre: 'Demander des avis', detail: 'Demandez à vos clients contents de laisser un avis, et répondez à chacun.' },
    { titre: 'Tenir le rythme', detail: 'Une nouvelle photo ou une actualité par mois garde la fiche vivante.' },
  ],
  annuaires: [
    { titre: 'Dresser la liste', detail: 'Repérez les annuaires, comparateurs ou magasins d’applications où vos clients comparent.' },
    { titre: 'Soigner le profil', detail: 'Remplissez chaque fiche en entier : mêmes nom, description et lien partout.' },
    { titre: 'Demander des avis', detail: 'Invitez vos premiers clients à y laisser une note : c’est elle qui fait choisir.' },
    { titre: 'Suivre les résultats', detail: 'Regardez chaque trimestre lesquels amènent des visites, et laissez tomber les autres.' },
  ],
  'publicite-recherche': [
    { titre: 'Préparer la page d’arrivée', detail: 'Une page claire qui répond exactement à ce que la personne a cherché, avec un seul bouton.' },
    { titre: 'Choisir la cible', detail: 'Choisissez quelques mots très précis, ceux qu’emploie quelqu’un prêt à acheter.' },
    { titre: 'Fixer un petit budget', detail: 'Commencez petit, avec un plafond par jour, pendant deux à trois semaines.' },
    { titre: 'Mesurer et ajuster', detail: 'Comparez le coût d’un client obtenu à ce qu’il rapporte, puis coupez ce qui ne rapporte pas.' },
  ],
  'publicite-reseaux': [
    { titre: 'Choisir la cible', detail: 'Décrivez votre client type : âge, région, centres d’intérêt.' },
    { titre: 'Rédiger l’annonce', detail: 'Préparez deux ou trois visuels et textes différents pour voir lequel marche.' },
    { titre: 'Fixer un petit budget', detail: 'Un petit budget quotidien pendant une à deux semaines, jamais plus au départ.' },
    { titre: 'Mesurer et ajuster', detail: 'Gardez l’annonce qui amène des clients au meilleur prix, arrêtez les autres.' },
  ],
  communautes: [
    { titre: 'Observer d’abord', detail: 'Repérez les forums et groupes où votre sujet passionne, et participez avant de présenter quoi que ce soit.' },
    { titre: 'Préparer le lancement', detail: 'Préparez une présentation courte, des images, et prévenez vos proches de la date.' },
    { titre: 'Le jour du lancement', detail: 'Publiez tôt, restez disponible toute la journée et répondez à chaque question.' },
    { titre: 'Relancer après', detail: 'Remerciez, notez les retours et écrivez aux personnes intéressées.' },
  ],
  partenariats: [
    { titre: 'Dresser la liste', detail: 'Listez les marques ou créateurs qui parlent déjà à vos clients sans vous faire concurrence.' },
    { titre: 'Préparer le dossier', detail: 'Décidez ce que vous offrez : une commission, un échange, un code de réduction.' },
    { titre: 'Prendre contact', detail: 'Un message court et personnel à chacun, qui dit ce qu’il y gagne.' },
    { titre: 'Suivre les résultats', detail: 'Donnez à chaque partenaire son lien de suivi pour savoir qui amène des clients.' },
  ],
  presse: [
    { titre: 'Préparer le dossier', detail: 'Une page presse avec une présentation courte, des photos et votre contact.' },
    { titre: 'Dresser la liste', detail: 'Repérez les journalistes et blogueurs qui ont déjà écrit sur votre sujet.' },
    { titre: 'Prendre contact', detail: 'Un message personnel avec un angle qui intéresse leurs lecteurs, pas une publicité.' },
    { titre: 'Relancer après', detail: 'Une relance polie une semaine plus tard, puis partagez chaque article obtenu.' },
  ],
  evenements: [
    { titre: 'Choisir les rendez-vous', detail: 'Repérez les salons, marchés ou conférences où vos clients se rendent vraiment.' },
    { titre: 'Préparer le dossier', detail: 'Un support simple à montrer, de quoi noter les contacts et une offre du jour.' },
    { titre: 'Sur place', detail: 'Faites essayer ou montrez le produit, et notez chaque personne intéressée.' },
    { titre: 'Relancer après', detail: 'Écrivez à chaque contact dans la semaine qui suit, tant que le souvenir est frais.' },
  ],
};

export function parcoursDuCanal(cle: string): readonly EtapeDeParcours[] {
  return PARCOURS_DES_CANAUX[cle] ?? [];
}

export type Reseau = string;

export function canalDuCatalogue(cle: string): CanalDuCatalogue | undefined {
  return CATALOGUE_CANAUX.find((c) => c.cle === cle);
}

/** Les canaux où un CONTENU peut se ranger : ceux du catalogue qui se publient, plus « autre ». */
export const CANAUX_CONTENU = [...CATALOGUE_CANAUX.filter((c) => c.publiable).map((c) => c.cle), 'autre'] as const;
export type CanalContenu = string;

export const PERTINENCES = ['haute', 'moyenne', 'faible'] as const;
export type Pertinence = (typeof PERTINENCES)[number];

/** L'AVIS DE L'AGENT SUR UN CANAL : convient-il, pourquoi, et par quoi commencer. */
export interface RecommandationCanal {
  canal: string;
  pertinence: Pertinence;
  raison: string;
  premierPas?: string;
  /** Les conseils de l'agent propres au produit, affichés avec le parcours de base. */
  etapes?: string[];
}

export const GENRES_CONTENU = ['post', 'courriel', 'page', 'annonce', 'argumentaire'] as const;
export type GenreContenu = (typeof GENRES_CONTENU)[number];

export const ETAPES_CONTENU = ['brouillon', 'a_valider', 'pret', 'programme', 'publie', 'echec', 'abandonne'] as const;
export type EtapeContenu = (typeof ETAPES_CONTENU)[number];

export const ORIGINES_CONTENU = ['agent', 'humain', 'nouveaute', 'hebdo'] as const;
export type OrigineContenu = (typeof ORIGINES_CONTENU)[number];

export const LANGUES_MARKETING = ['fr', 'en', 'de', 'it', 'es'] as const;
export type LangueMarketing = (typeof LANGUES_MARKETING)[number];

export interface ConfigurationMarketing {
  nature?: NatureProduit;
  hebergement?: GenreHebergement;
  /** Où tourne la production, dit en clair (« VPS OVH », « Shopify »…). */
  hebergementDetail?: string;
  /** L'adresse publique du produit. */
  adresse?: string;
  /** Les origines autorisées à envoyer des visites (https://exemple.ch). */
  origines: string[];
  sourcesVentes: SourceVentes[];
  /** Les objectifs suivis : « inscription », « contact », « achat »… */
  objectifs: string[];
  canaux: Reseau[];
  /** L'avis de l'agent sur chaque canal du catalogue qu'il a étudié. */
  recommandations: RecommandationCanal[];
  methodeSuivi?: MethodeSuivi;
  etatSuivi: EtatSuivi;
  langue: LangueMarketing;
  /** Ce que l'agent a compris et choisi, en deux ou trois phrases. */
  explication?: string;
}

export interface FicheMarketing {
  cible?: string;
  probleme?: string;
  promesse?: string;
  arguments?: string[];
  ton?: string;
  offre?: string;
  prix?: string;
  concurrents?: string[];
}

export interface EspaceMarketing {
  projectId: string;
  agentId?: string;
  cardId?: string;
  /** La clé PUBLIQUE du script de suivi : elle n'ouvre rien, elle désigne le projet. */
  cleSuivi: string;
  configuration: ConfigurationMarketing;
  fiche: FicheMarketing;
  suiviVerifieLe?: number;
  /**
   * LE RAPPORT DE L'AGENT — ce qu'il a compris du produit et ce qu'il a
   * décidé, en Markdown, rangé comme une procédure : il se relit dans le
   * tiroir de l'agent, se retravaille en lui parlant, se refait sur
   * « Réanalyser ». Écrit par l'outil « marketing », action « rapport », et
   * par elle seule : aucun texte de message n'est relu pour le deviner.
   */
  rapport?: string;
  rapportLe?: number;
  /**
   * LE SUIVI MARKETING EST-IL VOULU pour ce projet ? Coupé à la main depuis
   * l'entête de son écran : le projet passe dans « Projets inactifs », sort
   * des chiffres du tableau de bord, et ne reçoit plus de plan du dimanche.
   */
  actif: boolean;
  /**
   * LE MODE DU SUIVI (service Statistiques) : « anonyme » par défaut — rien
   * n'est écrit sur l'appareil —, ou « visiteur » : le script montre un
   * bandeau d'accord et, seulement après accord, garde un identifiant dans le
   * stockage local du navigateur (jamais de cookie) pour relier les pages
   * d'une même personne.
   */
  modeSuivi: ModeSuivi;
  /** Le nom d'un SITE AUTONOME (sans projet Beluga, `projectId` « site:<id> »). */
  nom?: string;
  creeLe: number;
  majLe: number;
}

export const MODES_SUIVI = ['anonyme', 'visiteur'] as const;
export type ModeSuivi = (typeof MODES_SUIVI)[number];

export interface ContenuMarketing {
  id: string;
  projectId: string;
  genre: GenreContenu;
  canal: CanalContenu;
  titre: string;
  texte: string;
  /** Le jour prévu, AAAA-MM-JJ, et l'heure prévue facultative (HH:MM). */
  datePrevue?: string;
  heurePrevue?: string;
  etape: EtapeContenu;
  origine: OrigineContenu;
  /** La version A dont celle-ci est la version B. */
  varianteDe?: string;
  /** Le code du lien de suivi propre à ce contenu. */
  lienCode?: string;
  /** L'adresse vers laquelle le lien de suivi mène. */
  lienCible?: string;
  urlPubliee?: string;
  raisonEchec?: string;
  creeLe: number;
  majLe: number;
}

/* ------------------------------------------------------------------ */
/* Configuration et fiche                                              */
/* ------------------------------------------------------------------ */

export function configurationVide(): ConfigurationMarketing {
  return { origines: [], sourcesVentes: [], objectifs: [], canaux: [], recommandations: [], etatSuivi: 'absent', langue: 'fr' };
}

function dans<T extends string>(liste: readonly T[], valeur: unknown): T | undefined {
  return typeof valeur === 'string' && (liste as readonly string[]).includes(valeur) ? (valeur as T) : undefined;
}

function texteBorne(valeur: unknown, max = 600): string | undefined {
  if (typeof valeur !== 'string') return undefined;
  const propre = valeur.replace(/\s+/g, ' ').trim();
  return propre ? propre.slice(0, max) : undefined;
}

function listeDe<T extends string>(liste: readonly T[], valeur: unknown): T[] {
  if (!Array.isArray(valeur)) return [];
  return [...new Set(valeur.map((v) => dans(liste, v)).filter((v): v is T => !!v))];
}

function listeLibre(valeur: unknown, max = 12): string[] {
  if (!Array.isArray(valeur)) return [];
  return [...new Set(valeur.map((v) => texteBorne(v, 200)).filter((v): v is string => !!v))].slice(0, max);
}

/**
 * L'ORIGINE D'UNE ADRESSE — « https://www.exemple.ch/page » devient
 * « https://www.exemple.ch ». Rend null pour ce qui n'est pas une adresse web.
 */
export function origineDe(adresse: unknown): string | null {
  if (typeof adresse !== 'string' || !adresse.trim()) return null;
  try {
    const url = new URL(adresse.trim().includes('://') ? adresse.trim() : `https://${adresse.trim()}`);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * FUSIONNE une configuration reçue (de l'agent ou de l'écran) avec l'actuelle :
 * ce qui n'est pas redit est CONSERVÉ, ce qui ne vaut rien est ignoré. L'origine
 * de l'adresse publique rejoint toujours les origines autorisées.
 */
export function fusionnerConfiguration(actuelle: ConfigurationMarketing, recue: Record<string, unknown>): ConfigurationMarketing {
  const suivante: ConfigurationMarketing = { ...actuelle };
  const nature = dans(NATURES_PRODUIT, recue.nature);
  if (nature) suivante.nature = nature;
  const hebergement = dans(GENRES_HEBERGEMENT, recue.hebergement);
  if (hebergement) suivante.hebergement = hebergement;
  const detail = texteBorne(recue.hebergementDetail, 200);
  if (detail) suivante.hebergementDetail = detail;
  if (typeof recue.adresse === 'string') {
    const origine = origineDe(recue.adresse);
    if (origine) suivante.adresse = recue.adresse.trim().slice(0, 300);
  }
  if (Array.isArray(recue.origines)) {
    suivante.origines = recue.origines.map(origineDe).filter((o): o is string => !!o);
  }
  const origineAdresse = origineDe(suivante.adresse);
  if (origineAdresse && !suivante.origines.includes(origineAdresse)) suivante.origines = [...suivante.origines, origineAdresse];
  suivante.origines = [...new Set(suivante.origines)].slice(0, 10);
  if (Array.isArray(recue.sourcesVentes)) suivante.sourcesVentes = listeDe(SOURCES_VENTES, recue.sourcesVentes);
  if (Array.isArray(recue.objectifs)) suivante.objectifs = listeLibre(recue.objectifs, 8);
  if (Array.isArray(recue.canaux)) suivante.canaux = listeDe(CLES_CANAUX, recue.canaux);
  if (Array.isArray(recue.recommandations)) suivante.recommandations = fusionnerRecommandations(actuelle.recommandations ?? [], recue.recommandations);
  const methode = dans(METHODES_SUIVI, recue.methodeSuivi);
  if (methode) suivante.methodeSuivi = methode;
  const langue = dans(LANGUES_MARKETING, recue.langue);
  if (langue) suivante.langue = langue;
  const explication = texteBorne(recue.explication, 900);
  if (explication) suivante.explication = explication;
  return suivante;
}

/**
 * LES AVIS SUR LES CANAUX : chaque avis reçu REMPLACE celui du même canal, les
 * autres sont gardés. Un canal hors catalogue ou sans raison est ignoré.
 */
export function fusionnerRecommandations(actuelles: readonly RecommandationCanal[], recues: unknown[]): RecommandationCanal[] {
  const parCanal = new Map(actuelles.map((r) => [r.canal, r]));
  for (const brut of recues) {
    if (!brut || typeof brut !== 'object') continue;
    const r = brut as Record<string, unknown>;
    const canal = dans(CLES_CANAUX, r.canal);
    const pertinence = dans(PERTINENCES, r.pertinence);
    const raison = texteBorne(r.raison, 400);
    if (!canal || !pertinence || !raison) continue;
    const premierPas = texteBorne(r.premierPas, 300);
    const etapes = Array.isArray(r.etapes) ? r.etapes.map((e) => texteBorne(e, 300)).filter((e): e is string => !!e).slice(0, 6) : [];
    parCanal.set(canal, { canal, pertinence, raison, ...(premierPas ? { premierPas } : {}), ...(etapes.length ? { etapes } : {}) });
  }
  return [...parCanal.values()];
}

/**
 * LES CANAUX DANS L'ORDRE DE L'ÉCRAN : les canaux choisis d'abord, puis par
 * pertinence donnée par l'agent (haute, moyenne, sans avis, faible), l'ordre du
 * catalogue départageant.
 */
export function canauxDansLOrdre(config: Pick<ConfigurationMarketing, 'canaux' | 'recommandations'>): {
  canal: CanalDuCatalogue;
  choisi: boolean;
  recommandation?: RecommandationCanal;
}[] {
  const avis = new Map((config.recommandations ?? []).map((r) => [r.canal, r]));
  const rang = (p?: Pertinence) => (p === 'haute' ? 0 : p === 'moyenne' ? 1 : p === 'faible' ? 3 : 2);
  return CATALOGUE_CANAUX.map((canal, i) => ({ canal, i, choisi: config.canaux.includes(canal.cle), recommandation: avis.get(canal.cle) }))
    .sort((a, b) => Number(b.choisi) - Number(a.choisi) || rang(a.recommandation?.pertinence) - rang(b.recommandation?.pertinence) || a.i - b.i)
    .map(({ canal, choisi, recommandation }) => ({ canal, choisi, ...(recommandation ? { recommandation } : {}) }));
}

/* ------------------------------------------------------------------ */
/* Le plan d'action                                                    */
/* ------------------------------------------------------------------ */

/**
 * UNE ACTION DU PLAN : une chose À FAIRE par l'utilisateur, datée — créer sa
 * fiche Google, écrire à trois blogueurs, s'inscrire à un salon. Le plan est
 * posé par l'agent et se lit dans le calendrier à côté des contenus ; cocher
 * « fait » est un geste de l'utilisateur.
 */
export interface ActionMarketing {
  id: string;
  projectId: string;
  titre: string;
  detail: string;
  canal?: string;
  datePrevue?: string;
  faitLe?: number;
  creeLe: number;
  majLe: number;
}

export function raisonActionRefusee(entree: { titre?: unknown; datePrevue?: unknown }, creation: boolean): string | null {
  if (creation && !texteBorne(entree.titre, 160)) return 'Une action a besoin d’un titre.';
  if (creation && !jourValide(entree.datePrevue)) return 'Une action du plan a besoin de sa « datePrevue » (AAAA-MM-JJ).';
  if (!creation && entree.datePrevue !== undefined && !jourValide(entree.datePrevue)) return '« datePrevue » attend AAAA-MM-JJ.';
  return null;
}

export function fusionnerFiche(actuelle: FicheMarketing, recue: Record<string, unknown>): FicheMarketing {
  const suivante: FicheMarketing = { ...actuelle };
  for (const champ of ['cible', 'probleme', 'promesse', 'ton', 'offre', 'prix'] as const) {
    const valeur = texteBorne(recue[champ], 900);
    if (valeur) suivante[champ] = valeur;
  }
  if (Array.isArray(recue.arguments)) suivante.arguments = listeLibre(recue.arguments, 8);
  if (Array.isArray(recue.concurrents)) suivante.concurrents = listeLibre(recue.concurrents, 8);
  return suivante;
}

/** La fiche dit-elle l'essentiel : à qui, quel problème, quelle promesse ? */
export function ficheRemplie(fiche: FicheMarketing): boolean {
  return !!(fiche.cible && fiche.probleme && fiche.promesse);
}

/* ------------------------------------------------------------------ */
/* Étapes d'un contenu                                                 */
/* ------------------------------------------------------------------ */

export const LIBELLE_ETAPE: Record<EtapeContenu, string> = {
  brouillon: 'Brouillon',
  a_valider: 'À valider',
  pret: 'Prêt',
  programme: 'Programmé',
  publie: 'Publié',
  echec: 'En échec',
  abandonne: 'Abandonné',
};

/** Les passages permis, quel que soit l'auteur. */
const PASSAGES: Record<EtapeContenu, EtapeContenu[]> = {
  brouillon: ['a_valider', 'pret', 'abandonne'],
  a_valider: ['brouillon', 'pret', 'abandonne'],
  pret: ['a_valider', 'programme', 'publie', 'abandonne'],
  programme: ['pret', 'publie', 'echec', 'abandonne'],
  publie: [],
  echec: ['pret', 'programme', 'abandonne'],
  abandonne: ['brouillon'],
};

/** Ce que l'AGENT peut atteindre : jamais plus loin que « À valider » (et « Abandonné » pour archiver ses propositions). */
const ETAPES_DE_L_AGENT: EtapeContenu[] = ['brouillon', 'a_valider'];

/**
 * UN PASSAGE D'ÉTAPE EST-IL PERMIS ? Rend null si oui, sinon la raison en une
 * phrase. « Programmé » exige une date : on ne programme pas « un jour ».
 */
export function transitionPermise(entree: {
  de: EtapeContenu;
  vers: EtapeContenu;
  parQui: 'humain' | 'agent' | 'systeme';
  datePrevue?: string;
}): string | null {
  const { de, vers, parQui } = entree;
  if (de === vers) return null;
  // L'agent archive SES propositions encore en « Brouillon » ou « À valider » (vers « Abandonné »), jamais plus loin.
  if (parQui === 'agent' && vers !== 'abandonne' && !ETAPES_DE_L_AGENT.includes(vers)) {
    return `L’agent ne dépose qu’en « Brouillon » ou « À valider » : « ${LIBELLE_ETAPE[vers]} » est un geste de l’utilisateur.`;
  }
  if (parQui === 'agent' && !ETAPES_DE_L_AGENT.includes(de)) {
    return `Ce contenu est déjà « ${LIBELLE_ETAPE[de]} » : l’agent n’y touche plus.`;
  }
  // « Publié » et « En échec » depuis « Programmé » sont posés par la publication elle-même.
  if (parQui === 'systeme') return de === 'programme' && (vers === 'publie' || vers === 'echec') ? null : 'Passage réservé à l’utilisateur.';
  if (!PASSAGES[de].includes(vers)) return `On ne passe pas de « ${LIBELLE_ETAPE[de]} » à « ${LIBELLE_ETAPE[vers]} ».`;
  if (vers === 'programme' && !jourValide(entree.datePrevue)) return 'Un contenu programmé a besoin d’une date.';
  return null;
}

/* ------------------------------------------------------------------ */
/* Les colonnes de l'onglet « Contenus » et les dépôts entre elles     */
/* ------------------------------------------------------------------ */

/**
 * LES COLONNES DE L'ONGLET « CONTENUS » :
 *  - Brouillons : ce qu'on écrit encore (l'utilisateur ou l'agent) ;
 *  - À valider : ce qui est écrit et attend une relecture ;
 *  - Programmés : relu, avec ou sans date de publication (« Prêt » sans date,
 *    « Programmé » avec date et heure) — un repère de calendrier, rien ne part
 *    tout seul ;
 *  - Publiés : marqués comme publiés par l'utilisateur.
 */
export type ColonneContenu = 'brouillons' | 'a_valider' | 'programmes' | 'publies';

export const COLONNES_CONTENU: readonly ColonneContenu[] = ['brouillons', 'a_valider', 'programmes', 'publies'];

/** La colonne d'un contenu ; null pour un contenu abandonné, qui ne se montre plus. */
export function colonneDeContenu(etape: EtapeContenu): ColonneContenu | null {
  switch (etape) {
    case 'brouillon':
      return 'brouillons';
    case 'a_valider':
      return 'a_valider';
    case 'pret':
    case 'programme':
    case 'echec':
      return 'programmes';
    case 'publie':
      return 'publies';
    default:
      return null;
  }
}

export type DepotContenu =
  | {
      ok: true;
      /** Les étapes à poser, dans l'ordre (vide : rien à changer). */
      etapes: EtapeContenu[];
      /** Une date (et une heure facultative) doivent être choisies AVANT les étapes. */
      exigeDate: boolean;
    }
  | { ok: false; raison: string };

/**
 * UN CONTENU PEUT-IL ÊTRE DÉPOSÉ DANS CETTE COLONNE, ET PAR QUELLES ÉTAPES ?
 * Le chemin ne sort jamais de la matrice `PASSAGES` : « À valider » ne passe pas
 * directement à « Programmé », il traverse « Prêt ». C'est un geste de
 * l'utilisateur ; l'agent, lui, ne dépose qu'en Brouillon ou À valider.
 */
export function depotContenu(contenu: { etape: EtapeContenu }, cible: ColonneContenu): DepotContenu {
  const source = colonneDeContenu(contenu.etape);
  if (!source) return { ok: false, raison: 'Ce contenu est abandonné.' };
  if (contenu.etape === 'publie') return { ok: false, raison: 'Un contenu publié ne bouge plus.' };
  const chemin = (etapes: EtapeContenu[]): DepotContenu => ({ ok: true, etapes, exigeDate: etapes.includes('programme') });

  switch (cible) {
    case 'brouillons':
      if (contenu.etape === 'brouillon') return chemin([]);
      if (contenu.etape === 'a_valider') return chemin(['brouillon']);
      return { ok: false, raison: 'Repassez-le d’abord en « À valider ».' };
    case 'a_valider':
      if (contenu.etape === 'a_valider') return chemin([]);
      if (contenu.etape === 'brouillon' || contenu.etape === 'pret') return chemin(['a_valider']);
      if (contenu.etape === 'programme') return chemin(['pret', 'a_valider']);
      return { ok: false, raison: 'Un contenu en échec se reprogramme : déposez-le dans « Programmés ».' };
    case 'programmes':
      if (contenu.etape === 'programme') return chemin([]);
      if (contenu.etape === 'pret' || contenu.etape === 'echec') return chemin(['programme']);
      return chemin(['pret', 'programme']);
    case 'publies':
      if (contenu.etape === 'pret' || contenu.etape === 'programme') return chemin(['publie']);
      if (contenu.etape === 'echec') return { ok: false, raison: 'Reprogrammez d’abord ce contenu.' };
      return { ok: false, raison: 'Un contenu se publie depuis « Programmés ».' };
    default:
      return { ok: false, raison: 'Ce dépôt n’est pas possible.' };
  }
}

export function jourValide(jour: unknown): jour is string {
  if (typeof jour !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(jour)) return false;
  const d = new Date(`${jour}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === jour;
}

export function heureValide(heure: unknown): heure is string {
  return typeof heure === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(heure);
}

/* ------------------------------------------------------------------ */
/* Le Guide                                                            */
/* ------------------------------------------------------------------ */

export interface JalonDuGuide {
  cle: 'configuration' | 'fiche' | 'offre' | 'suivi' | 'canaux' | 'contenus' | 'ventes';
  libelle: string;
  explication: string;
  fait: boolean;
  action: string;
}

export interface GuideMarketing {
  jalons: JalonDuGuide[];
  /** Part des jalons faits, de 0 à 100. */
  avancement: number;
  /** Les trois prochaines actions, dans l'ordre où elles rapportent. */
  prochainesActions: string[];
}

/**
 * OÙ EN EST LE PROJET, ET QUE FAIRE ENSUITE. L'ordre des jalons est celui où
 * ils rapportent : sans savoir ce qu'on vend, écrire ne sert à rien ; sans
 * mesure, on ne sait pas ce qui marche.
 */
export function guideDuProjet(entree: {
  espace: EspaceMarketing | null;
  contenusPublies: number;
  contenusEnAttente: number;
  ventes: number;
  /** Une carte d'installation du suivi existe : elle ne vaut pas code posé. */
  carteDuSuivi?: boolean;
}): GuideMarketing {
  const config = entree.espace?.configuration ?? configurationVide();
  const fiche = entree.espace?.fiche ?? {};
  const jalons: JalonDuGuide[] = [
    {
      cle: 'configuration',
      libelle: 'Le produit est compris',
      explication: 'L’agent sait ce que vous vendez, où le produit est hébergé et comment on y paie.',
      fait: !!(config.nature && config.hebergement),
      action: 'Demandez à l’agent d’étudier le projet.',
    },
    {
      cle: 'fiche',
      libelle: 'Le positionnement est clair',
      explication: 'À qui s’adresse le produit, quel problème il règle, ce qu’il promet. C’est la base de chaque texte.',
      fait: ficheRemplie(fiche),
      action: 'Faites rédiger la fiche de positionnement par l’agent.',
    },
    {
      cle: 'offre',
      libelle: 'L’offre et le prix sont posés',
      explication: 'Un visiteur convaincu doit savoir quoi acheter et combien ça coûte.',
      fait: !!(fiche.offre && fiche.prix),
      action: 'Précisez l’offre et le prix avec l’agent.',
    },
    {
      cle: 'suivi',
      libelle: 'La mesure est en place',
      explication: 'Un petit script anonyme compte les visites et d’où elles viennent. Sans lui, impossible de savoir ce qui marche.',
      fait: config.etatSuivi === 'verifie',
      action:
        config.etatSuivi === 'pose'
          ? 'Le code est posé : attendez la première visite, le suivi sera confirmé tout seul.'
          : entree.carteDuSuivi
            ? 'La carte d’installation est posée : lancez-la, puis mettez le site en ligne.'
            : 'Faites installer le script de suivi : bouton « Installer le suivi » dans Statistiques.',
    },
    {
      cle: 'canaux',
      libelle: 'Les canaux sont choisis',
      explication: 'Les canaux où votre public se trouve vraiment, pas tous à la fois.',
      fait: config.canaux.length > 0,
      action: 'Demandez à l’agent quels canaux conviennent à ce produit.',
    },
    {
      cle: 'contenus',
      libelle: 'Des contenus sortent',
      explication: 'Des posts réguliers, relus et validés par vous, qui amènent des visiteurs.',
      fait: entree.contenusPublies > 0,
      action:
        entree.contenusEnAttente > 0
          ? `Relisez ${entree.contenusEnAttente > 1 ? `les ${entree.contenusEnAttente} contenus qui attendent` : 'le contenu qui attend'} votre validation.`
          : 'Demandez à l’agent un premier contenu.',
    },
    {
      cle: 'ventes',
      libelle: 'Les ventes sont reliées',
      explication: 'Chaque vente est rattachée au contenu qui a amené l’acheteur : on voit ce qui rapporte vraiment.',
      fait: entree.ventes > 0 || config.sourcesVentes.length > 0,
      action: 'Indiquez à l’agent comment vos clients paient.',
    },
  ];
  const faits = jalons.filter((j) => j.fait).length;
  return {
    jalons,
    avancement: Math.round((faits / jalons.length) * 100),
    prochainesActions: jalons.filter((j) => !j.fait).slice(0, 3).map((j) => j.action),
  };
}

/* ------------------------------------------------------------------ */
/* Les chiffres, selon la nature du produit                            */
/* ------------------------------------------------------------------ */

export interface Indicateur {
  cle: string;
  libelle: string;
  explication: string;
}

const COMMUNS: Indicateur[] = [
  { cle: 'visites', libelle: 'Visites', explication: 'Le nombre de passages sur le produit.' },
  { cle: 'visiteurs', libelle: 'Visiteurs', explication: 'Les personnes différentes, comptées jour par jour, sans les reconnaître.' },
];

export const INDICATEURS_PAR_NATURE: Record<NatureProduit, Indicateur[]> = {
  site: [
    ...COMMUNS,
    { cle: 'pagesParVisite', libelle: 'Pages par visite', explication: 'Combien de pages une personne regarde avant de partir.' },
    { cle: 'duree', libelle: 'Durée moyenne', explication: 'Le temps passé par visite.' },
    { cle: 'rebond', libelle: 'Rebond', explication: 'La part des visites qui repartent après une seule page.' },
    { cle: 'objectifs', libelle: 'Objectifs atteints', explication: 'Inscriptions, demandes de contact : ce que le site cherche à obtenir.' },
  ],
  boutique: [
    ...COMMUNS,
    { cle: 'ventes', libelle: 'Ventes', explication: 'Le nombre de commandes.' },
    { cle: 'chiffreAffaires', libelle: 'Chiffre d’affaires', explication: 'L’argent encaissé sur la période.' },
    { cle: 'panierMoyen', libelle: 'Panier moyen', explication: 'Le montant moyen d’une commande.' },
    { cle: 'paniersAbandonnes', libelle: 'Paniers abandonnés', explication: 'Les paniers remplis puis laissés sans achat.' },
    { cle: 'conversion', libelle: 'Taux d’achat', explication: 'La part des visites qui finissent en commande.' },
  ],
  app: [
    { cle: 'sessions', libelle: 'Ouvertures', explication: 'Le nombre de fois où l’application est ouverte.' },
    { cle: 'visiteurs', libelle: 'Utilisateurs', explication: 'Les personnes différentes, comptées jour par jour, sans les reconnaître.' },
    { cle: 'installations', libelle: 'Installations', explication: 'Les nouvelles installations sur la période.' },
    { cle: 'fidelite', libelle: 'Fidélité', explication: 'La part des jours actifs qui reviennent la semaine suivante.' },
    { cle: 'duree', libelle: 'Durée moyenne', explication: 'Le temps passé par ouverture.' },
  ],
  saas: [
    ...COMMUNS,
    { cle: 'objectifs', libelle: 'Inscriptions', explication: 'Les comptes créés : le premier pas vers un abonnement.' },
    { cle: 'ventes', libelle: 'Abonnements', explication: 'Les paiements reçus.' },
    { cle: 'chiffreAffaires', libelle: 'Revenu', explication: 'L’argent encaissé sur la période.' },
    { cle: 'conversion', libelle: 'Taux d’inscription', explication: 'La part des visites qui créent un compte.' },
  ],
};

/** Les chiffres d'un projet dont la nature n'est pas encore connue : ceux d'un site. */
export function indicateursDe(nature: NatureProduit | undefined): Indicateur[] {
  return INDICATEURS_PAR_NATURE[nature ?? 'site'];
}

/* ------------------------------------------------------------------ */
/* Événements de suivi                                                 */
/* ------------------------------------------------------------------ */

export const TYPES_EVENEMENT = ['vue', 'sortie', 'objectif', 'achat', 'panier', 'session', 'ecran', 'installation', 'clic', 'repere'] as const;
export type TypeEvenement = (typeof TYPES_EVENEMENT)[number];

/** Un événement tel qu'il est gardé : aucune donnée personnelle, aucune adresse IP. */
export interface EvenementDeSuivi {
  instant: number;
  type: TypeEvenement;
  /** Le chemin de la page ou le nom de l'écran, sans paramètres. */
  chemin?: string;
  /** D'où vient la visite : un réseau, un moteur de recherche, « direct »… */
  source?: string;
  contenuId?: string;
  /** Le visiteur DU JOUR : un hachage salé qui change chaque jour. */
  visiteur: string;
  /** La visite : un identifiant tiré au hasard par la page, jamais gardé ailleurs. */
  visite?: string;
  dureeMs?: number;
  montantCentimes?: number;
  devise?: string;
  reference?: string;
  objectif?: string;
  variante?: 'A' | 'B';
  /** Une ouverture d'application par quelqu'un qui l'avait déjà utilisée. */
  retour?: boolean;
  appareil?: 'mobile' | 'tablette' | 'ordinateur';
  /**
   * MODE VISITEUR SEULEMENT, APRÈS ACCORD : l'identifiant tiré au hasard par
   * le navigateur et gardé dans son stockage local (renouvelé au plus tard
   * après 13 mois), et celui de la session (stockage de l'onglet). Le serveur
   * les jette pour un espace en mode anonyme.
   */
  visiteurPersistant?: string;
  session?: string;
  /** Le repère cliqué (`data-beluga-repere`), pour un événement « repere ». */
  repere?: string;
  /** Le code ISO du pays, déduit de l'adresse à la collecte — l'adresse n'est jamais gardée. */
  pays?: string;
}

export const TAILLE_EVENEMENT_MAX = 2048;

const MOTEURS = ['google', 'bing', 'duckduckgo', 'qwant', 'ecosia', 'yahoo', 'startpage', 'brave'];
const RESEAUX_SOURCES: Record<string, string> = {
  'linkedin.com': 'linkedin',
  'lnkd.in': 'linkedin',
  't.co': 'x',
  'x.com': 'x',
  'twitter.com': 'x',
  'instagram.com': 'instagram',
  'facebook.com': 'facebook',
  'm.facebook.com': 'facebook',
  'l.facebook.com': 'facebook',
  'youtube.com': 'youtube',
  'tiktok.com': 'tiktok',
};

/**
 * LA SOURCE D'UNE VISITE, d'après le paramètre « utm_source » ou la page d'où
 * elle arrive. La page d'origine n'est gardée que sous forme de nom de domaine.
 */
export function sourceDeLaVisite(entree: { referent?: string; utm?: string; origineDuSite?: string }): string {
  const utm = texteBorne(entree.utm, 40)?.toLowerCase().replace(/[^a-z0-9._-]/g, '');
  if (utm) return utm;
  if (!entree.referent) return 'direct';
  let hote: string;
  try {
    hote = new URL(entree.referent).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return 'direct';
  }
  if (entree.origineDuSite) {
    try {
      if (new URL(entree.origineDuSite).hostname.toLowerCase().replace(/^www\./, '') === hote) return 'direct';
    } catch {
      /* rien */
    }
  }
  if (RESEAUX_SOURCES[hote]) return RESEAUX_SOURCES[hote];
  const moteur = MOTEURS.find((m) => hote === `${m}.com` || hote.startsWith(`${m}.`) || hote.includes(`.${m}.`));
  if (moteur) return 'recherche';
  return hote.slice(0, 80);
}

export function appareilDe(userAgent: string | undefined): EvenementDeSuivi['appareil'] {
  const ua = (userAgent ?? '').toLowerCase();
  if (/ipad|tablet/.test(ua)) return 'tablette';
  if (/mobi|iphone|android/.test(ua)) return 'mobile';
  return 'ordinateur';
}

export type EvenementJuge =
  | {
      ok: true;
      evenement: Omit<EvenementDeSuivi, 'instant' | 'visiteur' | 'appareil' | 'source' | 'visiteurPersistant' | 'session'>;
      referent?: string;
      utm?: string;
      /** Les identifiants du mode visiteur, lus mais PAS encore acceptés : le serveur décide selon le mode de l'espace. */
      visiteurPersistant?: string;
      session?: string;
    }
  | { ok: false; raison: string };

/**
 * JUGE UN ÉVÉNEMENT REÇU D'UNE PAGE. Tout ce qui n'est pas prévu est jeté : un
 * champ « email » ou « nom » glissé par un site ne passe jamais. Le chemin perd
 * ses paramètres (ils portent parfois des adresses ou des jetons).
 */
export function jugerEvenementDeSuivi(brut: unknown): EvenementJuge {
  if (!brut || typeof brut !== 'object') return { ok: false, raison: 'événement illisible' };
  const b = brut as Record<string, unknown>;
  const type = dans(TYPES_EVENEMENT, b.t ?? b.type);
  if (!type || type === 'clic') return { ok: false, raison: 'type inconnu' };
  const cheminBrut = typeof (b.p ?? b.chemin) === 'string' ? String(b.p ?? b.chemin) : '';
  const chemin = cheminBrut ? (cheminBrut.split(/[?#]/)[0] || '/').slice(0, 200) : undefined;
  const evenement: Omit<EvenementDeSuivi, 'instant' | 'visiteur' | 'appareil' | 'source' | 'visiteurPersistant' | 'session'> = { type };
  if (chemin) evenement.chemin = chemin;
  const visite = typeof b.v === 'string' && /^[a-z0-9]{6,32}$/i.test(b.v) ? b.v : undefined;
  if (visite) evenement.visite = visite;
  const contenu = typeof b.c === 'string' && /^[a-z0-9_-]{4,40}$/i.test(b.c) ? b.c : undefined;
  if (contenu) evenement.contenuId = contenu;
  const duree = Number(b.d);
  if (Number.isFinite(duree) && duree > 0) evenement.dureeMs = Math.min(Math.round(duree), 6 * 3600_000);
  if (type === 'achat' || type === 'panier') {
    const montant = Number(b.m);
    if (Number.isFinite(montant) && montant >= 0) evenement.montantCentimes = Math.min(Math.round(montant * 100), 10_000_000_00);
    const devise = typeof b.cur === 'string' && /^[A-Za-z]{3}$/.test(b.cur) ? b.cur.toUpperCase() : undefined;
    if (devise) evenement.devise = devise;
    const reference = typeof b.ref === 'string' ? b.ref.replace(/[^\w.-]/g, '').slice(0, 64) : '';
    if (reference) evenement.reference = reference;
  }
  if (type === 'objectif') {
    const objectif = typeof b.o === 'string' ? b.o.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 40) : '';
    if (!objectif) return { ok: false, raison: 'objectif sans nom' };
    evenement.objectif = objectif;
  }
  if (type === 'repere') {
    const repere = nomDeRepere(b.n);
    if (!repere) return { ok: false, raison: 'repère sans nom' };
    evenement.repere = repere;
  }
  if (b.ab === 'A' || b.ab === 'B') evenement.variante = b.ab;
  if (type === 'session' && (b.ret === 1 || b.ret === true || b.ret === '1')) evenement.retour = true;
  const referent = typeof b.r === 'string' ? b.r.slice(0, 400) : undefined;
  const utm = typeof b.u === 'string' ? b.u : undefined;
  const visiteurPersistant = identifiantDeNavigateur(b.vp);
  const session = identifiantDeNavigateur(b.vs);
  return {
    ok: true,
    evenement,
    referent,
    utm,
    ...(visiteurPersistant ? { visiteurPersistant } : {}),
    ...(visiteurPersistant && session ? { session } : {}),
  };
}

/** Un identifiant tiré au hasard par le script : lettres et chiffres, 12 à 40 signes — rien d'autre ne passe. */
export function identifiantDeNavigateur(valeur: unknown): string | undefined {
  return typeof valeur === 'string' && /^[a-z0-9]{12,40}$/i.test(valeur) ? valeur : undefined;
}

/**
 * LE NOM D'UN REPÈRE (`data-beluga-repere="<nom>"`) : minuscules, chiffres et
 * tirets, 60 signes au plus. Les accents et espaces d'un nom écrit à la main
 * sont ramenés à cette forme ; un nom vide est refusé.
 */
export function nomDeRepere(valeur: unknown): string | undefined {
  if (typeof valeur !== 'string') return undefined;
  const nom = valeur
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return nom || undefined;
}

/** L'origine d'une requête est-elle déclarée pour ce projet ? */
export function origineAutorisee(origine: string | undefined, config: ConfigurationMarketing): boolean {
  const o = origineDe(origine);
  if (!o) return false;
  return config.origines.includes(o);
}

/* ------------------------------------------------------------------ */
/* Résultats                                                           */
/* ------------------------------------------------------------------ */

export interface Vente {
  instant: number;
  montantCentimes: number;
  devise: string;
  source: SourceVentes;
  /** L'identifiant de la commande ou du paiement : c'est lui qui dédoublonne. */
  reference?: string;
  visiteur?: string;
  contenuId?: string;
}

export const FENETRE_ATTRIBUTION_MS = 30 * 24 * 3600_000;

/**
 * LE CONTENU QUI A AMENÉ UNE VENTE : le dernier contenu par lequel ce visiteur
 * est arrivé, dans les trente jours qui précèdent. Le visiteur étant compté au
 * jour, une vente ne remonte en pratique qu'aux contenus du même jour — sauf
 * quand la vente porte elle-même le contenu (lien de suivi transmis au paiement).
 */
export function attribuerVente(
  vente: Pick<Vente, 'instant' | 'visiteur' | 'contenuId'>,
  touches: readonly { instant: number; visiteur: string; contenuId: string }[],
): string | null {
  if (vente.contenuId) return vente.contenuId;
  if (!vente.visiteur) return null;
  let meilleure: { instant: number; contenuId: string } | null = null;
  for (const t of touches) {
    if (t.visiteur !== vente.visiteur) continue;
    if (t.instant > vente.instant || vente.instant - t.instant > FENETRE_ATTRIBUTION_MS) continue;
    if (!meilleure || t.instant > meilleure.instant) meilleure = t;
  }
  return meilleure?.contenuId ?? null;
}

/**
 * UNE VENTE N'EST COMPTÉE QU'UNE FOIS, même vue par deux sources (le script du
 * site ET le service de paiement). La référence fait foi ; entre deux copies,
 * on garde celle qui connaît son contenu.
 */
export function dedoublonnerVentes<V extends Vente>(ventes: readonly V[]): V[] {
  const parReference = new Map<string, V>();
  const sansReference: V[] = [];
  for (const v of ventes) {
    if (!v.reference) {
      sansReference.push(v);
      continue;
    }
    const deja = parReference.get(v.reference);
    if (!deja || (!deja.contenuId && v.contenuId)) parReference.set(v.reference, v);
  }
  return [...parReference.values(), ...sansReference].sort((a, b) => a.instant - b.instant);
}

export interface ResultatsMarketing {
  depuis: number;
  jusqua: number;
  totaux: Record<string, number | null>;
  parJour: { jour: string; visites: number; visiteurs: number; objectifs: number; ventes: number; montantCentimes: number }[];
  sources: { source: string; visites: number }[];
  pages: { chemin: string; vues: number }[];
  appareils: { appareil: string; visites: number }[];
  parContenu: { contenuId: string; visites: number; objectifs: number; ventes: number; montantCentimes: number }[];
  /** Un plafond qui se dit : les listes sont coupées à ce nombre. */
  plafondListes: number;
}

const PLAFOND_LISTES = 10;

function jourDe(instant: number): string {
  return new Date(instant).toISOString().slice(0, 10);
}

/**
 * LES RÉSULTATS D'UNE PÉRIODE, calculés depuis les événements bruts. Une
 * mesure qui ne se calcule pas (aucune visite) vaut null — l'écran dit « — »,
 * jamais un zéro inventé.
 */
export function resumeDesResultats(entree: {
  evenements: readonly EvenementDeSuivi[];
  ventes: readonly Vente[];
  depuis: number;
  jusqua: number;
}): ResultatsMarketing {
  const ev = entree.evenements.filter((e) => e.instant >= entree.depuis && e.instant <= entree.jusqua);
  const ventes = dedoublonnerVentes(entree.ventes.filter((v) => v.instant >= entree.depuis && v.instant <= entree.jusqua));
  const vues = ev.filter((e) => e.type === 'vue');
  const sessions = ev.filter((e) => e.type === 'session');
  // Une visite = une clé de visite (ou, à défaut, le visiteur du jour).
  const visiteDe = (e: EvenementDeSuivi) => e.visite ?? `${e.visiteur}:${jourDe(e.instant)}`;
  const visites = new Map<string, EvenementDeSuivi[]>();
  for (const e of vues) {
    const cle = visiteDe(e);
    const liste = visites.get(cle);
    if (liste) liste.push(e);
    else visites.set(cle, [e]);
  }
  const visiteursParJour = new Map<string, Set<string>>();
  const visitesParJour = new Map<string, Set<string>>();
  for (const e of [...vues, ...sessions]) {
    const jour = jourDe(e.instant);
    if (!visiteursParJour.has(jour)) visiteursParJour.set(jour, new Set());
    if (!visitesParJour.has(jour)) visitesParJour.set(jour, new Set());
    visiteursParJour.get(jour)!.add(e.visiteur);
    visitesParJour.get(jour)!.add(visiteDe(e));
  }
  const visiteurs = [...visiteursParJour.values()].reduce((s, v) => s + v.size, 0);
  const nbVisites = visites.size;
  const sorties = ev.filter((e) => e.type === 'sortie' && typeof e.dureeMs === 'number');
  const dureeMoyenne = sorties.length ? Math.round(sorties.reduce((s, e) => s + (e.dureeMs ?? 0), 0) / sorties.length) : null;
  const rebonds = [...visites.values()].filter((l) => l.length === 1).length;
  const objectifs = ev.filter((e) => e.type === 'objectif').length;
  const paniers = ev.filter((e) => e.type === 'panier').length;
  const chiffre = ventes.reduce((s, v) => s + v.montantCentimes, 0);
  const installations = ev.filter((e) => e.type === 'installation').length;

  // Fidélité d'une application : le visiteur changeant chaque jour, on ne peut pas le reconnaître ;
  // c'est l'application qui dit qu'une ouverture est un RETOUR (« ret: 1 »), sans rien dire de la personne.
  const retours = sessions.filter((e) => e.retour).length;

  const compter = <K extends string>(cles: K[]) => {
    const m = new Map<K, number>();
    for (const c of cles) m.set(c, (m.get(c) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, PLAFOND_LISTES);
  };
  const premieresVues = [...visites.values()].map((l) => l[0]);
  const parContenu = new Map<string, { visites: number; objectifs: number; ventes: number; montantCentimes: number }>();
  const ligneContenu = (id: string) => {
    let l = parContenu.get(id);
    if (!l) parContenu.set(id, (l = { visites: 0, objectifs: 0, ventes: 0, montantCentimes: 0 }));
    return l;
  };
  for (const e of ev) {
    if (!e.contenuId) continue;
    if (e.type === 'clic') ligneContenu(e.contenuId).visites += 1;
    if (e.type === 'objectif') ligneContenu(e.contenuId).objectifs += 1;
  }
  const touches = ev
    .filter((e) => e.contenuId && (e.type === 'clic' || e.type === 'vue'))
    .map((e) => ({ instant: e.instant, visiteur: e.visiteur, contenuId: e.contenuId! }));
  for (const v of ventes) {
    const id = attribuerVente(v, touches);
    if (!id) continue;
    const l = ligneContenu(id);
    l.ventes += 1;
    l.montantCentimes += v.montantCentimes;
  }

  const objectifsParJour = new Map<string, number>();
  for (const e of ev) if (e.type === 'objectif') objectifsParJour.set(jourDe(e.instant), (objectifsParJour.get(jourDe(e.instant)) ?? 0) + 1);
  const ventesParJour = new Map<string, { n: number; montant: number }>();
  for (const v of ventes) {
    const l = ventesParJour.get(jourDe(v.instant)) ?? { n: 0, montant: 0 };
    ventesParJour.set(jourDe(v.instant), { n: l.n + 1, montant: l.montant + v.montantCentimes });
  }
  const jours: ResultatsMarketing['parJour'] = [];
  for (let t = Date.parse(`${jourDe(entree.depuis)}T00:00:00Z`); t <= entree.jusqua; t += 86_400_000) {
    const jour = jourDe(t);
    jours.push({
      jour,
      visites: visitesParJour.get(jour)?.size ?? 0,
      visiteurs: visiteursParJour.get(jour)?.size ?? 0,
      objectifs: objectifsParJour.get(jour) ?? 0,
      ventes: ventesParJour.get(jour)?.n ?? 0,
      montantCentimes: ventesParJour.get(jour)?.montant ?? 0,
    });
  }

  return {
    depuis: entree.depuis,
    jusqua: entree.jusqua,
    totaux: {
      visites: nbVisites + sessions.length,
      visiteurs,
      sessions: sessions.length,
      pagesParVisite: nbVisites ? Math.round((vues.length / nbVisites) * 10) / 10 : null,
      duree: dureeMoyenne,
      rebond: nbVisites ? Math.round((rebonds / nbVisites) * 100) : null,
      objectifs,
      ventes: ventes.length,
      chiffreAffaires: chiffre,
      panierMoyen: ventes.length ? Math.round(chiffre / ventes.length) : null,
      paniersAbandonnes: Math.max(0, paniers - ventes.length),
      conversion: nbVisites ? Math.round(((ventes.length || objectifs) / nbVisites) * 1000) / 10 : null,
      installations,
      fidelite: sessions.length ? Math.round((retours / sessions.length) * 100) : null,
    },
    parJour: jours,
    sources: compter(premieresVues.map((e) => e.source ?? 'direct')).map(([source, n]) => ({ source, visites: n })),
    pages: compter(vues.map((e) => e.chemin ?? '/')).map(([chemin, n]) => ({ chemin, vues: n })),
    appareils: compter(premieresVues.map((e) => e.appareil ?? 'ordinateur')).map(([appareil, n]) => ({ appareil, visites: n })),
    parContenu: [...parContenu.entries()]
      .map(([contenuId, l]) => ({ contenuId, ...l }))
      .sort((a, b) => b.montantCentimes - a.montantCentimes || b.visites - a.visites),
    plafondListes: PLAFOND_LISTES,
  };
}

/* ------------------------------------------------------------------ */
/* Le script de suivi et la confidentialité                            */
/* ------------------------------------------------------------------ */

/** La ligne à coller dans les pages du produit. */
export function extraitDeSuivi(adresseBeluga: string, cleSuivi: string): string {
  const racine = adresseBeluga.replace(/\/+$/, '');
  return `<script defer src="${racine}/m/s.js" data-cle="${cleSuivi}"></script>`;
}

/** Comment déclarer un objectif atteint ou un achat depuis la page. */
export function modeDEmploiDuSuivi(): string {
  return [
    'Une page vue est comptée toute seule.',
    'Objectif atteint : belugaSuivi("objectif", { o: "inscription" })',
    'Achat : belugaSuivi("achat", { m: 49.9, cur: "EUR", ref: "<numéro de commande>" })',
    'Panier rempli : belugaSuivi("panier", { m: 49.9, cur: "EUR" })',
    'Application — ouverture : belugaSuivi("session") (ou belugaSuivi("session", { ret: 1 }) pour quelqu’un qui revient) ; écran : belugaSuivi("ecran", { p: "Accueil" }) ; installation : belugaSuivi("installation")',
    'Repère (bouton, lien, formulaire, zone clé) : l’attribut data-beluga-repere="nom-du-repere" sur l’élément suffit, chaque clic est compté ; à la main : belugaSuivi("repere", { n: "nom-du-repere" })',
    'Mode visiteur : belugaSuivi.accord() rouvre le bandeau d’accord (lien « gérer mon choix » de la page de confidentialité).',
  ].join('\n');
}

const PHRASES_CONFIDENTIALITE: Record<LangueMarketing, (nom: string) => string> = {
  fr: (nom) =>
    `Mesure d’audience — ${nom} mesure la fréquentation de ses pages de façon anonyme, sans cookie et sans service extérieur : aucune donnée ne permet de vous identifier, et votre passage n’est pas suivi d’un jour à l’autre. Ces chiffres servent uniquement à améliorer le site.`,
  en: (nom) =>
    `Audience measurement — ${nom} measures visits to its pages anonymously, without cookies and without any third-party service: no data can identify you, and your visit is not tracked from one day to the next. These figures are used only to improve the site.`,
  de: (nom) =>
    `Reichweitenmessung — ${nom} misst die Besuche seiner Seiten anonym, ohne Cookies und ohne externe Dienste: Keine Daten ermöglichen Ihre Identifizierung, und Ihr Besuch wird nicht von einem Tag zum nächsten verfolgt. Diese Zahlen dienen ausschliesslich der Verbesserung der Website.`,
  it: (nom) =>
    `Misurazione del pubblico — ${nom} misura le visite alle sue pagine in modo anonimo, senza cookie e senza servizi esterni: nessun dato permette di identificarvi e la vostra visita non viene seguita da un giorno all’altro. Questi dati servono solo a migliorare il sito.`,
  es: (nom) =>
    `Medición de audiencia — ${nom} mide las visitas a sus páginas de forma anónima, sin cookies y sin servicios externos: ningún dato permite identificarle y su visita no se sigue de un día a otro. Estas cifras solo sirven para mejorar el sitio.`,
};

/**
 * LE MODE VISITEUR NE PEUT PAS PROMETTRE L'ANONYMAT : sa phrase dit ce qui est
 * gardé (un identifiant tiré au hasard, dans le navigateur, après accord),
 * combien de temps, et comment reprendre son accord.
 */
const PHRASES_CONFIDENTIALITE_VISITEUR: Record<LangueMarketing, (nom: string) => string> = {
  fr: (nom) =>
    `Mesure d’audience — ${nom} mesure la fréquentation de ses pages sans cookie et sans service extérieur. Si vous l’acceptez dans le bandeau prévu, un identifiant tiré au hasard est gardé dans votre navigateur (stockage local, renouvelé au plus tard après 13 mois) pour comprendre votre parcours d’une page à l’autre ; il ne contient aucune donnée personnelle et les passages enregistrés sont effacés après 90 jours. Sans votre accord, votre visite est comptée de façon anonyme. Vous pouvez changer d’avis à tout moment avec le lien « gérer mon choix ».`,
  en: (nom) =>
    `Audience measurement — ${nom} measures visits to its pages without cookies and without any third-party service. If you accept it in the banner provided, a random identifier is kept in your browser (local storage, renewed after 13 months at the latest) to understand your journey from one page to the next; it contains no personal data and recorded visits are deleted after 90 days. Without your consent, your visit is counted anonymously. You can change your mind at any time with the “manage my choice” link.`,
  de: (nom) =>
    `Reichweitenmessung — ${nom} misst die Besuche seiner Seiten ohne Cookies und ohne externe Dienste. Wenn Sie im dafür vorgesehenen Banner zustimmen, wird eine zufällige Kennung in Ihrem Browser gespeichert (lokaler Speicher, spätestens nach 13 Monaten erneuert), um Ihren Weg von Seite zu Seite zu verstehen; sie enthält keine personenbezogenen Daten, und die erfassten Besuche werden nach 90 Tagen gelöscht. Ohne Ihre Zustimmung wird Ihr Besuch anonym gezählt. Über den Link «Meine Wahl verwalten» können Sie Ihre Entscheidung jederzeit ändern.`,
  it: (nom) =>
    `Misurazione del pubblico — ${nom} misura le visite alle sue pagine senza cookie e senza servizi esterni. Se lo accettate nell’apposito banner, un identificativo casuale viene conservato nel vostro browser (memoria locale, rinnovato al più tardi dopo 13 mesi) per capire il vostro percorso da una pagina all’altra; non contiene dati personali e le visite registrate vengono cancellate dopo 90 giorni. Senza il vostro consenso, la visita viene contata in modo anonimo. Potete cambiare idea in qualsiasi momento con il link «gestisci la mia scelta».`,
  es: (nom) =>
    `Medición de audiencia — ${nom} mide las visitas a sus páginas sin cookies y sin servicios externos. Si lo acepta en el aviso previsto, se guarda en su navegador un identificador aleatorio (almacenamiento local, renovado como máximo a los 13 meses) para entender su recorrido de una página a otra; no contiene ningún dato personal y las visitas registradas se borran a los 90 días. Sin su consentimiento, su visita se cuenta de forma anónima. Puede cambiar de opinión en cualquier momento con el enlace «gestionar mi elección».`,
};

/** LA PHRASE À AJOUTER À LA PAGE « CONFIDENTIALITÉ » du produit, dans sa langue et selon le mode du suivi. */
export function phraseDeConfidentialite(langue: LangueMarketing | undefined, nomProjet: string, mode: ModeSuivi = 'anonyme'): string {
  const phrases = mode === 'visiteur' ? PHRASES_CONFIDENTIALITE_VISITEUR : PHRASES_CONFIDENTIALITE;
  return phrases[langue ?? 'fr'](nomProjet.trim() || 'Ce site');
}

/**
 * LE BANDEAU D'ACCORD DU MODE VISITEUR, dans la langue de la page (`<html
 * lang>`) ou, à défaut, celle de l'espace. Deux boutons de même poids : refuser
 * est aussi simple qu'accepter.
 */
export const TEXTES_BANDEAU: Record<LangueMarketing, readonly [texte: string, accepter: string, refuser: string]> = {
  fr: ['Ce site aimerait se souvenir de votre passage d’une page à l’autre pour comprendre comment il est utilisé. Aucun cookie, aucune donnée personnelle, rien n’est partagé.', 'Accepter', 'Refuser'],
  en: ['This site would like to remember your visit from one page to the next to understand how it is used. No cookies, no personal data, nothing is shared.', 'Accept', 'Decline'],
  de: ['Diese Website möchte sich Ihren Besuch von Seite zu Seite merken, um zu verstehen, wie sie genutzt wird. Keine Cookies, keine personenbezogenen Daten, nichts wird weitergegeben.', 'Akzeptieren', 'Ablehnen'],
  it: ['Questo sito vorrebbe ricordare la vostra visita da una pagina all’altra per capire come viene usato. Nessun cookie, nessun dato personale, nulla viene condiviso.', 'Accetta', 'Rifiuta'],
  es: ['Este sitio quiere recordar su visita de una página a otra para entender cómo se usa. Sin cookies, sin datos personales, nada se comparte.', 'Aceptar', 'Rechazar'],
};

/** Au-delà, l'identifiant du mode visiteur est tiré à nouveau (13 mois). */
export const DUREE_IDENTIFIANT_VISITEUR_MS = 396 * 86_400_000;

/**
 * LE SCRIPT SERVI AUX PAGES. Minuscule et différé ; il se tait quand le
 * navigateur demande à ne pas être suivi (Do Not Track, Global Privacy
 * Control). L'identifiant de visite vit en mémoire le temps de la page.
 *
 * LE MODE EST DIT PAR LE SERVEUR, dans la réponse à la première page vue
 * (`{"m":"v"}` pour le mode visiteur) : l'extrait posé sur le site ne change
 * jamais, et passer d'un mode à l'autre ne demande pas de retoucher le site.
 *
 *  - MODE ANONYME : le script n'écrit RIEN sur l'appareil (ni cookie, ni
 *    stockage). S'il trouve un accord laissé par un ancien mode visiteur, il
 *    l'efface.
 *  - MODE VISITEUR : un bandeau d'accord, isolé du site (ombre DOM), deux
 *    boutons de même poids. Le choix est gardé dans le stockage local
 *    (`beluga_accord_<clé>`). Après accord seulement : un identifiant tiré au
 *    hasard (`beluga_v_<clé>`, renouvelé après 13 mois) et celui de la
 *    session (stockage de l'onglet) partent avec chaque événement. Refus ou
 *    absence de choix : la visite reste anonyme. JAMAIS de cookie.
 *  - REPÈRES : un clic sur un élément `[data-beluga-repere]` envoie
 *    l'événement « repere » avec son nom, dans les deux modes.
 */
export function scriptDeSuivi(adresseCollecte: string): string {
  const url = JSON.stringify(`${adresseCollecte.replace(/\/+$/, '')}/m/c`);
  const textes = JSON.stringify(TEXTES_BANDEAU);
  return `(function(){var d=document,n=navigator,w=window;var s=d.currentScript;if(!s)return;var k=s.getAttribute('data-cle');if(!k)return;
if(n.doNotTrack==='1'||w.doNotTrack==='1'||n.globalPrivacyControl){w.belugaSuivi=function(){};w.belugaSuivi.accord=function(){};return;}
var v=Math.random().toString(36).slice(2,12)+Math.random().toString(36).slice(2,8),t0=Date.now(),q=new URLSearchParams(location.search);
var c=q.get('bm')||'',u=q.get('utm_source')||'';
var A='beluga_accord_'+k,V='beluga_v_'+k,S='beluga_s_'+k,vp='',vs='',M='',L='';
function rid(){var a='';while(a.length<24)a+=Math.random().toString(36).slice(2);return a.slice(0,24);}
function st(x){try{return w[x];}catch(_){return null;}}
function ids(){var l=st('localStorage'),g=st('sessionStorage');if(!l||!g)return;try{var o=JSON.parse(l.getItem(V)||'null');
if(!o||!o.i||Date.now()-o.t>${DUREE_IDENTIFIANT_VISITEUR_MS}){o={i:rid(),t:Date.now()};l.setItem(V,JSON.stringify(o));}vp=o.i;vs=g.getItem(S)||'';if(!vs){vs=rid();g.setItem(S,vs);}}catch(_){vp='';vs='';}}
function choix(){var l=st('localStorage');try{return l?l.getItem(A):null;}catch(_){return null;}}
function oublier(){var l=st('localStorage'),g=st('sessionStorage');try{if(l&&(l.getItem(A)!==null||l.getItem(V)!==null)){l.removeItem(A);l.removeItem(V);}if(g&&g.getItem(S)!==null)g.removeItem(S);}catch(_){}vp='';vs='';}
if(choix()==='1')ids();
function e(t,x){x=x||{};var b={k:k,t:t,v:v,p:x.p||location.pathname,r:d.referrer||'',u:u,c:x.c||c};if(vp){b.vp=vp;b.vs=vs;}for(var i in x)if(!(i in b))b[i]=x[i];
var j=JSON.stringify(b);try{if(t==='sortie'&&n.sendBeacon){n.sendBeacon(${url},new Blob([j],{type:'text/plain'}));return null;}
return fetch(${url},{method:'POST',body:j,keepalive:true,mode:'cors',credentials:'omit',headers:{'content-type':'text/plain'}});}catch(_){return null;}}
var T=${textes},bd=null;
function bandeau(){if(bd||M!=='v')return;var h=(d.documentElement.lang||L||'fr').slice(0,2).toLowerCase(),x=T[h]||T[L]||T.fr;
bd=d.createElement('div');bd.setAttribute('data-beluga-bandeau','');bd.style.cssText='position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;max-width:560px;margin:0 auto';
var r=bd.attachShadow?bd.attachShadow({mode:'open'}):bd,y='font:14px/1.45 system-ui,sans-serif;';
r.innerHTML='<div style="'+y+'background:#fff;color:#1a1a1a;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.18);padding:14px 16px;display:flex;flex-wrap:wrap;gap:10px;align-items:center"><p style="margin:0;flex:1 1 260px"></p><span style="display:flex;gap:8px;flex:0 0 auto"><button data-r="0" style="'+y+'padding:7px 14px;border-radius:7px;border:1px solid #1a1a1a;background:#fff;color:#1a1a1a;cursor:pointer"></button><button data-r="1" style="'+y+'padding:7px 14px;border-radius:7px;border:1px solid #1a1a1a;background:#fff;color:#1a1a1a;cursor:pointer"></button></span></div>';
r.querySelector('p').textContent=x[0];r.querySelector('[data-r="1"]').textContent=x[1];r.querySelector('[data-r="0"]').textContent=x[2];
r.addEventListener('click',function(ev){var g=ev.target&&ev.target.getAttribute&&ev.target.getAttribute('data-r');if(g===null||g===undefined)return;
var l=st('localStorage');try{if(l)l.setItem(A,g);}catch(_){}if(g==='1')ids();else{vp='';vs='';try{if(l)l.removeItem(V);var ss=st('sessionStorage');if(ss)ss.removeItem(S);}catch(_){}}
if(bd&&bd.parentNode)bd.parentNode.removeChild(bd);bd=null;});(d.body||d.documentElement).appendChild(bd);}
function mode(p){if(!p||!p.then)return;p.then(function(r){return r&&r.status===200?r.json():null;}).then(function(o){if(!o)return;M=o.m==='v'?'v':'a';L=o.l||'';
if(M==='v'){if(choix()===null)bandeau();}else oublier();})['catch'](function(){});}
w.belugaSuivi=function(t,x){return e(t,x);};w.belugaSuivi.accord=function(){if(M!=='v')return;var l=st('localStorage');try{if(l)l.removeItem(A);}catch(_){}bandeau();};
mode(e('vue'));var fini=false;function sortie(){if(fini)return;fini=true;e('sortie',{d:Date.now()-t0});}
d.addEventListener('click',function(ev){var el=ev.target&&ev.target.closest?ev.target.closest('[data-beluga-repere]'):null;if(el)e('repere',{n:el.getAttribute('data-beluga-repere')||''});},true);
d.addEventListener('visibilitychange',function(){if(d.visibilityState==='hidden')sortie();});w.addEventListener('pagehide',sortie);})();`;
}

/* ------------------------------------------------------------------ */
/* Annonces et semaine                                                 */
/* ------------------------------------------------------------------ */

/**
 * UNE LIVRAISON QUI MÉRITE UNE ANNONCE : seules une grande nouveauté ou une
 * amélioration en valent la peine. Rend le brouillon, ou null.
 */
export function annonceDeLivraison(entree: {
  poids?: string | null;
  titre?: string | null;
  explication?: string | null;
  nomProjet: string;
}): { titre: string; texte: string } | null {
  if (entree.poids !== 'grande-nouveaute' && entree.poids !== 'amelioration') return null;
  const titre = (entree.titre ?? '').trim();
  if (!titre) return null;
  const explication = (entree.explication ?? '').trim();
  const accroche = entree.poids === 'grande-nouveaute' ? `Nouveau sur ${entree.nomProjet} :` : `${entree.nomProjet} s’améliore :`;
  return {
    titre: `Annonce — ${titre}`.slice(0, 120),
    texte: [`${accroche} ${titre}.`, explication].filter(Boolean).join('\n\n').slice(0, 2000),
  };
}

/** Le lundi (AAAA-MM-JJ) de la semaine d'un instant, en heure locale du serveur. */
export function lundiDe(instant: number): string {
  const d = new Date(instant);
  const decalage = (d.getDay() + 6) % 7;
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - decalage);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * EST-CE L'HEURE DU PLAN DE LA SEMAINE ? Le dimanche à partir de 22 h, une
 * seule fois par semaine : `dejaFaitPour` est le lundi de la semaine déjà
 * préparée.
 */
export function estLHeureDuPlanHebdo(instant: number, dejaFaitPour: string | null | undefined): boolean {
  const d = new Date(instant);
  if (d.getDay() !== 0 || d.getHours() < 22) return false;
  const lundiSuivant = lundiDe(instant + 86_400_000);
  return dejaFaitPour !== lundiSuivant;
}

/* ------------------------------------------------------------------ */
/* Le plafond de ce qui attend, et le rythme de l'utilisateur          */
/* ------------------------------------------------------------------ */

/**
 * AU-DELÀ DE CE NOMBRE DE CONTENUS QUI ATTENDENT (brouillons + à valider),
 * l'agent cesse de produire TOUT SEUL : annonces de livraison et plan du
 * dimanche. Produire davantage n'aide personne tant que rien n'est relu. Le
 * bouton « Générer la suite » reste, lui, un geste de l'utilisateur : il ne
 * s'arrête jamais sur ce plafond.
 */
export const SEUIL_CONTENUS_EN_ATTENTE = 10;

/** Combien de contenus attendent une relecture (les abandonnés ne comptent pas). */
export function contenusEnAttente(parEtape: Readonly<Record<string, number>>): number {
  return (parEtape.brouillon ?? 0) + (parEtape.a_valider ?? 0);
}

/** La production automatique est-elle suspendue ? Oui dès que 10 contenus ou plus attendent. */
export function productionAutomatiqueSuspendue(parEtape: Readonly<Record<string, number>>): boolean {
  return contenusEnAttente(parEtape) >= SEUIL_CONTENUS_EN_ATTENTE;
}

/** AAAA-MM-JJ d'un instant, en heure locale du serveur (comme `lundiDe`). */
export function jourLocalDe(instant: number): string {
  const d = new Date(instant);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export type VitesseDeLUtilisateur = 'lent' | 'regulier' | 'rapide';

export interface RythmeDeLUtilisateur {
  /** Contenus que l'utilisateur a fait avancer (prêts, programmés, publiés) sur 7 puis 14 jours. */
  avances7: number;
  avances14: number;
  /** Brouillons et « à valider » dont le jour prévu est passé : ce qui n'a pas été fait. */
  enRetard: number;
  enAttente: number;
  vitesse: VitesseDeLUtilisateur;
}

/**
 * LE RYTHME RÉEL DE L'UTILISATEUR, en chiffres rendus à l'agent. Un contenu
 * « avancé » est un contenu que l'utilisateur a relu : il a quitté
 * « Brouillon » et « À valider » (dernier mouvement dans la fenêtre).
 * Lent : rien d'avancé en 14 jours alors que des contenus attendent, ou
 * plus de retard que d'avancé ; rapide : au moins 3 avancés en 7 jours sans
 * retard à rattraper.
 */
export function rythmeDeLUtilisateur(
  contenus: readonly { etape: EtapeContenu; datePrevue?: string | null; majLe: number }[],
  maintenant: number,
): RythmeDeLUtilisateur {
  const aujourdhui = jourLocalDe(maintenant);
  const avances = contenus.filter((c) => c.etape === 'pret' || c.etape === 'programme' || c.etape === 'publie');
  const avances7 = avances.filter((c) => maintenant - c.majLe <= 7 * 86_400_000).length;
  const avances14 = avances.filter((c) => maintenant - c.majLe <= 14 * 86_400_000).length;
  const enAttenteListe = contenus.filter((c) => c.etape === 'brouillon' || c.etape === 'a_valider');
  const enRetard = enAttenteListe.filter((c) => !!c.datePrevue && c.datePrevue < aujourdhui).length;
  const enAttente = enAttenteListe.length;
  let vitesse: VitesseDeLUtilisateur = 'regulier';
  if ((avances14 === 0 && enAttente > 0) || enRetard > avances14) vitesse = 'lent';
  else if (avances7 >= 3 && enRetard === 0) vitesse = 'rapide';
  return { avances7, avances14, enRetard, enAttente, vitesse };
}

/** Le rythme, en une ligne lisible par l'agent. */
export function phraseDuRythme(r: RythmeDeLUtilisateur): string {
  return `RYTHME DE L’UTILISATEUR : ${r.avances7} contenu(s) relu(s) ou programmé(s) en 7 jours, ${r.avances14} en 14 jours ; ${r.enAttente} en attente (brouillon ou à valider), dont ${r.enRetard} dont le jour prévu est passé. Vitesse : ${r.vitesse}.`;
}

/** Les contenus à replacer : brouillons et « à valider » dont le jour prévu est passé. */
export function contenusEnRetard<C extends { etape: EtapeContenu; datePrevue?: string | null }>(contenus: readonly C[], maintenant: number): C[] {
  const aujourdhui = jourLocalDe(maintenant);
  return contenus.filter((c) => (c.etape === 'brouillon' || c.etape === 'a_valider') && !!c.datePrevue && c.datePrevue < aujourdhui);
}

/** Heure du tour quotidien de réorganisation : à partir de 6 h, une seule fois par jour local. */
export function estLHeureDeLaReorganisation(instant: number, dejaFaitPour: string | null | undefined): boolean {
  return new Date(instant).getHours() >= 6 && dejaFaitPour !== jourLocalDe(instant);
}

/* ------------------------------------------------------------------ */
/* L'agent                                                             */
/* ------------------------------------------------------------------ */

export const DEMANDE_MARKETING_MAX = 4000;

export function raisonDemandeMarketingRefusee(demande: string): string | null {
  const propre = (demande ?? '').trim();
  if (!propre) return 'Dites à l’agent ce que vous voulez.';
  if (propre.length > DEMANDE_MARKETING_MAX) return `La demande dépasse ${DEMANDE_MARKETING_MAX} signes.`;
  return null;
}

export const CONSIGNE_AGENT_MARKETING = `Tu travailles dans Beluga Build. Tu parles à quelqu'un qui ne connaît PAS le marketing : mots courants, phrases courtes, chaque notion expliquée en une phrase la première fois.

TU ES L'AGENT MARKETING ATTITRÉ DE CE PROJET. Ton but : que ce projet rapporte le plus possible. Tu fais le travail ; l'utilisateur décide.

TON OUTIL : « marketing ». Ses actions : « lire » (tout ce qui est enregistré : configuration, fiche, rapport, avis sur les canaux, plan d'action, contenus, résultats), « configurer », « fiche », « canaux », « action », « contenu », « poser_suivi », « rapport ». Tu n'écris RIEN d'autre ailleurs : tu ne modifies aucun fichier du projet, tu ne publies rien, tu ne lances aucune commande de mise en ligne.

1. COMPRENDRE LE PRODUIT (à la première conversation, puis dès qu'il change). Lis le dépôt du projet (lecture seule : README, pages, package.json, configuration), sa destination et ses consignes de mise en ligne, son adresse publique, et regarde le site s'il répond. Déduis : la NATURE (site, boutique, app, saas), l'HÉBERGEMENT (beluga = ce serveur, serveur-distant, hebergeur, plateforme comme Shopify ou WordPress) et son détail, l'ADRESSE, les SOURCES DE VENTES (suivi, stripe, shopify, woocommerce, compta), les OBJECTIFS à suivre, la LANGUE, la MÉTHODE de pose du suivi (carte-code si le code est géré dans Beluga ; plateforme ; manuel sinon). Enregistre avec « configurer », avec une « explication » de deux ou trois phrases. Dis ensuite à l'utilisateur ce que tu as compris et choisi : il te corrige en te parlant.

2. LE POSITIONNEMENT. Rédige la fiche (« fiche ») : cible, probleme, promesse, arguments, ton, offre, prix, concurrents. Ce que tu ne peux pas deviner (le prix, la cible exacte), tu le DEMANDES avec « ask_user », une question à la fois, avec des propositions.

3. LE SUIVI. « poser_suivi » prépare l'installation du script de suivi anonyme et sans cookie : il crée une carte à lancer par l'utilisateur (carte-code), ou te rend l'extrait et la marche à suivre (plateforme, manuel). Il rend TOUJOURS la phrase à ajouter à la page « confidentialité » : transmets-la. Sur une plateforme, un geste dans son administration ne se fait qu'APRÈS l'avoir annoncé à l'utilisateur et avec son accord (« ask_user »), avec les accès du coffre-fort (« coffre_fort », « lister » d'abord). Jamais en cachette.

4. LES CANAUX. L'utilisateur est DÉBUTANT : c'est toi qui l'orientes. Passe en revue TOUT le catalogue (${CATALOGUE_CANAUX.map((c) => c.cle).join(', ')}) et donne ton avis sur chacun avec « canaux » : « recommandations » = [{ canal, pertinence haute|moyenne|faible, raison (une phrase simple, propre à CE produit), premierPas (le premier geste concret), etapes (deux à quatre conseils concrets propres à CE produit, qui complètent le parcours de base du canal déjà affiché à l'utilisateur : créer le compte, soigner le profil, publier, tenir le rythme — ne les redis pas, précise-les) }], et « choisis » = les deux à quatre canaux par lesquels commencer. Pas tous à la fois : mieux vaut peu de canaux bien tenus.

5. LE PLAN D'ACTION. Pose un plan daté sur les quatre à six semaines qui viennent avec « action » (titre, detail : quoi faire et comment, en pas simples ; canal ; datePrevue AAAA-MM-JJ) : créer les comptes et fiches qui manquent, préparer une page, contacter des partenaires, lancer une publicité test, faire le point. Deux ou trois actions par semaine au plus. Il s'affiche dans le calendrier ; l'utilisateur coche ce qui est fait. « lire » d'abord : n'ajoute pas une action qui existe déjà, corrige-la (« id »).

6. LES CONTENUS. « contenu » crée ou modifie un contenu : genre (post, courriel, page, annonce, argumentaire), canal (${CANAUX_CONTENU.join(', ')}), titre, texte, datePrevue (AAAA-MM-JJ) facultative, etape « brouillon » ou « a_valider ». Tu ne vas JAMAIS plus loin : valider, programmer et publier sont des gestes de l'utilisateur. Seule exception : tu peux ARCHIVER une de tes propositions périmée ou devenue inutile (encore en brouillon ou à valider) avec etape « abandonne » ; jamais un contenu prêt, programmé ou publié. Écris pour le réseau visé (longueur, ton), appuie-toi sur la fiche et sur ce qui a marché (« lire » donne les résultats par contenu). Pour tester deux versions d'un post, crée la version B avec « varianteDe ». L'utilisateur doit trouver de la MATIÈRE prête : à l'initialisation, rédige une première série (au moins un contenu par canal choisi qui se publie), datée sur les jours du plan, en « a_valider ». « lire » d'abord : ne double jamais un contenu qui existe.

7. LE RAPPORT. À la fin de l'initialisation, d'une réanalyse, ou quand ce que tu sais du produit change, écris le rapport avec l'action « rapport » : un texte Markdown court et lisible par quelqu'un qui ne programme pas — ce qu'est le produit et pour qui, où il vit, comment on y paie, le positionnement retenu, les canaux choisis et pourquoi, le plan des semaines qui viennent, les contenus prêts à relire, l'état de la mesure, puis les trois prochaines choses à faire. Le rapport REMPLACE le précédent : écris-le entier. L'outil le refuse tant que la nature et l'hébergement ne sont pas enregistrés avec « configurer ».

LE RAPPORT VIT DANS TA CONVERSATION : l'utilisateur le lit dans ton fil et te répond juste dessous (« tu as oublié tel point », « change ceci »). Chaque fois que tu écris ou réécris le rapport, ta RÉPONSE FINALE est le rapport ENTIER, tel que tu l'as enregistré. Sur une demande de correction : « lire », corrige ce qui est demandé (configuration, fiche, canaux, plan, contenus), puis réécris le rapport entier avec « rapport » et rends-le.

LISTE DE TÂCHES : au début d'un travail de plusieurs étapes, annonce ta liste de tâches et coche-la au fil de l'eau — l'écran la montre au-dessus du champ d'écriture. À l'initialisation et à la réanalyse, UNE tâche par point étudié : comprendre le produit, le positionnement, l'offre et le prix, la mesure, les canaux, le plan d'action, les premiers contenus, les ventes, le rapport.

TA RÉPONSE FINALE, hors rapport, tient en quelques lignes simples : ce que tu as fait, ce qui attend l'utilisateur. Aucun tableau, aucun bloc json.

SILENCE SUR LES IDENTIFIANTS STOCKÉS : les accès gardés au coffre-fort sont un choix ASSUMÉ par l'utilisateur. Tu ne le commentes pas.`;

/** Le rapport de l'agent : du Markdown borné, jamais vide. */
export const RAPPORT_MARKETING_MAX = 12_000;

export function rapportPropre(valeur: unknown): string | null {
  if (typeof valeur !== 'string') return null;
  const propre = valeur.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return propre ? propre.slice(0, RAPPORT_MARKETING_MAX) : null;
}

/**
 * LE RAPPORT N'EST ACCEPTÉ QUE SI LE GUIDE PEUT SE COCHER. Sans nature ni
 * hébergement enregistrés, l'agent avait tout expliqué en texte et « Le produit
 * est compris » restait vide : la porte du rapport le lui rappelle.
 */
export function raisonRapportRefuse(config: ConfigurationMarketing, rapport: unknown): string | null {
  if (!rapportPropre(rapport)) return 'Donne « rapport » : le texte complet, en Markdown.';
  const manque = [!config.nature && 'nature', !config.hebergement && 'hebergement'].filter(Boolean);
  if (manque.length) {
    return `Enregistre d’abord ${manque.join(' et ')} avec « configurer » : sans eux, le Guide ne peut pas dire que le produit est compris.`;
  }
  return null;
}

/** Les deux gestes du bouton unique de l'écran : la phrase part à l'agent attitré. */
export type GesteAgentMarketing = 'initialiser' | 'reanalyser' | 'suite';

export function demandeDuGeste(geste: GesteAgentMarketing, rythme?: RythmeDeLUtilisateur | null): string {
  if (geste === 'suite') {
    return [
      'GÉNÈRE LA SUITE : l’utilisateur te demande de préparer la suite du travail. Annonce ta liste de tâches, puis :',
      '1. « lire » d’abord : les contenus existants, le plan, les résultats, les nouveautés en réserve et le rythme de l’utilisateur.',
      '2. ARCHIVE tes propositions périmées ou doublonnées encore en brouillon ou à valider (« contenu » avec « id » et etape « abandonne »). Jamais un contenu prêt, programmé ou publié.',
      '3. Produis la suite, MESURÉE sur son rythme : 3 à 6 contenus au plus, moins s’il est lent, jamais un doublon de ce qui existe. Chaque nouveauté en réserve qui mérite une annonce devient un contenu avec « nouveaute » = sa référence.',
      '4. Dates : replace aussi les brouillons existants en retard (« datePrevue ») — plus loin s’il est lent, plus près s’il avance vite.',
      'Dépose en « a_valider » ou « brouillon », jamais plus loin. Personne ne te répond : n’appelle PAS « ask_user ». Réponse finale : quelques lignes — ce que tu as archivé, déposé, replacé.',
      ...(rythme ? [phraseDuRythme(rythme)] : []),
    ].join(' ');
  }
  if (geste === 'reanalyser') {
    return [
      'RÉANALYSE COMPLÈTE : le projet a changé. Annonce ta liste de tâches (une par point étudié), puis refais les étapes 1 à 7 de ta consigne sur le dépôt ACTUEL.',
      '« lire » d’abord : corrige la configuration, la fiche, les avis sur les canaux et le plan (ce qui n’a pas changé, tu le laisses),',
      'complète le plan et les contenus SANS doubler ce qui existe déjà, vérifie le suivi,',
      'puis RÉÉCRIS le rapport entier avec l’action « rapport » et rends-le comme réponse finale.',
    ].join(' ');
  }
  return [
    'INITIALISATION : annonce ta liste de tâches (une par point étudié), puis fais les étapes 1 à 7 de ta consigne —',
    'comprendre le produit et l’enregistrer (« configurer », nature et hébergement compris), rédiger la fiche (« fiche »),',
    'préparer le suivi, donner ton avis sur TOUS les canaux du catalogue et choisir ceux par lesquels commencer (« canaux »),',
    'poser le plan d’action des quatre à six semaines qui viennent (« action »), rédiger une première série de contenus datés à valider (« contenu »).',
    'Ce que tu ne peux pas deviner, demande-le avec « ask_user ».',
    'Termine en enregistrant le rapport avec l’action « rapport », et rends-le entier comme réponse finale.',
  ].join(' ');
}

/**
 * L'ÉTAT DU BOUTON UNIQUE de l'écran Marketing d'un projet. Un seul bouton en
 * tête : il lance, montre l'avancement, signale une question, puis ouvre le
 * rapport — jamais deux boutons qui mènent au même agent.
 */
export type EtatBoutonMarketing = 'initialiser' | 'travail' | 'question' | 'rapport' | 'conversation';

export function etatDuBoutonMarketing(entree: {
  aUnAgent: boolean;
  travaille: boolean;
  attendReponse: boolean;
  aUnRapport: boolean;
}): EtatBoutonMarketing {
  if (!entree.aUnAgent) return 'initialiser';
  // La question passe DEVANT le travail : un agent arrêté sur sa question
  // n'est en travail pour personne, il attend quelqu'un.
  if (entree.attendReponse) return 'question';
  if (entree.travaille) return 'travail';
  return entree.aUnRapport ? 'rapport' : 'conversation';
}

/** La demande envoyée à l'agent : la phrase de l'utilisateur, et l'état actuel quand il y en a un. */
export function demandeMarketing(entree: {
  demande: string;
  nomProjet: string;
  premiere: boolean;
  espace: EspaceMarketing | null;
  destination?: string | null;
  consignesDeMiseEnLigne?: string | null;
  adressePublique?: string | null;
}): string {
  const demande = entree.demande.trim().slice(0, DEMANDE_MARKETING_MAX);
  const lignes = [`PROJET : « ${entree.nomProjet} ».`, ''];
  if (entree.premiere) {
    lignes.push(
      'PREMIÈRE CONVERSATION : commence par COMPRENDRE LE PRODUIT (étape 1 de ta consigne) et enregistre la configuration, puis réponds à la demande.',
      '',
      'CE QUE BELUGA SAIT DÉJÀ DE SA MISE EN LIGNE :',
      `- destination : ${entree.destination?.trim() || 'non renseignée'}`,
      `- consignes : ${entree.consignesDeMiseEnLigne?.trim().slice(0, 800) || 'non renseignées'}`,
      `- adresse publique : ${entree.adressePublique?.trim() || 'non renseignée'}`,
      '',
    );
  } else if (entree.espace) {
    const c = entree.espace.configuration;
    lignes.push(
      `DÉJÀ ENREGISTRÉ : nature ${c.nature ?? '?'}, hébergement ${c.hebergement ?? '?'}${c.hebergementDetail ? ` (${c.hebergementDetail})` : ''}, suivi ${c.etatSuivi}. « lire » te donne le reste.`,
      '',
    );
  }
  lignes.push('LA DEMANDE :', `« ${demande} »`);
  return lignes.join('\n');
}

/** La demande du dimanche soir : préparer la semaine, en brouillons. */
export function demandeDuPlanHebdo(entree: { lundi: string }): string {
  return [
    `PLAN DE LA SEMAINE DU ${entree.lundi}. Tour automatique du dimanche soir : personne ne te répond, n'appelle PAS « ask_user ».`,
    '« lire » d’abord : les livraisons récentes (annonces en brouillon), les résultats et ce qui a le mieux marché.',
    `Puis dépose 3 à 5 contenus pour la semaine, chacun avec sa « datePrevue » entre le ${entree.lundi} et le dimanche suivant, en étape « a_valider ». Ne programme rien : l’utilisateur valide lundi.`,
    'Réponse finale : une ligne par contenu déposé.',
  ].join('\n');
}

/** La demande du tour quotidien : replacer les dates selon le rythme réel, sans rien produire de neuf. */
export function demandeDeReorganisation(entree: { aujourdhui: string; rythme: RythmeDeLUtilisateur }): string {
  return [
    `RÉORGANISATION DU ${entree.aujourdhui}. Tour automatique quotidien : personne ne te répond, n'appelle PAS « ask_user ». Tu ne CRÉES aucun contenu ici.`,
    phraseDuRythme(entree.rythme),
    '« lire » d’abord. Replace les brouillons et contenus « à valider » dont le jour prévu est passé, avec « contenu » (« id » + « datePrevue » AAAA-MM-JJ) :',
    'si l’utilisateur est LENT, reporte-les sur les jours et les semaines qui viennent, à raison de peu par jour ; s’il avance VITE, rapproche-les sur les jours à venir ;',
    'répartis-les sans les empiler sur un même jour. Archive (etape « abandonne ») ceux de tes contenus devenus périmés. Ne touche jamais un contenu prêt, programmé ou publié.',
    'Réponse finale : une ligne par contenu replacé ou archivé.',
  ].join('\n');
}

/** Le titre de la carte de l'agent attitré. */
export function titreDeLAgentMarketing(nomProjet: string): string {
  return `Marketing — ${nomProjet}`.slice(0, 80);
}
