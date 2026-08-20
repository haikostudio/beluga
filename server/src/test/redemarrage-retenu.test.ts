import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DeployRun, Project, etapeDeRedemarrageDePublication } from '@haikodev/shared';

/* ------------------------------------------------------------------ */
/* UN CORRECTIF SERVEUR QUI DORT SUR LE DISQUE N'EN EST PAS UN         */
/*                                                                     */
/* Le bogue rapporté : des cartes passaient en « Terminé » — et         */
/* partaient même en déploiement automatique — pendant que leur agent   */
/* rangeait encore son tour. Une carte avait DÉJÀ été livrée pour cela  */
/* (« une carte dont le tour range encore n'est pas une carte           */
/* oubliée »), et le comportement se reproduisait quand même.          */
/*                                                                     */
/* La cause n'était pas dans la protection, qui est juste : elle        */
/* n'avait jamais été CHARGÉE. Publier HaikoDev écrit le nouveau code   */
/* sur le disque, mais le démon en marche garde celui de son           */
/* lancement. L'étape « redémarrage » de la publication le sait, et    */
/* refuse à juste titre de couper un travail en vol — sauf qu'elle     */
/* traitait ses deux refus DIFFÉREMMENT :                              */
/*                                                                     */
/*   - une AUTRE PUBLICATION en cours faisait RETENIR le redémarrage ;  */
/*   - un AGENT AU TRAVAIL faisait simplement sauter l'étape, en        */
/*     renvoyant à un clic manuel, sans rien retenir.                  */
/*                                                                     */
/* Or un agent travaille presque toujours quand on publie : c'est la    */
/* fin de son travail qui remplit le lot. Constaté le 20/08/2026 : la   */
/* publication de 07:30 portait le correctif, son étape de             */
/* redémarrage a été sautée sur « 1 agent(s) travaillent encore », et   */
/* à 07:48 trois cartes de trois projets ont été rangées d'office par   */
/* le balayage — l'ancien code tournant toujours. L'une d'elles est     */
/* partie en déploiement automatique à 07:49, vingt minutes avant que   */
/* son agent n'ait fini.                                               */
/*                                                                     */
/* Une demande retenue est rejouée par la fin d'un tour et par la fin   */
/* d'une publication — deux `finally`. Le filet de veille la rejoue     */
/* désormais AUSSI, toutes les quinze secondes : il ne dépend de rien   */
/* de ce qu'il surveille. Ce contrôle verrouille les deux moitiés — la  */
/* demande est bien retenue, et elle part bien toute seule.             */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* 1. LA RÈGLE PURE : les deux attentes RETIENNENT                     */
/* ------------------------------------------------------------------ */

test('un agent au travail RETIENT le redémarrage, il ne le jette plus', () => {
  const etape = etapeDeRedemarrageDePublication({
    redemarrageNecessaire: true,
    agents: 1,
    agentsDetail: ['la carte « X » (projet « Y »)'],
    autresPublications: [],
  });
  assert.equal(etape.etat, 'skipped', 'on ne coupe pas un agent au travail');
  assert.equal(etape.retenir, true, 'LA RÉGRESSION : la demande doit être retenue');
  assert.match(etape.message, /RETENU/);
  assert.match(etape.message, /tout seul/, 'le message promet un départ automatique');
  assert.doesNotMatch(etape.message, /clic/, 'plus aucun renvoi vers un geste à la main');
  assert.match(etape.message, /la carte « X »/, 'et il nomme ce qui retient');
});

test('une autre publication en cours retient aussi, comme avant', () => {
  const etape = etapeDeRedemarrageDePublication({
    redemarrageNecessaire: true,
    agents: 0,
    autresPublications: ['HaikoMail'],
  });
  assert.equal(etape.etat, 'skipped');
  assert.equal(etape.retenir, true);
  assert.match(etape.message, /HaikoMail/);
});

test('la voie libre part tout de suite', () => {
  const etape = etapeDeRedemarrageDePublication({
    redemarrageNecessaire: true,
    agents: 0,
    autresPublications: [],
  });
  assert.equal(etape.etat, 'done');
  assert.equal(etape.retenir, true);
});

test('rien à recharger : rien n’est retenu, sinon on redémarrerait pour rien', () => {
  const etape = etapeDeRedemarrageDePublication({
    redemarrageNecessaire: false,
    agents: 3,
    autresPublications: ['HaikoMail'],
  });
  assert.equal(etape.etat, 'skipped');
  assert.equal(etape.retenir, false);
});

test('un agent au travail passe DEVANT une autre publication : c’est lui qu’on nomme', () => {
  const etape = etapeDeRedemarrageDePublication({
    redemarrageNecessaire: true,
    agents: 2,
    autresPublications: ['HaikoMail'],
  });
  assert.equal(etape.retenir, true);
  assert.match(etape.message, /2 agents travaillent encore/);
});

/* ------------------------------------------------------------------ */
/* 2. LE FILET REJOUE LA DEMANDE RETENUE, à chaque passage             */
/* ------------------------------------------------------------------ */

const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'redemarrage-retenu-'));
process.env.HAIKODEV_DATA = bacASable;

const store = await import('../store.js');
const demon = await import('../demon.js');
const { passageDeVeille } = await import('../scheduler.js');

const PROJET = 'projet-essai';

store.saveProject(
  Project.parse({
    id: PROJET,
    name: 'Projet d’essai',
    path: bacASable,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }),
);

/** Une publication en base, dans l'état demandé : c'est elle qui retient. */
function publication(state: DeployRun['state']): void {
  store.saveDeploy(
    DeployRun.parse({
      id: 'publication-essai',
      projectId: PROJET,
      state,
      steps: [],
      cardIds: [],
      startedAt: Date.now(),
      ...(state === 'running' ? {} : { endedAt: Date.now() }),
    }),
  );
}

/** Le vrai `process.exit`, remplacé le temps du contrôle : on ne quitte pas. */
let sorties = 0;
const vraiExit = process.exit;
// On remplace volontairement la sortie du processus, le temps du contrôle.
process.exit = (() => {
  sorties += 1;
}) as never;
test.after(() => {
  process.exit = vraiExit;
});

/** Le redémarrage part avec un léger différé (le temps que l'alerte sorte). */
async function laisserPartir(): Promise<void> {
  await new Promise((r) => setTimeout(r, 3_000));
}

test('une demande retenue par une publication ne part pas, puis part toute seule', async () => {
  publication('running');

  const demande = await demon.demanderRedemarrage();
  assert.equal(demande.ok, false, 'rien ne part sous une publication en cours');
  assert.equal(demande.enAttente, true, 'la demande est RETENUE');
  assert.equal(demon.redemarrageEstEnAttente(), true);

  // Le filet repasse : la publication tourne toujours, rien ne bouge.
  passageDeVeille();
  await laisserPartir();
  assert.equal(sorties, 0, 'le filet n’a pas coupé la publication en cours');
  assert.equal(demon.redemarrageEstEnAttente(), true, 'la demande est toujours là');

  // La publication se termine. PLUS RIEN NE TRAVAILLE : le passage suivant du
  // filet doit rejouer la demande retenue, sans attendre le `finally` de quoi
  // que ce soit.
  publication('success');
  passageDeVeille();
  await laisserPartir();
  assert.equal(sorties, 1, 'le filet a rejoué le redémarrage retenu');
  assert.equal(demon.redemarrageEstEnAttente(), false, 'la demande est retombée');
});

test('sans demande, le filet ne redémarre jamais de lui-même', async () => {
  const avant = sorties;
  passageDeVeille();
  await laisserPartir();
  assert.equal(sorties, avant, 'aucun redémarrage spontané');
});
