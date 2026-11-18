/*
 * LA PROTECTION CONTRE LES ROBOTS — RÈGLES PURES DU CONTRÔLE DE SÉCURITÉ ET DE LA LISTE DES VISITEURS BLOQUÉS.
 * Carte « Anti-robots et référencement des projets » (18/11/2026).
 *
 * Deux gardes, sur chacun des deux serveurs :
 *   - le RENVOI des robots d'ENTRAÎNEMENT d'IA vers /pour-les-ia (liste unique : robots-ia.ts), la lecture LIBRE du
 *     site public par les robots de recherche et les agents des IA (règle par rôle, carte « Audit et suivi du GEO »,
 *     18/11/2026), et la fermeture des adresses de travail à tous les robots ;
 *   - le GARDE DES VISITEURS INSISTANTS (fail2ban : prisons caddy-* sur le serveur Beluga, traefik-* sur le serveur
 *     Clients), qui coupe puis bannit les adresses qui aspirent, rafraîchissent en rafale ou visitent des pages pièges.
 * Le contrôle relève, le rapport juge ici ; « Libérer » lève un bannissement sur le serveur qui sert le projet.
 *
 * Règles PURES : ni base, ni réseau, ni horloge (la date du jour est passée).
 */

import type { ConstatSecurite } from './controle-securite.js';
import { estAdresseDeTravail, PAGE_POUR_LES_IA } from './robots-ia.js';

/** Les deux serveurs (MEM-3294) : les adresses de travail sur Beluga, les domaines publics sur Clients. */
export type ServeurDesSites = 'beluga' | 'clients';

export const IP_DES_SERVEURS: Readonly<Record<ServeurDesSites, string>> = {
  beluga: '198.51.100.7',
  clients: '46.224.231.253',
};

export function serveurDeLIp(ip: string | null | undefined): ServeurDesSites | null {
  if (!ip) return null;
  return (Object.keys(IP_DES_SERVEURS) as ServeurDesSites[]).find((s) => IP_DES_SERVEURS[s] === ip) ?? null;
}

/** Une réponse lue SANS suivre les renvois. */
export interface ReponseDeRobot {
  statut: number;
  /** L'entête Location, telle quelle. */
  vers?: string | null;
  xRobotsTag?: string | null;
}

export interface ReleveDesRobots {
  adresse: string;
  /** Un faux robot d'ENTRAÎNEMENT d'IA (GPTBot) demande la page d'accueil. null = injoignable. */
  ia: ReponseDeRobot | null;
  /** Un faux robot de RECHERCHE d'IA (OAI-SearchBot) demande la même page. Absent = non relevé (ancien relevé). */
  recherche?: ReponseDeRobot | null;
  /** Un faux Googlebot demande la même page. */
  google: ReponseDeRobot | null;
  /** Le serveur qui sert l'adresse ; null si elle passe ailleurs (relais, autre hébergeur). */
  serveur: ServeurDesSites | null;
  /** Le garde des visiteurs insistants tourne-t-il sur ce serveur ? null = non vérifié. */
  gardeActif: boolean | null;
}

function hoteDe(adresse: string): string {
  try {
    return new URL(adresse).hostname;
  } catch {
    return adresse;
  }
}

/** Le robot d'IA a-t-il été renvoyé vers la page qui lui est destinée (ou refusé) ? */
export function iaRenvoyee(r: ReponseDeRobot): boolean {
  if (r.statut === 403) return true;
  if (r.statut < 300 || r.statut >= 400 || !r.vers) return false;
  try {
    return new URL(r.vers, 'https://x.invalid').pathname.replace(/\/$/, '') === PAGE_POUR_LES_IA;
  } catch {
    return false;
  }
}

/** Un robot de recherche d'IA a-t-il été empêché de lire (renvoyé vers /pour-les-ia, refusé ou freiné) ? */
export function rechercheBloquee(r: ReponseDeRobot): boolean {
  return r.statut === 403 || r.statut === 429 || iaRenvoyee(r);
}

/** Google a-t-il été traité comme un robot d'IA ou refusé ? (une redirection ordinaire, vers https ou /fr, ne compte pas) */
export function googleCoupe(r: ReponseDeRobot): boolean {
  return r.statut === 403 || r.statut === 429 || (iaRenvoyee(r) && r.statut !== 403);
}

const NOM_DU_SERVEUR: Record<ServeurDesSites, string> = {
  beluga: 'le serveur des adresses de travail',
  clients: 'le serveur des sites publics',
};

/** Les constats de la rubrique « Protection contre les robots ». */
export function constatsDeRobots(r: ReleveDesRobots): ConstatSecurite[] {
  const constats: ConstatSecurite[] = [];
  const travail = estAdresseDeTravail(hoteDe(r.adresse));
  const ajouter = (c: Omit<ConstatSecurite, 'categorie' | 'ou'>) => constats.push({ ...c, categorie: 'robots', ou: [r.adresse] });

  if (r.ia && !iaRenvoyee(r.ia)) {
    ajouter({
      id: 'robots-ia-non-renvoyes',
      gravite: 'elevee',
      titre: "Les robots d'entraînement des IA lisent tout le site",
      risque:
        "Les robots qui servent à entraîner les IA (GPTBot, ClaudeBot, CCBot…) aspirent toutes les pages, à leur rythme, sans passer par la page qui leur est destinée.",
      proposition: `Poser le renvoi commun des robots d'entraînement vers « ${PAGE_POUR_LES_IA} » sur le serveur qui sert cette adresse.`,
      technique: `Réponse à un User-Agent GPTBot : ${r.ia.statut}${r.ia.vers ? ` → ${r.ia.vers}` : ''}. Attendu : 307/302 vers ${PAGE_POUR_LES_IA}, ou 403. Serveur Beluga : « import garde-robots » dans le bloc Caddy du site (node scripts/garde-robots.mjs caddy). Serveur Clients : scripts/serveur-clients/garde/installer.sh.`,
    });
  }
  if (r.recherche && !travail && rechercheBloquee(r.recherche)) {
    ajouter({
      id: 'robots-recherche-bloques',
      gravite: 'moyenne',
      titre: 'Les IA ne peuvent pas citer les pages du site',
      risque:
        "Les robots de recherche de ChatGPT, Perplexity ou Claude sont renvoyés vers une seule page : ils ne peuvent citer ni les services, ni les prix, ni les articles du site.",
      proposition: `Laisser les robots de recherche et les agents des IA lire tout le site public ; seuls les robots d'entraînement restent sur « ${PAGE_POUR_LES_IA} ».`,
      technique: `Réponse à un User-Agent OAI-SearchBot : ${r.recherche.statut}${r.recherche.vers ? ` → ${r.recherche.vers}` : ''}. Attendu : la page elle-même (200, ou une redirection ordinaire). Côté site : robots.txt avec un groupe d'entraînement limité et un groupe recherche ouvert ; côté serveur : bloc garde-robots régénéré (règle par rôle).`,
    });
  }
  if (r.recherche && travail && !rechercheBloquee(r.recherche)) {
    ajouter({
      id: 'robots-travail-ouvert-aux-ia',
      gravite: 'moyenne',
      titre: 'Les IA lisent l’adresse de travail',
      risque: 'Une version de travail, pas finie, peut être lue et citée par ChatGPT ou Perplexity à la place du vrai site.',
      proposition: `Renvoyer tous les robots d'IA vers « ${PAGE_POUR_LES_IA} » sur l’adresse de travail.`,
      technique: `Réponse à un User-Agent OAI-SearchBot : ${r.recherche.statut}. Le bloc commun « garde-robots » (matcher @robot-ia-travail) le fait sur les adresses de travail.`,
    });
  }
  if (r.google && !travail && googleCoupe(r.google)) {
    ajouter({
      id: 'robots-google-coupe',
      gravite: 'critique',
      titre: 'Google ne peut plus lire le site',
      risque: 'Le site disparaît peu à peu des résultats de recherche : Google est refusé ou renvoyé comme un robot d’IA.',
      proposition: 'Rendre à Google et Bing l’accès complet au site public.',
      technique: `Réponse à un User-Agent Googlebot : ${r.google.statut}${r.google.vers ? ` → ${r.google.vers}` : ''}.`,
    });
  }
  if (travail && r.google && !/noindex/i.test(r.google.xRobotsTag ?? '')) {
    ajouter({
      id: 'robots-travail-indexable',
      gravite: 'moyenne',
      titre: 'L’adresse de travail peut apparaître dans Google',
      risque: 'Une version de travail, pas finie, peut être trouvée dans les moteurs de recherche et faire concurrence au vrai site.',
      proposition: 'Fermer l’adresse de travail à tous les robots (consigne « noindex » et fichier robots.txt fermé).',
      technique: 'Entête X-Robots-Tag absent. Le bloc commun « garde-robots » du Caddyfile le pose sur les adresses de travail.',
    });
  }
  if (r.serveur && r.gardeActif === false) {
    ajouter({
      id: 'robots-sans-garde',
      gravite: 'elevee',
      titre: 'Rien ne coupe les visiteurs qui aspirent le site',
      risque:
        'Un robot qui rafraîchit les pages en rafale ou cherche des fichiers sensibles peut continuer sans limite, ralentir le site et le serveur.',
      proposition: `Activer le garde des visiteurs insistants sur ${NOM_DU_SERVEUR[r.serveur]} : 24 h au premier abus, bannissement définitif à la récidive.`,
      technique:
        r.serveur === 'clients'
          ? 'Aucune prison traefik-* dans fail2ban : lancer scripts/serveur-clients/garde/installer.sh (recrée le conteneur Traefik, quelques secondes de coupure).'
          : 'Aucune prison caddy-* dans fail2ban sur le serveur Beluga (source : dépôt haiko-hetzner, server/fail2ban).',
    });
  }
  return constats;
}

/** Ce que l'étape « Protection contre les robots » dit dans « Ce qui a été vérifié ». */
export function noteDeLEtapeRobots(r: ReleveDesRobots): string {
  const morceaux: string[] = [];
  if (r.ia) morceaux.push(iaRenvoyee(r.ia) ? "robots d'entraînement renvoyés" : "robots d'entraînement NON renvoyés");
  if (r.recherche) {
    const travail = estAdresseDeTravail(hoteDe(r.adresse));
    const bloquee = rechercheBloquee(r.recherche);
    morceaux.push(travail ? (bloquee ? 'recherche des IA fermée (adresse de travail)' : 'recherche des IA OUVERTE sur l’adresse de travail') : bloquee ? 'recherche des IA BLOQUÉE' : 'recherche des IA libre');
  }
  if (r.google) morceaux.push(googleCoupe(r.google) ? 'Google coupé' : 'Google passe');
  morceaux.push(
    r.gardeActif === true ? 'garde des visiteurs insistants actif' : r.gardeActif === false ? 'aucun garde des visiteurs insistants' : 'garde non vérifié (serveur inconnu)',
  );
  morceaux.push("un robot déguisé en navigateur n'est attrapé que par son comportement");
  return morceaux.join(' · ');
}

/* ------------------------------------------------------------------------------------------------------------------
 * Les visiteurs bloqués (fail2ban)
 * ---------------------------------------------------------------------------------------------------------------- */

export interface VisiteurBloque {
  ip: string;
  prison: string;
  /** Pourquoi, en mots courants. */
  raison: string;
  /** Début du bannissement (« 2026-11-18 08:43:37 », heure du serveur). */
  depuis: string | null;
  /** Fin prévue ; null = définitif. */
  jusqua: string | null;
  definitif: boolean;
  serveur: ServeurDesSites;
}

/** La raison d'une prison, en mots courants. */
export function raisonDeLaPrison(prison: string): string {
  if (/pieges/.test(prison)) return 'A cherché des fichiers sensibles';
  if (/cadence-apps/.test(prison)) return "Rafale de demandes sur une application d'équipe";
  if (/cadence/.test(prison)) return 'Rafale de pages';
  if (/recidive/.test(prison)) return 'Récidive';
  return 'Bloqué par le garde';
}

/** Les prisons du garde web (jamais sshd : l'accès SSH a ses propres règles et ne se libère pas d'ici). */
export function prisonsDuGarde(statut: string): string[] {
  const m = /Jail list:\s*(.*)$/m.exec(statut);
  if (!m) return [];
  return m[1]!
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^(caddy|traefik)-/.test(s));
}

/**
 * La sortie de « fail2ban-client get <prison> banip --with-time » :
 *   « 130.211.87.56 \t2026-11-18 08:43:37 + 86401 = 2026-11-19 08:43:38 »
 * Un bannissement définitif porte une durée négative (« + -1 = … »).
 */
export function bannisDeFail2ban(prison: string, sortie: string, serveur: ServeurDesSites): VisiteurBloque[] {
  const liste: VisiteurBloque[] = [];
  for (const ligne of sortie.split('\n')) {
    const m = /^\s*([0-9a-f.:]+)\s+(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\s*\+\s*(-?\d+)\s*=\s*(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)?/i.exec(ligne);
    if (!m) continue;
    const duree = Number(m[3]);
    const definitif = duree < 0 || duree >= 50 * 365 * 86400;
    liste.push({
      ip: m[1]!,
      prison,
      raison: raisonDeLaPrison(prison),
      depuis: m[2]!,
      jusqua: definitif ? null : (m[4] ?? null),
      definitif,
      serveur,
    });
  }
  return liste;
}

/** Une même adresse dans plusieurs prisons ne fait qu'une ligne : la plus sévère (définitive, puis la fin la plus tardive). */
export function regrouperLesBannis(liste: readonly VisiteurBloque[]): VisiteurBloque[] {
  const parIp = new Map<string, VisiteurBloque>();
  for (const v of liste) {
    const deja = parIp.get(v.ip);
    if (!deja || (v.definitif && !deja.definitif) || (!deja.definitif && !v.definitif && (v.jusqua ?? '') > (deja.jusqua ?? ''))) parIp.set(v.ip, v);
  }
  return [...parIp.values()].sort((a, b) => (b.depuis ?? '').localeCompare(a.depuis ?? ''));
}

/** Une adresse IP valide, et seulement elle : la commande « Libérer » ne passe rien d'autre au serveur. */
export function ipValide(ip: string): boolean {
  if (/^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(ip)) return true;
  return /^[0-9a-f:]+$/i.test(ip) && ip.includes(':') && ip.length <= 39;
}
