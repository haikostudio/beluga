#!/usr/bin/env node
/**
 * UNE ÉTAPE TOMBÉE NE PEUT PLUS PORTER LA PASTILLE DU SUCCÈS.
 *
 * Constat qui a produit ce contrôle : sur la capture du 19/09/2026, la ligne
 * « Étape tombée : spawn ENOTCONN … » s'affichait avec une COCHE VERTE. La
 * cause était en une ligne : `setStep` écrivait les trois issues d'une étape
 * (terminée, sautée, tombée) sous le même genre « issue », que le tiroir
 * dessine en vert. L'écran disait donc le contraire du compte rendu qu'il
 * portait — exactement ce que l'invariant « L'écran ne peut plus contredire un
 * compte rendu qu'il affiche » interdit.
 *
 * Le contrôle LIT LES SOURCES : il n'a besoin ni de navigateur, ni de démon
 * d'essai, ni d'un seul jeton, et il tient donc dans les contrôles de tous les
 * jours.
 *
 *   node scripts/verif-pastille-etat-reel.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* Le script juge le dépôt d'où il PART, jamais un chemin en dur. */
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lire = (relatif) => fs.readFileSync(path.join(RACINE, relatif), 'utf8');

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

const deploy = lire('server/src/deploy.ts');
const tiroir = lire('web/src/components/tiroir-deploiement.tsx');
const journal = lire('shared/src/journal-publication.ts');
const models = lire('shared/src/models.ts');

/* 1. Le serveur POSE l'état réel sur le moment d'issue de chaque étape. */
noter(
  'le fil d’une étape porte son état RÉEL (terminée, sautée, tombée)',
  /state === 'done' \? 'fait' : state === 'failed' \? 'echec' : state === 'skipped' \? 'saute'/.test(deploy),
  'server/src/deploy.ts, setStep',
);

/* 2. L'état est déclaré dans la règle pure ET dans le schéma qui la valide. */
noter(
  'les états « sautée » et « rattrapée » existent dans la règle partagée',
  /'saute'/.test(journal) && /'rattrape'/.test(journal),
  'shared/src/journal-publication.ts',
);
noter(
  'le schéma du fil accepte ces mêmes états, sinon la publication les perdrait',
  /z\.enum\(\['encours', 'fait', 'echec', 'saute', 'rattrape'\]\)/.test(models),
  'shared/src/models.ts',
);

/* 3. L'écran lit l'ÉTAT avant le genre — sinon le vert du genre « issue »
      reprendrait le dessus, ce qui est très exactement le défaut d'origine. */
const icone = tiroir.slice(tiroir.indexOf('function IconeMoment'), tiroir.indexOf('function bordureRondMoment'));
const rangDe = (motif) => icone.search(motif);
noter(
  'le rond d’un moment suit son état AVANT son genre',
  rangDe(/etat === 'echec'/) > 0 &&
    rangDe(/etat === 'saute'/) > 0 &&
    rangDe(/etat === 'rattrape'/) > 0 &&
    rangDe(/etat === 'echec'/) < rangDe(/genre === 'issue'/) &&
    rangDe(/etat === 'saute'/) < rangDe(/genre === 'issue'/) &&
    rangDe(/etat === 'rattrape'/) < rangDe(/genre === 'issue'/),
  'web/src/components/tiroir-deploiement.tsx, IconeMoment',
);
noter(
  'un échec se dessine en rouge, une reprise en orange — jamais en vert',
  /etat === 'echec'\) return <X className="h-2\.5 w-2\.5 text-danger"/.test(icone) &&
    /etat === 'rattrape'\) return <Wrench className="h-2\.5 w-2\.5 text-warning"/.test(icone),
  'web/src/components/tiroir-deploiement.tsx, IconeMoment',
);

/* 4. Une étape passée APRÈS une reprise se distingue d'une réussite franche. */
noter(
  'une étape rattrapée après une coupure ne se confond pas avec une réussite franche',
  /const rattrape = etat === 'done' && \(etape\?\.reprises \?\? 0\) > 0;/.test(tiroir) &&
    /etat === 'done' && rattrape\) return <Wrench className="h-3\.5 w-3\.5 text-warning"/.test(tiroir) &&
    /'data-etape-rattrapee': 'oui'/.test(tiroir),
  'web/src/components/tiroir-deploiement.tsx, EtapeDuTiroir',
);

/* 5. Aucune couleur en dur : le tiroir n'emploie que les jetons du thème. */
noter(
  'les pastilles emploient les jetons du thème, jamais une couleur écrite en dur',
  !/text-(red|green|orange|amber|emerald)-\d{3}/.test(tiroir),
  'web/src/components/tiroir-deploiement.tsx',
);

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés`);
process.exit(echecs.length ? 1 : 0);
