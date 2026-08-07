/**
 * L'ADRESSE PUBLIQUE SE DEMANDE AU MONTAGE DU PROJET.
 *
 * Le sous-domaine se fabriquait à part, à la main, une fois le projet monté :
 * un projet neuf naissait donc sans adresse, et le déploiement n'avait rien à
 * contrôler à la fin. On demande donc le nom voulu et le port DÈS la création,
 * et le montage porte une étape de plus qui appelle le mécanisme existant.
 *
 * Ici, RIEN ne touche au réseau : ce fichier ne fait que juger ce qui a été
 * saisi. La création elle-même (fournisseur de noms, propagation, reverse-proxy)
 * ne bouge pas d'un iota et vit toujours dans le démon.
 */

/** La zone dont dépendent toutes les adresses des projets. */
export const ZONE_PROJETS = 'haikostudio.cloud';

/** Le nom ne peut pas être plus long que ce que le fournisseur accepte. */
export const SOUS_DOMAINE_MAX = 40;

/** Les ports utilisables par un projet qui écoute sur le serveur. */
export const PORT_MIN = 1;
export const PORT_MAX = 65535;

/** Le titre de l'étape, tel qu'il se lit dans le déroulé du montage. */
export const TITRE_ETAPE_ADRESSE = 'Adresse publique créée';

/**
 * Ramène une saisie au nom court attendu. On tolère ce qu'un utilisateur écrit
 * naturellement : l'adresse entière, le « https:// » de tête, la zone collée
 * au bout, les accents et les majuscules.
 */
export function normaliserSousDomaine(saisi: string | undefined | null): string {
  const brut = (saisi ?? '').trim().toLowerCase();
  if (!brut) return '';
  const sansProtocole = brut.replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '');
  const sansZone = sansProtocole.endsWith(`.${ZONE_PROJETS}`)
    ? sansProtocole.slice(0, -(ZONE_PROJETS.length + 1))
    : sansProtocole;
  return sansZone
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SOUS_DOMAINE_MAX)
    .replace(/-+$/g, '');
}

/** L'adresse complète d'un nom court, telle qu'elle sera contrôlée après chaque déploiement. */
export function adresseDuSousDomaine(nomCourt: string): string {
  const slug = normaliserSousDomaine(nomCourt);
  return slug ? `https://${slug}.${ZONE_PROJETS}` : '';
}

/** Le port sur lequel le projet écoute, ou `null` si la saisie n'en est pas un. */
export function normaliserPort(saisi: string | number | undefined | null): number | null {
  if (saisi === undefined || saisi === null || saisi === '') return null;
  const nombre = typeof saisi === 'number' ? saisi : Number(String(saisi).trim());
  if (!Number.isInteger(nombre)) return null;
  if (nombre < PORT_MIN || nombre > PORT_MAX) return null;
  return nombre;
}

/** Ce qu'on a compris de la saisie, avant de toucher au fournisseur de noms. */
export interface AdresseDemandee {
  /** L'utilisateur veut-il une adresse ? Non demandée est un état NORMAL. */
  demandee: boolean;
  /** Le nom court retenu, une fois nettoyé. */
  sousDomaine?: string;
  /** Le port du projet sur le serveur. */
  port?: number;
  /** Ce qui empêche de créer l'adresse, en français simple. */
  erreur?: string;
}

/**
 * Juge la paire nom + port. Rien de saisi : on ne demande RIEN et le montage se
 * déroule comme avant, sans étape d'adresse ni échec. Une moitié seulement :
 * on le dit, car un nom sans port ne peut pas être branché.
 */
export function jugerAdresseDemandee(saisie: {
  sousDomaine?: string | null;
  port?: string | number | null;
}): AdresseDemandee {
  const nomBrut = (saisie.sousDomaine ?? '').trim();
  const portBrut = saisie.port === undefined || saisie.port === null ? '' : String(saisie.port).trim();
  if (!nomBrut && !portBrut) return { demandee: false };

  const sousDomaine = normaliserSousDomaine(nomBrut);
  const port = normaliserPort(portBrut);

  if (!sousDomaine) {
    return { demandee: true, port: port ?? undefined, erreur: "le nom de l'adresse ne contient aucune lettre utilisable" };
  }
  if (port === null) {
    return {
      demandee: true,
      sousDomaine,
      erreur: portBrut
        ? `le port « ${portBrut} » n'est pas un nombre entre ${PORT_MIN} et ${PORT_MAX}`
        : 'le port sur lequel le projet écoute manque',
    };
  }
  return { demandee: true, sousDomaine, port };
}

/**
 * La consigne donnée à TOUT agent : monter un projet sans adresse, c'est monter
 * un projet que le déploiement ne pourra jamais contrôler. La question se pose
 * AVANT le premier dossier, avec l'outil prévu pour ça.
 */
export const CONSIGNE_CREATION_PROJET =
  "CRÉER UN PROJET SUPPOSE DE CONNAÎTRE SON ADRESSE. Avant de monter quoi que ce soit — dossier, dépôt, fichiers de départ —, " +
  `demande avec l'outil « ask_user » le SOUS-DOMAINE voulu (il finira par « .${ZONE_PROJETS} ») et le PORT sur lequel le projet écoutera sur le serveur. ` +
  "Tu attends la réponse : ce n'est pas un détail qu'on règle après coup, c'est cette adresse qui sera contrôlée à la fin de chaque déploiement. " +
  "Si l'utilisateur répond qu'il n'en veut pas, tu montes le projet sans adresse et tu le dis — mais tu ne le décides jamais à sa place.";
