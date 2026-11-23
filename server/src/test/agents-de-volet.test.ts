import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * LES AGENTS DE VOLET RESTENT DANS LEUR VOLET (incident du 06.10.2026).
 *
 * Un message écrit dans le volet Surveillance d'InVia a ouvert la carte de
 * cadrage 43a2796b : la carte de l'agent de surveillance avait été emportée
 * par une publication, donc « déjà en ligne », et seuls le Studio et le
 * Marketing étaient exemptés. Ce qui est verrouillé ici :
 *
 *  - surveillance et sauvegardes sont des agents de volet (prédicat partagé) ;
 *  - leur carte ne rejoint plus jamais le lot à publier ;
 *  - un agent de tâche ne s'inscrit plus comme conversation d'un site, et les
 *    liens déjà faits sont défaits au démarrage ;
 *  - sous une carte ORDINAIRE en ligne, aucune carte ne naît sans l'accord
 *    explicite (`ouvrirNouvelleCarte`), et jamais depuis `sendPrompt` ;
 *  - un fil qui meurt en plein tour repart avec le rappel des derniers échanges.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-de-volet-'));
process.env.BELUGA_DATA = bacASable;

const shared = await import('@beluga/shared');
const { Agent, Card, Project, estAgentDeVolet, demandeDeRepriseApresPanne, LABEL_SURVEILLANCE, LABEL_BACKUP } = shared;
const store = await import('../store.js');
const { estAgentAttitre } = await import('../agent-attitre.js');
const { deployableCards } = await import('../deploy.js');
const surveillance = await import('../surveillance.js');
const runtime = await import('../runtime.js');

const ICI = path.dirname(fileURLToPath(import.meta.url));
const lire = (fichier: string) => fs.readFileSync(path.resolve(ICI, '../../src', fichier), 'utf8');

const projet = store.saveProject(
  Project.parse({ id: 'p-volets', name: 'Volets', path: bacASable, createdAt: store.now(), updatedAt: store.now() }),
);

function carte(id: string, labels: string[], extra: Record<string, unknown> = {}) {
  return store.saveCard(
    Card.parse({ id, projectId: projet.id, title: id, column: 'archived', position: 0, labels, run: { engine: 'claude' }, createdAt: store.now(), updatedAt: store.now(), ...extra }),
  );
}
function agent(id: string, cardId: string, extra: Record<string, unknown> = {}) {
  return store.saveAgent(
    Agent.parse({ id, projectId: projet.id, role: 'task', title: id, cardId, run: { engine: 'claude' }, status: 'done', createdAt: store.now(), updatedAt: store.now(), ...extra }),
  );
}

carte('carte-surveillance', [LABEL_SURVEILLANCE], { agentId: 'agent-surveillance', deployedAt: 5_000 });
agent('agent-surveillance', 'carte-surveillance');
carte('carte-backup', [LABEL_BACKUP], { agentId: 'agent-backup' });
agent('agent-backup', 'carte-backup');
carte('carte-code', [], { agentId: 'agent-code', deployedAt: 5_000 });
agent('agent-code', 'carte-code', { workdir: '/tmp/copie-de-la-carte' });

test('le prédicat partagé : étiquette de volet, sans copie de travail, jamais un cadrage', () => {
  assert.equal(estAgentDeVolet({ role: 'task' }, { labels: [LABEL_SURVEILLANCE] }), true);
  assert.equal(estAgentDeVolet({ role: 'task' }, { labels: [LABEL_BACKUP] }), true);
  assert.equal(estAgentDeVolet({ role: 'task' }, { labels: ['studio'] }), false, 'le Studio est retiré : son ancienne étiquette ne fait plus un agent de volet');
  assert.equal(estAgentDeVolet({ role: 'analysis' }, { labels: [shared.LABEL_MARKETING] }), true);
  assert.equal(estAgentDeVolet({ role: 'cadrage' }, { labels: [LABEL_SURVEILLANCE] }), false, 'un cadrage n’en est jamais un');
  assert.equal(estAgentDeVolet({ role: 'task', workdir: '/x' }, { labels: [LABEL_SURVEILLANCE] }), false, 'une vraie tâche non plus');
  assert.equal(estAgentDeVolet({ role: 'analysis' }, { labels: ['rendez-vous-de-nuit'] }), false, 'l’auto-amélioration propose des cartes');
  assert.equal(estAgentDeVolet({ role: 'task' }, { labels: [] }), false);
  assert.equal(estAgentDeVolet(null, { labels: [LABEL_SURVEILLANCE] }), false);
});

test('surveillance et sauvegardes sont des agents attitrés, une carte de code non', () => {
  assert.equal(estAgentAttitre('agent-surveillance'), true);
  assert.equal(estAgentAttitre('agent-backup'), true);
  assert.equal(estAgentAttitre('agent-code'), false);
});

test('la carte d’un agent de volet ne rejoint jamais le lot à publier', () => {
  carte('carte-volet-a-deployer', [LABEL_SURVEILLANCE], { column: 'to_deploy', agentId: 'agent-volet-a-deployer' });
  agent('agent-volet-a-deployer', 'carte-volet-a-deployer');
  carte('carte-code-a-deployer', [], { column: 'to_deploy', agentId: 'agent-code-a-deployer' });
  agent('agent-code-a-deployer', 'carte-code-a-deployer', { workdir: '/tmp/copie' });
  const lot = deployableCards(projet.id).map((c) => c.id);
  assert.deepEqual(lot, ['carte-code-a-deployer']);
});

test('un agent de tâche ne reste pas la conversation d’un site, un agent de volet si', () => {
  const avecCode = surveillance.enregistrerSurveillance({ url: 'https://code.exemple.ch', nom: 'Code', agentId: 'agent-code', projectId: projet.id, cardId: 'carte-code' });
  const avecVolet = surveillance.enregistrerSurveillance({ url: 'https://volet.exemple.ch', nom: 'Volet', agentId: 'agent-surveillance', projectId: projet.id, cardId: 'carte-surveillance' });
  assert.ok(avecCode.ok && avecVolet.ok);
  assert.equal(surveillance.delierLesConversationsHorsVolet(estAgentAttitre), 1);
  assert.equal(surveillance.lireSurveillance(avecCode.site.id)!.agentId, undefined, 'le volet proposera un agent neuf');
  assert.equal(surveillance.lireSurveillance(avecVolet.site.id)!.agentId, 'agent-surveillance');
  assert.equal(surveillance.delierLesConversationsHorsVolet(estAgentAttitre), 0, 'idempotent');

  const outil = lire('tools.ts').split("case 'surveillance_recette': {")[1]!;
  assert.match(outil, /\.\.\.\(estAgentAttitre\(ctx\.agentId\)\s*\?\s*\{ agentId: ctx\.agentId/);
});

test('sendPrompt sous une carte ordinaire en ligne ne crée AUCUNE carte', async () => {
  const avant = store.listCards(projet.id).length;
  await runtime.sendPrompt('agent-code', 'Ajoute un bouton');
  assert.equal(store.listCards(projet.id).length, avant);
  const envoi = lire('runtime.ts').split('export async function sendPrompt(')[1]!.split('Un agent occupé ?')[0]!;
  assert.doesNotMatch(envoi, /ouvrirUneNouvelleCarteDepuis\(/);
});

test('agent.prompt : la nouvelle carte exige l’accord, un agent de volet n’y passe jamais', () => {
  const commande = lire('ws.ts').split("case 'agent.prompt': {")[1]!;
  const exemption = commande.indexOf('messageOuvreUneNouvelleCarte(carteDuFil) && !attitre');
  const refus = commande.indexOf('if (!cmd.ouvrirNouvelleCarte) throw new Error(TEXTE_ACCORD_NOUVELLE_CARTE)');
  const creation = commande.indexOf('ouvrirUneNouvelleCarteDepuis(');
  assert.ok(exemption > 0 && refus > exemption && creation > refus, 'exemption, puis refus sans accord, puis création');
  assert.ok(shared.ClientEnvelope, 'le protocole existe');
});

test('le champ d’écriture ouvre la nouvelle carte à l’envoi, sans barre d’accord, et jamais dans un volet', () => {
  const composer = fs.readFileSync(path.resolve(ICI, '../../../web/src/components/composer.tsx'), 'utf8');
  assert.match(composer, /messageOuvreUneNouvelleCarte\(carteDuChamp\) &&\s*!estAgentDeVolet\(agent, carteDuChamp\)/);
  assert.match(composer, /ouvreUneNouvelleCarte \? \{ ouvrirNouvelleCarte: true \}/);
  // Décision du 23/11/2026 : la barre « Ouvrir une nouvelle carte / Annuler » n'existe plus.
  assert.doesNotMatch(composer, /data-accord-nouvelle-carte/);
  assert.doesNotMatch(composer, /accordNouvelleCarte/);
});

test('un fil mort en plein tour repart avec le rappel des derniers échanges', () => {
  const base = { motif: 'session-morte' as const, essai: 1, promptDuTour: 'Pose le contrôle', travailCommence: false };
  const neuf = demandeDeRepriseApresPanne({ ...base, filNeuf: true, rappelDuFil: 'RÉSUMÉ — on parlait de WordPress' });
  assert.match(neuf, /RÉSUMÉ — on parlait de WordPress/);
  assert.ok(neuf.indexOf('RÉSUMÉ') < neuf.indexOf('Pose le contrôle'), 'le rappel précède la demande');
  const vivant = demandeDeRepriseApresPanne({ ...base, filNeuf: false, rappelDuFil: 'RÉSUMÉ' });
  assert.doesNotMatch(vivant, /RÉSUMÉ/, 'un fil vivant se souvient seul');
  assert.match(lire('runtime.ts'), /!filDuNouvelEssai && !nouvelleSession\s*\?\s*resumePourAgent\(agentBefore, 'fil-neuf'/);
});

/*
 * LE SERVICE D'OÙ VIENT UNE CARTE D'AGENT DE VOLET (clic qui ramène au service,
 * badge et cadre jaune) : un agent de configuration n'en est jamais un.
 */
test('serviceDeLaCarte nomme le service des agents de volet, et seulement eux', () => {
  const { serviceDeLaCarte } = shared;
  assert.equal(serviceDeLaCarte({ role: 'task' }, { labels: ['studio'] }), null, 'le Studio est retiré');
  assert.equal(serviceDeLaCarte({ role: 'analysis' }, { labels: [shared.LABEL_MARKETING] }), 'marketing');
  assert.equal(serviceDeLaCarte({ role: 'task' }, { labels: [LABEL_SURVEILLANCE] }), 'surveillance');
  assert.equal(serviceDeLaCarte({ role: 'task' }, { labels: [LABEL_BACKUP] }), 'backups');
  assert.equal(serviceDeLaCarte({ role: 'task' }, { labels: ['bibliotheque'] }), null, 'la bibliothèque de styles aussi');
  assert.equal(serviceDeLaCarte({ role: 'deploy' }, { labels: [] }), null, 'un agent de configuration reste violet');
  assert.equal(serviceDeLaCarte({ role: 'task', workdir: '/x' }, { labels: [shared.LABEL_MARKETING] }), null, 'une vraie tâche non plus');
  assert.equal(serviceDeLaCarte({ role: 'cadrage' }, { labels: [LABEL_BACKUP] }), null);
  assert.equal(serviceDeLaCarte(null, { labels: [LABEL_BACKUP] }), null);
  assert.equal(shared.serviceAUneConversation('marketing'), true);
});

/*
 * OÙ MÈNE LE CLIC SUR LA CARTE D'UN AGENT DE VOLET (`lieuDuServiceDeLaCarte`) :
 * le site pour la surveillance ; rien — donc la carte rouverte comme avant —
 * pour un élément disparu, une carte ordinaire ou un agent de configuration.
 */
test('le clic sur la carte d’un agent de volet mène à son élément, ou à rien', async () => {
  const { lieuDuServiceDeLaCarte } = await import('../service-de-carte.js');
  carte('carte-studio', ['studio'], { agentId: 'agent-studio' });
  agent('agent-studio', 'carte-studio');
  assert.equal(lieuDuServiceDeLaCarte('carte-studio'), null, 'une ancienne carte du Studio (retiré) s’ouvre comme une carte');

  const ajout = surveillance.ajouterSite('https://exemple-service.test/', 'Exemple');
  assert.ok(ajout.ok);
  carte('carte-site', [LABEL_SURVEILLANCE], { agentId: 'agent-site' });
  agent('agent-site', 'carte-site');
  surveillance.marquerAssistantSurveillance(ajout.site.id, { agentId: 'agent-site', projectId: projet.id, cardId: 'carte-site' });
  assert.deepEqual(lieuDuServiceDeLaCarte('carte-site'), { vue: 'surveillance', elementId: ajout.site.id });

  assert.equal(lieuDuServiceDeLaCarte('carte-backup'), null, 'aucune fiche de sauvegarde ne porte cet agent');
  assert.equal(lieuDuServiceDeLaCarte('carte-code'), null, 'une carte ordinaire ne mène nulle part');
  assert.equal(lieuDuServiceDeLaCarte('carte-inconnue'), null);
});
