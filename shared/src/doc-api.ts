/**
 * LE MODE D'EMPLOI PUBLIC DE LA PORTE D'ENTRÉE.
 *
 * Un service qu'on branche a besoin de trouver la marche à suivre SANS compte :
 * l'adresse `/api` la donne, ouverte à tous, avant le mur d'accès. Elle ne
 * montre QUE du texte — aucune clé, aucun projet, aucune carte : la
 * documentation ne lit rien de la base.
 *
 * Tout se décide ici, sans base ni disque : le serveur (`server/src/http.ts`)
 * ne fait que rendre ce que ce fichier écrit. La documentation NAÎT donc des
 * mêmes constantes que la porte elle-même (`cles-api.ts`) — elle ne peut pas
 * mentir sur une borne ou sur un nom de champ.
 */

import {
  DESCRIPTION_EXTERNE_MAX,
  ETIQUETTES_EXTERNES_MAX,
  PREFIXE_CLE_API,
  ROUTE_CARTE_EXTERNE,
  ROUTE_CLIENTS_EXTERNE,
  TITRE_EXTERNE_MAX,
  TITRE_EXTERNE_MIN,
} from './cles-api.js';

/** L'adresse du mode d'emploi. Publique, en lecture seule. */
export const ROUTE_DOC_API = '/api';

export interface ChampDocumente {
  nom: string;
  /** Les autres noms acceptés pour le même champ (français / anglais). */
  alias: string[];
  obligatoire: boolean;
  description: string;
}

export interface RefusDocumente {
  statut: number;
  quand: string;
}

export interface DocumentationApi {
  titre: string;
  resume: string;
  methode: string;
  /** L'adresse complète quand la racine est connue, sinon le seul chemin. */
  adresse: string;
  chemin: string;
  entetes: { nom: string; description: string }[];
  champs: ChampDocumente[];
  exempleCurl: string;
  exempleReponse: string;
  refus: RefusDocumente[];
  /** Ce qu'une carte venue du dehors ne fait PAS : dépenser. */
  invariants: string[];
  /** Où l'on fabrique une clé. */
  ouObtenirUneCle: string;
  /** La seconde adresse de la porte : retrouver un projet par le nom d'un client. */
  routeClients: DocumentationRouteLecture;
}

/** Le mode d'emploi d'une adresse de LECTURE — plus légère qu'une adresse de création. */
export interface DocumentationRouteLecture {
  titre: string;
  resume: string;
  methode: string;
  adresse: string;
  chemin: string;
  parametres: { nom: string; obligatoire: boolean; description: string }[];
  exempleCurl: string;
  exempleReponse: string;
  refus: RefusDocumente[];
}

/** La racine sans barre finale : `https://exemple.tld/` et `https://exemple.tld` valent pareil. */
function racineNette(racine: string): string {
  return racine.replace(/\/+$/, '');
}

/** Le mode d'emploi de la route qui retrouve un projet par le nom de son client. */
function documentationRouteClients(base: string): DocumentationRouteLecture {
  const adresse = `${base}${ROUTE_CLIENTS_EXTERNE}`;
  return {
    titre: 'Retrouver un projet à partir du nom d’un client',
    resume:
      'Rend les clients déjà rapprochés d’un projet (réglages → onglet facturation), filtrés sur ' +
      'le nom du client OU de son entreprise quand `client` est donné — une PARTIE du nom suffit, ' +
      'accents et majuscules mis de côté. Sans ce paramètre, la liste entière est rendue. Lecture ' +
      'seule : rien n’est modifié.',
    methode: 'GET',
    adresse,
    chemin: ROUTE_CLIENTS_EXTERNE,
    parametres: [
      {
        nom: 'client',
        obligatoire: false,
        description:
          'Le nom (ou un morceau du nom) cherché, comparé au client ET à son entreprise — alias : « nom ».',
      },
    ],
    exempleCurl: [
      `curl "${adresse}?client=Dupont" \\`,
      `  -H "x-haikodev-cle: ${PREFIXE_CLE_API}…"`,
    ].join('\n'),
    exempleReponse: JSON.stringify(
      {
        ok: true,
        clients: [
          {
            projet: { id: 'p_…', nom: 'Nom du projet' },
            client: { id: 'c_…', nom: 'Dupont & Fils SA' },
            entreprise: { id: 'e_…', nom: 'Entreprise' },
          },
        ],
      },
      null,
      2,
    ),
    refus: [
      { statut: 401, quand: 'Aucune clé, clé mal formée ou clé inconnue.' },
      { statut: 403, quand: 'La clé a été révoquée.' },
      { statut: 405, quand: 'Une autre méthode que GET.' },
    ],
  };
}

export function documentationApi(racine = ''): DocumentationApi {
  const base = racineNette(racine);
  const adresse = `${base}${ROUTE_CARTE_EXTERNE}`;

  return {
    titre: 'HaikoDev — créer une carte depuis un service extérieur',
    resume:
      'Une seule adresse, gardée par une clé : elle pose une carte dans le projet visé. ' +
      'La carte arrive dans « Planifié » et attend un lancement humain.',
    methode: 'POST',
    adresse,
    chemin: ROUTE_CARTE_EXTERNE,
    entetes: [
      { nom: 'x-haikodev-cle', description: `La clé du service, de la forme ${PREFIXE_CLE_API}…` },
      { nom: 'Authorization: Bearer …', description: 'La même clé, pour les outils qui ne savent envoyer que cela.' },
      { nom: 'content-type: application/json', description: 'Le corps est du JSON.' },
    ],
    champs: [
      {
        nom: 'projet',
        alias: ['project', 'projectId'],
        obligatoire: true,
        description: 'Le projet visé, par son NOM (accents et majuscules mis de côté) ou par son identifiant.',
      },
      {
        nom: 'titre',
        alias: ['title'],
        obligatoire: true,
        description: `Le titre de la carte, de ${TITRE_EXTERNE_MIN} à ${TITRE_EXTERNE_MAX} signes.`,
      },
      {
        nom: 'description',
        alias: ['texte', 'body'],
        obligatoire: false,
        description: `Le contenu de la carte, ${DESCRIPTION_EXTERNE_MAX} signes au plus.`,
      },
      {
        nom: 'etiquettes',
        alias: ['labels'],
        obligatoire: false,
        description: `Une liste de mots-clés, ${ETIQUETTES_EXTERNES_MAX} au plus.`,
      },
    ],
    exempleCurl: [
      `curl -X POST ${adresse} \\`,
      `  -H "x-haikodev-cle: ${PREFIXE_CLE_API}…" \\`,
      '  -H "content-type: application/json" \\',
      `  -d '${JSON.stringify({
        projet: 'Nom du projet',
        titre: 'Mail de M. Dupont',
        description: 'Ce qu’il demande, tel quel.',
      })}'`,
    ].join('\n'),
    exempleReponse: JSON.stringify(
      {
        ok: true,
        carte: {
          id: 'c_…',
          titre: 'Mail de M. Dupont',
          description: 'Ce qu’il demande, tel quel.',
          colonne: 'planned',
          projet: { id: 'p_…', nom: 'Nom du projet' },
          creeeLe: 1750000000000,
        },
      },
      null,
      2,
    ),
    refus: [
      { statut: 400, quand: "L'envoi n'est pas du JSON lisible, ou un champ manque." },
      { statut: 401, quand: 'Aucune clé, clé mal formée ou clé inconnue.' },
      { statut: 403, quand: 'La clé a été révoquée.' },
      { statut: 404, quand: 'Aucun projet ne porte ce nom.' },
      { statut: 405, quand: 'Une autre méthode que POST.' },
      { statut: 409, quand: 'Deux projets portent ce nom, ou le projet est mis de côté.' },
    ],
    invariants: [
      'La carte naît dans « Planifié » : elle n’a pas d’agent et ne démarre pas toute seule.',
      'Rien ne part au moteur : un appel extérieur ne peut donc rien dépenser.',
      'Cette porte n’ouvre que la création de carte — elle ne lit ni ne modifie rien d’autre.',
      'Tout refus est dit en clair, dans le champ « error » de la réponse.',
    ],
    ouObtenirUneCle:
      'Réglages → onglet « Accès API » : on nomme le service, on génère sa clé, on la copie ' +
      '(elle n’est montrée qu’une fois) et on peut la révoquer d’un clic.',
    routeClients: documentationRouteClients(base),
  };
}

/** Le texte qui part dans une page : les chevrons et l’esperluette ne doivent rien ouvrir. */
function echapper(texte: string): string {
  return texte
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * La page lisible par un humain, servie telle quelle par le démon. Volontairement
 * sans image, sans script et sans dépendance : elle doit s'ouvrir partout, et
 * rester lisible dans un terminal comme dans un navigateur.
 */
export function pageDocApi(racine = ''): string {
  const doc = documentationApi(racine);
  const champs = doc.champs
    .map(
      (c) => `<tr>
        <td><code>${echapper(c.nom)}</code>${
          c.alias.length ? `<div class="alias">aussi : ${c.alias.map((a) => echapper(a)).join(', ')}</div>` : ''
        }</td>
        <td>${c.obligatoire ? '<span class="oblig">obligatoire</span>' : 'facultatif'}</td>
        <td>${echapper(c.description)}</td>
      </tr>`,
    )
    .join('\n');

  const refus = doc.refus
    .map((r) => `<tr><td><code>${r.statut}</code></td><td>${echapper(r.quand)}</td></tr>`)
    .join('\n');

  const entetes = doc.entetes
    .map((e) => `<li><code>${echapper(e.nom)}</code> — ${echapper(e.description)}</li>`)
    .join('\n');

  const invariants = doc.invariants.map((i) => `<li>${echapper(i)}</li>`).join('\n');

  const rc = doc.routeClients;
  const rcParametres = rc.parametres
    .map(
      (p) => `<tr>
        <td><code>${echapper(p.nom)}</code></td>
        <td>${p.obligatoire ? '<span class="oblig">obligatoire</span>' : 'facultatif'}</td>
        <td>${echapper(p.description)}</td>
      </tr>`,
    )
    .join('\n');
  const rcRefus = rc.refus
    .map((r) => `<tr><td><code>${r.statut}</code></td><td>${echapper(r.quand)}</td></tr>`)
    .join('\n');

  return `<!doctype html>
<html lang="fr" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#09090b">
<meta name="robots" content="noindex">
<title>${echapper(doc.titre)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; background:#09090b; color:#fafafa; padding:32px 20px 64px;
         font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; line-height:1.6; }
  main { max-width:760px; margin:0 auto; }
  h1 { font-size:22px; font-weight:600; margin:0 0 6px; letter-spacing:-0.01em; }
  h2 { font-size:15px; font-weight:600; margin:28px 0 8px; }
  p, li { font-size:14px; color:#d4d4d8; }
  p.sub { color:#a1a1aa; margin:0 0 20px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:13px;
         background:#18181b; border:1px solid #27272a; border-radius:5px; padding:1px 5px; color:#fafafa; }
  pre { background:#131316; border:1px solid #27272a; border-radius:8px; padding:12px 14px;
        overflow-x:auto; font-size:12.5px; line-height:1.55; color:#e4e4e7; }
  pre code { background:none; border:0; padding:0; font-size:12.5px; }
  table { width:100%; border-collapse:collapse; margin-top:6px; }
  th, td { text-align:left; vertical-align:top; padding:7px 10px; border-bottom:1px solid #27272a; font-size:13.5px; }
  th { color:#a1a1aa; font-weight:500; font-size:12px; text-transform:uppercase; letter-spacing:0.04em; }
  td { color:#d4d4d8; }
  .alias { color:#71717a; font-size:12px; margin-top:3px; }
  .oblig { color:#fbbf24; }
  .adresse { display:inline-block; background:#131316; border:1px solid #27272a; border-radius:8px;
             padding:8px 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:13.5px; }
  .note { border:1px solid #27272a; background:#131316; border-radius:8px; padding:12px 14px; }
  ul { padding-left:20px; }
  footer { margin-top:36px; color:#71717a; font-size:12.5px; }
</style>
</head>
<body>
<main>
  <h1>${echapper(doc.titre)}</h1>
  <p class="sub">${echapper(doc.resume)}</p>

  <p class="adresse">${echapper(doc.methode)} ${echapper(doc.adresse)}</p>

  <h2>La clé</h2>
  <p>${echapper(doc.ouObtenirUneCle)}</p>
  <p>Elle se présente de l'une de ces façons :</p>
  <ul>
${entetes}
  </ul>

  <h2>Ce qu'on envoie</h2>
  <table>
    <thead><tr><th>Champ</th><th></th><th>Rôle</th></tr></thead>
    <tbody>
${champs}
    </tbody>
  </table>

  <h2>Un appel complet</h2>
  <pre><code>${echapper(doc.exempleCurl)}</code></pre>

  <h2>Ce qui revient</h2>
  <pre><code>${echapper(doc.exempleReponse)}</code></pre>

  <h2>Les refus</h2>
  <table>
    <thead><tr><th>Code</th><th>Quand</th></tr></thead>
    <tbody>
${refus}
    </tbody>
  </table>

  <h2>À savoir</h2>
  <div class="note">
    <ul>
${invariants}
    </ul>
  </div>

  <h2>${echapper(rc.titre)}</h2>
  <p>${echapper(rc.resume)}</p>
  <p class="adresse">${echapper(rc.methode)} ${echapper(rc.adresse)}</p>
  <table>
    <thead><tr><th>Paramètre</th><th></th><th>Rôle</th></tr></thead>
    <tbody>
${rcParametres}
    </tbody>
  </table>
  <pre><code>${echapper(rc.exempleCurl)}</code></pre>
  <pre><code>${echapper(rc.exempleReponse)}</code></pre>
  <table>
    <thead><tr><th>Code</th><th>Quand</th></tr></thead>
    <tbody>
${rcRefus}
    </tbody>
  </table>

  <footer>Cette page est publique et en lecture seule. Le même contenu en JSON :
    <code>${echapper(`${racineNette(racine)}${ROUTE_DOC_API}`)}</code> avec l'en-tête
    <code>accept: application/json</code>.</footer>
</main>
</body>
</html>`;
}
