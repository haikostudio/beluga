#!/usr/bin/env node
/**
 * UNE ÉTAPE DE PUBLICATION QUI NE REND PAS LA MAIN EST-ELLE VRAIMENT DÉBLOQUÉE ?
 *
 * La réparation des étapes savait relever ce qui TOMBE. Il lui manquait le cas
 * le plus sournois — l'étape qui ne finit JAMAIS : elle reste « en cours » avec
 * sa petite roue, indistinguable d'une étape qui travaille, et personne n'est
 * prévenu. Il fallait venir constater soi-même, vingt minutes plus tard, que
 * rien n'avançait.
 *
 * On rejoue donc le mécanisme entier, avec un dépanneur d'essai à la place de
 * l'agent et des plafonds ramenés à quelques millisecondes :
 *
 *   1. un tour d'agent qui ne rend pas la main est ARRÊTÉ à son plafond ;
 *   2. un tour qui finit à temps n'est jamais coupé — on ne casse pas ce qui
 *      travaille ;
 *   3. une étape coupée par le TEMPS nomme sa panne, appelle un dépanneur, et
 *      elle est REJOUÉE — au lieu de s'arrêter en rouge sur un silence ;
 *   4. une étape qui ne finit toujours pas s'arrête au PLAFOND de reprises :
 *      un blocage ne devient jamais une boucle ;
 *   5. le temps du DÉPANNEUR ne compte pas comme du temps d'étape, sinon un
 *      dépannage naîtrait du précédent, indéfiniment ;
 *   6. les gestes du dépanneur ne franchissent aucune des limites fermes :
 *      rien n'est mis en ligne, aucune branche n'est effacée, le service du
 *      démon HaikoDev n'est jamais touché.
 *
 * Aucun moteur n'est appelé, aucun agent réel n'est arrêté, aucune publication
 * n'est lancée : tout se passe dans une base jetable, effacée en partant.
 *
 *   npm run build:server && node scripts/verif-garde-fou-duree.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Le dépôt d'où PART ce script, jamais /root/haikodev en dur : lancé depuis une
// copie de travail, il doit juger cette copie.
const racineDuDepot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-garde-fou-duree-'));
process.env.HAIKODEV_DATA = bacASable;

const store = await import(path.join(racineDuDepot, 'server/dist/store.js'));
const { rejouerAvecDepannage, tourDAgentSousPlafond } = await import(
  path.join(racineDuDepot, 'server/dist/deploy.js')
);
const {
  DeployRun,
  REPRISES_ETAPE_MAX,
  DUREE_ATTENDUE_MS,
  PLAFOND_TOUR_D_AGENT_MS,
  constatDeDuree,
  panneDeLenteur,
  recitTourCoupe,
} = await import(path.join(racineDuDepot, 'shared/dist/index.js'));

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

function publicationDEssai() {
  return store.saveDeploy(
    DeployRun.parse({
      id: store.newId(),
      projectId: 'projet-essai',
      state: 'running',
      startedAt: Date.now(),
      steps: ['merge', 'commit', 'push', 'verify', 'build', 'publish', 'restart'].map((key) => ({
        key,
        state: 'todo',
        log: '',
      })),
    }),
  );
}

/** Un dépanneur d'essai : il compte ses appels et il ne coûte pas un jeton. */
function depanneurDEssai(aboutit = true) {
  const appels = [];
  const depanneur = async (projectId, etape, panne, sortie, passe) => {
    appels.push({ etape, panne: panne.nom, sortie, passe });
    return aboutit
      ? { tente: true, recit: '' }
      : { tente: false, recit: `reprise ${passe} : l’agent de dépannage n’a pas abouti (essai)` };
  };
  return { appels, depanneur };
}

/** La panne d'une étape qui vient d'être constatée en retard. */
function lenteurDe(etape, libelle) {
  const debut = 0;
  const constat = constatDeDuree({
    etape,
    debutMs: debut + 1,
    maintenantMs: debut + 1 + DUREE_ATTENDUE_MS[etape] * 2,
  });
  return panneDeLenteur(libelle, constat);
}

const jamais = () => new Promise(() => {});

try {
  /* ---------------------------------------------------------------- */
  /* 1. Un tour d'agent qui ne rend pas la main est ARRÊTÉ             */
  /* ---------------------------------------------------------------- */
  {
    const arretes = [];
    const debut = Date.now();
    const tour = await tourDAgentSousPlafond('agent-essai', 'mise-en-ligne', jamais, {
      plafondMs: 120,
      arreter: (id) => arretes.push(id),
    });
    const attendu = Date.now() - debut;
    noter(
      'un tour d’agent qui ne rend jamais la main est arrêté à son plafond',
      tour.depasse === true && arretes.length === 1 && arretes[0] === 'agent-essai' && attendu < 5000,
      `arrêté après ${attendu} ms, ${arretes.length} arrêt(s)`,
    );
  }

  /* ---------------------------------------------------------------- */
  /* 2. Un tour qui finit à temps n'est JAMAIS coupé                   */
  /* ---------------------------------------------------------------- */
  {
    const arretes = [];
    const tour = await tourDAgentSousPlafond(
      'agent-essai',
      'depannage',
      () => new Promise((resolve) => setTimeout(resolve, 20)),
      { plafondMs: 5000, arreter: (id) => arretes.push(id) },
    );
    noter(
      'un tour qui travaille et qui finit n’est jamais coupé',
      tour.depasse === false && arretes.length === 0,
      `${arretes.length} arrêt(s)`,
    );
  }

  /* ---------------------------------------------------------------- */
  /* 2 bis. Un tour qui ÉCHOUE rend son erreur, il ne passe pas pour   */
  /*        un dépassement                                             */
  /* ---------------------------------------------------------------- */
  {
    const arretes = [];
    const tour = await tourDAgentSousPlafond(
      'agent-essai',
      'controles',
      () => Promise.reject(new Error('le moteur a refusé la demande')),
      { plafondMs: 5000, arreter: (id) => arretes.push(id) },
    );
    noter(
      'un tour en échec reste un échec : il n’est pas confondu avec un blocage',
      tour.depasse === false && /a refusé la demande/.test(tour.erreur?.message ?? '') && arretes.length === 0,
      tour.erreur?.message ?? '(aucune erreur)',
    );
  }

  /* ---------------------------------------------------------------- */
  /* 3. Une étape coupée par le TEMPS appelle un dépanneur puis rejoue */
  /* ---------------------------------------------------------------- */
  {
    const { appels, depanneur } = depanneurDEssai();
    let tours = 0;
    const issue = await rejouerAvecDepannage(
      publicationDEssai(),
      { projectId: 'projet-essai', etape: 'publish' },
      async () => {
        tours += 1;
        // Le premier essai ne rend jamais la main (il est coupé et NOMME sa
        // panne), le second passe : c'est la mise en production débloquée.
        return tours === 1
          ? { ok: false, sortie: 'l’étape n’a pas rendu la main', panne: lenteurDe('publish', 'Mise en ligne') }
          : { ok: true, sortie: 'mise en production menée à bien' };
      },
      depanneur,
    );
    noter(
      'une étape bloquée par le temps appelle un dépanneur, puis elle est rejouée et elle passe',
      issue.ok && appels.length === 1 && issue.reprises === 1 && tours === 2,
      `${appels.length} appel(s), ${issue.reprises} reprise(s), ${tours} essai(s)`,
    );
    noter(
      'la panne envoyée au dépanneur nomme le blocage, pas un message brut',
      appels.length === 1 && /ne rend pas la main/.test(appels[0].panne),
      appels[0]?.panne ?? '(aucun appel)',
    );
    noter(
      'le déroulé garde ce qui a été tenté, en clair',
      issue.reparations.some((r) => /ne rend pas la main/.test(r)) &&
        issue.reparations.some((r) => /rejouée et elle est passée/.test(r)),
      issue.reparations.join(' | ').slice(0, 160),
    );
  }

  /* ---------------------------------------------------------------- */
  /* 4. Un blocage ne devient JAMAIS une boucle                        */
  /* ---------------------------------------------------------------- */
  {
    const { appels, depanneur } = depanneurDEssai();
    let tours = 0;
    const issue = await rejouerAvecDepannage(
      publicationDEssai(),
      { projectId: 'projet-essai', etape: 'restart' },
      async () => {
        tours += 1;
        return {
          ok: false,
          sortie: 'l’étape n’a toujours pas rendu la main',
          panne: lenteurDe('restart', 'Redémarrage du serveur'),
        };
      },
      depanneur,
    );
    noter(
      `une étape qui ne finit toujours pas s’arrête au plafond (${REPRISES_ETAPE_MAX} reprises)`,
      !issue.ok && appels.length === REPRISES_ETAPE_MAX && issue.reprises === REPRISES_ETAPE_MAX,
      `${appels.length} appel(s), ${tours} essai(s)`,
    );
    noter(
      'et le refus final le DIT : rendue telle quelle, rien n’a été forcé',
      issue.reparations.some((r) => /rendue telle quelle/.test(r) && /rien n’a été forcé/.test(r)),
      issue.reparations.join(' | ').slice(0, 160),
    );
  }

  /* ---------------------------------------------------------------- */
  /* 5. Le temps du dépanneur ne compte pas comme du temps d'étape     */
  /* ---------------------------------------------------------------- */
  {
    // L'instant `0` vaut « départ inconnu » (règle voulue : on ne devine pas) :
    // on part donc d'un instant réel.
    const depart = 1_700_000_000_000;
    const attendu = DUREE_ATTENDUE_MS.push;
    const brut = constatDeDuree({ etape: 'push', debutMs: depart, maintenantMs: depart + attendu + 60_000 });
    const net = constatDeDuree({
      etape: 'push',
      debutMs: depart,
      maintenantMs: depart + attendu + 60_000,
      // Tout sauf cinq minutes a été passé à réparer.
      tempsDeDepannageMs: attendu + 60_000 - 5 * 60_000,
    });
    noter(
      'le temps du dépanneur ne compte pas : un dépannage ne naît jamais du précédent',
      brut.depasse === true && net.depasse === false && net.ecouleMs === 5 * 60_000,
      `brut ${Math.round(brut.ecouleMs / 60_000)} min, net ${Math.round(net.ecouleMs / 60_000)} min`,
    );
  }

  /* ---------------------------------------------------------------- */
  /* 6. Les limites fermes ne bougent pas                              */
  /* ---------------------------------------------------------------- */
  {
    const panne = lenteurDe('publish', 'Mise en ligne');
    const gestes = panne.gestes.join('\n');
    noter(
      'les gestes n’autorisent JAMAIS à mettre en ligne de sa propre initiative',
      /Ne mets RIEN en ligne/.test(gestes),
      '',
    );
    noter('les gestes interdisent de toucher au service du démon HaikoDev', /démon HaikoDev/.test(gestes), '');
    noter('les gestes interdisent d’effacer une branche : aucun travail n’est perdu', /n’efface aucune branche/.test(gestes), '');
    noter(
      'les cinq tours d’agent d’une publication sont tous bornés',
      ['conflit', 'depannage', 'controles', 'construction', 'mise-en-ligne'].every(
        (m) => PLAFOND_TOUR_D_AGENT_MS[m] > 0,
      ),
      Object.entries(PLAFOND_TOUR_D_AGENT_MS)
        .map(([m, ms]) => `${m}=${Math.round(ms / 60_000)} min`)
        .join(', '),
    );
  }

  /* ---------------------------------------------------------------- */
  /* 7. LE CHEMIN DU CONFLIT DE FUSION, celui qui immobilisait         */
  /* ---------------------------------------------------------------- */
  {
    /*
     * C'est le trou que l'audit du 18/08/2026 a nommé : `resoudreConflit`
     * appelait `sendPrompt` NU, et ce contrôle n'exerçait jamais ce chemin. Un
     * agent de conflit qui ne démarrait pas laissait la fusion « en cours »
     * pour toujours — seul un clic humain sur « Arrêter » la débloquait.
     */
    const arretes = [];
    const debut = Date.now();
    const tour = await tourDAgentSousPlafond('agent-conflit-essai', 'conflit', jamais, {
      plafondMs: 120,
      arreter: (id) => arretes.push(id),
    });
    const ecoule = Date.now() - debut;
    noter(
      'un agent de résolution de conflit qui ne démarre jamais est arrêté à son plafond',
      tour.depasse === true && arretes.length === 1 && arretes[0] === 'agent-conflit-essai' && ecoule < 5000,
      `arrêté après ${ecoule} ms, ${arretes.length} arrêt(s)`,
    );

    const recit = recitTourCoupe('conflit', 15 * 60_000);
    noter(
      'et ce qui s’écrit au fil nomme l’agent du conflit, pas « l’agent de réparation »',
      /résolution du conflit/.test(recit) && /rien n’a été perdu/.test(recit),
      recit,
    );

    // Une résolution de conflit qui aboutit dans les temps n'est jamais coupée :
    // on ne casse pas une fusion en train de se recoller.
    const paisibles = [];
    const bref = await tourDAgentSousPlafond(
      'agent-conflit-essai',
      'conflit',
      () => new Promise((resolve) => setTimeout(resolve, 20)),
      { plafondMs: 5000, arreter: (id) => paisibles.push(id) },
    );
    noter(
      'une résolution de conflit qui aboutit à temps n’est jamais coupée',
      bref.depasse === false && paisibles.length === 0,
      `${paisibles.length} arrêt(s)`,
    );
  }
} finally {
  fs.rmSync(bacASable, { recursive: true, force: true });
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} contrôles passés`);
process.exit(echecs.length ? 1 : 0);
