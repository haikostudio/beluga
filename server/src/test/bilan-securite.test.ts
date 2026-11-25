import test from 'node:test';
import assert from 'node:assert/strict';
import {
  avancementDesCorrections,
  blocDuBilanEnTexte,
  completerLeBilan,
  consigneDeCorrectionSecurite,
  carteDeCorrectionGroupee,
  contientLesMots,
  empreintesOubliees,
  historiqueEnTexte,
  lireLeBilan,
  NON_TRAITE,
  nomDeCategorie,
  noteDeSecurite,
  noteEnAlerte,
  phraseCourte,
  phraseDAudit,
  phraseDeLaNoteDeSecurite,
  rangerLeBilan,
  reperesTries,
  transitionsDeSurveillance,
  type LigneDuBilan,
} from '@beluga/shared';

/*
 * LE BILAN D'UNE CORRECTION DE SÉCURITÉ, LA NOTE ET L'HISTORIQUE DES SERVICES (carte « Sécurité : bilan, écran et
 * historique », 25/11/2026) — règles pures, sans base ni disque.
 */

const ligne = (empreinte: string, statut: LigneDuBilan['statut'], extra: Partial<LigneDuBilan> = {}): LigneDuBilan => ({
  empreinte,
  titre: `Point ${empreinte}`,
  categorie: empreinte.split(':')[0]!,
  statut,
  but: 'but',
  fait: 'fait',
  ...extra,
});

test('le bloc se lit dans un compte rendu, et un bloc illisible rend null (le texte reste du Markdown)', () => {
  const lignes = [ligne('entetes:csp', 'fait'), ligne('robots:garde', 'a-finir', { production: true })];
  const texte = `## Ce qui est fait\n\nVoici le bilan.\n\n${blocDuBilanEnTexte(lignes)}\n\n## Conséquences\nRien.`;
  const lu = lireLeBilan(texte);
  assert.equal(lu?.length, 2);
  assert.equal(lu?.[1]?.production, true);
  assert.equal(lireLeBilan('```bilan-securite\n[{"empreinte": "x:y", \n```'), null, 'JSON coupé');
  assert.equal(lireLeBilan('Pas de bloc du tout.'), null, 'bloc absent');
  assert.equal(lireLeBilan('```bilan-securite\n{"pas":"une liste"}\n```'), null, 'pas une liste');
  assert.equal(lireLeBilan('```bilan-securite\n[]\n```'), null, 'liste vide');
});

test('la lecture est tolérante : statut inconnu « à finir », doublons et lignes vides écartés, phrases coupées', () => {
  const brut = JSON.stringify([
    { empreinte: 'xss:html', titre: 'HTML', statut: 'Done', but: 'b', fait: 'x'.repeat(500) },
    { empreinte: 'xss:html', titre: 'doublon', statut: 'fait' },
    { titre: '', empreinte: '' },
    { empreinte: 'acces:mdp', statut: 'bizarre' },
    { empreinte: 'secrets:cle', statut: 'Pas fait' },
  ]);
  const lu = lireLeBilan(brut)!;
  assert.deepEqual(lu.map((l) => [l.empreinte, l.statut]), [['xss:html', 'fait'], ['acces:mdp', 'a-finir'], ['secrets:cle', 'pas-fait']]);
  assert.ok(lu[0]!.fait.length <= 220 && lu[0]!.fait.endsWith('…'));
  assert.equal(lu[1]!.categorie, 'acces', 'la catégorie se tire de l’empreinte');
  assert.equal(phraseCourte('  deux   espaces  '), 'deux espaces');
});

test('aucun point détecté ne disparaît : les oubliés s’ajoutent en « pas fait — non traité »', () => {
  const points = [
    { empreinte: 'entetes:csp', titre: 'CSP absente', categorie: 'entetes' },
    { empreinte: 'robots:ia', titre: 'IA lisent tout', categorie: 'robots' },
  ];
  assert.deepEqual(empreintesOubliees([ligne('entetes:csp', 'fait')], points), ['robots:ia']);
  const complet = completerLeBilan([ligne('entetes:csp', 'fait')], points);
  assert.equal(complet.length, 2);
  assert.deepEqual(complet[1], { empreinte: 'robots:ia', titre: 'IA lisent tout', categorie: 'robots', statut: 'pas-fait', but: '', fait: NON_TRAITE });
  assert.deepEqual(empreintesOubliees(null, points), ['entetes:csp', 'robots:ia']);
});

test('le bilan se range par statut : Pas fait, puis À finir, puis Fait, avec ses compteurs', () => {
  const range = rangerLeBilan([ligne('a:1', 'fait'), ligne('a:2', 'pas-fait'), ligne('a:3', 'a-finir'), ligne('a:4', 'fait')]);
  assert.deepEqual(range.groupes.map((g) => g.statut), ['pas-fait', 'a-finir', 'fait']);
  assert.deepEqual(range.compte, { fait: 2, 'a-finir': 1, 'pas-fait': 1, total: 4 });
  assert.deepEqual(rangerLeBilan([ligne('a:1', 'fait')]).groupes.map((g) => g.statut), ['fait'], 'les groupes vides sautent');
  assert.equal(nomDeCategorie('injection-sql'), 'Injection');
  assert.equal(nomDeCategorie('inconnue'), 'inconnue');
});

test('une seule consigne « aller au bout », reprise par la carte de correction groupée', () => {
  const consigne = consigneDeCorrectionSecurite([{ empreinte: 'entetes:csp', titre: 'CSP absente' }]);
  assert.match(consigne, /TOUS/);
  assert.match(consigne, /contournement/);
  assert.match(consigne, /geste_de_production/);
  assert.match(consigne, /bilan_securite/);
  assert.match(consigne, /\[entetes:csp\] CSP absente/);
  const carte = carteDeCorrectionGroupee('Fishflow', [
    { id: 'csp', categorie: 'entetes', gravite: 'moyenne', titre: 'CSP absente', risque: 'r', proposition: 'p', ou: [] },
  ]);
  assert.ok(carte.description.includes(consigne), 'la carte groupée porte la même consigne');
});

test('la note de sécurité : 100 moins le poids des points restants, jamais sous 0', () => {
  assert.equal(noteDeSecurite({ critique: 0, elevee: 2, moyenne: 2, faible: 4 }), 56, 'Beluga Build');
  assert.equal(noteDeSecurite({ critique: 0, elevee: 0, moyenne: 0, faible: 0 }), 100);
  assert.equal(noteDeSecurite({ critique: 3, elevee: 4, moyenne: 3, faible: 1 }), 0, 'plancher');
  assert.equal(phraseDeLaNoteDeSecurite(56), 'Protection moyenne');
  assert.equal(phraseDeLaNoteDeSecurite(90), 'Bonne protection');
  assert.equal(phraseDeLaNoteDeSecurite(70), 'Protection correcte');
  assert.equal(phraseDeLaNoteDeSecurite(39), 'Protection faible');
  assert.equal(phraseDeLaNoteDeSecurite(null), 'Pas encore notée');
  assert.equal(noteEnAlerte(39), true);
  assert.equal(noteEnAlerte(40), false);
  assert.equal(noteEnAlerte(null), false);
});

test('l’avancement des corrections : la part des points suivis déjà corrigés', () => {
  const a = avancementDesCorrections([
    ...Array.from({ length: 8 }, () => ({ etat: 'a-traiter' as const })),
    { etat: 'corrige' as const },
    { etat: 'corrige' as const },
  ]);
  assert.deepEqual(a, { corriges: 2, enCorrection: 0, aTraiter: 8, total: 10, pourcent: 20 });
  assert.equal(avancementDesCorrections([]).pourcent, null);
});

test('l’historique : transitions de surveillance, phrases d’audit, tri et texte pour l’agent', () => {
  const transitions = transitionsDeSurveillance(
    [
      { instant: 1, etat: 'ok' },
      { instant: 2, etat: 'ok' },
      { instant: 3, etat: 'panne', raison: 'injoignable' },
      { instant: 4, etat: 'panne' },
      { instant: 5, etat: 'ok' },
    ],
    'site',
  );
  assert.deepEqual(transitions.map((r) => [r.le, r.icone]), [[3, 'panne'], [5, 'retabli']], 'seules les transitions font un repère');
  assert.equal(phraseDAudit('hebdo', 9), 'Audit de la semaine · 9 points à traiter');
  assert.equal(phraseDAudit('apres-mise-en-ligne', 1), 'Audit après la mise en ligne · 1 point à traiter');
  assert.equal(phraseDAudit('manuel', 0), 'Audit à la demande · rien à traiter');
  assert.match(phraseDAudit('hebdo', null, 'npm absent'), /impossible/);
  const tries = reperesTries([
    { id: 'b', le: 20, icone: 'audit', texte: 'b' },
    { id: 'a', le: 10, icone: 'audit', texte: 'a' },
    { id: 'a', le: 10, icone: 'audit', texte: 'doublon' },
  ]);
  assert.deepEqual(tries.map((r) => r.id), ['a', 'b']);
  assert.equal(reperesTries(Array.from({ length: 10 }, (_, i) => ({ id: String(i), le: i, icone: 'audit' as const, texte: '' })), 3).length, 3);
  const texte = historiqueEnTexte([
    { genre: 'message', le: Date.UTC(2026, 10, 22, 18, 55), role: 'user', texte: 'Débloque ChatGPT' },
    { genre: 'repere', le: Date.UTC(2026, 10, 23, 23, 29), texte: 'Audit de la semaine · 8 points à traiter' },
  ]);
  assert.match(texte, /\[2026-11-22 18:55\] Utilisateur : Débloque ChatGPT/);
  assert.match(texte, /— Audit de la semaine/);
  assert.equal(contientLesMots('Débloquer ChatGPT sur le site', 'chatgpt debloquer'), true);
  assert.equal(contientLesMots('Audit', 'panne'), false);
});
