/**
 * LE PILOTAGE DE CHROME PAR BELUGA — les règles pures (carte « Pilotage de Chrome par Beluga », 09/11/2026).
 *
 * Une extension Chrome, téléchargée depuis la rubrique « Extension » des réglages et reliée par un code, ouvre le
 * navigateur de la personne aux agents. Tout ce qui se décide SANS base ni disque vit ici, testé seul :
 *
 *  - LA LIAISON : identifiant public d'un Chrome (« <compte>.<id>.<nonce> »), message signé par requête, fraîcheur ;
 *    le secret (HMAC du secret du serveur) se calcule côté démon, jamais stocké (compétence
 *    `cle-appareil-signee-raccourci-sans-session`) ;
 *  - LE CHOIX DU NAVIGATEUR : par l'ordinateur qui le porte (`shared/src/ordinateurs.ts`) ;
 *  - LES ACCORDS PAR SITE : autorisé, lecture seule, refusé ; « cette fois seulement » ne s'écrit pas ;
 *  - LES GESTES LOURDS : envoyer, payer, publier, supprimer — toujours confirmés, routines comprises ;
 *  - LES GESTES RÉPÉTÉS : prochaine échéance, une seule occurrence rattrapée au retour de Chrome ;
 *  - LES CORRESPONDANCES d'adresse : fiche du coffre-fort, projet reconnu.
 */

import type { GenreDeNavigateur, Ordinateur } from './ordinateurs.js';

/** La version de l'extension SERVIE par ce démon. Une extension reliée plus ancienne voit « nouvelle version ». */
export const VERSION_EXTENSION_CHROME = '1.0.13';

/**
 * LA PLUS ANCIENNE EXTENSION QUI SAIT OUVRIR UNE FENÊTRE PRIVÉE RÉDUITE (`fenetre: 'privee-reduite'`, 18/11/2026). Les
 * plus anciennes ignorent la demande et ouvrent dans la fenêtre de travail, sur les comptes de la personne (audit GEO du
 * 19/11/2026 : 0 réponse sur 30, comptes personnels) : une carte en fenêtre privée ne les prend jamais.
 */
export const VERSION_MIN_FENETRE_PRIVEE = '1.0.9';

/** « 1.0.10 » ≥ « 1.0.9 » ? Comparaison chiffre par chiffre ; une version inconnue est trop ancienne. */
export function versionAuMoins(version: string | null | undefined, minimum: string): boolean {
  const lire = (v: string) => v.trim().split('.').map((n) => Number.parseInt(n, 10));
  if (!version || !/^\d+(\.\d+)*$/.test(version.trim())) return false;
  const a = lire(version);
  const b = lire(minimum);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

/** La voie WebSocket de l'extension — authentifiée par la clé de l'appareil, JAMAIS par le témoin de session. */
export const ROUTE_WS_CHROME = '/ws/chrome';

/** Une requête signée vieille de plus de cinq minutes est refusée. */
export const FRAICHEUR_SIGNATURE_S = 300;

/** Le code de liaison affiché dans la rubrique « Extension » : un seul usage, dix minutes. */
export const DUREE_CODE_LIAISON_MS = 10 * 60_000;

/** Au plus dix Chrome reliés par compte : au-delà, la liaison est refusée (déliez-en un). */
export const CHROME_RELIES_MAX = 10;

/** L'extension parle au démon toutes les quinze secondes : un service worker MV3 s'endort après trente. */
export const BATTEMENT_EXTENSION_MS = 15_000;

/** Au-delà, un Chrome qui ne bat plus est hors ligne. */
export const HORS_LIGNE_APRES_MS = 45_000;

/** Le débogueur se détache après ce silence de l'agent : le bandeau de Chrome ne reste que pendant le travail. */
export const DETACHER_APRES_MS = 20_000;

/** Le texte de liaison : six chiffres, groupés par trois à l'affichage. */
export function codeDeLiaisonValide(code: string): boolean {
  return /^\d{6}$/.test(code.replace(/\s+/g, ''));
}

export function codeDeLiaisonLisible(code: string): string {
  const net = code.replace(/\s+/g, '');
  return net.length === 6 ? `${net.slice(0, 3)} ${net.slice(3)}` : net;
}

/* ------------------------------------------------------------------ */
/* La liaison : identifiant public et message signé                    */
/* ------------------------------------------------------------------ */

export interface IdentifiantDAppareil {
  compteId: string;
  id: string;
  nonce: string;
}

/** « <compte>.<id>.<nonce> » — aucun des trois ne contient de point. */
export function identifiantDAppareil(cle: IdentifiantDAppareil): string {
  return `${cle.compteId}.${cle.id}.${cle.nonce}`;
}

export function lireIdentifiantDAppareil(brut: unknown): IdentifiantDAppareil | null {
  if (typeof brut !== 'string' || brut.length > 200) return null;
  const morceaux = brut.split('.');
  if (morceaux.length !== 3) return null;
  const [compteId, id, nonce] = morceaux as [string, string, string];
  const sur = /^[A-Za-z0-9_-]{1,64}$/;
  if (!sur.test(compteId) || !sur.test(id) || !sur.test(nonce)) return null;
  return { compteId, id, nonce };
}

/** La phrase dont on dérive le secret d'un Chrome : la seule, pour qu'aucune autre clé n'en sorte. */
export function phraseDuSecretDAppareil(cle: IdentifiantDAppareil): string {
  return `chrome-extension:${cle.compteId}:${cle.id}:${cle.nonce}`;
}

/** Ce qui est signé à chaque ouverture de la voie : horodatage, identifiant, empreinte du corps (vide ici). */
export function messageASigner(horodatage: number, identifiant: string, empreinteDuCorps: string): string {
  return `${horodatage}.${identifiant}.${empreinteDuCorps}`;
}

/** L'horodatage (en secondes) est-il assez frais ? */
export function signatureFraiche(horodatageS: number, maintenantMs = Date.now()): boolean {
  if (!Number.isFinite(horodatageS)) return false;
  return Math.abs(maintenantMs / 1000 - horodatageS) <= FRAICHEUR_SIGNATURE_S;
}

/* ------------------------------------------------------------------ */
/* Le choix du Chrome                                                   */
/* ------------------------------------------------------------------ */

/* LE CHOIX DU NAVIGATEUR (aucun, un seul, plusieurs, fermé) passe désormais par l'ORDINATEUR qui le porte :
   `choisirLOrdinateur` (`shared/src/ordinateurs.ts`, carte « Choisir l'ordinateur visé depuis le téléphone »). */

/* ------------------------------------------------------------------ */
/* Les gestes                                                           */
/* ------------------------------------------------------------------ */

export const GESTES_CHROME = [
  'lister_onglets',
  'ouvrir',
  'aller',
  'lire',
  'capturer',
  'defiler',
  'attendre',
  'cliquer',
  'ecrire',
  'touche',
  'fermer',
  'se_connecter',
  'deposer',
  'demander_la_main',
] as const;
export type GesteChrome = (typeof GESTES_CHROME)[number];

/** Les gestes qui AGISSENT sur la page : refusés en lecture seule, même confirmés. */
export const GESTES_D_ACTION: ReadonlySet<GesteChrome> = new Set(['cliquer', 'ecrire', 'touche', 'se_connecter', 'deposer']);

/** Ouvrir, naviguer, fermer : changer de page n'agit sur aucun site, et il faut ouvrir pour pouvoir demander. */
export const GESTES_DE_NAVIGATION: ReadonlySet<GesteChrome> = new Set(['ouvrir', 'aller', 'fermer']);

/* ------------------------------------------------------------------ */
/* Le dépôt d'un fichier                                                */
/* ------------------------------------------------------------------ */

/**
 * LE DÉPÔT D'UN FICHIER (geste « deposer ») : le fichier vit sur le SERVEUR, Chrome sur l'ordinateur de la personne.
 * Son contenu voyage donc en base64 par la voie de l'extension, puis il est posé dans la page (DataTransfer) — jamais
 * par un chemin local (`DOM.setFileInputFiles`), jamais par la fenêtre de sélection de l'ordinateur. Son type :
 * `mimeDuFichier` (mime-fichiers.ts).
 */
export const TAILLE_MAX_DEPOT_OCTETS = 15 * 1024 * 1024;

/** Ce qui empêche de déposer un fichier de cette taille, ou null. */
export function refusDuDepot(octets: number, nom: string): string | null {
  if (octets <= 0) return `Le fichier « ${nom} » est vide.`;
  if (octets > TAILLE_MAX_DEPOT_OCTETS) return `Le fichier « ${nom} » pèse ${Math.round(octets / 1024 / 1024)} Mo : 15 Mo au plus.`;
  return null;
}

export function gesteValide(brut: unknown): brut is GesteChrome {
  return typeof brut === 'string' && (GESTES_CHROME as readonly string[]).includes(brut);
}

/* ------------------------------------------------------------------ */
/* Les accords par site                                                 */
/* ------------------------------------------------------------------ */

export const MODES_DE_SITE = ['autorise', 'lecture_seule', 'refuse'] as const;
export type ModeDeSite = (typeof MODES_DE_SITE)[number];

export const REPONSE_FAIRE_LE_GESTE = 'Oui, le faire';
export const REPONSE_NE_PAS_FAIRE_LE_GESTE = 'Ne pas le faire';
export const REPONSE_RENDRE_LA_MAIN = 'Rendre la main';

/** L'origine d'une adresse (« https://drive.google.com »), ou `null` pour ce qui ne se pilote pas. */
export function origineDeLaPage(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** L'hôte sans « www. », en minuscules : ce qu'on compare entre une page, une fiche du coffre et un projet. */
export function hoteDe(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const brut = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`;
    const hote = new URL(brut).hostname.toLowerCase();
    return hote.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/** Les pages que Chrome interdit au débogueur : ses propres pages et la boutique. */
export function pagePilotable(url: string | null | undefined): boolean {
  if (!url) return true; // un onglet neuf, encore vide
  if (/^(chrome|chrome-extension|devtools|edge|about):/i.test(url) && url !== 'about:blank') return false;
  const hote = hoteDe(url);
  return !(hote === 'chromewebstore.google.com' || (hote === 'chrome.google.com' && /\/webstore/.test(url)));
}

export type DecisionDeSite = { genre: 'permis' } | { genre: 'refus'; texte: string };

/**
 * CE GESTE PEUT-IL PARTIR SUR CE SITE ? L'agent est AUTONOME (décision de l'utilisateur, carte « Fil du chat en
 * ordre chronologique », 09/11/2026) : un site inconnu est permis, sans question. Seul un mode posé À LA MAIN dans
 * Réglages → Extension retient l'agent — lecture seule : lire oui, agir jamais ; refusé : rien.
 */
export function decisionDeSite(mode: ModeDeSite | null | undefined, geste: GesteChrome): DecisionDeSite {
  if (GESTES_DE_NAVIGATION.has(geste) || geste === 'lister_onglets' || geste === 'demander_la_main') return { genre: 'permis' };
  if (!mode || mode === 'autorise') return { genre: 'permis' };
  if (mode === 'refuse') {
    return { genre: 'refus', texte: "La personne a refusé ce site : n'y fais rien. Elle peut changer d'avis dans Réglages → Extension." };
  }
  if (mode === 'lecture_seule' && GESTES_D_ACTION.has(geste)) {
    return {
      genre: 'refus',
      texte:
        "Ce site est en LECTURE SEULE : tu peux lire, capturer et faire défiler, jamais cliquer ni écrire, même avec un accord. Dis à la personne ce que tu voulais faire ; elle peut le faire elle-même ou changer le mode dans Réglages → Extension.",
    };
  }
  return { genre: 'permis' };
}

/* ------------------------------------------------------------------ */
/* Les gestes lourds                                                    */
/* ------------------------------------------------------------------ */

/**
 * LES SEULS GESTES QUI DEMANDENT UNE VALIDATION : l'argent (paiement, banque) et la suppression d'un COMPTE. Envoyer,
 * soumettre un formulaire, publier, supprimer un élément ordinaire (un brouillon, un fichier) partent sans question :
 * l'agent est autonome (décision de l'utilisateur, 09/11/2026).
 */
/* « nom-definitif » (13/11/2026) : DÉCLARÉ par l'agent seulement — jamais lu sur un libellé, pour qu'un nom dicté mot
   pour mot ne se redemande pas (`RAPPEL_NOM_DEFINITIF`, shared/src/blocages-de-site.ts). */
export const INTENTIONS_LOURDES = ['paiement', 'suppression', 'nom-definitif'] as const;
export type IntentionLourde = (typeof INTENTIONS_LOURDES)[number];

const LIBELLES_LOURDS: readonly [IntentionLourde, RegExp][] = [
  [
    'paiement',
    /\b(payer|paiement|acheter|achat|commander|passer (la |ma )?commande|virement|iban|carte bancaire|compte bancaire|coordonn[ée]es bancaires|checkout|pay|payment|buy|purchase|place order|order now|bank account|wire transfer)\b/i,
  ],
  [
    'suppression',
    /\b((supprimer|fermer|cl[ôo]turer|r[ée]silier|d[ée]sactiver|effacer) (d[ée]finitivement )?(mon |votre |le |ce |du )?compte|suppression (de |du )?(mon |votre |ce )?compte|(delete|close|deactivate|remove|cancel) (my |your |this |the )?account|account deletion)\b/i,
  ],
];

/**
 * CE GESTE DEMANDE-T-IL UNE VALIDATION ? L'intention déclarée par l'agent (paiement, suppression de compte) OU le
 * libellé de l'élément visé : on ne dépend jamais de la seule bonne foi de l'agent. Une soumission de formulaire
 * ordinaire ne compte plus (`soumission` reste accepté et ignoré).
 */
export function gesteLourd(signes: {
  intention?: string | null;
  libelle?: string | null;
  soumission?: boolean;
}): IntentionLourde | null {
  const declaree = (INTENTIONS_LOURDES as readonly string[]).includes(String(signes.intention ?? ''))
    ? (signes.intention as IntentionLourde)
    : null;
  if (declaree) return declaree;
  const libelle = (signes.libelle ?? '').slice(0, 200);
  for (const [intention, motif] of LIBELLES_LOURDS) if (motif.test(libelle)) return intention;
  return null;
}

const NOM_DE_L_INTENTION: Record<IntentionLourde, string> = {
  paiement: 'un geste d’argent',
  suppression: 'la suppression d’un compte',
  'nom-definitif': 'un nom qui ne se changera peut-être plus',
};

export function phraseDuGesteLourd(intention: IntentionLourde, site: string, libelle?: string | null): { question: string; description: string } {
  const objet = libelle ? `« ${libelle.slice(0, 80)} »` : 'ce geste';
  return {
    question: `Faire ${objet} sur ${site} ?`,
    description:
      intention === 'nom-definitif'
        ? `C'est ${NOM_DE_L_INTENTION[intention]} : le site peut empêcher de le modifier ensuite. Je préfère votre accord avant de valider.`
        : `C'est ${NOM_DE_L_INTENTION[intention]} : il part et ne se reprend pas. C'est le seul genre de geste pour lequel je vous demande votre accord.`,
  };
}

/* ------------------------------------------------------------------ */
/* L'endroit cliqué, porté par le nom d'une capture                     */
/* ------------------------------------------------------------------ */

/**
 * LE NOM D'UNE CAPTURE DE L'OUTIL « chrome ». Quand l'agent a cliqué depuis la capture précédente, le nom porte
 * l'endroit cliqué en fraction de l'image (« chrome-<date>-clic-0.512x0.230.png ») : le panneau en tire le point
 * violet de la vignette, sans rien dessiner dans l'image que lit l'agent.
 */
export function nomDeCaptureChrome(date: number, point?: { x: number; y: number } | null): string {
  const ok = point && Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
  return ok ? `chrome-${date}-clic-${point!.x.toFixed(3)}x${point!.y.toFixed(3)}.png` : `chrome-${date}.png`;
}

/** L'endroit cliqué lu dans le nom d'une capture, ou `null`. */
export function pointClicDuNom(nom: string | null | undefined): { x: number; y: number } | null {
  const m = /-clic-(0(?:\.\d+)?|1(?:\.0+)?)x(0(?:\.\d+)?|1(?:\.0+)?)\.(?:png|jpe?g|webp)$/i.exec(nom ?? '');
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

/* ------------------------------------------------------------------ */
/* Les correspondances d'adresse                                        */
/* ------------------------------------------------------------------ */

/** Deux hôtes se correspondent-ils ? Égaux, ou l'un sous-domaine de l'autre (« compte.exemple.fr » ~ « exemple.fr »). */
export function hotesCorrespondent(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/** Les fiches du coffre dont l'adresse va avec cette page — les plus précises d'abord. */
export function fichesPourLaPage<T extends { champs: Record<string, string> }>(fiches: readonly T[], urlDeLaPage: string): T[] {
  const hote = hoteDe(urlDeLaPage);
  if (!hote) return [];
  return fiches
    .filter((f) => f.champs.motDePasse && hotesCorrespondent(hoteDe(f.champs.adresse), hote))
    .sort((x, y) => Number(hoteDe(y.champs.adresse) === hote) - Number(hoteDe(x.champs.adresse) === hote));
}

/** Le projet dont l'adresse (essai ou production) est celle de l'onglet : proposé d'avance pour une demande. */
export function projetDeLAdresse<T extends { id: string; devUrl?: string | null; adresseProduction?: string | null }>(
  projets: readonly T[],
  url: string,
): T | null {
  const hote = hoteDe(url);
  if (!hote) return null;
  return projets.find((p) => hotesCorrespondent(hoteDe(p.adresseProduction), hote) || hotesCorrespondent(hoteDe(p.devUrl), hote)) ?? null;
}

/** L'adresse d'une page sans ce qui change d'une visite à l'autre : la clé d'une comparaison avant / après. */
export function adresseDeComparaison(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const chemin = u.pathname.replace(/\/+$/, '') || '/';
    return `${u.hostname.replace(/^www\./, '')}${chemin}`;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Les gestes répétés (routines)                                        */
/* ------------------------------------------------------------------ */

export type FrequenceDeRoutine = 'semaine' | 'mois';

export interface ReglageDeRoutine {
  frequence: FrequenceDeRoutine;
  /** Semaine : 0 (dimanche) … 6. Mois : 1 … 28 (au-delà, certains mois n'existent pas). */
  jour: number;
  /** Heure locale du serveur, 0 … 23. */
  heure: number;
  minute?: number;
}

/** Le réglage tiré de l'instant du clic : même jour de la semaine (ou du mois, plafonné à 28), même heure. */
export function reglageDepuisLInstant(frequence: FrequenceDeRoutine, instant: Date): ReglageDeRoutine {
  return {
    frequence,
    jour: frequence === 'semaine' ? instant.getDay() : Math.min(28, instant.getDate()),
    heure: instant.getHours(),
    minute: instant.getMinutes(),
  };
}

/** La prochaine échéance STRICTEMENT après `apres`. */
export function prochaineEcheanceDeRoutine(reglage: ReglageDeRoutine, apres: Date): Date {
  const minute = reglage.minute ?? 0;
  if (reglage.frequence === 'semaine') {
    const d = new Date(apres);
    d.setHours(reglage.heure, minute, 0, 0);
    const ecart = (reglage.jour - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + ecart);
    if (d.getTime() <= apres.getTime()) d.setDate(d.getDate() + 7);
    return d;
  }
  const jour = Math.max(1, Math.min(28, reglage.jour));
  const d = new Date(apres.getFullYear(), apres.getMonth(), jour, reglage.heure, minute, 0, 0);
  if (d.getTime() <= apres.getTime()) d.setMonth(d.getMonth() + 1);
  return d;
}

export interface EtatDeRoutine {
  actif: boolean;
  prochaineEcheance: number;
}

/**
 * LA ROUTINE PART-ELLE MAINTENANT ? Échue, active et son Chrome en ligne. Chrome fermé : elle ATTEND (décision du
 * 09/11/2026) — elle partira au retour de Chrome, une seule fois, avec son retard dit.
 */
export function routineAPartir(routine: EtatDeRoutine, maintenant: number, chromeEnLigne: boolean): boolean {
  return routine.actif && routine.prochaineEcheance <= maintenant && chromeEnLigne;
}

/** Après un départ : l'échéance suivante saute TOUTES celles manquées (une seule occurrence rattrapée). */
export function echeanceApresDepart(reglage: ReglageDeRoutine, maintenant: number): number {
  return prochaineEcheanceDeRoutine(reglage, new Date(maintenant)).getTime();
}

/** Le retard d'un départ, en jours entiers (0 : à l'heure, ou presque). */
export function retardEnJours(echeance: number, depart: number): number {
  return Math.max(0, Math.floor((depart - echeance) / 86_400_000));
}

export function phraseDuReglage(reglage: ReglageDeRoutine): string {
  const heure = `${String(reglage.heure).padStart(2, '0')}h${String(reglage.minute ?? 0).padStart(2, '0')}`;
  if (reglage.frequence === 'semaine') {
    const jours = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
    return `chaque ${jours[reglage.jour] ?? 'lundi'} à ${heure}`;
  }
  return `le ${reglage.jour} de chaque mois à ${heure}`;
}

/** La demande qu'une routine pose sur sa carte : l'intention et les étapes, jamais des clics à rejouer. */
export function demandeDeLaRoutine(r: { titre: string; consigne: string; retardJours: number }): string {
  const retard = r.retardJours > 0 ? `\n\n(Fait avec ${r.retardJours} jour${r.retardJours > 1 ? 's' : ''} de retard : Chrome était fermé à l'échéance.)` : '';
  return (
    `GESTE RÉPÉTÉ « ${r.titre} ». Refais ce parcours dans Chrome, avec l'outil « chrome », en t'adaptant si le site a changé :\n\n` +
    `${r.consigne}${retard}\n\nEnvoyer, payer, publier ou supprimer reste soumis à l'accord de la personne, même ici.`
  );
}

/* ------------------------------------------------------------------ */
/* Ce que la rubrique « Extension » lit                                 */
/* ------------------------------------------------------------------ */

export interface ChromeRelie {
  id: string;
  nom: string;
  version: string | null;
  /** Autorisée en navigation privée (dit par l'extension 1.0.11 et plus) ; `null` quand elle ne le dit pas. */
  incognito?: boolean | null;
  creeLe: number;
  vuLe: number | null;
  enLigne: boolean;
  /** Les agents qui travaillent dans ce Chrome en ce moment. */
  agentsAuTravail: number;
  /** L'ordinateur qui le porte (carte « Choisir l'ordinateur visé », 15/11/2026). */
  ordinateurId: string | null;
  /** Chrome ou Safari : l'extension Beluga existe pour les deux. */
  genre: GenreDeNavigateur;
}

export interface SiteDuChrome {
  origine: string;
  mode: ModeDeSite;
  chromeId: string | null;
  chromeNom: string | null;
  decideLe: number;
}

export interface RoutineChrome {
  id: string;
  titre: string;
  projectId: string;
  projet: string;
  reglage: ReglageDeRoutine;
  phrase: string;
  actif: boolean;
  prochaineEcheance: number;
  dernierDepart: number | null;
  carteOrigine: string | null;
  chromeId: string | null;
}

export interface EtatDeLExtension {
  version: string;
  chromes: ChromeRelie[];
  /** Les ordinateurs nommés de la personne, chacun avec ses navigateurs et son programme du Mac. */
  ordinateurs: Ordinateur[];
  /** L'extension Safari signée est-elle prête à télécharger ? (fabriquée sur GitHub, servie par le démon) */
  safari: { disponible: boolean; version: string | null };
  sites: SiteDuChrome[];
  routines: RoutineChrome[];
}

/* ------------------------------------------------------------------ */
/* Le fil du panneau                                                    */
/* ------------------------------------------------------------------ */

/** Les lignes que le démon AJOUTE à une demande née dans le panneau (`creerUneDemande`) : pas les mots de la personne. */
const AJOUTS_DU_DEMON = ['\n\nOnglet confié dans Chrome :', '\n\nSélection faite par la personne sur la page :'];

/**
 * LA PREMIÈRE DEMANDE D'UNE CARTE, telle que la personne l'a écrite (carte « Panneau Chrome façon discussion »,
 * 09/11/2026). Une carte lancée n'a PAS de message « utilisateur » pour sa demande : elle vit dans la description.
 * Le panneau l'affiche en première bulle, à droite — sans les lignes techniques que le démon y a ajoutées.
 */
export function demandeInitialeDeLaCarte(description: string | null | undefined): string {
  let texte = String(description ?? '');
  for (const ajout of AJOUTS_DU_DEMON) {
    const i = texte.indexOf(ajout);
    if (i >= 0) texte = texte.slice(0, i);
  }
  return texte.trim();
}

/* ------------------------------------------------------------------ */
/* Le fil d'un tour, dans l'ordre réel (carte « Fil du chat en ordre chronologique », 09/11/2026)          */
/* ------------------------------------------------------------------ */

/**
 * LE FLUX D'UN TOUR, TEL QUE LE PANNEAU LE LIT DE HAUT EN BAS.
 *
 * Le panneau rendait chaque tour dans un ordre FIXE — le travail replié, puis les questions, puis la réponse, puis
 * les captures en rangée au bas : on ne savait plus quelle capture suivait quelle action, ni quand une question
 * avait été posée. Ce flux remet chaque chose à sa place réelle :
 *
 *  - les NOTES de l'agent (phrases écrites entre deux actions, `JALON_NOTE_DE_L_AGENT`) et les ACTIONS se lisent
 *    dans l'ordre du journal de la carte, par RANG, jamais par horodatage ;
 *  - des actions qui se suivent forment UN groupe replié (« A utilisé Chrome (N actions) ») ;
 *  - une CAPTURE suit l'action qui l'a prise (`capturePiece`), sinon la dernière action commencée avant elle ;
 *  - une QUESTION paraît à la place de l'appel `ask_user` qui l'a posée ;
 *  - la RÉPONSE vient en dernier, SANS les notes déjà montrées : pendant le direct, le texte du message contient
 *    tout le tour, notes comprises — elles seraient sinon lues deux fois.
 *
 * Règle pure : le démon lui donne le journal du tour, les étapes, les questions et les pièces ; le panneau, en
 * JavaScript sans accès à ce paquet, ne fait que rendre la liste. Sans journal (agent sans carte, tour ancien),
 * les étapes gardent leur ordre propre.
 */
export interface EtapeDuFilPanneau {
  id: string;
  label: string;
  state: string;
  outil?: string;
  entree?: string;
  startedAt?: number;
  capturePiece?: string;
}
export interface EntreeDuFilPanneau {
  rang: number;
  nature: string;
  libelle: string;
  resultat?: string;
}
export interface QuestionDuFilPanneau {
  id: string;
  question: string;
  /** L'heure où elle a été posée : une question qu'aucun appel `ask_user` ne porte se place par elle. */
  poseeLe?: number;
}
export interface PieceDuFilPanneau {
  id: string;
  createdAt?: number;
}
export type ElementDuFilPanneau =
  | { sorte: 'texte'; texte: string }
  | { sorte: 'actions'; id: string; nb: number; etapes: { label: string; etat: string; outil: string | null }[] }
  | { sorte: 'capture'; piece: string }
  | { sorte: 'question'; question: string }
  | { sorte: 'coupe'; nb: number };

/** Le libellé du jalon d'une note de l'agent (repris ici pour ne pas lier ce module au journal). */
const NOTE_DE_L_AGENT = 'Note de l’agent';
const OUTIL_QUESTION = /(?:^|__)ask_user$/;
/** Au plus tant d'éléments par tour : au-delà, le début se coupe, et le flux le DIT. */
export const ELEMENTS_DU_FLUX_MAX = 80;
/** Au plus tant d'étapes listées dans un groupe déplié (les dernières) ; le nombre total voyage à part. */
export const ETAPES_PAR_GROUPE_MAX = 40;

/** Le texte de la réponse privé des notes déjà rendues plus haut (on garde ce qui suit la dernière retrouvée). */
export function texteApresLesNotes(contenu: string, notes: readonly string[]): string {
  let fin = 0;
  for (const note of notes) {
    const n = note.trim();
    if (!n) continue;
    const i = contenu.indexOf(n, fin);
    if (i >= 0) fin = i + n.length;
  }
  /* …ET AUCUN PARAGRAPHE QUI REDIT UNE NOTE, même retrouvée hors de son ordre ou aux blancs près (17/11/2026, capture
     #6b87 : la Charte graphique relisait « Je pose la palette complète… » sous sa réponse, la note ayant été cherchée
     dans un texte où ses espaces ne tombaient pas pareil). */
  const reduite = (texte: string) => texte.replace(/\s+/g, ' ').trim();
  const notesReduites = notes.map(reduite).filter((note) => note.length >= 12);
  if (!notesReduites.length) return contenu.slice(fin).trim();
  return contenu
    .slice(fin)
    .split(/\n{2,}/)
    .filter((paragraphe) => {
      const p = reduite(paragraphe);
      return !p || !notesReduites.some((note) => note === p || (p.length >= 12 && note.includes(p)));
    })
    .join('\n\n')
    .trim();
}

export function fluxDuTour(tour: {
  contenu: string;
  journal: readonly EntreeDuFilPanneau[];
  etapes: readonly EtapeDuFilPanneau[];
  questions: readonly QuestionDuFilPanneau[];
  pieces: readonly PieceDuFilPanneau[];
}): ElementDuFilPanneau[] {
  /* 1. LA SUITE DES ÉVÉNEMENTS : notes et étapes, dans l'ordre du journal ; les étapes pas encore journalisées
        (celle en cours, ou un tour sans journal) suivent dans leur ordre propre. */
  type Evenement = { note: string } | { etape: EtapeDuFilPanneau };
  const evenements: Evenement[] = [];
  const prises = new Set<number>();
  const notes: string[] = [];
  for (const e of [...tour.journal].sort((a, b) => a.rang - b.rang)) {
    if (e.nature === 'jalon' && e.libelle === NOTE_DE_L_AGENT && e.resultat?.trim()) {
      evenements.push({ note: e.resultat.trim() });
      notes.push(e.resultat);
    } else if (e.nature === 'requete') {
      const i = tour.etapes.findIndex((s, k) => !prises.has(k) && s.label === e.libelle);
      if (i < 0) continue;
      prises.add(i);
      evenements.push({ etape: tour.etapes[i] });
    }
  }
  tour.etapes.forEach((s, k) => {
    if (!prises.has(k)) evenements.push({ etape: s });
  });

  /* 2. LES PIÈCES SANS ÉTAPE : après la dernière étape commencée avant elles, sinon en fin de tour. */
  const piecesDesEtapes = new Set(tour.etapes.map((s) => s.capturePiece).filter(Boolean) as string[]);
  const apresLEtape = new Map<string, string[]>();
  const aLaFin: string[] = [];
  for (const p of tour.pieces) {
    if (piecesDesEtapes.has(p.id)) continue;
    let porteuse: EtapeDuFilPanneau | null = null;
    for (const ev of evenements) {
      if (!('etape' in ev)) continue;
      const debut = ev.etape.startedAt;
      if (p.createdAt !== undefined && debut !== undefined && debut <= p.createdAt) {
        if (!porteuse || (porteuse.startedAt ?? 0) <= debut) porteuse = ev.etape;
      }
    }
    if (porteuse) apresLEtape.set(porteuse.id, [...(apresLEtape.get(porteuse.id) ?? []), p.id]);
    else aLaFin.push(p.id);
  }
  const piecesConnues = new Set(tour.pieces.map((p) => p.id));

  /* 3. LES QUESTIONS : à la place de l'appel qui les a posées (texte retrouvé dans ses paramètres, sinon dans
        l'ordre des appels) ; celles qu'aucun appel ne porte (posées par le démon) avant la réponse. */
  const questionsRestantes = [...tour.questions];
  const appelsDeQuestion = evenements.filter((ev) => 'etape' in ev && OUTIL_QUESTION.test(ev.etape.outil ?? '')).length;
  const questionsDeLAppel = (s: EtapeDuFilPanneau): QuestionDuFilPanneau[] => {
    const parTexte = questionsRestantes.filter((q) => q.question && (s.entree ?? '').includes(q.question.slice(0, 60)));
    const choisies = parTexte.length ? parTexte : appelsDeQuestion >= tour.questions.length ? questionsRestantes.slice(0, 1) : [];
    for (const q of choisies) questionsRestantes.splice(questionsRestantes.indexOf(q), 1);
    return choisies;
  };

  /* 4. LE FLUX : les étapes consécutives se groupent ; une note, une capture ou une question ferme le groupe. */
  const flux: ElementDuFilPanneau[] = [];
  const groupesDEtapes = new Map<ElementDuFilPanneau, EtapeDuFilPanneau[]>();
  let groupe: Extract<ElementDuFilPanneau, { sorte: 'actions' }> | null = null;
  const fermer = () => {
    if (groupe) groupe.etapes = groupe.etapes.slice(-ETAPES_PAR_GROUPE_MAX);
    groupe = null;
  };
  for (const ev of evenements) {
    if ('note' in ev) {
      fermer();
      flux.push({ sorte: 'texte', texte: ev.note });
      continue;
    }
    const s = ev.etape;
    if (OUTIL_QUESTION.test(s.outil ?? '')) {
      const qs = questionsDeLAppel(s);
      if (qs.length) {
        fermer();
        for (const q of qs) flux.push({ sorte: 'question', question: q.id });
        continue;
      }
    }
    if (!groupe) {
      groupe = { sorte: 'actions', id: s.id, nb: 0, etapes: [] };
      flux.push(groupe);
      groupesDEtapes.set(groupe, []);
    }
    groupesDEtapes.get(groupe)!.push(s);
    groupe.nb += 1;
    groupe.etapes.push({ label: s.label, etat: s.state, outil: s.outil ?? null });
    const captures = [...(s.capturePiece && piecesConnues.has(s.capturePiece) ? [s.capturePiece] : []), ...(apresLEtape.get(s.id) ?? [])];
    if (captures.length) {
      fermer();
      for (const piece of captures) flux.push({ sorte: 'capture', piece });
    }
  }
  fermer();
  for (const piece of aLaFin) flux.push({ sorte: 'capture', piece });
  /* Les questions posées par le démon (accord d'un site, geste lourd…) pendant une action : juste après le groupe
     où se trouve la dernière étape commencée avant elles. */
  for (const q of [...questionsRestantes]) {
    if (q.poseeLe === undefined) continue;
    let apres = -1;
    flux.forEach((e, i) => {
      if (e.sorte !== 'actions') return;
      const ids = groupesDEtapes.get(e) ?? [];
      if (ids.some((s) => s.startedAt !== undefined && s.startedAt <= q.poseeLe!)) apres = i;
    });
    if (apres < 0) continue;
    let ou = apres + 1;
    while (ou < flux.length && (flux[ou].sorte === 'capture' || flux[ou].sorte === 'question')) ou += 1;
    flux.splice(ou, 0, { sorte: 'question', question: q.id });
    questionsRestantes.splice(questionsRestantes.indexOf(q), 1);
  }
  for (const q of questionsRestantes) flux.push({ sorte: 'question', question: q.id });
  const reponse = texteApresLesNotes(tour.contenu, notes);
  if (reponse) flux.push({ sorte: 'texte', texte: reponse });

  /* 5. LA BORNE : on coupe le DÉBUT du tour, jamais le milieu, et on dit combien d'étapes manquent. */
  if (flux.length <= ELEMENTS_DU_FLUX_MAX) return flux;
  const coupes = flux.slice(0, flux.length - ELEMENTS_DU_FLUX_MAX);
  const nb = coupes.reduce((n, e) => n + (e.sorte === 'actions' ? e.nb : 1), 0);
  return [{ sorte: 'coupe', nb }, ...flux.slice(-ELEMENTS_DU_FLUX_MAX)];
}

/* ------------------------------------------------------------------ */
/* Les fichiers collés dans le panneau, et les images de l'agent        */
/* ------------------------------------------------------------------ */

/**
 * LES FICHIERS COLLÉS OU DÉPOSÉS DANS LE CHAMP DU PANNEAU (carte « Images dans l'extension Chrome », 09/11/2026)
 * voyagent en data URL avec la commande, sur la voie signée (`maxPayload` 24 Mo) : leur poids CUMULÉ est borné sous
 * cette limite (base64 = +33 %), pour qu'un envoi trop lourd soit refusé en clair au lieu de couper la voie.
 */
export const PIECES_DU_PANNEAU_MAX = 10;
export const POIDS_DES_PIECES_DU_PANNEAU_MAX = 15 * 1024 * 1024;

export interface PieceDuPanneau {
  nom: string;
  mime: string;
  base64: string;
  octets: number;
}

/** Les pièces reçues du panneau, vérifiées : nom sûr (extension tirée du type au besoin), type, poids. */
export function piecesDuPanneau(brutes: unknown): { ok: true; pieces: PieceDuPanneau[] } | { ok: false; refus: string } {
  if (brutes === undefined || brutes === null) return { ok: true, pieces: [] };
  if (!Array.isArray(brutes)) return { ok: false, refus: 'Pièces jointes illisibles.' };
  if (brutes.length > PIECES_DU_PANNEAU_MAX) return { ok: false, refus: `${PIECES_DU_PANNEAU_MAX} fichiers au plus par message.` };
  const pieces: PieceDuPanneau[] = [];
  let total = 0;
  for (const b of brutes) {
    const dataUrl = typeof b?.dataUrl === 'string' ? b.dataUrl : '';
    const m = /^data:([\w.+-]+\/[\w.+-]+)?(?:;[^,;]*)*;base64,([A-Za-z0-9+/=]*)$/.exec(dataUrl);
    if (!m || !m[2]) return { ok: false, refus: 'Un fichier joint est vide ou illisible.' };
    const mime = (m[1] || 'application/octet-stream').toLowerCase();
    const base64 = m[2];
    const octets = Math.floor((base64.length * 3) / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
    total += octets;
    if (total > POIDS_DES_PIECES_DU_PANNEAU_MAX) return { ok: false, refus: 'Fichiers trop lourds pour un message (15 Mo au plus en tout).' };
    pieces.push({ nom: nomDePieceDuPanneau(typeof b?.nom === 'string' ? b.nom : '', mime), mime, base64, octets });
  }
  return { ok: true, pieces };
}

/** Un nom de fichier sûr, sans dossier, avec une extension (tirée du type quand le nom n'en a pas). */
export function nomDePieceDuPanneau(nom: string, mime: string): string {
  const base = (nom.split(/[\\/]/).pop() ?? '').replace(/[^\p{L}\p{N}._ -]+/gu, '-').replace(/^[.\s-]+/, '').trim().slice(0, 120);
  if (/\.[a-z0-9]{1,8}$/i.test(base)) return base;
  const ext = (mime.split('/')[1] ?? 'bin').replace(/^svg\+xml$/, 'svg').replace(/^octet-stream$/, 'bin').replace(/^jpeg$/, 'jpg').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
  return `${base || 'fichier'}.${ext}`;
}

/**
 * « CE QUE L'AGENT A VU » DANS LE PANNEAU : les images que l'agent a lui-même rangées (captures de l'outil
 * « chrome », fichiers joints par l'agent) dans la conversation affichée — jamais celles de la personne, comme dans
 * Beluga. Les plus anciennes d'abord, les `max` dernières seulement.
 */
export function imagesDeLAgentPourLePanneau<T extends { id: string; mime: string; createdAt: number; agentId?: string; cardId?: string; deLAgent?: boolean }>(
  pieces: readonly T[],
  conversation: { agentId: string; cardId?: string | null },
  max = 60,
): T[] {
  return pieces
    .filter((p) => p.deLAgent && p.mime.startsWith('image/') && (p.agentId === conversation.agentId || (!!conversation.cardId && p.cardId === conversation.cardId)))
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-max);
}

/**
 * L'HEURE D'UNE RÉPONSE DANS LE PANNEAU (1.0.6) : la fin de sa dernière étape (ou son début, si elle n'a pas de fin),
 * sinon la création du message. Un message ne porte que sa date de création, prise au DÉBUT du tour : la date
 * affichée sous une longue réponse serait sinon celle de la demande.
 */
export function heureDeLaReponse(m: { createdAt?: number | null; etapes?: readonly { startedAt?: number; endedAt?: number }[] }): number | null {
  let fin = Number.isFinite(m.createdAt) ? Number(m.createdAt) : null;
  for (const e of m.etapes ?? []) {
    const t = e.endedAt ?? e.startedAt;
    if (Number.isFinite(t) && (fin === null || t! > fin)) fin = t!;
  }
  return fin;
}
