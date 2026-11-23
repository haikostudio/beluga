#!/usr/bin/env node
/**
 * UN TOUR PRIVÉ D'OUTILS SE REJOUE, ET LES ÉTAPES SONT BIEN CLASSÉES.
 *
 *   node scripts/verif-panne-outils.mjs
 *
 * Cinq volets, tous jugés sur les RÈGLES compilées (`shared/dist`) et sur le
 * CODE du dépôt — aucun moteur appelé, aucun agent lancé, pas un jeton dépensé.
 * Le script part du dépôt d'où il est lancé : une copie de travail juge son
 * propre code, jamais celui du dossier principal.
 *
 *  1. UN TOUR PRIVÉ D'OUTILS N'EST PAS UN TOUR RENDU — c'est l'appel abouti qui
 *     décide, jamais le texte écrit.
 *  2. DEUX REJEUX SILENCIEUX, PUIS UNE DÉCISION — le compteur d'essais est
 *     consécutif, les délais croissent, et le pont absent du disque se DIT au
 *     lieu de se rejouer trois fois pour rien.
 *  3. LA DÉCISION EST BIEN POSÉE — même sur un tour qui a « réussi ».
 *  4. LA PRESSION DE LA MACHINE EST MESURÉE ET DITE — la table des processus se
 *     remplit sans que la mémoire bouge, et elle met le lancement en file.
 *  5. UN MESSAGE HUMAIN REÇU CARTE EN COURS OUVRE SA « DEMANDE », et le bouton
 *     du plan lit la même source que le flux, en nommant sa version.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shared = await import(path.join(RACINE, 'shared/dist/index.js'));

const {
  ESSAIS_DE_PONT_MAX,
  PONT_INTROUVABLE,
  decisionDePlanOuverte,
  erreurDeTourAPoser,
  etapeDeLEntree,
  etatDuPont,
  gesteDuParcours,
  issueDuPontMort,
  phraseDeRejeuDuPont,
  pointsDuParcours,
  pressionDeProcessus,
  raisonDePontMortDefinitif,
  tourARejouerFauteDOutils,
  versionCouranteDuPlan,
} = shared;

const resultats = [];
const noter = (nom, ok, detail = '') => {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
};

/* ------------------------------------------------------------------ */
/* 1. Un tour privé d'outils n'est pas un tour rendu                    */
/* ------------------------------------------------------------------ */

console.log('\n── 1. Un tour privé d’outils n’est pas un tour rendu');

const TOUR_AVEUGLE = { pontOk: false, moteurMuet: false, echec: false };

noter(
  'un compte rendu écrit SANS le moindre outil se rejoue quand même',
  tourARejouerFauteDOutils(TOUR_AVEUGLE) === true,
);
noter(
  'un seul appel d’outil abouti suffit : le tour garde son sort ordinaire',
  tourARejouerFauteDOutils({ ...TOUR_AVEUGLE, outilAbouti: true }) === false,
);
noter(
  'un arrêt à la main l’emporte sur tout : rien n’est rejoué',
  tourARejouerFauteDOutils({ ...TOUR_AVEUGLE, arretDemande: true }) === false,
);
noter(
  'un moteur jamais joint garde sa propre route, plus précise',
  tourARejouerFauteDOutils({ ...TOUR_AVEUGLE, moteurMuet: true }) === false,
);
noter(
  'une relève de compte ou une panne du fournisseur passent devant',
  tourARejouerFauteDOutils({ ...TOUR_AVEUGLE, autreRoute: true }) === false,
);

/* ------------------------------------------------------------------ */
/* 2. Deux rejeux silencieux, puis une décision                         */
/* ------------------------------------------------------------------ */

console.log('\n── 2. Les rejeux silencieux ont un plafond, et des délais qui croissent');

const essais = [0, 1, 2, 3].map((faits) => issueDuPontMort(faits));
noter(
  `les ${ESSAIS_DE_PONT_MAX} premiers essais se rejouent en silence`,
  essais.slice(0, ESSAIS_DE_PONT_MAX).every((issue) => issue.rejouer === true),
);
const delais = essais.slice(0, ESSAIS_DE_PONT_MAX).map((issue) => issue.delaiMs);
noter(
  'le délai CROÎT d’un essai à l’autre, il ne repart pas dans le mur',
  delais.every((delai, i) => i === 0 || delai >= delais[i - 1]),
  delais.map((ms) => `${Math.round(ms / 1000)} s`).join(' → '),
);
noter(
  'au-delà du plafond, on ne rejoue plus : on DEMANDE',
  essais[ESSAIS_DE_PONT_MAX].rejouer === false && essais[ESSAIS_DE_PONT_MAX].essais === ESSAIS_DE_PONT_MAX,
);
noter(
  'la trace du rejeu dit son numéro et son plafond, pas « une erreur »',
  phraseDeRejeuDuPont(2).includes(`2 sur ${ESSAIS_DE_PONT_MAX}`),
);
noter(
  'la phrase de la décision dit le NOMBRE d’essais déjà faits',
  raisonDePontMortDefinitif(3).includes('3 essais'),
);

/* Le pont ABSENT DU DISQUE : aucun rejeu n'y changera rien, la cause se dit. */
const surLeDisque = etatDuPont({ demarre: true, outils: 12 }, false);
noter(
  'un pont introuvable sur le disque dit SA cause, devant toutes les autres',
  surLeDisque.ok === false && surLeDisque.raison === PONT_INTROUVABLE,
);
noter('un pont présent sur le disque se juge sur son passage, comme avant', etatDuPont({ demarre: true, outils: 12 }, true).ok === true);

/* ------------------------------------------------------------------ */
/* 3. La décision est bien posée, même sur un tour qui a « réussi »     */
/* ------------------------------------------------------------------ */

console.log('\n── 3. La décision « Relancer / Ignorer / Arrêter » est posée');

const SANS_ECHEC = { failed: false, reprise: false, panneDefinitive: false, moteurMuet: false };
noter(
  'trois tours sans outils posent la décision, même sans échec du moteur',
  erreurDeTourAPoser({ ...SANS_ECHEC, pontEpuise: true }) === true,
);
noter(
  'un tour ENCORE dans ses rejeux ne dérange personne',
  erreurDeTourAPoser({ ...SANS_ECHEC, pontEpuise: false }) === false,
);
noter(
  'un arrêt demandé à la main ferme la décision, pont épuisé ou non',
  erreurDeTourAPoser({ ...SANS_ECHEC, pontEpuise: true, arretDemande: true }) === false,
);

/* Et le démon la CÂBLE vraiment : le drapeau part bien de `runtime.ts`. */
const runtime = fs.readFileSync(path.join(RACINE, 'server/src/runtime.ts'), 'utf8');
noter(
  'le démon alimente `pontEpuise` au lieu de laisser le champ mort',
  /pontEpuise,\s*$/m.test(runtime) && runtime.includes('issueDuPontMort('),
);
noter(
  'la carte ne repart en file QUE pendant les rejeux (`pontMort: pontRejoue`)',
  runtime.includes('pontMort: pontRejoue'),
);
noter(
  'le rejeu laisse une trace dans le journal de la carte',
  runtime.includes('phraseDeRejeuDuPont('),
);

/* ------------------------------------------------------------------ */
/* 4. La pression de la machine, mesurée et dite                        */
/* ------------------------------------------------------------------ */

console.log('\n── 4. La table des processus est mesurée, dite, et met le lancement en file');

noter(
  'une table presque pleine suspend les départs, avec sa cause en clair',
  (() => {
    const pression = pressionDeProcessus(29_000, 30_000);
    return pression.suspendre === true && !!pression.raison && pression.partPct >= 95;
  })(),
);
noter('une table à l’aise ne suspend rien', pressionDeProcessus(1_800, 30_000).suspendre === false);
noter(
  'une machine qui ne dit pas sa limite ne se voit pas inventer un mur',
  pressionDeProcessus(1_800, 0).suspendre === false,
);

const capacity = fs.readFileSync(path.join(RACINE, 'server/src/capacity.ts'), 'utf8');
noter(
  'le démon LIT la table des processus de la machine',
  capacity.includes('/proc/loadavg') && capacity.includes('threads-max') && capacity.includes('Max processes'),
);
noter(
  'et elle suspend au même titre que la mémoire vive',
  capacity.includes('pressionFils.suspendre'),
);
/* Suspendu ne veut pas dire perdu : la porte de lancement dit sa cause, et
   `canStartAgent` la rend — c'est elle qui met la carte en file. */
noter(
  'la cause remonte à la porte de lancement, au lieu d’un échec muet',
  capacity.includes('pauseReason') && capacity.includes('pressionFils.raison'),
);

/* ------------------------------------------------------------------ */
/* 5. Le classement des étapes : demande, plan                          */
/* ------------------------------------------------------------------ */

console.log('\n── 5. Un message humain ouvre sa « Demande », et le bouton du plan nomme sa version');

const demandeEnPleinTravail = {
  id: 'e1',
  cardId: 'c1',
  rang: 1,
  phase: 'execution',
  nature: 'jalon',
  at: 1,
  libelle: 'Demande',
  agentRole: 'task',
  resultat: 'Ajoute aussi le bouton',
};
noter(
  'un message humain reçu CARTE EN COURS est classé « Demande », pas « travail »',
  etapeDeLEntree(demandeEnPleinTravail, false) === 'demande',
);

/* Et il OUVRE son passage : le flux doit le montrer, pas le noyer. */
const journal = [
  { ...demandeEnPleinTravail, id: 'j1', rang: 1, at: 1, resultat: 'Fais ceci' },
  {
    id: 'j2',
    cardId: 'c1',
    rang: 2,
    phase: 'execution',
    nature: 'requete',
    at: 2,
    libelle: 'Read',
    outil: 'Read',
    agentRole: 'task',
  },
  { ...demandeEnPleinTravail, id: 'j3', rang: 3, at: 3, resultat: 'Ajoute aussi le bouton' },
];
const points = pointsDuParcours(journal, { chapitre: 'travail', colonne: 'running', tourEnCours: true });
const passagesDemande = points.filter((point) => point.etape === 'demande');
noter(
  'deux demandes humaines ouvrent DEUX passages « Demande » dans le flux',
  passagesDemande.length === 2,
  `${passagesDemande.length} passage(s)`,
);
noter(
  'la seconde demande se lit comme une demande, pas comme une trace repliée',
  passagesDemande.at(-1)?.moments.some((moment) => moment.sorte === 'demande') === true,
);

/* Le bouton du plan et le bandeau du flux répondent la MÊME chose. */
const PLAN = { numero: 1, titre: 'P', resume: 'r', texte: '# P', at: 1 };
const contexte = {
  colonne: 'planned',
  roleAgent: 'cadrage',
  tourEnCours: false,
  messages: [
    { role: 'user', content: 'Je veux un bouton' },
    { role: 'assistant', content: 'Compris.' },
  ],
  parcours: { plans: [PLAN, { ...PLAN, numero: 2 }] },
};
const memeSource = (ctx) => {
  const geste = gesteDuParcours(ctx);
  const flux = decisionDePlanOuverte({
    estCourant: true,
    colonne: ctx.colonne,
    agentDeLaCarte: ctx.agentDeLaCarte,
    agentDuPlan: ctx.agentDuPlan,
    codeDejaEnregistre: ctx.codeDejaEnregistre,
    planValide: false,
    tourEnCours: ctx.tourEnCours,
  });
  return (geste.geste === 'valider-et-lancer') === flux;
};
noter('carte neuve : le bouton et le flux disent tous deux « à valider »', memeSource(contexte));
noter(
  'carte qui a DÉJÀ enregistré du code : ni l’un ni l’autre ne propose de valider',
  memeSource({ ...contexte, codeDejaEnregistre: true }) &&
    gesteDuParcours({ ...contexte, codeDejaEnregistre: true }).geste === 'lancer',
);
noter(
  'carte passée à un AUTRE agent que celui du plan : même réponse des deux côtés',
  memeSource({ ...contexte, agentDuPlan: 'a-cadrage', agentDeLaCarte: 'a-tache' }),
);
noter(
  'le geste NOMME la version courante du plan',
  gesteDuParcours(contexte).versionDuPlan === 2 && versionCouranteDuPlan(contexte.parcours) === 2,
);

const flux = fs.readFileSync(path.join(RACINE, 'web/src/components/parcours-carte.tsx'), 'utf8');
noter('…et l’écran l’affiche à côté du libellé', flux.includes('geste.versionDuPlan'));

/* ------------------------------------------------------------------ */

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés.`);
if (echecs.length) {
  console.log('\nCe qui ne va pas :');
  for (const e of echecs) console.log(`  · ${e.nom}`);
}
process.exit(echecs.length ? 1 : 0);
