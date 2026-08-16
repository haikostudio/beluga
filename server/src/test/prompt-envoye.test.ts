import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LIGNES_VISIBLES_BULLE,
  LIGNES_VISIBLES_MEMOIRE,
  apercuDeBulle,
  bullesDuPromptEnvoye,
  demandeDuPromptEnvoye,
  donneesParallelesDuPrompt,
  mentionDesPassages,
  morceauxDuPromptEnvoye,
  nomDuMoteurEnvoye,
  texteDesPassagesRetrouves,
  texteDuPromptEnvoye,
  type SentContextSnapshot,
} from '@haikodev/shared';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function tourEssai(extra: Partial<SentContextSnapshot> = {}): SentContextSnapshot {
  return {
    engine: 'claude',
    model: 'claude-sonnet-5',
    session: 'new',
    prompt: 'DEMANDE : montre le prompt réel.',
    systemInstruction: { kind: 'full', content: 'MÉTHODE', transport: 'separate' },
    blocks: [
      { kind: 'request', label: 'Demande utilisateur', characters: 30, text: 'DEMANDE : montre le prompt réel.' },
      { kind: 'system', label: 'Rappel de méthode', characters: 7, text: 'MÉTHODE', cached: true },
      { kind: 'format', label: 'Gabarit HaikoDev', characters: 12 },
    ],
    passages: [],
    history: 'none',
    sentAt: 1_000,
    ...extra,
  } as SentContextSnapshot;
}

test('le prompt est mis à plat dans l’ordre : blocs, puis passages retrouvés', () => {
  const morceaux = morceauxDuPromptEnvoye(
    tourEssai({
      passages: [
        {
          source: 'docs/regles/cartes.md',
          titre: 'Cartes › Une carte NAÎT dans « Planifié »',
          score: 0.6,
          tokens: 120,
          texte: 'Une carte NAÎT dans « Planifié ».',
        },
      ],
    }),
  );

  assert.equal(morceaux.length, 4);
  assert.deepEqual(
    morceaux.map((m) => m.passage),
    [false, false, false, true],
  );
  assert.match(morceaux[3].label, /docs\/regles\/cartes\.md/);
  assert.match(morceaux[3].label, /Planifié/);
});

test('un bloc sans texte conservé reste dans la liste, pour le dire', () => {
  const morceaux = morceauxDuPromptEnvoye(tourEssai());
  assert.equal(morceaux[2].label, 'Gabarit HaikoDev');
  assert.equal(morceaux[2].texte, undefined);
});

test('le bloc relu au cache est signalé comme tel', () => {
  const morceaux = morceauxDuPromptEnvoye(tourEssai());
  assert.equal(morceaux[1].cached, true);
  assert.equal(morceaux[0].cached, false);
});

test('la mention dit le nombre de passages, sinon la raison écrite par le démon', () => {
  assert.equal(
    mentionDesPassages(tourEssai({ passagesRaison: 'Reprise de session : la mémoire est déjà là.' })),
    'Reprise de session : la mémoire est déjà là.',
  );
  const avec = mentionDesPassages(
    tourEssai({
      passages: [
        { source: 'a.md', titre: 'A', score: 0.5, tokens: 10, texte: 'un' },
        { source: 'b.md', titre: 'B', score: 0.4, tokens: 10, texte: 'deux' },
      ],
    }),
  );
  assert.equal(avec, '2 passages retrouvés dans la documentation');
});

test('un lot peu convaincant le dit, sans faire disparaître les passages', () => {
  const mention = mentionDesPassages(
    tourEssai({
      passages: [
        { source: 'a.md', titre: 'A', score: 0.33, tokens: 10, texte: 'un' },
        { source: 'b.md', titre: 'B', score: 0.31, tokens: 10, texte: 'deux' },
      ],
      passagesPertinents: false,
    }),
  );
  assert.equal(mention, '2 passages retrouvés dans la documentation · rien de nettement pertinent trouvé');
});

test('un lot net ne porte aucune mention de pertinence en trop', () => {
  const mention = mentionDesPassages(
    tourEssai({
      passages: [{ source: 'a.md', titre: 'A', score: 0.7, tokens: 10, texte: 'un' }],
      passagesPertinents: true,
    }),
  );
  assert.equal(mention, '1 passage retrouvé dans la documentation');
});

test('sans mesure de pertinence (contexte écrit avant cette règle), rien ne se dit', () => {
  const mention = mentionDesPassages(
    tourEssai({
      passages: [{ source: 'a.md', titre: 'A', score: 0.7, tokens: 10, texte: 'un' }],
    }),
  );
  assert.equal(mention, '1 passage retrouvé dans la documentation');
});

test('mode et pertinence se combinent dans une même mention', () => {
  const mention = mentionDesPassages(
    tourEssai({
      passages: [{ source: 'a.md', titre: 'A', score: 0.33, tokens: 10, texte: 'un' }],
      passagesMode: { sens: false, couverture: 0.53 },
      passagesPertinents: false,
    }),
  );
  assert.equal(
    mention,
    '1 passage retrouvé dans la documentation · par les MOTS · 53 % de la documentation préparée · rien de nettement pertinent trouvé',
  );
});

test('la copie rend le texte réel, jamais un bloc vide ni un chiffre de jetons', () => {
  const texte = texteDuPromptEnvoye(tourEssai());
  assert.match(texte, /Claude Code — claude-sonnet-5/);
  assert.match(texte, /DEMANDE : montre le prompt réel\./);
  assert.match(texte, /Rappel de méthode \(relu au cache\)/);
  assert.ok(!texte.includes('Gabarit HaikoDev'));
  assert.ok(!/\d+\s*(tokens?|jetons?)/i.test(texte));
});

test('chaque moteur porte son nom lisible', () => {
  assert.equal(nomDuMoteurEnvoye('claude'), 'Claude Code');
  assert.equal(nomDuMoteurEnvoye('codex'), 'Codex');
  assert.equal(nomDuMoteurEnvoye('cursor'), 'Cursor');
});

test('la conversation ne pose plus ni pastille ni tiroir : des bulles, dans le fil', () => {
  const vue = fs.readFileSync(path.join(RACINE, 'web', 'src', 'components', 'message-view.tsx'), 'utf8');
  assert.ok(!vue.includes('function ContexteEnvoye'), 'l’ancien bloc doit être retiré');
  assert.ok(!vue.includes('RepereDuPrompt'), 'l’ancienne pastille doit être retirée');
  assert.ok(vue.includes('<BullesDuPromptEnvoye'), 'les bulles se posent dans la conversation');

  const bulles = fs.readFileSync(path.join(RACINE, 'web', 'src', 'components', 'prompt-envoye.tsx'), 'utf8');
  assert.ok(bulles.includes('bullesDuPromptEnvoye'), 'l’affichage lit la règle partagée');
  assert.ok(!/<Drawer/.test(bulles), 'plus aucun tiroir à ouvrir pour lire le prompt');
  assert.ok(!bulles.includes('LecteurPrompt'), 'le fil reste simple : pas de chronologie ici');
});

/*
 * LES TROIS BULLES. Ce qui est parti au moteur se lit comme des messages de
 * l'utilisateur, alignés à droite : sa demande, la mémoire retrouvée, puis le
 * prompt complet — dans cet ordre, jamais un autre.
 */

test('les trois bulles sortent dans l’ordre demandé', () => {
  const bulles = bullesDuPromptEnvoye(
    tourEssai({
      passages: [{ source: 'docs/regles/cartes.md', titre: 'Cartes', score: 0.6, tokens: 12, texte: 'une règle' }],
    }),
  );

  assert.deepEqual(
    bulles.map((b) => b.cle),
    ['demande', 'memoire', 'complet'],
  );
  assert.equal(bulles[0].texte, 'DEMANDE : montre le prompt réel.');
  assert.match(bulles[1].texte, /docs\/regles\/cartes\.md/);
  assert.match(bulles[1].texte, /une règle/);
  assert.match(bulles[2].texte, /Claude Code — claude-sonnet-5/);
});

test('une demande déjà écrite par l’utilisateur n’est pas redite en bulle', () => {
  const bulles = bullesDuPromptEnvoye(tourEssai({ passagesRaison: 'Index complet transmis.' }), {
    demandeDejaAffichee: true,
  });
  assert.deepEqual(
    bulles.map((b) => b.cle),
    ['memoire', 'complet'],
  );
});

test('sans aucun passage, la bulle de mémoire dit la raison plutôt que de disparaître', () => {
  const bulles = bullesDuPromptEnvoye(
    tourEssai({ passagesRaison: 'Reprise de session : la mémoire est déjà là.' }),
  );
  const memoire = bulles.find((b) => b.cle === 'memoire');
  assert.equal(memoire?.texte, 'Reprise de session : la mémoire est déjà là.');
});

test('sans passage ET sans raison, aucune bulle de mémoire n’est posée', () => {
  assert.equal(texteDesPassagesRetrouves(tourEssai()), undefined);
  const bulles = bullesDuPromptEnvoye(tourEssai());
  assert.ok(!bulles.some((b) => b.cle === 'memoire'));
});

test('la bulle du prompt complet nomme ce qui est parti en même temps', () => {
  const bulles = bullesDuPromptEnvoye(
    tourEssai({
      blocks: [
        { kind: 'request', label: 'Demande utilisateur', characters: 10, text: 'fais-le' },
        { kind: 'briefing', label: 'Briefing du projet', characters: 20, text: 'projet' },
      ],
    }),
  );
  const complet = bulles.find((b) => b.cle === 'complet');
  assert.deepEqual(complet?.noms, ['Briefing du projet']);
});

/*
 * LA COUPE À CINQ LIGNES. Une bulle trop longue ne montre que ses cinq
 * premières lignes ; « voir plus » déroule le reste.
 */

test('un texte court n’est pas coupé, et ne demande pas « voir plus »', () => {
  const { apercu, tronque } = apercuDeBulle('une\ndeux\ntrois');
  assert.equal(apercu, 'une\ndeux\ntrois');
  assert.equal(tronque, false);
});

test('un texte long ne montre que ses cinq premières lignes', () => {
  const texte = Array.from({ length: 12 }, (_, i) => `ligne ${i + 1}`).join('\n');
  const { apercu, tronque } = apercuDeBulle(texte);
  assert.equal(tronque, true);
  assert.equal(apercu.split('\n').length, LIGNES_VISIBLES_BULLE);
  assert.equal(apercu.split('\n').at(-1), 'ligne 5');
});

test('exactement cinq lignes tiennent sans « voir plus »', () => {
  const texte = Array.from({ length: LIGNES_VISIBLES_BULLE }, (_, i) => `ligne ${i + 1}`).join('\n');
  assert.equal(apercuDeBulle(texte).tronque, false);
});

test('l’affichage borne aussi la hauteur, pour une ligne unique très longue', () => {
  const bulles = fs.readFileSync(path.join(RACINE, 'web', 'src', 'components', 'prompt-envoye.tsx'), 'utf8');
  assert.ok(bulles.includes('apercuDeBulle'), 'la règle pure décide de la coupe');
  assert.ok(/max-h-\[8em\]/.test(bulles), 'cinq lignes de hauteur bornent aussi le texte replié');
  assert.ok(bulles.includes('scrollHeight'), 'un texte replié par l’écran seul demande aussi « voir plus »');
  assert.ok(bulles.includes('data-voir-plus'), 'le bouton porte son repère d’écran');
});

/*
 * LA MÉMOIRE RETROUVÉE, ISOLÉE ET REPLIÉE. Elle portait le même encadré que le
 * prompt complet posé juste dessous : deux pavés collés, sans frontière, et ses
 * passages cités en entier poussaient la réponse de l'agent hors de l'écran.
 */

test('la bulle de mémoire est isolée et repliée sur trois lignes', () => {
  const bulles = bullesDuPromptEnvoye(
    tourEssai({
      passages: [
        { source: 'docs/regles/quotas.md', titre: 'Quotas', score: 0.6, tokens: 20, texte: 'une\ndeux\ntrois\nquatre' },
      ],
    }),
  );
  const memoire = bulles.find((b) => b.cle === 'memoire');
  assert.equal(memoire?.isole, true, 'elle porte son propre encadré');
  assert.equal(memoire?.lignesVisibles, LIGNES_VISIBLES_MEMOIRE);
  assert.equal(LIGNES_VISIBLES_MEMOIRE < LIGNES_VISIBLES_BULLE, true, 'plus courte que les autres bulles');
});

test('les autres bulles gardent l’encadré des messages', () => {
  const bulles = bullesDuPromptEnvoye(tourEssai());
  for (const bulle of bulles.filter((b) => b.cle !== 'memoire')) {
    assert.equal(bulle.isole, undefined, `${bulle.cle} reste une bulle de message`);
    assert.equal(bulle.lignesVisibles, undefined);
  }
});

test('l’aperçu suit le nombre de lignes demandé par la bulle', () => {
  const texte = Array.from({ length: 9 }, (_, i) => `ligne ${i + 1}`).join('\n');
  const { apercu, tronque } = apercuDeBulle(texte, LIGNES_VISIBLES_MEMOIRE);
  assert.equal(tronque, true);
  assert.equal(apercu.split('\n').length, LIGNES_VISIBLES_MEMOIRE);
});

test('l’écran isole la bulle de mémoire et l’ouvre d’un clic sur son entête', () => {
  const vue = fs.readFileSync(path.join(RACINE, 'web', 'src', 'components', 'prompt-envoye.tsx'), 'utf8');
  assert.ok(vue.includes('data-bulle-isolee'), 'la bulle isolée porte son repère d’écran');
  assert.ok(vue.includes('data-bulle-entete'), 'son entête est un bouton qui bascule');
  assert.ok(/max-h-\[4\.8em\]/.test(vue), 'trois lignes de hauteur bornent le texte replié');
  assert.ok(/bg-surface/.test(vue), 'elle ne reprend pas le gris des messages');
});

/*
 * LE TOUR SANS BULLE DE DEMANDE. Une carte lancée par un bouton n'écrit aucun
 * message d'utilisateur : le prompt envoyé est alors porté par la RÉPONSE du
 * tour, et le tiroir de la carte le montre au-dessus du déroulé.
 */

test('la demande envoyée se relit dans l’instantané, même sans bulle écrite', () => {
  assert.equal(demandeDuPromptEnvoye(tourEssai()), 'DEMANDE : montre le prompt réel.');
});

test('un bloc de demande vidé par la purge ne rend rien plutôt qu’une chaîne vide', () => {
  const purge = tourEssai({
    blocks: [{ kind: 'request', label: 'Demande utilisateur', characters: 30, text: '   ' }],
  });
  assert.equal(demandeDuPromptEnvoye(purge), undefined);
  assert.equal(demandeDuPromptEnvoye(tourEssai({ blocks: [] })), undefined);
});

test('la réponse d’un tour lancé par un bouton montre la demande au-dessus des étapes', () => {
  const vue = fs.readFileSync(path.join(RACINE, 'web', 'src', 'components', 'message-view.tsx'), 'utf8');
  const bloc = vue.lastIndexOf('<BullesDuPromptEnvoye');
  assert.ok(bloc > 0, 'les bulles doivent être posées sur la réponse');
  assert.ok(bloc < vue.indexOf('<MemoryNote'), 'elles passent avant la mémoire relue');
  assert.ok(bloc < vue.indexOf('<Steps'), 'et avant le déroulé des étapes');
});

/*
 * CE QUI EST PARTI EN MÊME TEMPS QUE LA DEMANDE. Le bloc posé au-dessus du
 * déroulé doit dire, sans rien ouvrir, ce qui a voyagé à côté du texte tapé.
 */

test('les données parallèles nomment le contexte, jamais la demande ni le gabarit', () => {
  const noms = donneesParallelesDuPrompt(
    tourEssai({
      blocks: [
        { kind: 'request', label: 'Demande utilisateur', characters: 10, text: 'fais-le' },
        { kind: 'briefing', label: 'Briefing du projet', characters: 20, text: 'projet' },
        { kind: 'memory', label: 'Index de la mémoire du projet', characters: 30, text: 'faits' },
        { kind: 'card', label: 'Carte en cours', characters: 12, text: 'carte' },
        { kind: 'format', label: 'Gabarit et séparateurs HaikoDev', characters: 8 },
      ],
    }),
  );

  assert.deepEqual(noms, ['Briefing du projet', 'Index de la mémoire du projet', 'Carte en cours']);
});

test('les passages retrouvés comptent pour une seule entrée, et un nom répété ne l’est pas', () => {
  const noms = donneesParallelesDuPrompt(
    tourEssai({
      blocks: [
        { kind: 'briefing', label: 'Briefing du projet', characters: 20, text: 'projet' },
        { kind: 'briefing', label: 'Briefing du projet', characters: 20, text: 'projet' },
      ],
      passages: [
        { source: 'a.md', titre: 'A', score: 0.5, tokens: 10, texte: 'un' },
        { source: 'b.md', titre: 'B', score: 0.4, tokens: 10, texte: 'deux' },
      ],
    }),
  );

  assert.deepEqual(noms, ['Briefing du projet', 'Passages retrouvés (2)']);
  assert.ok(!noms.some((nom) => /jetons?|tokens?/i.test(nom)));
});

test('la conversation affiche ces données parallèles dans la bulle du prompt complet', () => {
  const vue = fs.readFileSync(path.join(RACINE, 'web', 'src', 'components', 'prompt-envoye.tsx'), 'utf8');
  assert.ok(vue.includes('bulle.noms'), 'la bulle rend les noms venus de la règle partagée');
  assert.ok(vue.includes('data-donnees-paralleles'), 'et les pose sous un repère d’écran');
});

test('le prompt envoyé est conservé même quand aucun message utilisateur n’est écrit', () => {
  const runtime = fs.readFileSync(path.join(RACINE, 'server', 'src', 'runtime.ts'), 'utf8');
  assert.ok(
    runtime.includes('contexteUtilisateur?.messageId ?? assistantMessage.id'),
    'sans bulle de demande, le contexte envoyé se pose sur la réponse du tour',
  );
  assert.ok(
    !/userMessageId\s*\n?\s*\?\s*\{\s*\n\s*messageId: userMessageId,/.test(runtime),
    'le contexte envoyé ne dépend plus de l’existence d’un message utilisateur',
  );
});
