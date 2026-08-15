import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  demandeDuPromptEnvoye,
  donneesParallelesDuPrompt,
  mentionDesPassages,
  morceauxDuPromptEnvoye,
  nomDuMoteurEnvoye,
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

test('la conversation ne pose plus l’ancien bloc « Contexte envoyé » sous la demande', () => {
  const vue = fs.readFileSync(path.join(RACINE, 'web', 'src', 'components', 'message-view.tsx'), 'utf8');
  assert.ok(!vue.includes('function ContexteEnvoye'), 'l’ancien bloc doit être retiré');
  assert.ok(vue.includes('<RepereDuPrompt'), 'le repère du prompt doit être posé sous la demande');

  const repere = fs.readFileSync(path.join(RACINE, 'web', 'src', 'components', 'prompt-envoye.tsx'), 'utf8');
  assert.ok(repere.includes('morceauxDuPromptEnvoye'), 'le tiroir lit la règle partagée');
  assert.ok(!repere.includes('LecteurPrompt'), 'le tiroir du chat reste simple : pas de chronologie');
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
  const bloc = vue.indexOf('<DemandeEnvoyee');
  assert.ok(bloc > 0, 'le bloc de la demande envoyée doit être posé sur la réponse');
  assert.ok(bloc < vue.indexOf('<MemoryNote'), 'il passe avant la mémoire relue');
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

test('la conversation affiche ces données parallèles dans le bloc de la demande', () => {
  const vue = fs.readFileSync(path.join(RACINE, 'web', 'src', 'components', 'prompt-envoye.tsx'), 'utf8');
  assert.ok(vue.includes('donneesParallelesDuPrompt'), 'le bloc lit la règle partagée');
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
