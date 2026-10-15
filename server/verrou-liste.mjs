#!/usr/bin/env node
/**
 * LE VERROU DE LISTE, posé devant les commandes et les modifications d'un agent
 * de tâche (`shared/src/liste-obligatoire.ts`).
 *
 * À chaque appel, il demande au démon si l'action peut partir
 * (`/internal/liste`) : tant que le tour n'a pas annoncé sa liste de tâches,
 * une modification est refusée tout de suite, une commande au-delà de quelques
 * lectures aussi. Le refus est rendu à l'agent comme résultat de son outil :
 * le tour continue, l'agent annonce sa liste et relance la même action.
 *
 * Règle de prudence, la même que le verrou d'analyse : au moindre doute (démon
 * muet, tour étranger, réponse illisible), on LAISSE PASSER.
 */

/** Le démon est local : au-delà, il est occupé, et on ne retient pas l'agent. */
const DELAI_MS = 3000;

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
    const res = await fetch(`${url}/internal/liste`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-beluga-token': jeton,
        'x-beluga-agent': agent,
        'x-beluga-tour': process.env.BELUGA_TOUR ?? '',
      },
      body: JSON.stringify({
        outil: typeof entree?.tool_name === 'string' ? entree.tool_name : '',
        // Le moteur ne remplit `agent_id` que pour un SOUS-AGENT : sa liste n'est pas exigée.
        sousAgent: typeof entree?.agent_id === 'string' && entree.agent_id !== '',
      }),
      signal: AbortSignal.timeout(DELAI_MS),
    });
    if (!res.ok) return;
    reponse = await res.json();
  } catch {
    return;
  }
  if (reponse?.refuse !== true || typeof reponse.texte !== 'string' || !reponse.texte) return;

  // Code 2 : le moteur n'exécute pas l'outil et rend ce texte à l'agent.
  process.stderr.write(`${reponse.texte}\n`);
  process.exit(2);
}

main().catch(() => {
  // Un verrou en panne ne bloque rien.
});
