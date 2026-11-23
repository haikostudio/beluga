/**
 * LA GARDE DES VERSIONS DE TRAVAIL (carte « Accès des IA : prod ou dev », 23/11/2026).
 *
 * Décision de l'utilisateur : TOUTES les versions de travail des projets servies par le relais du serveur Beluga
 * (adresses de la zone des projets) sont réservées aux personnes CONNECTÉES, par défaut et pour
 * les projets à venir ; un interrupteur par projet (paramètres › Déploiement) la coupe. Pas de mot de passe à part :
 * un administrateur de Beluga ouvre tous les sites, tout autre compte (client, membre, lecteur) n'ouvre que les sites
 * des projets qui lui sont ouverts (`peutVoirProjet`). Les adresses propres à Beluga (administration, espace client,
 * tout bloc servi par le démon lui-même) et celles qu'aucun projet ne réclame ne sont jamais fermées.
 *
 * Mécanique : Caddy demande au démon, pour chaque requête d'un site protégé (`forward_auth`), si elle passe. Le démon
 * répond 200 (passe) ou un renvoi vers la page de connexion ; l'aller-retour se termine sur `/__beluga-acces` du site,
 * où un JETON À USAGE UNIQUE se change en cookie de garde propre à ce site — jamais le cookie de session de Beluga,
 * que le code du projet recevrait sinon à chaque requête.
 *
 * Ce fichier ne contient que des règles pures : la lecture des blocs Caddy, la correspondance hôte → projet, le
 * verdict, l'adresse de retour sûre et le bloc Caddy généré. La base, le disque et le réseau vivent dans
 * server/src/garde-acces.ts.
 */

/** Le chemin d'arrivée de l'aller-retour de connexion, sur le site protégé. */
export const CHEMIN_ENTREE_GARDE = '/__beluga-acces';
/** Le cookie de garde, posé sur l'hôte du site protégé seulement. */
export const COOKIE_GARDE = '__beluga_garde';
/** L'adresse du démon que Caddy interroge. */
export const ROUTE_VERIFIER_GARDE = '/auth/garde/verifier';
/** La page de connexion de la garde, sur l'adresse d'administration puis sur celle de l'espace client. */
export const ROUTE_CONNEXION_GARDE = '/auth/garde/connexion';
/**
 * Un contrôle lancé DEPUIS le serveur passe sans connexion (Playwright, relevé Sécurité, audit). Cet entête, posé par
 * un contrôle qui veut se voir comme un visiteur anonyme, RETIRE ce passe-droit : il ne peut jamais en donner un.
 */
export const ENTETE_ESSAI_VISITEUR = 'x-beluga-garde';
/** Chemins toujours libres : ils ne disent rien du site et les robots doivent lire robots.txt. */
export const CHEMINS_TOUJOURS_LIBRES: readonly string[] = ['/robots.txt', '/favicon.ico'];
/** Durée de vie d'un jeton d'aller-retour. */
export const DUREE_JETON_GARDE_MS = 2 * 60_000;

/* ------------------------------------------------------------------------------------------------------------------
 * Les blocs de site de Caddy
 * ---------------------------------------------------------------------------------------------------------------- */

export interface BlocDeSite {
  /** Les hôtes servis (sans schéma ni port, en minuscules). */
  hotes: string[];
  /** Les ports locaux vers lesquels le bloc relaie (127.0.0.1:N, localhost:N). */
  ports: number[];
  /** Le bloc importe-t-il la garde commune (`import garde-robots`) ? */
  importeLaGarde: boolean;
}

function hoteDAdresseDeSite(brut: string): string | null {
  let a = brut.trim().toLowerCase();
  if (!a) return null;
  a = a.replace(/^https?:\/\//, '');
  a = a.split('/')[0] ?? '';
  a = a.replace(/:\d+$/, '');
  if (!a || a.startsWith('(') || a.includes('*') || a.includes('{')) return null;
  if (!/^[a-z0-9.-]+$/.test(a)) return null;
  return a;
}

/**
 * Lit les blocs de site d'un texte Caddyfile : chaque bloc de premier niveau qui nomme des adresses. Les snippets
 * « (nom) { … } », le bloc global « { … } » et les adresses génériques (« https:// », « *.zone ») sont ignorés.
 */
export function blocsDeSiteCaddy(texte: string): BlocDeSite[] {
  const blocs: BlocDeSite[] = [];
  let profondeur = 0;
  let courant: BlocDeSite | null = null;
  for (const brute of texte.split('\n')) {
    const ligne = brute.replace(/(^|\s)#.*$/, '').trim();
    if (!ligne) continue;
    if (profondeur === 0 && ligne.endsWith('{')) {
      const tete = ligne.slice(0, -1).trim();
      const hotes = tete
        .split(/[\s,]+/)
        .map(hoteDAdresseDeSite)
        .filter((h): h is string => !!h);
      courant = hotes.length && !tete.startsWith('(') ? { hotes: [...new Set(hotes)], ports: [], importeLaGarde: false } : null;
      profondeur = 1;
      continue;
    }
    if (courant) {
      const proxy = /^reverse_proxy\s+(?:\S*\s+)?(?:https?:\/\/)?(?:127\.0\.0\.1|localhost|\[::1\]):(\d+)/.exec(ligne);
      if (proxy) {
        const port = Number(proxy[1]);
        if (!courant.ports.includes(port)) courant.ports.push(port);
      }
      if (/^import\s+garde-robots\b/.test(ligne)) courant.importeLaGarde = true;
    }
    for (const c of ligne) {
      if (c === '{') profondeur += 1;
      else if (c === '}') profondeur -= 1;
    }
    if (profondeur <= 0) {
      profondeur = 0;
      if (courant) blocs.push(courant);
      courant = null;
    }
  }
  return blocs;
}

/* ------------------------------------------------------------------------------------------------------------------
 * Hôte → projet
 * ---------------------------------------------------------------------------------------------------------------- */

export interface ProjetPourLaGarde {
  id: string;
  name: string;
  devUrl?: string | null;
  port?: number | null;
  archived?: boolean;
  isSelf?: boolean;
  /** Absent : protégé (la garde est le défaut). */
  protectionTravail?: boolean;
  cheminsLibresTravail?: string[];
}

export interface SiteDeTravail {
  projetId: string;
  projetNom: string;
  /** Les hôtes de ce projet dans la zone, tous blocs confondus. */
  hotes: string[];
  /** La protection est-elle voulue (interrupteur du projet) ? */
  protege: boolean;
  /** Tous ses blocs importent-ils la garde ? Sinon la protection ne peut pas s'appliquer partout. */
  gardePosee: boolean;
  cheminsLibres: string[];
}

export function hoteDUneAdresse(adresse: string | null | undefined): string | null {
  if (!adresse) return null;
  try {
    return new URL(adresse.includes('://') ? adresse : `https://${adresse}`).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

export function dansLaZone(hote: string, zone: string): boolean {
  return !!zone && (hote === zone || hote.endsWith(`.${zone}`));
}

/**
 * LES SITES DE TRAVAIL DES PROJETS. Un bloc revient à un projet quand il sert l'hôte de son adresse de travail, ou
 * qu'il relaie vers le port du projet. Jamais fermés : un bloc servi par le démon lui-même (administration, espace
 * client), l'hôte de l'espace client et celui de l'administration, l'apex de la zone, un bloc qu'aucun projet ne
 * réclame, le projet de l'application elle-même. Seuls les hôtes DE LA ZONE sont gardés : une production qui
 * passerait par ce relais n'est jamais fermée.
 */
export function sitesDeTravail(
  blocs: readonly BlocDeSite[],
  projets: readonly ProjetPourLaGarde[],
  options: { zone: string; portDuDemon: number; hotesExclus: readonly string[] },
): SiteDeTravail[] {
  const { zone, portDuDemon } = options;
  if (!zone) return [];
  const exclus = new Set([zone, `www.${zone}`, ...options.hotesExclus.map((h) => h.toLowerCase()).filter(Boolean)]);
  const actifs = projets.filter((p) => !p.archived && !p.isSelf);
  const parProjet = new Map<string, { hotes: Set<string>; blocs: BlocDeSite[] }>();
  for (const bloc of blocs) {
    if (bloc.ports.includes(portDuDemon)) continue;
    if (bloc.hotes.some((h) => exclus.has(h))) continue;
    const parHote = actifs.find((p) => {
      const h = hoteDUneAdresse(p.devUrl);
      return !!h && bloc.hotes.includes(h);
    });
    const projet = parHote ?? actifs.find((p) => typeof p.port === 'number' && bloc.ports.includes(p.port));
    if (!projet) continue;
    const hotes = bloc.hotes.filter((h) => dansLaZone(h, zone) && !exclus.has(h));
    if (!hotes.length) continue;
    const entree = parProjet.get(projet.id) ?? { hotes: new Set<string>(), blocs: [] };
    hotes.forEach((h) => entree.hotes.add(h));
    entree.blocs.push(bloc);
    parProjet.set(projet.id, entree);
  }
  return actifs
    .filter((p) => parProjet.has(p.id))
    .map((p) => {
      const e = parProjet.get(p.id)!;
      return {
        projetId: p.id,
        projetNom: p.name,
        hotes: [...e.hotes].sort(),
        protege: p.protectionTravail !== false,
        gardePosee: e.blocs.every((b) => b.importeLaGarde),
        cheminsLibres: cheminsLibresLus(p.cheminsLibresTravail),
      };
    });
}

/** Les hôtes RÉELLEMENT fermés par la garde (protection voulue), triés. */
export function hotesProteges(sites: readonly SiteDeTravail[]): string[] {
  return [...new Set(sites.filter((s) => s.protege).flatMap((s) => s.hotes))].sort();
}

/** Tous les hôtes d'un même bloc qu'un hôte donné (alias compris) ; l'hôte seul s'il n'est dans aucun bloc. */
export function hotesDuMemeSite(blocs: readonly BlocDeSite[], hote: string): string[] {
  const h = hote.toLowerCase();
  const bloc = blocs.find((b) => b.hotes.includes(h));
  return bloc ? [...bloc.hotes].sort() : [h];
}

/* ------------------------------------------------------------------------------------------------------------------
 * Chemins libres et verdict
 * ---------------------------------------------------------------------------------------------------------------- */

/** Lit la liste des chemins libres saisie par l'utilisateur : « /api/webhooks/* », un par ligne. */
export function cheminsLibresLus(brut: unknown): string[] {
  const liste = Array.isArray(brut) ? brut : typeof brut === 'string' ? brut.split(/[\n,]+/) : [];
  return [
    ...new Set(
      liste
        .map((c) => String(c ?? '').trim())
        .filter((c) => /^\/[A-Za-z0-9._~\-/]*\*?$/.test(c) && c.length <= 200),
    ),
  ].slice(0, 50);
}

/** Le chemin est-il libre ? « /x/* » couvre /x et tout ce qui est dessous ; sans étoile, le chemin exact. */
export function cheminEstLibre(chemin: string, libres: readonly string[]): boolean {
  const c = chemin.split('?')[0] || '/';
  for (const l of [...CHEMINS_TOUJOURS_LIBRES, ...libres]) {
    if (l.endsWith('/*')) {
      const base = l.slice(0, -2);
      if (c === base || c.startsWith(`${base}/`)) return true;
    } else if (l.endsWith('*')) {
      if (c.startsWith(l.slice(0, -1))) return true;
    } else if (c === l) return true;
  }
  return false;
}

/** Les adresses de CE serveur : une requête qui en vient est un contrôle interne. */
export function ipInterne(ip: string | null | undefined, ipsDuServeur: readonly string[]): boolean {
  const a = (ip ?? '').trim().toLowerCase().replace(/^::ffff:/, '');
  if (!a) return false;
  if (a === '127.0.0.1' || a === '::1') return true;
  return ipsDuServeur.some((s) => s.toLowerCase() === a);
}

export interface CompteDeGarde {
  role: string;
  projets: string[];
}

/** Le compte ouvre-t-il ce site ? L'administrateur ouvre tout ; les autres, les projets qui leur sont ouverts. */
export function compteOuvreLeSite(compte: CompteDeGarde | null, projetId: string): boolean {
  if (!compte) return false;
  if (compte.role === 'admin') return true;
  return compte.projets.includes(projetId);
}

export type VerdictDeGarde = 'passe' | 'entree' | 'connexion';

/**
 * LE VERDICT D'UNE REQUÊTE sur un site connu de la garde. `entree` : l'arrivée de l'aller-retour, à traiter à part.
 */
export function verdictDeGarde(d: {
  site: Pick<SiteDeTravail, 'projetId' | 'protege' | 'cheminsLibres'> | null;
  chemin: string;
  interne: boolean;
  essaiVisiteur: boolean;
  compte: CompteDeGarde | null;
}): VerdictDeGarde {
  if (!d.site || !d.site.protege) return 'passe';
  const chemin = d.chemin.split('?')[0] || '/';
  if (chemin === CHEMIN_ENTREE_GARDE) return 'entree';
  if (cheminEstLibre(chemin, d.site.cheminsLibres)) return 'passe';
  if (d.interne && !d.essaiVisiteur) return 'passe';
  return compteOuvreLeSite(d.compte, d.site.projetId) ? 'passe' : 'connexion';
}

/**
 * L'ADRESSE DE RETOUR, VÉRIFIÉE : une adresse https d'un hôte PROTÉGÉ, rien d'autre (aucune redirection ouverte).
 * Rend l'URL normalisée, ou null.
 */
export function adresseDeRetourSure(vers: string | null | undefined, hotes: readonly string[]): URL | null {
  if (!vers) return null;
  try {
    const u = new URL(vers);
    if (u.protocol !== 'https:') return null;
    if (u.username || u.password || u.port) return null;
    if (!hotes.includes(u.hostname.toLowerCase())) return null;
    return u;
  } catch {
    return null;
  }
}

/** Le chemin local où renvoyer après l'entrée (jamais une autre origine : « //x », « /\x » refusés). */
export function cheminDeRetourSur(brut: string | null | undefined): string {
  const c = String(brut ?? '/');
  if (!c.startsWith('/') || c.startsWith('//') || c.startsWith('/\\') || /[\r\n]/.test(c)) return '/';
  if (c.split('?')[0] === CHEMIN_ENTREE_GARDE) return '/';
  return c;
}

/* ------------------------------------------------------------------------------------------------------------------
 * Le morceau de configuration Caddy
 * ---------------------------------------------------------------------------------------------------------------- */

/**
 * Les lignes à poser DANS le snippet commun `(garde-robots)` : chaque bloc qui l'importe reçoit la garde, mais elle
 * ne s'applique qu'aux hôtes listés (ceux des projets dont la protection est allumée). Liste vide : aucune ligne.
 * `forward_auth` passe après les renvois des robots d'IA (ordre des directives de Caddy) : un robot renvoyé vers
 * /pour-les-ia d'une version de travail tombe ensuite sur la connexion.
 */
export function lignesCaddyGardeAcces(hotes: readonly string[], amont: string): string[] {
  const surs = [...new Set(hotes.map((h) => hoteDAdresseDeSite(h)).filter((h): h is string => !!h))].sort();
  if (!surs.length) return [];
  return [
    '',
    `\t# Versions de travail réservées aux personnes connectées (${surs.length} adresse(s)) : réglées projet par projet, écrites par le démon.`,
    `\t@garde-acces host ${surs.join(' ')}`,
    `\tforward_auth @garde-acces ${amont} {`,
    `\t\turi ${ROUTE_VERIFIER_GARDE}`,
    '\t}',
  ];
}

/* ------------------------------------------------------------------------------------------------------------------
 * Le contrôle Sécurité
 * ---------------------------------------------------------------------------------------------------------------- */

export interface GardeAControler {
  /** Les adresses de travail du projet servies par ce serveur. */
  hotes: string[];
  /** L'interrupteur du projet. */
  protege: boolean;
  /** Tous les blocs du site importent-ils la garde commune ? */
  gardePosee: boolean;
  /** Ce qu'un visiteur anonyme a reçu sur la première adresse (null : rien reçu). */
  reponse: { statut: number; vers: string | null } | null;
}

/** Une réponse anonyme qui renvoie vers la connexion de la garde : la protection tient. */
export function reponseFermee(r: { statut: number; vers: string | null } | null): boolean {
  if (!r) return false;
  if (r.statut === 401 || r.statut === 403) return true;
  return r.statut >= 300 && r.statut < 400 && !!r.vers && r.vers.includes(ROUTE_CONNEXION_GARDE);
}

/**
 * LES CONSTATS DE LA GARDE D'UN PROJET (catégorie « robots », la plus proche : qui lit le site). Une version de
 * travail censée être réservée mais qui s'ouvre à un visiteur anonyme est une alerte ; une protection coupée par
 * l'utilisateur n'est qu'une information de faible gravité.
 */
export function constatsDeLaGarde(g: GardeAControler): {
  id: string;
  categorie: 'robots';
  gravite: 'elevee' | 'moyenne' | 'faible';
  titre: string;
  risque: string;
  proposition: string;
  ou: string[];
  technique?: string;
}[] {
  if (!g.hotes.length) return [];
  if (!g.protege) {
    return [
      {
        id: 'travail-protection-coupee',
        categorie: 'robots',
        gravite: 'faible',
        titre: 'La version de travail est ouverte à tous',
        risque: 'Sa protection a été coupée dans les paramètres du projet : n’importe qui, robots et IA compris, peut lire une version pas finie du site.',
        proposition: 'Rallumer « Version de travail réservée aux personnes connectées » dans paramètres › Déploiement, sauf si l’ouverture est voulue.',
        ou: g.hotes,
      },
    ];
  }
  if (reponseFermee(g.reponse)) return [];
  return [
    {
      id: 'travail-ouvert-sans-connexion',
      categorie: 'robots',
      gravite: 'moyenne',
      titre: 'La version de travail s’ouvre sans connexion',
      risque: 'Elle devrait être réservée aux personnes connectées, mais un visiteur anonyme la lit : robots, IA et curieux voient une version pas finie du site.',
      proposition: g.gardePosee
        ? 'Vérifier que le relais du serveur a bien reçu la liste des adresses réservées (elle est réécrite au démarrage de Beluga).'
        : 'Ajouter la garde commune au bloc du relais qui sert cette adresse : il ne l’importe pas.',
      ou: g.hotes,
      technique: `Réponse anonyme sur https://${g.hotes[0]}/ : ${g.reponse ? `${g.reponse.statut}${g.reponse.vers ? ` → ${g.reponse.vers}` : ''}` : 'aucune'}. Attendu : 302 vers ${ROUTE_CONNEXION_GARDE}. ${
        g.gardePosee
          ? 'Le snippet (garde-robots) de /etc/caddy/garde-robots.caddy doit contenir « @garde-acces host … » et « forward_auth » : appliquerLesReglagesDeRobots (server/src/garde-des-robots.ts).'
          : 'Un bloc de site sans « import garde-robots » (projet qui réécrit son fichier Caddy à la publication ?).'
      }`,
    },
  ];
}
