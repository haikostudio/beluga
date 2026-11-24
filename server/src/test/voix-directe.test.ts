import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BULLES_MAX,
  dernieresBulles,
  brouillonApresSynthese,
  CONSIGNE_DE_LA_VOIX,
  consigneDeLaVoix,
  CONSIGNE_DU_DIRECT,
  EFFORT_DU_DIRECT,
  MODELE_DU_DIRECT,
  PERTINENCE_MIN_DISCUSSION,
  SIGNES_MAX_PAR_TOUR,
  TOURS_MAX_PAR_DISCUSSION,
  VOIX_DU_DIRECT,
  idDeDiscussion,
  numeroDeDiscussion,
  pertinenceDUneDiscussion,
  projetsCites,
  projetsDesArguments,
  reunirLesMarques,
  sourcesDeLaMemoireCitees,
  tourAGarder,
  voixDuDirectRetenue,
  voixPermises,
  type ProjetJoignable,
} from '@beluga/shared';

/*
 * LA CONVERSATION VOCALE EN DIRECT AVEC CODEX : les règles pures (voix, marques de projet, bornes, recherche)
 * puis le flux « Discussions » sur une base à soi.
 */
const bacASable = fs.mkdtempSync(path.join(os.tmpdir(), 'voix-directe-'));
process.env.BELUGA_DATA = bacASable;

const NARVAL = { id: 'p-narval', name: 'NarvalDev' };
const FACTURE = { id: 'p-facture', name: 'FactureBox' };
const DUPONT = { id: 'p-dupont', name: 'Site du client Dupont' };
const PROJETS: ProjetJoignable[] = [NARVAL, FACTURE, DUPONT];

test('la voix réglée est gardée si le direct la propose, sinon Cove, sinon la première', () => {
  assert.equal(voixDuDirectRetenue('Maple'), 'maple');
  assert.equal(voixDuDirectRetenue('marin'), 'cove', 'une voix v2 est refusée par une session V3');
  assert.equal(voixDuDirectRetenue(undefined), 'cove');
  assert.equal(voixDuDirectRetenue('cove', ['sol', 'vale']), 'sol');
  assert.ok(!(VOIX_DU_DIRECT as readonly string[]).includes('alloy'));
});

test('la liste des voix lue chez Codex est nettoyée', () => {
  assert.deepEqual(voixPermises(['Cove', 'cove', ' sol ', 3, '', 'deux mots']), ['cove', 'sol']);
  assert.deepEqual(voixPermises(null), []);
});

test('une phrase marque TOUS les projets qu’elle cite, un seul approchant à défaut, rien dans le doute', () => {
  assert.deepEqual(projetsCites('Compare NarvalDev et FactureBox', PROJETS).sort(), ['p-facture', 'p-narval']);
  assert.deepEqual(projetsCites('où en est narval dev ?', PROJETS), ['p-narval']);
  assert.deepEqual(projetsCites('quelle heure est-il ?', PROJETS), []);
  assert.deepEqual(projetsCites('', PROJETS), []);
});

test('un appel d’outil marque le projet qu’il vise, par nom ou par identifiant', () => {
  assert.deepEqual(projetsDesArguments({ projet: 'facturebox' }, PROJETS), ['p-facture']);
  assert.deepEqual(projetsDesArguments({ projectId: 'p-dupont', projet: 'Inconnu' }, PROJETS), ['p-dupont']);
  assert.deepEqual(projetsDesArguments(null, PROJETS), []);
  assert.deepEqual(reunirLesMarques(['a'], ['b', 'a'], undefined), ['a', 'b']);
});

test('un tour gardé est resserré et borné ; un tour vide n’est pas gardé', () => {
  assert.equal(tourAGarder('  bonjour   Codex \n'), 'bonjour Codex');
  assert.equal(tourAGarder('   '), null);
  assert.equal(tourAGarder('x'.repeat(SIGNES_MAX_PAR_TOUR + 50))!.length, SIGNES_MAX_PAR_TOUR);
});

test('identifiants de discussion et sources citées', () => {
  assert.equal(idDeDiscussion(42), 'DISC-0042');
  assert.equal(numeroDeDiscussion('disc-0042'), 42);
  assert.equal(numeroDeDiscussion('MEM-0042'), null);
  assert.equal(sourcesDeLaMemoireCitees('MEM-0001 puis DEC-0002, encore MEM-0001 et DISC-0003'), 3);
});

test('la pertinence d’une discussion : mots retrouvés, et un coup de pouce au projet marqué', () => {
  const texte = 'On a parlé des relances automatiques des factures et de l’export en PDF';
  assert.ok(pertinenceDUneDiscussion('export PDF des factures', texte) >= PERTINENCE_MIN_DISCUSSION);
  assert.equal(pertinenceDUneDiscussion('météo de demain', texte), 0);
  assert.ok(pertinenceDUneDiscussion('relances clients', texte, true) > pertinenceDUneDiscussion('relances clients', texte, false));
});

test('le flux « Discussions » : tours finalisés gardés, marques réunies, recherche et lecture', async () => {
  const d = await import('../discussions-vocales.js');
  const numero = d.ouvrirDiscussion({ agentId: 'assistant', threadId: 't1', compte: 'c1' });
  assert.ok(d.ajouterTour(numero, 'user', 'Où en sont les relances de FactureBox ?', ['p-facture']));
  assert.ok(d.ajouterTour(numero, 'assistant', 'Les relances automatiques de FactureBox sont en ligne depuis jeudi.', []));
  assert.equal(d.ajouterTour(numero, 'assistant', '   '), false, 'un tour vide n’est pas écrit');
  d.marquerDiscussion(numero, ['p-narval', 'p-facture']);
  d.fermerDiscussion(numero);

  const lue = d.lireDiscussion(numero)!;
  assert.equal(lue.tours, 2);
  assert.deepEqual(lue.projets, ['p-facture', 'p-narval']);
  assert.ok(lue.fin);

  const trouvees = d.chercherDiscussions('relances FactureBox', 'p-facture');
  assert.equal(trouvees[0]?.numero, numero);
  assert.match(d.rendreDiscussionsTrouvees('relances FactureBox'), /DISC-\d{4}/);
  assert.equal(d.rendreDiscussionsTrouvees('recette de cuisine'), '');
  assert.match(d.texteDUneDiscussion(numero)!, /Utilisateur : Où en sont les relances/);

  const vide = d.ouvrirDiscussion({});
  d.fermerDiscussion(vide);
  assert.equal(d.lireDiscussion(vide), null, 'une discussion sans aucun tour est retirée');
});

test('une discussion pleine n’écrit plus, sans erreur', async () => {
  const d = await import('../discussions-vocales.js');
  const { getDb } = await import('../db.js');
  const numero = d.ouvrirDiscussion({});
  getDb().prepare('UPDATE discussions_vocales SET tours = ? WHERE id = ?').run(TOURS_MAX_PAR_DISCUSSION, numero);
  assert.equal(d.ajouterTour(numero, 'user', 'encore une phrase'), false);
});

test('le moteur et le modèle choisis à la voix deviennent le souhait de la carte', async () => {
  const { souhaitDeMoteurChoisi } = await import('../tools.js');
  assert.deepEqual(souhaitDeMoteurChoisi({ moteur: 'Codex', modele: 'gpt-x' }, { engine: 'claude' }), { engine: 'codex', model: 'gpt-x' });
  assert.deepEqual(souhaitDeMoteurChoisi({ moteur: 'codex' }, { engine: 'claude', model: 'm' }), { engine: 'codex' });
  assert.deepEqual(souhaitDeMoteurChoisi({}, { engine: 'claude' }), { engine: 'claude' });
});

test('une erreur de Codex se dit en mots courants', async () => {
  const { erreurLisible } = await import('../voix-directe.js');
  assert.match(erreurLisible('realtime conversation requires API key auth'), /refuse le direct avec ce compte/);
  assert.match(erreurLisible('rate limit reached'), /limite/);
});

test('la consigne du direct suit une méthode, sans recettes ni plafond d’appels (carte « Jarvis plus fiable et vérifié », 18/11/2026)', () => {
  // Les recettes retirées : elles faisaient répondre sans vérifier (91 demandes, mémoire ouverte une fois).
  assert.doesNotMatch(CONSIGNE_DU_DIRECT, /UN SEUL appel « assistant_resume »/);
  assert.doesNotMatch(CONSIGNE_DU_DIRECT, /deux au plus/);
  assert.doesNotMatch(CONSIGNE_DU_DIRECT, /seulement pour une question de SAVOIR/);
  // La méthode, EN TÊTE : juste après la ligne d'identité, avant les modes d'emploi d'outils.
  const lignes = CONSIGNE_DU_DIRECT.split('\n');
  assert.match(lignes[1]!, /^- TA MÉTHODE, À CHAQUE DEMANDE/);
  // Décision du 18/11/2026 (« je veux juste la réponse ») : plus de vérification d'office, plus d'étapes racontées.
  assert.doesNotMatch(CONSIGNE_DU_DIRECT, /APPELLE D’ABORD « voix_dossier »/);
  assert.doesNotMatch(CONSIGNE_DU_DIRECT, /voix_silence/);
  assert.match(CONSIGNE_DU_DIRECT, /SE RÉPOND TOUT DE SUITE, SANS AUCUN OUTIL/);
  assert.match(CONSIGNE_DU_DIRECT, /« Salut Jarvis, ça va \? » → « Ça va bien, et toi \? », sans aucun outil/);
  assert.match(CONSIGNE_DU_DIRECT, /TU NE CHERCHES QUE QUAND LA DEMANDE L’EXIGE/);
  assert.match(CONSIGNE_DU_DIRECT, /TU NE RACONTES JAMAIS ce que tu regardes/);
  assert.doesNotMatch(CONSIGNE_DU_DIRECT, /dis que tu vérifies/);
  assert.match(CONSIGNE_DU_DIRECT, /« jour »/);
  assert.match(CONSIGNE_DU_DIRECT, /update_plan/);
  assert.match(CONSIGNE_DU_DIRECT, /lister, filtrer ou explorer les outils/);
  assert.match(CONSIGNE_DU_DIRECT, /projet par projet/);
  assert.match(CONSIGNE_DU_DIRECT, /rg, grep, sqlite, shell/);
  assert.match(CONSIGNE_DU_DIRECT, /UNE réponse finale complète/);
  // Les garde-fous d'avant restent mot pour mot.
  /* La confirmation se pose en bulle (« voix_confirmer », 20/11/2026), jamais par « ask_user ». */
  assert.match(CONSIGNE_DU_DIRECT, /par « voix_confirmer » \(jamais « ask_user »/);
  // Décision du 17/11/2026 : seul ce qui ne se défait pas attend le « oui » dit à voix haute.
  assert.match(CONSIGNE_DU_DIRECT, /CE QUI NE SE DÉFAIT PAS/);
  assert.match(CONSIGNE_DU_DIRECT, /METTRE EN PRODUCTION, de PAYER, d’ÉCRIRE À UN CLIENT ou de SUPPRIMER/);
  assert.doesNotMatch(CONSIGNE_DU_DIRECT, /AUCUN GESTE QUI ENGAGE/);
  assert.match(CONSIGNE_DU_DIRECT, /SUIVI D’UNE TÂCHE/);
});

test('une tâche demandée se crée tout de suite, et rien ne passe pour fait sans outil (carte « Relier Beluga Pass dans les réglages », 16/11/2026)', () => {
  // DISC-0007 : « je note tes consignes et je m’en occupe », et aucune carte créée.
  /* Depuis le 20/11/2026 : une confirmation en bulle, puis la création. */
  assert.match(CONSIGNE_DU_DIRECT, /confirme d’abord par « voix_confirmer »/);
  assert.match(CONSIGNE_DU_DIRECT, /PUIS aussitôt « assistant_gestes » `\{ action: "valider_proposition"/);
  assert.doesNotMatch(CONSIGNE_DU_DIRECT, /qu’après un oui clair/);
  assert.match(CONSIGNE_DU_DIRECT, /JAMAIS « je m’en occupe », « je note », « c’est fait »/);
  assert.match(CONSIGNE_DU_DIRECT, /UNE seule question courte/);
  assert.match(CONSIGNE_DU_DIRECT, /« assistant_ecran »/);
  assert.match(CONSIGNE_DE_LA_VOIX, /TOUTE DEMANDE D’ACTION/);
  assert.match(CONSIGNE_DE_LA_VOIX, /ne t’est pas adressée/);
  assert.match(CONSIGNE_DE_LA_VOIX, /« toi, en veille »/);
});

test('la voix passe toute demande sur Beluga au cerveau, ne raconte rien pendant qu’il travaille, puis dit la réponse entière ; réflexion poussée', () => {
  assert.match(CONSIGNE_DE_LA_VOIX, /ne réponds JAMAIS de toi-même : passe la main à Codex/);
  assert.match(CONSIGNE_DE_LA_VOIX, /d’un seul tenant/);
  // 18/11/2026 : plus d'étapes glissées ni dites — « je veux juste la réponse ».
  assert.doesNotMatch(CONSIGNE_DE_LA_VOIX, /BELUGA TE GLISSE SES ÉTAPES/);
  assert.match(CONSIGNE_DE_LA_VOIX, /PENDANT QUE CODEX TRAVAILLE, TU NE RACONTES RIEN/);
  assert.match(CONSIGNE_DE_LA_VOIX, /UNE SEULE FOIS/);
  /* Depuis le 20/11/2026 : créer ou modifier passe par une confirmation en bulle, dite aussi à voix haute. */
  assert.match(CONSIGNE_DE_LA_VOIX, /Codex pose une confirmation en bulle que tu dis aussi à voix haute/);
  // Réflexion POUSSÉE (décision de l'utilisateur, 17/11/2026 : « le plus intelligent possible »), jamais « xhigh » à la voix.
  assert.equal(EFFORT_DU_DIRECT, 'high');
});

test('la voix du direct parle le français de France, jamais avec un accent québécois (16/11/2026)', async () => {
  const { CONSIGNE_DE_LA_VOIX, ACCENT_DE_LA_VOIX } = await import('@beluga/shared');
  assert.ok(CONSIGNE_DE_LA_VOIX.includes(ACCENT_DE_LA_VOIX));
  assert.match(ACCENT_DE_LA_VOIX, /français de FRANCE/);
  assert.match(ACCENT_DE_LA_VOIX, /jamais d’accent québécois/);
});


/* CARTE « JARVIS : VOLET, VOIX ET RAPIDITÉ » (16/11/2026). */
test('le cerveau de la voix tourne sur Sol en réflexion poussée, et la consigne donne l’appel exact d’une tâche', async () => {
  const { MODELE_DU_DIRECT } = await import('@beluga/shared');
  // Décision du 17/11/2026 : le plus puissant (Sol), « même si c'est plus cher » — vérifié accepté par l'abonnement.
  assert.equal(MODELE_DU_DIRECT, 'gpt-5.6-sol');
  // Le board_create_card raté de la session du 16/11 : « projet », « titre », « nom » au lieu de « title ».
  assert.match(CONSIGNE_DU_DIRECT, /board_create_card\(\{ title: /);
  assert.match(CONSIGNE_DU_DIRECT, /jamais « titre » ni « nom »/);
  // Les règles de moteur.
  assert.match(CONSIGNE_DU_DIRECT, /PROGRAMMATION[^;]*claude-opus-5-5[^;]*reflexion « high »/);
  assert.match(CONSIGNE_DU_DIRECT, /DEMANDE SIMPLE[^;]*claude-opus-5-5[^;]*reflexion « low »/);
  assert.match(CONSIGNE_DU_DIRECT, /GÉNÉRATION D’IMAGES → moteur « codex »/);
  // Un geste à l'écran : « chemins » puis « jouer ».
  assert.match(CONSIGNE_DU_DIRECT, /d’abord « chemins »/);
});

test('la réflexion dite à la voix suit la tâche jusqu’à ses réglages', async () => {
  const { souhaitDeMoteurChoisi } = await import('../tools.js');
  assert.deepEqual(souhaitDeMoteurChoisi({ moteur: 'claude', modele: 'claude-opus-5-5', reflexion: 'high' }, undefined), {
    engine: 'claude',
    model: 'claude-opus-5-5',
    thinking: 'high',
  });
  assert.deepEqual(souhaitDeMoteurChoisi({ moteur: 'claude', modele: 'claude-opus-5-5', reflexion: 'n’importe' }, undefined), {
    engine: 'claude',
    model: 'claude-opus-5-5',
  });
  const { reglagesDeLaProposition } = await import('@beluga/shared');
  const catalogue = [
    {
      id: 'claude',
      label: 'Claude',
      installed: true,
      comptesDisponibles: 1,
      models: [
        {
          id: 'claude-opus-5-5',
          label: 'Opus 5.5',
          thinking: ['low', 'medium', 'high'].map((id) => ({ id, label: id })),
          defaultThinking: 'medium',
        },
      ],
    },
  ] as any;
  const haut = reglagesDeLaProposition({ engine: 'claude', model: 'claude-opus-5-5', thinking: 'high', niveau: 'approfondi' } as any, catalogue);
  assert.equal(haut?.model, 'claude-opus-5-5');
  assert.equal(haut?.thinking, 'high');
  const bas = reglagesDeLaProposition({ engine: 'claude', model: 'claude-opus-5-5', thinking: 'low', niveau: 'leger' } as any, catalogue);
  assert.equal(bas?.thinking, 'low');
});

test('ce que Jarvis fait se dit en mots courants, ligne par ligne', async () => {
  const { libelleDeLActivite } = await import('@beluga/shared');
  assert.equal(libelleDeLActivite('memoire', { geste: 'chercher', demande: 'menu du téléphone' }), 'Je cherche dans la mémoire : menu du téléphone');
  assert.equal(
    libelleDeLActivite('board_create_card', { title: 'Menu du téléphone', projet: 'Toogo', moteur: 'claude', modele: 'claude-opus-5-5', reflexion: 'high' }),
    'Je crée la tâche « Menu du téléphone » · Toogo · Opus réflexion haute',
  );
  assert.equal(libelleDeLActivite('board_create_card', { title: 'Logo', moteur: 'codex' }), 'Je crée la tâche « Logo » · Codex');
  assert.equal(libelleDeLActivite('assistant_gestes', { action: 'valider_proposition' }), 'Je pose la tâche dans « Planifié »');
  assert.equal(libelleDeLActivite('assistant_ecran', { action: 'jouer', titre: 'J’ouvre le projet Beluga' }), 'J’ouvre le projet Beluga');
  assert.equal(libelleDeLActivite('assistant_resume', { jour: 'hier' }), 'Je regarde l’activité (hier)');
  assert.equal(libelleDeLActivite('update_plan', {}), null);
  assert.equal(libelleDeLActivite('outil_inconnu', {}), 'Je travaille dans Beluga');
});

test('la conversation vocale AGIT dès qu’on lui demande, et ne dit jamais « je ne peux pas » (17/11/2026)', () => {
  assert.match(CONSIGNE_DU_DIRECT, /TU AGIS/);
  assert.doesNotMatch(CONSIGNE_DU_DIRECT, /TU N’AGIS QUE SUR DEMANDE EXPLICITE/);
  assert.match(CONSIGNE_DU_DIRECT, /TU AS TOUS LES OUTILS DE BELUGA/);
  assert.match(CONSIGNE_DU_DIRECT, /« beluga_commande » « lister »/);
  assert.match(CONSIGNE_DU_DIRECT, /mcp__beluga__carte_demande/);
  assert.match(CONSIGNE_DU_DIRECT, /« assistant_ecran » sert à MONTRER/);
  assert.match(CONSIGNE_DU_DIRECT, /ton geste CONTINUE/);
  /* Plus de synthèse dans le champ (décision du 20/11/2026) : Jarvis se tait en fin de discussion. */
  assert.doesNotMatch(CONSIGNE_DU_DIRECT, /Je remplis ton champ\./);
  assert.match(CONSIGNE_DU_DIRECT, /réponds seulement « Entendu\. »/);
  assert.match(CONSIGNE_DU_DIRECT, /« c’est ok »/);
  assert.doesNotMatch(CONSIGNE_DE_LA_VOIX, /Je remplis ton champ|synthèse de l’échange sera collée/);
  assert.match(CONSIGNE_DE_LA_VOIX, /qui a TOUS les outils de Beluga/);
  assert.doesNotMatch(CONSIGNE_DE_LA_VOIX, /Sans demande d’action, n’agis pas/);
});

test('le salut est dit mot pour mot par une consigne glissée, jamais redit par la voix (18/11/2026)', async () => {
  const { consigneDuSalut } = await import('@beluga/shared');
  assert.match(consigneDuSalut('Chris'), /disant EXACTEMENT, mot pour mot et en français : « Salut Chris, je t’écoute\. »/);
  for (const c of [consigneDeLaVoix('Jarvis', 'Chris'), consigneDeLaVoix('Jarvis', 'Chris', { reprise: true })]) {
    assert.match(c, /ne le redis jamais toi-même/);
    assert.match(c, /Tu parles TOUJOURS français/);
    assert.doesNotMatch(c, /« Oui \? »/);
  }
  // Le serveur le glisse en rôle « developer » (essai réel : appendSpeech reformule) ; jamais de response.create.
  const source = fs.readFileSync(new URL('../../src/voix-directe.ts', import.meta.url), 'utf8');
  assert.match(source, /'thread\/realtime\/appendText', \{ threadId: courante\.threadId, text: consigneDuSalut\(courante\.prenom\), role: 'developer' \}/);
  assert.doesNotMatch(source, /response\.create'/);
});

test('plus de synthèse de fin ; un texte ajouté à une carte se pose à la suite du brouillon (20/11/2026)', () => {
  const source = fs.readFileSync(new URL('../../src/voix-directe.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /redigerLaSynthese|annoncer\('synthese'/);
  assert.equal(brouillonApresSynthese('', 'Ajout'), 'Ajout');
  assert.equal(brouillonApresSynthese('Mon brouillon  \n', 'Ajout'), 'Mon brouillon\n\nAjout');
  assert.equal(brouillonApresSynthese('Mon brouillon', '  '), 'Mon brouillon');
});

test('la confirmation en bulle, la carte ouverte à l’écran et le travail poursuivi pendant la veille (20/11/2026)', async () => {
  const { consigneDeLaReprise } = await import('@beluga/shared');
  assert.match(CONSIGNE_DU_DIRECT, /« voix_confirmer »/);
  assert.match(CONSIGNE_DU_DIRECT, /l’écran principal S’OUVRE DESSUS tout seul/);
  assert.match(consigneDeLaReprise('Chris', 'La carte est créée.', true), /TERMINÉ.*La carte est créée.*à Chris/);
  assert.match(consigneDeLaReprise('Chris', '', false), /de retour/);
  const source = fs.readFileSync(new URL('../../src/voix-directe.ts', import.meta.url), 'utf8');
  assert.match(source, /PLAFOND_DU_TRAVAIL_EN_VEILLE_MS = 15 \* 60_000/);
  assert.match(source, /if \(o\.garderLeTravail && courante\.travail && !courante\.serveur\.estFerme\(\)\)/);
  assert.match(source, /bus\.emit\(\{ type: 'voix\.direct\.reprendre'/);
});

test('les bulles de la voix : toute la session (soixante au plus), chaque parole écrite EN ENTIER en direct (17/11/2026)', () => {
  assert.equal(BULLES_MAX, 60);
  const fil = Array.from({ length: 64 }, (_, i) => ({ texte: i === 3 ? '' : `Tour ${i}` }));
  const bulles = dernieresBulles(fil);
  assert.equal(bulles.length, 60);
  assert.equal(bulles[59]!.texte, 'Tour 63');
  assert.equal(dernieresBulles([{ texte: '', activite: { id: 'a' } }]).length, 1);
});

test('le tour vocal est reconnu DÈS le lancement de Codex : le pont reçoit ses outils, un ancien tour reste refusé (17/11/2026)', async () => {
  const v = await import('../voix-directe.js');
  const { appelDuPontRecevable } = await import('@beluga/shared');
  // La cause racine : le pont d'outils démarre avec l'app-server, AVANT que la session soit posée.
  const source = fs.readFileSync(new URL('../../src/voix-directe.ts', import.meta.url), 'utf8');
  const demarrer = source.slice(source.indexOf('export async function demarrerLeDirect'));
  assert.ok(demarrer.indexOf('ouverture = { agentId: agent.id, tour }') >= 0, 'le tour s’enregistre à l’ouverture');
  assert.ok(
    demarrer.indexOf('ouverture = { agentId: agent.id, tour }') < demarrer.indexOf('lancerAppServer(compte.codexHome, cwd, { agentId: agent.id, tour })'),
    'le tour est connu AVANT que Codex lance son pont',
  );
  // LA RÉSERVE (17/11/2026) : Codex y est lancé avec le tour de la réserve, que la garde du pont accepte dès ce moment,
  // et qui devient celui de l'ouverture quand elle est prise — jamais une fenêtre où il serait refusé.
  assert.match(source, /lancerAppServer\(codexHome, cwd, \{ agentId: r\.agentId, tour: r\.tour \}(, cerveau)?\)/);
  assert.match(source, /return reserve && reserve\.agentId === agentId \? reserve\.tour : undefined;/);
  const prendre = source.slice(source.indexOf('async function prendreLaReserve'));
  assert.ok(prendre.indexOf('ouverture = { agentId, tour: r.tour }') < prendre.indexOf('await Promise.race'), 'le tour passe à l’ouverture avant toute attente');
  // La ligne vocale ne s'ouvre JAMAIS à l'avance : elle consommerait l'abonnement.
  const monter = source.slice(source.indexOf('function monterLaReserve'), source.indexOf('function reprendreLaReserve'));
  assert.doesNotMatch(monter, /thread\/realtime\/start/);
  assert.equal(v.tourVocalDe('agent-a'), undefined);
  v.poserLOuvertureVocalePourEssai({ agentId: 'agent-a', tour: 'voix-1' });
  try {
    const tour = v.tourVocalDe('agent-a');
    assert.equal(tour, 'voix-1');
    assert.equal(v.tourVocalDe('agent-b'), undefined, 'un autre agent n’en profite pas');
    assert.equal(appelDuPontRecevable({ tourAnnonce: 'voix-1', tourEnCours: tour }).ok, true, '/internal/pont et /internal/tools acceptés');
    assert.equal(appelDuPontRecevable({ tourAnnonce: 'voix-0', tourEnCours: tour }).ok, false, 'une configuration périmée reste refusée');
  } finally {
    v.poserLOuvertureVocalePourEssai(null);
  }
  assert.equal(v.tourVocalDe('agent-a'), undefined, 'retiré, il n’ouvre plus rien');
  // LA GRÂCE (18/11/2026) : une session close garde son tour un moment, pour le même agent et ce tour-là seulement.
  assert.match(source, /toursEnGrace\.set\(courante\.tour, \{ agentId: courante\.agentId, jusqua: Date\.now\(\) \+ GRACE_DU_TOUR_VOCAL_MS \}\)/);
  assert.match(source, /if \(tourAnnonce && toursEnGrace\.get\(tourAnnonce\)\?\.agentId === agentId\) return tourAnnonce;/);
  assert.equal(v.tourVocalDe('agent-a', 'voix-inconnu'), undefined, 'un tour jamais vu reste refusé');
});

test('un appel venu de la voix propose comme l’assistant, même depuis l’agent d’une carte', () => {
  const http = fs.readFileSync(new URL('../../src/http.ts', import.meta.url), 'utf8');
  assert.match(http, /const commeLAssistant = estAssistantGlobal\(agent\) \|\| pourLaVoix;/);
  assert.match(http, /const tools = commeLAssistant\s*\? outilsDeLAssistant/);
  assert.match(http, /pourLaVoix \? \{ voix: true \}/);
  const tools = fs.readFileSync(new URL('../../src/tools.ts', import.meta.url), 'utf8');
  assert.match(tools, /return !!ctx\.voix \|\| !!store\.getAgent\(ctx\.agentId\)\?\.assistantGlobal;/);
});

test('le salut de Jarvis à son prénom, et l’appel joué par l’écran n’a pas de bulle', async () => {
  const { salutDeJarvis } = await import('@beluga/shared');
  assert.equal(salutDeJarvis('Camille'), 'Salut Camille, je t’écoute.');
  assert.equal(salutDeJarvis(''), 'Salut, je t’écoute.');
  const { nEstQueLAppel } = await import('../voix-directe.js');
  assert.ok(nEstQueLAppel('Jarvis ?', 'Jarvis'));
  assert.ok(nEstQueLAppel('Dis Jarvis.', 'Jarvis'));
  assert.ok(!nEstQueLAppel('Jarvis, crée une tâche', 'Jarvis'));
  assert.ok(!nEstQueLAppel('Bonjour', 'Jarvis'));
});

test('la consigne sépare « en cours » de « terminé » et n’affirme rien sans résultat d’outil (17/11/2026)', () => {
  // La séparation vit dans le résumé lui-même (« déjà finies, ne sont PAS en cours », publications à part) et la
  // méthode fait primer la source vivante pour un état présent (carte « Jarvis plus fiable et vérifié », 18/11/2026).
  assert.match(CONSIGNE_DU_DIRECT, /Pour un ÉTAT présent, la source vivante \(tableau, publications\) l’emporte sur la mémoire/);
  assert.match(CONSIGNE_DU_DIRECT, /RIEN SANS PREUVE/);
  assert.match(CONSIGNE_DU_DIRECT, /qui ne vient pas de la réponse d’un outil de CE tour/);
  assert.match(CONSIGNE_DE_LA_VOIX, /n’invente jamais une tâche en cours/);
  // Le cerveau : Sol, effort poussé (décision de l'utilisateur, 17/11/2026, qui remplace « Terra, moyen »).
  assert.equal(MODELE_DU_DIRECT, 'gpt-5.6-sol');
  assert.equal(EFFORT_DU_DIRECT, 'high');
});

test('Jarvis concierge : un conseil passe par ce que Beluga sait des projets, jamais par la théorie (24/11/2026)', async () => {
  // Origine : DISC-0065 — à « comment générer du revenu avec mes projets », un tableau théorique sans un chiffre de Beluga.
  assert.doesNotMatch(CONSIGNE_DU_DIRECT, /un avis, une question générale — SE RÉPOND TOUT DE SUITE/);
  assert.match(CONSIGNE_DU_DIRECT, /un salut, un merci, une remarque, du bavardage — SE RÉPOND TOUT DE SUITE, SANS AUCUN OUTIL/);
  assert.match(CONSIGNE_DU_DIRECT, /ou un CONSEIL sur ses projets ou son activité/);
  assert.match(CONSIGNE_DU_DIRECT, /« assistant_portefeuille » réunit en UN appel/);
  assert.match(CONSIGNE_DU_DIRECT, /CE QUE BELUGA PEUT FAIRE MAINTENANT/);
  assert.match(CONSIGNE_DU_DIRECT, /jamais lancé sans « oui »/);
  // La méthode reste EN TÊTE, et l'ordre voix_souvenirs → voix_dossier attendu jusqu'au bout reste (DEC-552).
  assert.match(CONSIGNE_DU_DIRECT.split('\n')[1]!, /^- TA MÉTHODE, À CHAQUE DEMANDE/);
  assert.match(CONSIGNE_DU_DIRECT, /ATTENDS son retour complet/);
  assert.match(CONSIGNE_DU_DIRECT, /appeler un outil projet par projet en boucle/);
  for (const c of [consigneDeLaVoix('Jarvis', 'Chris'), consigneDeLaVoix('Jarvis', 'Chris', { reprise: true })]) {
    assert.doesNotMatch(c, /une question générale se répondent directement/);
    assert.match(c, /une demande de conseil, d’avis, de priorité ou de stratégie passe TOUJOURS par Codex/);
  }
  const { libelleDeLActivite } = await import('@beluga/shared');
  assert.equal(libelleDeLActivite('assistant_portefeuille', {}), 'Je fais le tour de ce que Beluga sait de chaque projet');
});
