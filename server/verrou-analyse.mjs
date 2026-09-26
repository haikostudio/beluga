#!/usr/bin/env node
/**
 * LE VERROU D'ANALYSE DU CADRAGE, posé devant chaque outil de terrain.
 *
 * Tant que l'agent de cadrage n'a pas ouvert la mémoire du projet, il ne lit
 * aucun fichier et ne lance aucune commande. Ce verrou était FIGÉ au lancement
 * du tour — les outils retirés de la liste blanche — : le modèle les appelait
 * quand même, le moteur refusait en rouge, et la liste restait bridée tout le
 * premier tour, même une fois la mémoire ouverte.
 *
 * Il est désormais VIVANT : à chaque appel, on demande au démon si la mémoire
 * est ouverte (`/internal/analyse`). Avant : refus clair, avec quoi faire à la
 * place. Après : l'outil passe, dans le même tour.
 *
 * Règle de prudence, la même que le garde du démon : au moindre doute (démon
 * muet, tour étranger, réponse illisible), on LAISSE PASSER. Un verrou en panne
 * ne doit jamais murer tout le cadrage.
 */

/** Le démon est local : au-delà, il est occupé, et on ne retient pas l'agent. */
const DELAI_MS = 3000;

const REPLI =
  'Trop tôt : ouvre d’abord la mémoire du projet avec l’outil « memoire » (geste « chercher », puis « lire »). S’il n’est pas encore chargé, charge-le avec ToolSearch (« select:mcp__beluga__memoire »), qui reste permis.';

async function lireEntree() {
  const morceaux = [];
  for await (const bout of process.stdin) morceaux.push(bout);
  return Buffer.concat(morceaux).toString('utf8');
}

async function main() {
  const brut = await lireEntree();
  const url = process.env.BELUGA_URL;
  const jeton = process.env.BELUGA_TOKEN;
  const agent = process.env.BELUGA_AGENT;
  if (!url || !jeton || !agent) return;

  let entree = {};
  try {
    entree = JSON.parse(brut || '{}');
  } catch {
    entree = {};
  }

  let reponse;
  try {
    const res = await fetch(`${url}/internal/analyse`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-beluga-token': jeton,
        'x-beluga-agent': agent,
        'x-beluga-tour': process.env.BELUGA_TOUR ?? '',
      },
      body: JSON.stringify({ outil: typeof entree?.tool_name === 'string' ? entree.tool_name : '' }),
      signal: AbortSignal.timeout(DELAI_MS),
    });
    if (!res.ok) return;
    reponse = await res.json();
  } catch {
    return;
  }
  if (reponse?.analyseFaite !== false) return;

  // Code 2 : le moteur n'exécute pas l'outil et rend ce texte à l'agent.
  process.stderr.write(`${typeof reponse.text === 'string' && reponse.text ? reponse.text : REPLI}\n`);
  process.exit(2);
}

main().catch(() => {
  // Un verrou en panne ne bloque rien.
});
