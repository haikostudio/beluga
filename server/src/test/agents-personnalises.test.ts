import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONSIGNE_DE_L_AGENT_PERSO,
  GESTES_JAMAIS_PERMIS,
  GESTES_A_VALIDER,
  GESTES_PAR_CARTE,
  LABEL_AGENT_PERSO,
  NOM_D_UN_NOUVEL_AGENT,
  completionDeLaFiche,
  construireFragment,
  contexteDeLAgentPerso,
  compteRenduDuPassage,
  debutDuJour,
  debutDuPointDuMatin,
  declencheurLu,
  ecrireRubrique,
  estAgentDeVolet,
  etatAffiche,
  ficheComplete,
  ficheLue,
  ficheVide,
  gesteInterditDans,
  heureLocale,
  jourDeSemaineLocal,
  limiteAtteinte,
  lireFragment,
  memeEcran,
  passageHoraireDu,
  pointDuMatin,
  prochainPassageHoraire,
  resumeDuDeclencheur,
  serviceDeLaCarte,
  type FicheDAgent,
  type LigneDeJournal,
} from '@beluga/shared';

/*
 * LES AGENTS PERSONNALISÉS D'UN PROJET — les règles pures (carte « Agents personnalisés dans les projets »,
 * 24/11/2026) : la fiche en huit rubriques, les gestes verrouillés, la limite, le rythme horaire recalculé, l'état
 * affiché, le point du matin, le relais de chaque passage, et l'adresse de l'onglet « Agents ».
 */

/** Une fiche entièrement remplie. */
function ficheComplete8(): FicheDAgent {
  let fiche = ficheVide();
  const ecrire = (rubrique: string, valeur: unknown) => {
    const r = ecrireRubrique(fiche, rubrique, valeur);
    assert.equal(r.ok, true, `${rubrique} : ${r.ok ? '' : r.raison}`);
    if (r.ok) fiche = r.fiche;
  };
  ecrire('nom', 'Veilleur des demandes');
  ecrire('mission', 'Lire chaque nouvelle demande client et préparer une réponse.');
  ecrire('quand', [{ genre: 'evenement', source: 'messagerie.demande' }]);
  ecrire('seul', ['Lire la demande', 'Préparer une réponse au client']);
  ecrire('demande', ['Envoyer la réponse au client']);
  ecrire('jamais', ['Promettre un délai']);
  ecrire('emporte', { competences: ['messagerie'], acces: ['Messagerie / Brevo'], memoire: true });
  ecrire('limite', { passages: 3, periode: 'jour' });
  return fiche;
}

function ligne(date: number, genre: LigneDeJournal['genre'] = 'horaire', issue: LigneDeJournal['issue'] = 'fait', agentPersoId = 'a1'): LigneDeJournal {
  return { id: `l${date}`, agentPersoId, date, genre, issue, resume: `ligne ${date}` };
}

/** 24/11/2026 à hh:mm dans le fuseau du produit. */
function le24(h: number, m = 0): number {
  return debutDuJour('2026-11-24') + (h * 60 + m) * 60_000;
}

test('une fiche neuve est un brouillon à 0 sur 8, complète une fois les huit rubriques tranchées', () => {
  const vide = ficheVide();
  assert.equal(vide.nom, NOM_D_UN_NOUVEL_AGENT);
  assert.deepEqual(completionDeLaFiche(vide), { remplies: 0, total: 8 });
  assert.equal(ficheComplete(vide), false);
  const pleine = ficheComplete8();
  assert.deepEqual(completionDeLaFiche(pleine), { remplies: 8, total: 8 });
  assert.equal(ficheComplete(pleine), true);
  // « Aucune limite » et « il ne demande rien » sont des réponses tranchées.
  const sansLimite = ecrireRubrique({ ...pleine, demandeAccord: null, limite: null }, 'limite', 'aucune');
  assert.ok(sansLimite.ok);
  const rienADemander = sansLimite.ok ? ecrireRubrique(sansLimite.fiche, 'demande', []) : null;
  assert.ok(rienADemander?.ok);
  if (rienADemander?.ok) assert.equal(ficheComplete(rienADemander.fiche), true);
});

test('une fiche relue de la base retombe sur « à définir » pour ce qui manque ou est mal formé', () => {
  const lue = ficheLue({ nom: '  ', mission: 3, declencheurs: [{ genre: 'horaire', heure: '25:00' }, { genre: 'manuel' }], faitSeul: 'x', limite: { passages: 0 } });
  assert.equal(lue.nom, NOM_D_UN_NOUVEL_AGENT);
  assert.equal(lue.mission, '');
  assert.deepEqual(lue.declencheurs, [{ genre: 'manuel' }]);
  assert.equal(lue.faitSeul, null);
  assert.equal(lue.limite, null);
  assert.deepEqual(ficheLue(null), ficheVide());
});

test('les gestes verrouillés sont refusés dans « ce qu’il fait seul », même demandés', () => {
  assert.deepEqual([...GESTES_JAMAIS_PERMIS], ['publier', 'deployer', 'mettre_en_production', 'envoyer_au_client', 'payer', 'lancer_carte', 'modifier_code', 'supprimer']);
  const cas: Array<[string, string]> = [
    ['Publier le post du jour', 'publier'],
    ['Mettre en ligne la nouvelle version', 'deployer'],
    ['Passer en production chaque vendredi', 'mettre_en_production'],
    ['Envoyer la réponse au client', 'envoyer_au_client'],
    ['Répondre directement aux clients', 'envoyer_au_client'],
    ['Payer la facture du domaine', 'payer'],
    ['Lancer la carte de correction', 'lancer_carte'],
    ['Corriger le code du formulaire', 'modifier_code'],
    ['Supprimer les vieux fichiers', 'supprimer'],
    // Une vérification ne couvre pas le geste qui la suit.
    ['Vérifier puis publier le post', 'publier'],
    ['Lire la demande et répondre au client', 'envoyer_au_client'],
  ];
  for (const [texte, geste] of cas) assert.equal(gesteInterditDans(texte), geste, texte);
  // Préparer, proposer, lire, surveiller : permis.
  for (const permis of ['Préparer une réponse au client', 'Proposer une carte pour corriger le code', 'Lire les nouvelles demandes', 'Surveiller la mise en ligne', 'Résumer les visites']) {
    assert.equal(gesteInterditDans(permis), null, permis);
  }
  const refus = ecrireRubrique(ficheVide(), 'seul', ['Lire la demande', 'Envoyer la réponse au client sans attendre']);
  assert.equal(refus.ok, false);
  if (!refus.ok) {
    assert.match(refus.raison, /REFUSÉ/);
    // Un geste important n'est plus « jamais lui-même » : il va dans « demande » et se fait après « Valider ».
    assert.match(refus.raison, /tu le feras toi-même après le « Valider »/);
  }
  const code = ecrireRubrique(ficheVide(), 'seul', ['Corriger le code du formulaire']);
  assert.equal(code.ok, false);
  if (!code.ok) assert.match(code.raison, /se propose en carte/);
  // Deux familles qui couvrent tous les gestes, sans recouvrement.
  assert.deepEqual([...GESTES_A_VALIDER, ...GESTES_PAR_CARTE].sort(), [...GESTES_JAMAIS_PERMIS].sort());
});

test('un accès se nomme par sa fiche du coffre, jamais par sa valeur', () => {
  const refus = ecrireRubrique(ficheVide(), 'emporte', { competences: [], acces: ['sk-proj-AbCdEf1234567890abcdef1234'], memoire: false });
  assert.equal(refus.ok, false);
  const ok = ecrireRubrique(ficheVide(), 'emporte', { competences: [], acces: ['Brevo / clé API', '2f9c1d4e-1111-4222-8333-944455556666'], memoire: false });
  assert.equal(ok.ok, true);
});

test('la limite compte les passages de la période en cours, et seulement eux', () => {
  const limite = { passages: 2, periode: 'jour' as const };
  const maintenant = le24(15);
  const hier = le24(15) - 86_400_000;
  const journal = [ligne(hier), ligne(le24(8)), ligne(le24(9), 'allumage', 'note'), ligne(le24(10), 'evenement', 'ignore')];
  assert.equal(limiteAtteinte(journal, limite, maintenant), false, 'hier, une note et un événement ignoré ne comptent pas');
  assert.equal(limiteAtteinte([...journal, ligne(le24(12), 'manuel')], limite, maintenant), true);
  assert.equal(limiteAtteinte([...journal, ligne(le24(12), 'manuel')], 'aucune', maintenant), false);
  assert.equal(limiteAtteinte([...journal, ligne(le24(12), 'manuel')], null, maintenant), false);
  // La semaine part du lundi : le 24/11/2026 est un mardi.
  assert.equal(jourDeSemaineLocal(le24(12)), 2);
  const semaine = { passages: 2, periode: 'semaine' as const };
  assert.equal(limiteAtteinte([ligne(le24(8) - 86_400_000), ligne(le24(8))], semaine, maintenant), true, 'lundi et mardi comptent');
  assert.equal(limiteAtteinte([ligne(le24(8) - 2 * 86_400_000), ligne(le24(8))], semaine, maintenant), false, 'dimanche est la semaine d’avant');
});

test('le rythme horaire se recalcule : un redémarrage ne double ni ne perd un passage', () => {
  const chaqueJour = [{ genre: 'horaire' as const, rythme: 'jour' as const, heure: '08:00' }];
  const allume = le24(7) - 3 * 86_400_000;
  // 8 h 05 : dû, jamais passé depuis l'allumage d'il y a trois jours → UN passage (pas trois).
  assert.equal(passageHoraireDu(chaqueJour, null, allume, le24(8, 5)), true);
  // Le passage s'inscrit à 8 h 05 : la tournée suivante (redémarrage à 8 h 30) ne le refait pas.
  assert.equal(passageHoraireDu(chaqueJour, le24(8, 5), allume, le24(8, 30)), false);
  // Le serveur était arrêté de 7 h à 11 h : le passage de 8 h est rattrapé une fois à 11 h.
  assert.equal(passageHoraireDu(chaqueJour, le24(8) - 86_400_000 + 60_000, allume, le24(11)), true);
  // 7 h : le créneau du jour n'est pas encore passé, celui d'hier a déjà eu lieu.
  assert.equal(passageHoraireDu(chaqueJour, le24(8) - 86_400_000 + 60_000, allume, le24(7)), false);
  // Allumé à 9 h : le créneau de 8 h n'est pas rattrapé.
  assert.equal(passageHoraireDu(chaqueJour, null, le24(9), le24(10)), false);
  assert.equal(heureLocale(prochainPassageHoraire(chaqueJour, le24(10))!), 8);
});

test('week-end exclu avec report : le passage du samedi part le lundi à la même heure', () => {
  const d = declencheurLu({ genre: 'horaire', rythme: 'jour', heure: '8:00', joursExclus: [0, 6], report: true });
  assert.ok(d && d.genre === 'horaire');
  // Vendredi 27/11/2026 à 9 h : le prochain est lundi 30 à 8 h.
  const vendredi = debutDuJour('2026-11-27') + 9 * 3_600_000;
  const prochain = prochainPassageHoraire([d!], vendredi)!;
  assert.equal(prochain, debutDuJour('2026-11-30') + 8 * 3_600_000);
  assert.match(resumeDuDeclencheur(d!), /Chaque jour à 8 h, sauf dim\. sam\. \(reporté\)/);
  const hebdo = declencheurLu({ genre: 'horaire', rythme: 'semaine', heure: '09:30', jours: [1, 3] });
  assert.equal(resumeDuDeclencheur(hebdo!), 'Lun. mer. à 9 h 30');
});

test('l’état affiché : au travail, puis ce qui attend un geste, puis le brouillon, éteint, en pause, en veille', () => {
  const fiche = ficheComplete8();
  const base = { fiche, actif: true, enPassage: false, attentes: 0, enPauseLimite: false };
  assert.equal(etatAffiche(base), 'en_veille');
  assert.equal(etatAffiche({ ...base, enPassage: true, attentes: 2 }), 'au_travail');
  assert.equal(etatAffiche({ ...base, attentes: 1 }), 'a_valider');
  assert.equal(etatAffiche({ ...base, fiche: ficheVide() }), 'brouillon');
  assert.equal(etatAffiche({ ...base, actif: false }), 'eteint');
  assert.equal(etatAffiche({ ...base, enPauseLimite: true }), 'pause_limite');
});

test('le point du matin part de la veille à 18 h et cite le journal', () => {
  const maintenant = le24(8, 30);
  assert.equal(debutDuPointDuMatin(maintenant), debutDuJour('2026-11-23') + 18 * 3_600_000);
  const fiche = ficheComplete8();
  const agents = [
    { id: 'a1', fiche, actif: true, attentes: 1, enPauseLimite: false },
    { id: 'a2', fiche: { ...fiche, nom: 'Gardien' }, actif: true, attentes: 0, enPauseLimite: true },
  ];
  const journal = [
    ligne(le24(8) - 86_400_000, 'horaire', 'fait'), // avant-hier soir : hors du point
    ligne(le24(7), 'horaire', 'fait'),
    ligne(le24(7, 30), 'evenement', 'a_valider'),
    ligne(le24(6), 'horaire', 'panne', 'a2'),
    ligne(le24(6, 30), 'limite', 'pause', 'a2'),
  ];
  const point = pointDuMatin(agents, journal, maintenant);
  assert.equal(point.agentsActifs, 2);
  assert.equal(point.passages, 3);
  assert.deepEqual(point.aValider.map((a) => a.agentPersoId), ['a1']);
  assert.equal(point.faits.length, 2);
  assert.equal(point.faits[0]!.resume, `ligne ${le24(7, 30)}`, 'le plus récent d’abord');
  assert.deepEqual(point.pannes.map((p) => p.nom), ['Gardien']);
  assert.deepEqual(point.enPause.map((p) => p.nom), ['Gardien']);
});

test('chaque passage reçoit un relais complet : consigne, fiche, journal récent et événement — jamais une valeur secrète', () => {
  const fiche = ficheComplete8();
  const texte = contexteDeLAgentPerso({
    projet: 'Beluga',
    fiche,
    actif: true,
    journal: [ligne(le24(7))],
    passage: { genre: 'evenement', source: 'messagerie.demande', details: 'Nouvelle demande de Marie : « le formulaire ne marche plus »' },
  });
  assert.match(texte, /TU ES UN AGENT PERSONNALISÉ/);
  assert.match(texte, /NOM : Veilleur des demandes/);
  assert.match(texte, /GESTES À VALIDER \(capture puis « Valider » dans le fil, puis tu le fais TOI-MÊME\) : publier quoi que ce soit/);
  assert.match(texte, /GESTES PAR CARTE .*lancer une tâche, modifier le code/);
  assert.doesNotMatch(texte, /GESTES VERROUILLÉS/);
  assert.match(texte, /ligne /);
  assert.match(texte, /À chaque nouvelle demande client/);
  assert.match(texte, /le formulaire ne marche plus/);
  assert.match(texte, /Messagerie \/ Brevo/, 'le nom de la fiche du coffre, et rien d’autre');
  const brouillon = contexteDeLAgentPerso({ projet: 'Beluga', fiche: ficheVide(), actif: false, journal: [] });
  assert.match(brouillon, /EN CRÉATION/);
  assert.match(brouillon, /MISSION : À DÉFINIR/);
});

test('le compte rendu d’un passage se lit sur sa phrase marquée', () => {
  assert.deepEqual(compteRenduDuPassage('Bonjour.\n\n**Fait :** deux demandes lues.'), { resume: 'Fait : deux demandes lues.', issue: 'fait' });
  assert.equal(compteRenduDuPassage('À valider : une réponse préparée pour Marie.').issue, 'a_valider');
  assert.equal(compteRenduDuPassage('Rien à faire : aucune demande.').issue, 'ignore');
  assert.equal(compteRenduDuPassage('').resume, 'Passage terminé.');
});

test('un agent personnalisé est un agent de volet : son message ne rouvre jamais de cadrage, sa carte mène à sa page', () => {
  assert.equal(estAgentDeVolet({ role: 'task' }, { labels: [LABEL_AGENT_PERSO] }), true);
  assert.equal(estAgentDeVolet({ role: 'cadrage' }, { labels: [LABEL_AGENT_PERSO] }), false);
  assert.equal(estAgentDeVolet({ role: 'task', workdir: '/tmp/x' }, { labels: [LABEL_AGENT_PERSO] }), false);
  assert.equal(serviceDeLaCarte({ role: 'task' }, { labels: [LABEL_AGENT_PERSO] }), 'agents');
});

test('l’onglet « Agents » et la page d’un agent ont leur adresse', () => {
  assert.equal(construireFragment({ vue: 'projet', projectId: 'p1', agents: true }), 'projet/p1/agents');
  assert.equal(construireFragment({ vue: 'projet', projectId: 'p1', agents: true, agentPersoId: 'x9' }), 'projet/p1/agents/x9');
  assert.deepEqual(lireFragment('#projet/p1/agents'), { vue: 'projet', projectId: 'p1', agents: true });
  assert.deepEqual(lireFragment('#projet/p1/agents/x9'), { vue: 'projet', projectId: 'p1', agents: true, agentPersoId: 'x9' });
  assert.deepEqual(lireFragment('#projet/p1'), { vue: 'projet', projectId: 'p1' });
  // Passer des tâches aux agents est un détail d'affichage ; ouvrir un agent est une destination.
  assert.equal(memeEcran({ vue: 'projet', projectId: 'p1' }, { vue: 'projet', projectId: 'p1', agents: true }), true);
  assert.equal(memeEcran({ vue: 'projet', projectId: 'p1', agents: true }, { vue: 'projet', projectId: 'p1', agents: true, agentPersoId: 'x9' }), false);
});

test('la consigne de l’agent : le nom d’abord, l’enquête avant toute question, un diagnostic, un objectif chiffré et un plan', () => {
  const c = CONSIGNE_DE_L_AGENT_PERSO;
  // Décision du 26/11/2026 : le nom vient EN PREMIER, posé par l'agent sans question.
  const nom = c.indexOf('TON NOM D’ABORD');
  const enquete = c.indexOf('ENQUÊTE SEUL avant toute question');
  const plan = c.indexOf('DIAGNOSTIC ET UN PLAN');
  assert.ok(nom > 0 && enquete > nom && plan > enquete, 'nom, puis enquête, puis diagnostic et plan');
  assert.match(c, /sans question : écris la rubrique « nom » avec agent_fiche/);
  assert.match(c, /OBJECTIF CHIFFRÉ avec son échéance/);
  assert.match(c, /Je valide ce plan \(recommandé\)/);
  assert.match(c, /NE QUESTIONNE QUE SUR LE FOND/);
  assert.match(c, /jamais par « dites-moi si… »/);
  // L'ancien questionnaire, une rubrique après l'autre, n'existe plus.
  assert.doesNotMatch(c, /Pour chaque rubrique, PROPOSE/);
  // Proactif entre deux conversations : l'avancée de l'objectif, la suite proposée, le plan revu avec accord.
  assert.match(c, /où en est l’objectif/);
  assert.match(c, /ne réécris ta fiche qu’après son accord/);
  // L'AGENT FAIT LES GESTES LUI-MÊME (26/11/2026, capture #6b90) : plus jamais « il te reste deux clics ».
  assert.match(c, /TU FAIS LES GESTES TOI-MÊME/);
  assert.match(c, /ne demande JAMAIS à l’utilisateur de cliquer à ta place/);
  assert.match(c, /ask_user avec « validation »/);
  assert.match(c, /À « Valider », fais le geste TOI-MÊME/);
  assert.match(c, /n’est PAS une mise en ligne de projet/);
  assert.doesNotMatch(c, /JAMAIS rien toi-même — même si on te le demande/);
  // Le cadre d'avant tient : accès par nom, compte rendu marqué.
  assert.match(c, /RESTENT HORS DE TA MAIN, même demandés : modifier le code, lancer une tâche/);
  assert.match(c, /« Fait : », « À valider : »/);
});

test('la mission porte l’objectif et le plan : quelques lignes, plus une seule phrase', () => {
  const longue = 'Objectif : 4 demandes de devis par mois d’ici fin janvier. '.repeat(15);
  const r = ecrireRubrique(ficheVide(), 'mission', longue);
  assert.ok(r.ok);
  if (r.ok) assert.ok(r.fiche.mission.length > 600 && r.fiche.mission.length <= 1200);
});
