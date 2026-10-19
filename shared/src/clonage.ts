/**
 * LE CLONAGE D'UN PRODUIT EXISTANT — une variante du cahier des charges.
 *
 * Décision de l'utilisateur (14.10.2026) : quand on lui demande de cloner un
 * site, un SaaS, une application (bureau, Android, iPhone), un jeu ou autre,
 * Beluga monte un projet dont le cahier des charges part de la SOURCE fournie.
 * L'agent du cahier demande d'abord « vrai clone ou s'inspirer profondément »,
 * puis — pour un clone, À CHAQUE FOIS — si l'identité (nom, logo, textes,
 * images) est reprise ; il analyse la source avec REA (github.com/morluto/rea)
 * et rédige le cahier des charges complet à partir de ce qu'il a trouvé.
 *
 * Entrées : la fenêtre « Nouveau projet » (champ « source à cloner »), l'outil
 * `project_manage` (geste creer, champ `source`), et toute conversation — le
 * cadrage et l'assistant général reconnaissent la demande et proposent le
 * montage (`REGLE_DEMANDE_DE_CLONAGE`).
 *
 * REA est branché sur le SEUL agent d'un cahier à source (`server/src/rea.ts`),
 * réduit aux outils de `OUTILS_REA_DU_CLONAGE` : sites, SaaS, JavaScript/Electron,
 * Android. Ni Ghidra, ni Hopper, ni IDA (choix de l'utilisateur).
 *
 * Règle PURE : ni base, ni disque, ni moteur (`server/src/test/clonage.test.ts`).
 */

import { z } from 'zod';

/** La version de REA installée et mesurée sur ce serveur (`scripts/installer-rea.mjs`). */
export const VERSION_REA = '6.5.0';

/** Le moteur Android que REA exige, vérifié par son empreinte. */
export const JAR_JADX = {
  nom: 'jadx-headless-mcp-0.7.1-all.jar',
  sha256: '6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75',
} as const;

/** Le nom du serveur MCP dans la configuration de l'agent du clonage. */
export const SERVEUR_MCP_REA = 'rea';

/**
 * LES OUTILS DE REA OUVERTS AU CLONAGE. `rea --mcp` en annonce ~207 (216 Ko de
 * schémas même en profil compact) ; le relais `scripts/rea-mcp.mjs` ne laisse
 * passer que ceux-ci (≈ 40 Ko) : pages et code des sites, applications
 * JavaScript/Electron, paquets Android, artefacts et bilans de reconstruction.
 */
export const OUTILS_REA_DU_CLONAGE = [
  // Sites et SaaS, par un Chrome au port de débogage local
  'list_browser_targets',
  'inspect_web_page',
  'analyze_web_bundle',
  'capture_web_screenshot',
  'capture_browser_scenario',
  'observe_web_session',
  'inspect_web_network_capture',
  'inspect_web_event_listeners',
  'export_web_scripts',
  'trace_web_module_imports',
  'recover_javascript_sources',
  // Applications JavaScript / Electron (bureau), sans moteur natif
  'analyze_javascript_application',
  'trace_application_feature',
  'trace_javascript_semantics',
  'inspect_electron_fuses',
  'list_electron_targets',
  'inspect_electron_page',
  'capture_electron_scenario',
  // Android, par JADX
  'inspect_android_package',
  'search_android_classes',
  'inspect_android_class',
  'inspect_android_method',
  'trace_android_references',
  'project_android_application_graph',
  // Artefacts et bilans
  'inspect_artifact',
  'extract_artifact',
  'get_evidence_bundle',
  'build_reconstruction_obligation_ledger',
  'evaluate_reconstruction_coverage',
] as const;

/** Ce qu'on clone. Les trois derniers ne se décompilent pas : captures et pages publiques. */
export const GENRES_DE_SOURCE = ['site', 'saas', 'bureau', 'android', 'iphone', 'jeu', 'autre'] as const;
export type GenreDeSource = (typeof GENRES_DE_SOURCE)[number];

export const LIBELLES_GENRES_DE_SOURCE: Record<GenreDeSource, string> = {
  site: 'Site',
  saas: 'SaaS',
  bureau: 'Application de bureau',
  android: 'Application Android',
  iphone: 'Application iPhone',
  jeu: 'Jeu',
  autre: 'Autre',
};

export const MODES_DE_CLONAGE = ['clone', 'inspiration'] as const;

export const ETATS_DE_L_ANALYSE = ['a-faire', 'en-cours', 'terminee', 'echouee'] as const;

/** Le dossier du projet où la source fournie est recopiée (sous `docs/inspiration`). */
export const DOSSIER_DE_LA_SOURCE = 'docs/inspiration/source';

/** Le rapport d'analyse que l'agent écrit, à côté. */
export const RAPPORT_D_ANALYSE = 'docs/inspiration/analyse-source.md';

/** La source d'un cahier, écrite sur la carte (`Card.cahierDesCharges.source`). */
export const SourceDuClonage = z.object({
  /** Le lien fourni (site, page d'une boutique, dépôt…). */
  url: z.string().optional(),
  /** Le produit nommé en clair quand il n'y a pas de lien (« l'appli Android de Strava »). */
  nom: z.string().optional(),
  /** Les fichiers fournis, relatifs au projet (APK, archive, HAR, captures). */
  fichiers: z.array(z.string()).default([]),
  /** Le genre, deviné à la création puis confirmé par l'agent. */
  genre: z.enum(GENRES_DE_SOURCE).optional(),
  /** Vrai clone ou inspiration profonde : la PREMIÈRE question du parcours. */
  mode: z.enum(MODES_DE_CLONAGE).optional(),
  /** Clone seulement : nom, logo, textes et images repris (demandé à chaque clone). */
  identiteReprise: z.boolean().optional(),
  /** Où en est l'analyse REA. */
  analyse: z.enum(ETATS_DE_L_ANALYSE).default('a-faire'),
});
export type SourceDuClonage = z.infer<typeof SourceDuClonage>;

/** Une adresse web lisible, ou rien. */
function lienPropre(brut: unknown): string | undefined {
  const texte = String(brut ?? '').trim();
  if (!texte) return undefined;
  const avecSchema = /^[a-z][a-z0-9+.-]*:\/\//i.test(texte) ? texte : `https://${texte}`;
  try {
    const u = new URL(avecSchema);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * LE GENRE DEVINÉ À LA CRÉATION, que l'agent confirme ensuite. Un fichier dit
 * plus qu'un lien : un APK est Android, une archive d'application de bureau est
 * « bureau » ; un lien vers une boutique dit sa plateforme ; un lien nu est un site.
 */
export function genreDevine(source: { url?: string; nom?: string; fichiers?: string[] }): GenreDeSource {
  const fichiers = (source.fichiers ?? []).map((f) => f.toLowerCase());
  if (fichiers.some((f) => /\.(apk|aab|xapk|apks)$/.test(f))) return 'android';
  if (fichiers.some((f) => /\.ipa$/.test(f))) return 'iphone';
  if (fichiers.some((f) => /\.(asar|exe|msi|dmg|appimage|deb|rpm)$/.test(f))) return 'bureau';
  const url = String(source.url ?? '').toLowerCase();
  if (/play\.google\.com\//.test(url)) return 'android';
  if (/apps\.apple\.com\//.test(url)) return 'iphone';
  if (/(store\.steampowered|itch\.io|epicgames\.com)/.test(url)) return 'jeu';
  if (url) return 'site';
  const nom = String(source.nom ?? '').toLowerCase();
  if (/android|apk\b/.test(nom)) return 'android';
  if (/iphone|ipad|\bios\b/.test(nom)) return 'iphone';
  if (/\bjeux?\b|\bgame\b/.test(nom)) return 'jeu';
  if (/\bsaas\b/.test(nom)) return 'saas';
  if (/electron|bureau|desktop|windows|macos|linux/.test(nom)) return 'bureau';
  return 'autre';
}

/**
 * LA SOURCE TELLE QU'ELLE ARRIVE (fenêtre, outil `project_manage`), lue et
 * bornée. Rien de fourni : `undefined`, et le cahier reste un cahier ordinaire.
 */
export function lireSourceFournie(brut: unknown): SourceDuClonage | undefined {
  const b: Record<string, unknown> = brut && typeof brut === 'object' ? (brut as Record<string, unknown>) : { url: brut };
  /* Un texte qui n'a rien d'une adresse (« Notion », « l'appli de Strava ») est le NOM du produit. */
  const texte = String(b.url ?? '').trim();
  const url = /\s/.test(texte) ? undefined : lienPropre(/[./]/.test(texte) ? texte : '');
  const nom = String(b.nom ?? '').trim().slice(0, 200) || (!url && texte ? texte.slice(0, 200) : '') || undefined;
  const fichiers = Array.isArray(b.fichiers)
    ? b.fichiers.map((f) => String(f ?? '').trim()).filter(Boolean).slice(0, 40)
    : [];
  if (!url && !nom && !fichiers.length) return undefined;
  const genre = (GENRES_DE_SOURCE as readonly string[]).includes(String(b.genre))
    ? (b.genre as GenreDeSource)
    : genreDevine({ url, nom, fichiers });
  return { url, nom, fichiers, genre, analyse: 'a-faire' };
}

/**
 * CE QUE L'AGENT PEUT FIXER SUR LA SOURCE à chaque écriture du cahier : le mode,
 * la reprise de l'identité, le genre confirmé, l'état de l'analyse. Une valeur
 * absente garde l'ancienne ; l'identité n'a de sens que pour un clone.
 */
export function majDeLaSource(avant: SourceDuClonage | undefined, args: Record<string, unknown>): SourceDuClonage | undefined {
  if (!avant) return undefined;
  const dans = <T extends string>(liste: readonly T[], v: unknown): T | undefined =>
    (liste as readonly string[]).includes(String(v)) ? (v as T) : undefined;
  const mode = dans(MODES_DE_CLONAGE, args.mode) ?? avant.mode;
  const identite =
    args.identiteReprise === true || args.identiteReprise === 'true'
      ? true
      : args.identiteReprise === false || args.identiteReprise === 'false'
        ? false
        : avant.identiteReprise;
  return {
    ...avant,
    genre: dans(GENRES_DE_SOURCE, args.genre) ?? avant.genre,
    mode,
    identiteReprise: mode === 'inspiration' ? undefined : identite,
    analyse: dans(ETATS_DE_L_ANALYSE, args.analyse) ?? avant.analyse,
  };
}

/** Le nom d'un fichier fourni, débarrassé de tout chemin et de tout caractère risqué. */
export function nomDeFichierDeSource(nom: string): string {
  const base = String(nom ?? '').split(/[\\/]/).pop() ?? '';
  const propre = base.replace(/[^\p{L}\p{N}._ -]+/gu, '-').replace(/^[.\s-]+/, '').slice(0, 120).trim();
  return propre || 'fichier';
}

/* ------------------------------------------------------------------ */
/* Les textes envoyés à l'agent                                        */
/* ------------------------------------------------------------------ */

function decrireLaSource(source: SourceDuClonage, avecGenre: boolean): string {
  const lignes = [
    source.url ? `- lien : ${source.url}` : '',
    source.nom ? `- le produit, nommé par l'utilisateur : ${source.nom}` : '',
    source.fichiers.length ? `- fichiers fournis (dans le projet) : ${source.fichiers.join(', ')}` : '',
    avecGenre && source.genre ? `- genre deviné à la création : ${LIBELLES_GENRES_DE_SOURCE[source.genre]} (« ${source.genre} », à confirmer)` : '',
  ].filter(Boolean);
  return lignes.join('\n');
}

/**
 * LA CONSIGNE DU CLONAGE, ajoutée à celle du cahier pour une carte À SOURCE. Elle
 * ne dépend que de la source fixée à la naissance : stable d'un tour à l'autre.
 */
export function consigneDuClonage(source: SourceDuClonage, cheminDuProjet: string, cheminCompetenceRea: string): string {
  return `CE CAHIER DES CHARGES PART D'UN PRODUIT EXISTANT À CLONER OU DONT S'INSPIRER. Il commence par une phase « Source », AVANT la vision, et c'est ce qui la distingue du parcours ordinaire.

LA SOURCE FOURNIE :
${decrireLaSource(source, false)}

PHASE « SOURCE », UNE QUESTION À LA FOIS AVEC « ask_user » :
1. « Voulez-vous un VRAI CLONE de cette source, ou vous en INSPIRER PROFONDÉMENT pour un produit à vous ? » — clone : on reproduit le fonctionnement, les écrans et la mise en page ; inspiration : on part de la source et chaque partie se garde, s'adapte ou change. Écris la réponse avec « cahier_des_charges » (« mode » : clone ou inspiration).
2. POUR UN CLONE SEULEMENT, et à CHAQUE clone : « Reprend-on aussi l'identité — nom, logo, textes, images — ou seulement le fonctionnement et la mise en page ? » (« identiteReprise »). Rappelle dans la description que reprendre l'identité d'un produit qui n'est pas le sien n'est permis qu'avec les droits sur cette marque.
3. S'il manque de quoi analyser — seulement un nom, une application Android sans son APK, une application de bureau sans son archive —, demande le lien exact ou le fichier (il se joint dans le panneau de décision) et recopie chaque fichier reçu dans ${cheminDuProjet}/${DOSSIER_DE_LA_SOURCE}/. Si le genre deviné est faux ou incertain, fais-le confirmer (« genre » : ${GENRES_DE_SOURCE.join(', ')}).
4. SI LA SOURCE EXIGE UNE CONNEXION (espace client d'un SaaS, application à compte) : demande un accès d'essai. Enregistre-le AUSSITÔT au coffre-fort (outil « coffre_fort », une fiche par secret), et ne l'écris JAMAIS dans le document, dans ${cheminDuProjet}/docs/inspiration/ ni dans le rapport.

L'ANALYSE, avec REA (les outils du serveur MCP « ${SERVEUR_MCP_REA} ») — rappelle-toi l'usage légitime : recherche, interopérabilité, produit dont l'utilisateur a les droits ou qu'il reproduit pour son propre usage. Lis d'abord le mode d'emploi de REA (${cheminCompetenceRea}). Passe « analyse » à « en-cours » avant de commencer, « terminee » (ou « echouee », en disant pourquoi dans le rapport) à la fin.
- SITE ou SAAS : lance un Chrome sans écran sur un port de débogage LOCAL (« google-chrome --headless=new --remote-debugging-port=<port libre> --user-data-dir=<dossier temporaire> about:blank », en arrière-plan), ouvre les pages utiles, puis « list_browser_targets », « inspect_web_page », « analyze_web_bundle », « capture_web_screenshot », « inspect_web_network_capture ». Parcours les écrans PUBLICS (et, avec l'accès d'essai, l'espace connecté) : pages, navigation, formulaires, appels réseau, technologies reconnues.
- APPLICATION DE BUREAU JavaScript / Electron : « analyze_javascript_application » sur le dossier ou l'archive .asar extraits, puis « trace_application_feature ».
- ANDROID (APK fourni) : « inspect_android_package », « search_android_classes », « inspect_android_class », « trace_android_references » : écrans (activités), permissions, services appelés, bibliothèques.
- IPHONE, JEU, PROGRAMME COMPILÉ : AUCUNE décompilation (non équipé). Analyse les pages publiques (boutique, site, vidéos) et DEMANDE des captures d'écran ou une courte vidéo de chaque écran ; elles se joignent dans le panneau de décision.
UNE SEULE ANALYSE À LA FOIS, et ferme le navigateur à la fin : la machine a peu de mémoire. Les fichiers fournis sont dans ${cheminDuProjet}/${DOSSIER_DE_LA_SOURCE}/ ; tes captures vont dans ${cheminDuProjet}/docs/inspiration/.

LE RAPPORT : écris-le avec « write_document » (chemin « ${RAPPORT_D_ANALYSE} » du projet), et réécris-le entier s'il s'enrichit — les écrans un par un (ce qu'on y voit, ce qu'on y fait), les parcours, les fonctionnalités, les données manipulées, les services tiers et les technologies observées, la mise en page et l'identité visuelle, et pour chaque point d'où vient la preuve. Ce qui n'a pas pu être établi se dit comme tel.

LA RÉDACTION, ENSUITE, suit le gabarit de la compétence avec une partie de plus, « ## Source analysée » (le lien, le mode, l'identité reprise ou non, un résumé du rapport et son chemin) :
- EN CLONE : PRÉREMPLIS toutes les parties depuis le rapport et marque-les tranchées. Ne pose que ce que l'analyse n'établit pas, puis les technologies (couche par couche) et l'hébergement. Si l'identité n'est pas reprise, la phase « Identité visuelle » se pose comme d'habitude.
- EN INSPIRATION : chaque partie PART de la source ; la question devient « garder, adapter ou changer ? », avec ce que fait la source dans la description.
Le compte des questions (« total ») ne compte que ce qui est vraiment posé.`;
}

/** Le premier tour d'un cahier à source : la phase « Source » d'abord. */
export function demandeDuPremierTourDuClonage(projet: { name: string; description?: string }, source: SourceDuClonage): string {
  const description = String(projet.description ?? '').trim();
  return `LE PROJET « ${projet.name} » VIENT D'ÊTRE MONTÉ À PARTIR D'UN PRODUIT EXISTANT, et l'utilisateur a demandé à démarrer par un cahier des charges. Personne n'a encore rien écrit dans cette carte : c'est toi qui ouvres la discussion.

LA SOURCE :
${decrireLaSource(source, true)}
${description ? `\nCE QUE L'UTILISATEUR A DIT DU PROJET EN LE CRÉANT :\n${description}\n` : ''}
Lis la compétence du cahier et le mode d'emploi de REA, écris un premier document (toutes les parties marquées « à voir », plus « ## Source analysée ») et l'avancement avec « cahier_des_charges » (phase « source »), puis pose la PREMIÈRE question — vrai clone ou inspiration profonde — avec « ask_user ». Continue ensuite question après question.`;
}

/**
 * LA RÈGLE QUI RECONNAÎT UNE DEMANDE DE CLONAGE, dans le cadrage ordinaire et
 * l'assistant général. Texte FIXE : la consigne système ne change pas d'un tour
 * à l'autre.
 */
export const REGLE_DEMANDE_DE_CLONAGE = `DEMANDE DE CLONAGE : quand l'utilisateur demande de CLONER, REPRODUIRE ou REFAIRE un produit existant ENTIER (un site, un SaaS, une application de bureau, Android ou iPhone, un jeu…), en donnant son lien, son nom ou un fichier, ce n'est pas une carte ordinaire : demande-lui d'abord avec « ask_user » s'il veut monter un NOUVEAU PROJET qui part de cette source (« Monter un nouveau projet à partir de cette source (recommandé) » / « Non, rester ici »). Oui : « project_manage », geste « creer », avec « source » ({ url, fichiers }) et le cahier des charges coché ; le projet démarre par l'analyse de la source puis la question « vrai clone ou inspiration ». S'inspirer d'un DÉTAIL pour le projet en cours (« fais un bouton comme sur tel site ») n'est PAS un clonage : ça reste une carte de ce projet.`;
