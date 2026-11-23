import test from 'node:test';
import assert from 'node:assert/strict';

/* ------------------------------------------------------------------ */
/* LE FICHIER D'INSTRUCTIONS NE BOUGE PLUS EN PLEINE JOURNÉE.          */
/*                                                                     */
/* Mesuré le 17/08/2026 : `CLAUDE.md` pèse 73 423 jetons, il est relu  */
/* à chacun des 62 allers-retours d'un tour de carte, et il était      */
/* réécrit 30 à 60 fois par jour — chaque réécriture faisant repayer   */
/* ces jetons au plein tarif aux agents qui démarrent ensuite.         */
/* ------------------------------------------------------------------ */

const {
  FENETRE_DE_FUSION,
  PERIODE_DE_FUSION_MS,
  SUJETS_MEMOIRE,
  ANCIENS_SUJETS,
  decisionDeFusion,
  entreeEnMarkdown,
  fichierApresFusion,
  lireEntrees,
  planDeFusion,
  PLAFOND_INSTRUCTIONS_SIGNES,
  compacterInstructions,
  contratMisDeCote,
  contratsQuiTiennent,
  rattacherHorsContrat,
  ditLaMemeChose,
  ligneDeContrat,
  secondTitreRetirable,
  retirerContrats,
} = await import('@beluga/shared');

// Les sujets qui ont un fichier de règles : tous sauf « divers », le sujet par défaut des faits.
const SUJETS = SUJETS_MEMOIRE.filter((s: { controles?: string }) => s.controles).map((s: { id: string }) => s.id);

const UNE_ENTREE = `# Instructions en attente

Le mode d'emploi, qui n'est jamais une entrée.

## Une règle apprise
- sujet : cartes
- contrat : une carte close ne rouvre jamais toute seule

Le texte entier de la règle, avec le fichier qui la porte.
`;

test("le mode d'emploi n'est pas lu comme une entrée", () => {
  const entrees = lireEntrees(UNE_ENTREE);
  assert.equal(entrees.length, 1);
  assert.equal(entrees[0].titre, 'Une règle apprise');
  assert.equal(entrees[0].sujet, 'cartes');
  assert.match(entrees[0].texte, /texte entier de la règle/);
});

test('un aller-retour par le markdown ne perd rien', () => {
  const entree = { titre: 'Titre', sujet: 'quotas', contrat: 'la ligne courte', texte: 'Le texte.' };
  const relu = lireEntrees(`# entête\n\n${entreeEnMarkdown(entree)}`);
  assert.deepEqual(relu, [entree]);
});

test('le repère de retrait se lit et se réécrit sans entrer dans le texte', () => {
  const entree = {
    titre: 'Remplacer une règle',
    sujet: 'cartes',
    retire: 'Une ancienne règle',
    contrat: 'Une nouvelle règle courte',
    texte: 'Le texte entier.',
  };
  const relu = lireEntrees(`# entête\n\n${entreeEnMarkdown(entree)}`);
  assert.deepEqual(relu, [entree]);
});

test('le retrait vise le titre normalisé, sans ressemblance', () => {
  const avant = [
    '- **La règle ancienne** — texte périmé',
    '- **La règle ancienne et proche** — texte à garder',
    'Une phrase ordinaire.',
  ].join('\n');
  const apres = retirerContrats(avant, ['LA RÈGLE ANCIENNE']);
  assert.deepEqual(apres.titresRetires, ['LA RÈGLE ANCIENNE']);
  assert.equal(apres.texte, '- **La règle ancienne et proche** — texte à garder\nUne phrase ordinaire.');
  assert.equal(retirerContrats(avant, ['Une règle absente']).texte, avant);
});

test('le retrait agit aussi sur une ligne sans gras, et laisse les voisines', () => {
  const titre = 'LE TRAVAIL PART OÙ IL Y A LE PLUS DE PLACE, pas au premier compte pas encore à 100 %';
  const avant = [
    '- Chaque hausse mesurée sur un compte n\'est attribuée qu\'une fois',
    `- ${titre}`,
    '- **Choisir le compte depuis les réglages de l\'agent**',
  ].join('\n');
  const apres = retirerContrats(avant, [titre]);
  assert.deepEqual(apres.titresRetires, [titre]);
  assert.equal(apres.texte, [avant.split('\n')[0], avant.split('\n')[2]].join('\n'));
  const plan = planDeFusion(
    lireEntrees(`## Nouvelle règle\n- sujet : quotas\n- retire : ${titre}\n- contrat : Une ligne courte\n\nTexte.\n`),
    ['quotas'],
  );
  assert.deepEqual(plan.retraits, [{ sujet: 'quotas', titre }]);
});

test('le texte va dans le sujet, et seule la ligne de contrat monte au contrat', () => {
  const plan = planDeFusion(lireEntrees(UNE_ENTREE), SUJETS);
  assert.equal(plan.parSujet.length, 1);
  assert.equal(plan.parSujet[0].sujet, 'cartes');
  assert.match(plan.parSujet[0].texte, /texte entier de la règle/);
  assert.equal(plan.contrat.length, 1);
  assert.equal(plan.contrat[0].sujet, 'cartes');
  assert.match(plan.contrat[0].ligne, /ne rouvre jamais toute seule/);
  // Le texte entier ne doit JAMAIS monter dans le contrat : c'est tout l'objet.
  assert.doesNotMatch(plan.contrat[0].ligne, /texte entier de la règle/);
});

test('une entrée de remplacement prépare à la fois le retrait et le nouveau contrat', () => {
  const plan = planDeFusion(
    lireEntrees(
      '## Remplacer une règle\n- sujet : cartes\n- retire : Une ancienne règle\n- contrat : Une nouvelle règle\n\nUn texte.\n',
    ),
    SUJETS,
  );
  assert.deepEqual(plan.retraits, [{ sujet: 'cartes', titre: 'Une ancienne règle' }]);
  assert.equal(plan.contrat.length, 1);
});

test('une entrée sans ligne de contrat ne fait pas grossir le fichier d’instructions', () => {
  const plan = planDeFusion(lireEntrees('## Sans contrat\n- sujet : voix\n\nUn texte.\n'), SUJETS);
  assert.equal(plan.parSujet.length, 1);
  assert.equal(plan.contrat.length, 0);
});

test('un sujet inconnu part au repli, en disant d’où il vient — plus jamais bloqué pour toujours', () => {
  const plan = planDeFusion(lireEntrees('## Perdue\n- sujet : cuisine\n\nUn texte.\n'), SUJETS);
  assert.equal(plan.refusees.length, 0);
  assert.equal(plan.parSujet.length, 1);
  assert.equal(plan.parSujet[0].sujet, 'methode');
  assert.match(plan.parSujet[0].texte, /Un texte\./);
  // Le déplacement se DIT : une règle de cuisine rangée dans « methode » ne
  // doit pas passer pour une règle de méthode.
  assert.match(plan.parSujet[0].texte, /« cuisine », qui n'existe pas/);
  assert.match(plan.parSujet[0].texte, /à déplacer/);
});

test('une entrée sans sujet part au repli aussi, et une entrée VIDE reste refusée', () => {
  const sansSujet = planDeFusion(lireEntrees('## Muette\n\nUn texte.\n'), SUJETS);
  assert.equal(sansSujet.refusees.length, 0);
  assert.equal(sansSujet.parSujet[0].sujet, 'methode');
  assert.match(sansSujet.parSujet[0].texte, /déposée sans sujet/);

  // Rien à ranger : là, le refus reste la seule réponse honnête.
  const sansTexte = planDeFusion(lireEntrees('## Vide\n- sujet : cartes\n'), SUJETS);
  assert.match(sansTexte.refusees[0].raison, /sans texte/);
});

test('une entrée sans corps mais avec un contrat est rangée : le contrat lui sert de texte', () => {
  const plan = planDeFusion(
    lireEntrees('## Seulement un contrat\n- sujet : cartes\n- contrat : une ligne qui dit tout\n'),
    SUJETS,
  );
  assert.equal(plan.refusees.length, 0);
  assert.equal(plan.parSujet.length, 1);
  assert.equal(plan.parSujet[0].sujet, 'cartes');
  assert.match(plan.parSujet[0].texte, /une ligne qui dit tout/);
  assert.equal(plan.contrat.length, 1);
});

test('sans sujet de repli sur le projet, le refus d’avant tient toujours', () => {
  const plan = planDeFusion(lireEntrees('## Perdue\n- sujet : cuisine\n\nUn texte.\n'), ['cartes']);
  assert.equal(plan.parSujet.length, 0);
  assert.match(plan.refusees[0].raison, /sujet inconnu/);

  const reste = fichierApresFusion(plan.refusees);
  assert.match(reste, /## Perdue/);
  assert.match(reste, /Non rangée cette nuit/);
  assert.equal(lireEntrees(reste).length, 1);
});

test('les avertissements ne s’empilent pas d’une nuit à l’autre', () => {
  // Trois nuits de suite sur un projet qui n'a pas le sujet demandé : le
  // fichier d'attente doit rendre le MÊME texte, sans un avertissement de plus.
  let fichier = '## Perdue\n- sujet : cuisine\n\nUn texte.\n';
  const tailles: number[] = [];
  for (let nuit = 0; nuit < 3; nuit++) {
    const plan = planDeFusion(lireEntrees(fichier), ['cartes']);
    fichier = fichierApresFusion(plan.refusees);
    tailles.push(fichier.length);
  }
  assert.equal(tailles[0], tailles[1]);
  assert.equal(tailles[1], tailles[2]);
  assert.equal((fichier.match(/Non rangée cette nuit/g) ?? []).length, 1);
  assert.equal(lireEntrees(fichier)[0].texte, 'Un texte.');
});

/* ------------------------------------------------------------------ */
/* LA TABLE DE CORRESPONDANCE : SUJETS DE MÉMOIRE SANS FICHIER À EUX   */
/* ------------------------------------------------------------------ */

test('un sujet de mémoire routé par la table est reconnu, sans note de repli', () => {
  const plan = planDeFusion(
    lireEntrees('## Une règle de tableau\n- sujet : tableau\n\nUn texte de tableau.\n'),
    SUJETS,
  );
  assert.equal(plan.refusees.length, 0);
  assert.equal(plan.parSujet.length, 1);
  assert.equal(plan.parSujet[0].sujet, 'cartes');
  assert.doesNotMatch(plan.parSujet[0].texte, /rangée ici par défaut/);
});

test("chaque sujet de la table de correspondance pointe vers un fichier de règles qui existe vraiment", () => {
  for (const cible of Object.values(ANCIENS_SUJETS)) {
    assert.ok(SUJETS.includes(cible), `« ${cible} » n'est pas un sujet de docs/regles/`);
  }
});

test('la table des anciens noms de sujets redirige correctement', () => {
  assert.equal(ANCIENS_SUJETS.conversation, 'interface');
  assert.equal(ANCIENS_SUJETS.tableau, 'cartes');
  assert.equal(ANCIENS_SUJETS.cadrage, 'cartes');
  assert.equal(ANCIENS_SUJETS.memoire, 'methode');
});

/* ------------------------------------------------------------------ */
/* LE PLAFOND, TENU PAR LE RANGEMENT LUI-MÊME                          */
/* ------------------------------------------------------------------ */

test('un contrat qui redit son titre ne s’écrit qu’une fois', () => {
  assert.equal(
    ligneDeContrat('Le menu du bas emprunte le fond', 'LE MENU DU BAS EMPRUNTE LE FOND DE LA ZONE'),
    '- **Le menu du bas emprunte le fond**',
  );
  assert.equal(ligneDeContrat('Un titre', ''), '- **Un titre**');
  /*
   * Une seconde moitié se garde quand elle APPREND quelque chose — un fichier,
   * une commande, une valeur, un libellé cité —, pas parce que ses mots
   * diffèrent : criée en capitales sans le moindre repère, elle ne fait que
   * renommer l'invariant du titre (`crieLeTitre`).
   */
  assert.match(
    ligneDeContrat('Un titre court', 'UNE RÈGLE ENTIÈREMENT AUTRE, PORTÉE PAR `shared/src/branches.ts`'),
    / — UNE RÈGLE/,
  );
  assert.equal(
    ligneDeContrat('Un titre court', 'UNE RÈGLE ENTIÈREMENT AUTRE SUR LES BRANCHES'),
    '- **Un titre court**',
  );
  assert.equal(ditLaMemeChose('les cartes closes', 'LES CARTES CLOSES'), true);
  assert.equal(ditLaMemeChose('les cartes closes', 'la publication du soir'), false);
});

/*
 * Constat du 06/09/2026 : un contrat déposé par un agent commence parfois par
 * son propre titre en gras (« **Une carte suspendue…** — UNE CARTE
 * SUSPENDUE… »). Ce préfixe alourdit le texte comparé et faisait chuter le
 * Jaccard et le recouvrement sous leurs seuils, laissant passer une ligne qui
 * répète son titre deux fois dans `CLAUDE.md`.
 */
test('un contrat qui commence par son propre titre en gras est décapé avant comparaison', () => {
  const titre = 'Une carte suspendue ne reste jamais affichée « En cours »';
  // La suite garde sa place parce qu'elle nomme un repère NEUF (`balayerLesCartes`) : depuis le
  // 20/09/2026, les seuls libellés « SUSPENDUE » et « EN COURS », déjà dans le titre, ne la
  // protégeraient plus — ce test-ci ne juge que le décapage du préfixe.
  const suite = '« SUSPENDUE » ET « EN COURS » NE PEUVENT PAS ÊTRE VRAIS ENSEMBLE, `balayerLesCartes` LE RÉPARE';
  assert.equal(ligneDeContrat(titre, `**${titre}** — ${suite}`), `- **${titre}** — ${suite}`);

  // Le préfixe seul, sans rien ajouter, ramène bien au titre nu.
  assert.equal(ligneDeContrat(titre, `**${titre}** — ${titre.toUpperCase()}`), `- **${titre}**`);
});

test('un contrat qui reformule son titre EN MAJUSCULES, sans un mot de plus, est repéré par recouvrement', () => {
  // Le titre est long et le contrat n'en garde qu'un sous-ensemble de mots : le Jaccard
  // (0,4 ici) ne suffit pas, mais le contrat ne dit RIEN que le titre ne disait déjà.
  const titre = 'Le rangement de nuit range les instructions par sujet précis chaque soir sans exception';
  const contrat = 'LE RANGEMENT DE NUIT RANGE LES INSTRUCTIONS';
  assert.equal(ditLaMemeChose(titre, contrat), true);
  assert.equal(ligneDeContrat(titre, contrat), `- **${titre}**`);
  // Un cas réel du contrat actuel : la reformulation ne fait que crier le titre en majuscules.
  assert.equal(
    ligneDeContrat(
      "Initier une procédure de mise en ligne n'interroge plus : l'agent analyse et tranche",
      "INITIER UNE PROCÉDURE, C'EST UNE ANALYSE, PAS UN QUESTIONNAIRE",
    ),
    "- **Initier une procédure de mise en ligne n'interroge plus : l'agent analyse et tranche**",
  );
  // Un contrat qui ajoute un fait réel (un fichier, une valeur) garde sa moitié.
  assert.match(
    ligneDeContrat('Un titre court', 'CE TITRE COURT S’APPLIQUE AUSSI À docs/regles/publication.md'),
    / — CE TITRE/,
  );
});

test('compacter le fichier d’instructions ne perd aucun invariant', () => {
  const avant = [
    '# Titre',
    '- **Une règle** — UNE RÈGLE',
    '- **Une règle** — UNE RÈGLE',
    // Une seconde moitié qui APPREND quelque chose — ici un contrôle à lancer —
    // survit au compactage ; criée sans repère, elle serait ramenée au titre.
    '- **Une autre** — UN PROPOS DIFFÉRENT, VÉRIFIÉ PAR `node scripts/verif-publication.mjs`',
    'Du texte ordinaire, laissé tel quel.',
  ].join('\n');
  const apres = compacterInstructions(avant);
  assert.equal(apres.doublons, 1);
  assert.equal(apres.compactees, 1);
  assert.ok(apres.gagnes > 0);
  assert.match(apres.texte, /- \*\*Une règle\*\*$/m);
  assert.match(apres.texte, /UN PROPOS DIFFÉRENT/);
  assert.match(apres.texte, /Du texte ordinaire, laissé tel quel\./);
  // Chaque NOM d'invariant survit : c'est la seule chose qu'on ne touche pas.
  assert.match(apres.texte, /Une autre/);
});

test('le rangement n’ajoute que les lignes qui tiennent sous le plafond', () => {
  const lignes = [
    { ligne: '- **A**'.padEnd(50, '.'), titre: 'A' },
    { ligne: '- **B**'.padEnd(50, '.'), titre: 'B' },
    { ligne: '- **C**'.padEnd(50, '.'), titre: 'C' },
  ];
  const tri = contratsQuiTiennent(0, lignes, 110);
  assert.deepEqual(tri.retenues.map((c) => c.titre), ['A', 'B']);
  assert.deepEqual(tri.debordent.map((c) => c.titre), ['C']);

  // Un fichier déjà plein n'accepte plus rien, et rien n'est tronqué.
  const plein = contratsQuiTiennent(PLAFOND_INSTRUCTIONS_SIGNES, lignes);
  assert.equal(plein.retenues.length, 0);
  assert.equal(plein.debordent.length, 3);
});

test('un invariant que le plafond écarte porte un marqueur court dans le fichier de son sujet', () => {
  const note = contratMisDeCote({ titre: 'Une règle tardive', ligne: '- **Une règle tardive**' });
  assert.match(note, /_\(hors contrat\)_/);
  assert.ok(note.length < 40, 'le marqueur doit rester court, pas la phrase complète recopiée à chaque invariant');
});

test('le marqueur se colle à la suite immédiate de SA règle, pas en bloc à part', () => {
  const texte = '\n- **Règle A** — Texte de A.\n\n- **Règle B** — Texte de B.\n';
  const apres = rattacherHorsContrat(texte, 'Règle A');
  assert.match(apres, /Texte de A\.\n\n  _\(hors contrat\)_\n\n- \*\*Règle B\*\*/);
  assert.doesNotMatch(apres, /Texte de B\.\n\n  _\(hors contrat\)_/);
});

test('deux règles écartées du même sujet ne collent jamais leurs marqueurs l’un à l’autre', () => {
  let texte = '\n- **Règle A** — Texte de A.\n\n- **Règle B** — Texte de B.\n';
  texte = rattacherHorsContrat(texte, 'Règle A');
  texte = rattacherHorsContrat(texte, 'Règle B');
  assert.doesNotMatch(texte, /_\(hors contrat\)_\s*\n\s*\n\s*_\(hors contrat\)_/);
  assert.match(texte, /Texte de A\.\n\n  _\(hors contrat\)_\n\n- \*\*Règle B\*\* — Texte de B\.\n\n  _\(hors contrat\)_/);
});

test('rien en attente : le fichier d’instructions ne bouge pas', () => {
  const decision = decisionDeFusion({ maintenant: new Date(2026, 7, 18, 3), entreesEnAttente: 0 });
  assert.equal(decision.fusionner, false);
  assert.match(decision.raison, /rien en attente/);
});

test('le rangement attend la nuit', () => {
  const jour = decisionDeFusion({ maintenant: new Date(2026, 7, 18, 14), entreesEnAttente: 2 });
  assert.equal(jour.fusionner, false);
  assert.match(jour.raison, /fenêtre/);

  const nuit = decisionDeFusion({ maintenant: new Date(2026, 7, 18, FENETRE_DE_FUSION.debut), entreesEnAttente: 2 });
  assert.equal(nuit.fusionner, true);
});

test('une seule fois par nuit', () => {
  const maintenant = new Date(2026, 7, 18, 3);
  const dejaFait = decisionDeFusion({
    maintenant,
    derniereFusionA: maintenant.getTime() - 60_000,
    entreesEnAttente: 2,
  });
  assert.equal(dejaFait.fusionner, false);
  assert.match(dejaFait.raison, /déjà rangé/);

  const nuitSuivante = decisionDeFusion({
    maintenant,
    derniereFusionA: maintenant.getTime() - PERIODE_DE_FUSION_MS - 1,
    entreesEnAttente: 2,
  });
  assert.equal(nuitSuivante.fusionner, true);
});

/* ------------------------------------------------------------------ */
/* UN INVARIANT N'EST NOMMÉ QU'UNE FOIS SUR SA LIGNE.                  */
/*                                                                     */
/* La redite la plus chère n'est pas une ligne trop longue : c'est un  */
/* contrat qui reformule son titre EN CAPITALES, avec d'autres mots.   */
/* `ditLaMemeChose` compare les MOTS et ne peut pas la voir — un seul  */
/* mot commun sur treize. Trente-six lignes de `CLAUDE.md` étaient     */
/* dans ce cas, pour 2 442 signes, et le fichier n'avait plus que 28   */
/* signes de marge sous son plafond.                                   */
/* ------------------------------------------------------------------ */

const { crieLeTitre, reperesNouveaux } = await import('@beluga/shared');

test('un contrat qui crie son titre en capitales est ramené au titre seul', () => {
  // Le cas réel : les deux formulations ne partagent qu'un mot, et disent la
  // même chose. Le vocabulaire ne peut pas trancher, la structure oui.
  assert.equal(
    ligneDeContrat(
      "L'arrêt vide la file AVANT de couper, jamais après",
      "UN ARRÊT COUPE D'ABORD CE QUI ATTEND DERRIÈRE, ENSUITE LE MOTEUR",
    ),
    "- **L'arrêt vide la file AVANT de couper, jamais après**",
  );
});

test('un préambule qui reformule le titre avec d’autres mots est décapé', () => {
  // Cas réel de CLAUDE.md : le préambule répète l'idée du titre en gras, avec
  // un vocabulaire différent — l'égalité stricte le rate, la structure non.
  assert.equal(
    ligneDeContrat(
      'Un tour de cadrage a DEUX fins : répondre, ou cadrer',
      '**Un tour de cadrage a deux fins : la réponse en texte libre, ou la compréhension** — ' +
        'la compréhension reste le DÉFAUT dès qu’il s’agit d’un travail à cadrer',
    ),
    '- **Un tour de cadrage a DEUX fins : répondre, ou cadrer** — la compréhension reste le DÉFAUT dès qu’il s’agit d’un travail à cadrer',
  );
});

test('un contrat qui apporte un repère technique garde sa ligne entière', () => {
  // Une commande, un chemin, un nombre ou un libellé cité ne se devine pas du
  // titre : la ligne reste entière, même écrite tout en capitales.
  for (const dit of [
    '`node scripts/verif-cycle-de-vie-carte.mjs` rejoue le cycle entier',
    "UN `chown -R` TROP LARGE COUPE LES ACCÈS SSH DE L'ADMINISTRATEUR",
    'UN TOUR MORT POSE « RELANCER / IGNORER / ARRÊTER »',
  ]) {
    assert.equal(crieLeTitre(dit), false, dit);
    assert.match(ligneDeContrat('Un titre quelconque', dit), / — /);
  }
});

test('une phrase ordinaire, en minuscules, n’est jamais prise pour un cri', () => {
  assert.equal(crieLeTitre('le rangement de nuit insère chaque ligne sous son sujet'), false);
});

test('le compactage retire les redites sans perdre une seule ligne', () => {
  const avant = [
    '### Cartes',
    '',
    '- **Un arrêt range la carte** — UN ARRÊT À LA MAIN RAMÈNE LA CARTE EN PLANIFIÉ',
    '- **Le cycle a son contrôle** — `node scripts/verif-cycle-de-vie-carte.mjs` rejoue le cycle',
    '',
  ].join('\n');
  const apres = compacterInstructions(avant);
  assert.equal(apres.compactees, 1);
  assert.equal(apres.texte.split('\n').length, avant.split('\n').length, 'aucun invariant perdu');
  assert.ok(apres.texte.includes('- **Un arrêt range la carte**\n'), 'le nom reste');
  assert.ok(apres.texte.includes('verif-cycle-de-vie-carte.mjs'), 'le repère technique reste');
  assert.ok(apres.gagnes > 0);
});

/* ------------------------------------------------------------------ */
/* UN REPÈRE NE PROTÈGE UNE LIGNE QUE S'IL EST NEUF, ET UNE REDITE EN  */
/* MINUSCULES EST UNE REDITE.                                          */
/*                                                                     */
/* Constat du 20/09/2026 : 10 signes de marge sous le plafond, 62      */
/* règles restées « hors contrat » en une semaine, et un compactage    */
/* qui ne gagnait plus rien. Deux angles morts : un libellé cité       */
/* protégeait la ligne même quand il figurait DÉJÀ dans le titre, et   */
/* une suite en minuscules plus longue que son titre échappait aux     */
/* deux mesures de `ditLaMemeChose`. La liste ci-dessous est la liste  */
/* de RÉFÉRENCE, relevée ligne à ligne dans `CLAUDE.md`.               */
/* ------------------------------------------------------------------ */

/** Les lignes réelles dont la suite ne fait que redire le titre : ramenées au titre seul. */
const REDITES_DE_REFERENCE: ReadonlyArray<readonly [string, string]> = [
  // En capitales, et le libellé cité (« en travail ») est déjà dans le titre.
  [
    "Un agent arrêté sur sa question n'est en travail pour PERSONNE",
    "UN AGENT QUI ATTEND UNE RÉPONSE N'EST PLUS « EN TRAVAIL » NULLE PART, ET SON CHRONOMÈTRE S'ARRÊTE",
  ],
  // En capitales, et les DEUX libellés cités sont déjà dans le titre.
  [
    'Une carte suspendue ne reste jamais affichée « En cours »',
    '« SUSPENDUE » ET « EN COURS » NE PEUVENT PAS ÊTRE VRAIS ENSEMBLE, ET LE BALAYAGE RÉPARE LA CONTRADICTION',
  ],
  // Un second titre en gras sans repère, d'une autre formulation (aucun mot commun).
  [
    "La fiche d'une demande est un flux continu, sans un seul cadre",
    "**La fiche d'une demande n'a plus ni cadre ni trait : la hiérarchie passe par les fonds**",
  ],
  // Un second titre en gras, écrit normalement, sans aucun repère.
  [
    "Une panne répétée d'un site lance seule une enquête, et rien de plus",
    "**Une panne répétée d'un site ouvre SEULE un cadrage dans son projet, jamais plus loin que le plan**",
  ],
  [
    'Le rangement de nuit vise les sujets réels du projet traité, pas les huit de Beluga Build',
    'le rangement de nuit range sous les sujets qui existent VRAIMENT dans la base de connaissances du projet traité, jamais dans les huit sujets fixes de Beluga Build appliqués à un autre projet',
  ],
  // Les deux repères entre accents graves sont déjà dans le titre.
  [
    'Un trait qui porte une information suit `--faint`, jamais `--border`',
    "sur les thèmes plats, un trait porteur d'information se dessine avec `--faint`, pas avec `--border`",
  ],
  [
    'Reconnecter un compte se lit en trois temps : chargement, résultat, ligne à jour',
    "Reconnecter un compte : chargement dès l'envoi du code, résultat seul, puis la ligne relue",
  ],
  // Le libellé cité (« Compte ») est un mot du titre.
  [
    "Choisir le compte depuis les réglages de l'agent",
    "Les réglages d'un agent proposent un quatrième choix, « Compte », visible dès que plusieurs comptes existent pour le moteur retenu",
  ],
  [
    'Un seul renouvellement de session Claude à la fois par compte, et chacun laisse sa trace',
    "Un seul renouvellement de session Claude à la fois par compte, jamais pendant qu'un agent y travaille, et chacun laisse sa ligne au journal",
  ],
];

/**
 * Les lignes réelles à SECOND TITRE EN GRAS suivi d'un repère : le second titre est retiré,
 * le repère (commande, fichier) est rendu tel quel.
 */
const SECONDS_TITRES_RETIRES: ReadonlyArray<readonly [string, string, string]> = [
  [
    "La mise en production vit dans le BANDEAU BAS du tableau, plus en tête d'« Archivé »",
    '**La mise en production est un bandeau bas du tableau, et son bouton devient le suivi pendant la publication** — `node scripts/verif-bandeau-production.mjs`',
    '`node scripts/verif-bandeau-production.mjs`',
  ],
  [
    "Un seul glisser dans l'application : `usePointerDrag`",
    "**L'ESPACE CLIENT GLISSE AVEC LE MÊME MÉCANISME QUE LE KANBAN** — `usePointerDrag` de `web/src/lib/dnd.ts`, jamais un second geste écrit pour l'occasion",
    "`usePointerDrag` de `web/src/lib/dnd.ts`, jamais un second geste écrit pour l'occasion",
  ],
  [
    'La publication se lit et se discute comme un agent',
    '**Une publication a un CONDUCTEUR, et son volet montre sa CONVERSATION** — `node scripts/verif-fil-de-publication.mjs`',
    '`node scripts/verif-fil-de-publication.mjs`',
  ],
  [
    'La plaquette client se lit sur un lien privé public, et seul son jeton y mène',
    '**Une plaquette client ne sert que SES images, et la visite de l\'auteur ne se compte pas** — `node scripts/verif-plaquette.mjs`',
    '`node scripts/verif-plaquette.mjs`',
  ],
];

/** Les lignes réelles dont la suite APPREND quelque chose : rendues entières, au signe près. */
const TEMOINS_A_GARDER: ReadonlyArray<readonly [string, string]> = [
  // Le libellé exact des trois boutons : le titre ne dit que « la même décision ».
  [
    "Un tour mort AVANT le moteur pose la même décision qu'un tour tombé après",
    'UN TOUR MORT AVANT LE MOTEUR POSE « RELANCER / IGNORER / ARRÊTER », COMME UN TOUR TOMBÉ APRÈS',
  ],
  // Plus de la moitié des mots du titre sont repris, mais la commande est neuve.
  [
    'Le contrôle du coffre des comptes rejoint les vérifications de tous les jours',
    '`node scripts/verif-coffre-des-comptes.mjs` fait partie des contrôles de TOUS LES JOURS — les coffres Claude et Codex tiennent-ils debout ?',
  ],
  // Des guillemets IMBRIQUÉS et un libellé fait de seuls symboles (« ### … ») : on ne
  // sait pas le comparer au titre, donc on GARDE.
  [
    'Chaque ligne de contrat rejoint la section de son sujet dans CLAUDE.md, pas la fin du fichier',
    'le rangement de nuit insère chaque ligne de contrat sous la section « ### … » de son sujet, repérée par « sujet « <sujet> » », jamais collée à la fin du fichier',
  ],
  // En capitales, avec un libellé cité que le titre ne porte pas.
  [
    "Le bouton d'arrêt range la carte, exactement comme la sortie à la souris",
    'UN ARRÊT À LA MAIN RAMÈNE LA CARTE EN « PLANIFIÉ », QUEL QUE SOIT LE BOUTON',
  ],
];

test('chaque redite de la liste de référence est ramenée à son titre seul', () => {
  for (const [titre, suite] of REDITES_DE_REFERENCE) {
    assert.equal(ligneDeContrat(titre, suite), `- **${titre}**`, titre);
  }
});

test('chaque ligne témoin ressort entière, au signe près', () => {
  for (const [titre, suite] of TEMOINS_A_GARDER) {
    assert.equal(ligneDeContrat(titre, suite), `- **${titre}** — ${suite}`, titre);
  }
});

test('un second titre en gras est retiré, le repère qui le suit est gardé', () => {
  for (const [titre, suite, reste] of SECONDS_TITRES_RETIRES) {
    assert.equal(ligneDeContrat(titre, suite), `- **${titre}** — ${reste}`, titre);
    // Aucun repère n'est perdu : la ligne rendue porte les mêmes repères neufs que la ligne d'origine.
    assert.deepEqual(reperesNouveaux(titre, reste), reperesNouveaux(titre, suite), titre);
    // Rejoué sur son propre résultat : plus rien à gagner.
    assert.equal(ligneDeContrat(titre, reste), `- **${titre}** — ${reste}`, titre);
  }
});

test('un second titre qui porte un repère neuf reste sur sa ligne', () => {
  const titre = 'Le mode « plein » du tiroir donne une HAUTEUR, pas un plafond';
  const suite = "**Un `Drawer plein` occupe la hauteur entière, il ne s'arrête plus sur son contenu**";
  assert.equal(ligneDeContrat(titre, suite), `- **${titre}** — ${suite}`);
  assert.equal(secondTitreRetirable(titre, suite), null);
});

test('un second titre qui est une AUTRE règle, suivi d’un repère, garde ce repère', () => {
  assert.equal(
    ligneDeContrat('Le dépôt public ne reçoit qu’une liste fermée', '**Tout fichier nouveau est écarté** — `CHEMINS_PUBLIES`'),
    '- **Le dépôt public ne reçoit qu’une liste fermée** — `CHEMINS_PUBLIES`',
  );
});

test('un repère déjà porté par le titre ne protège plus la ligne', () => {
  // Sans titre, le jugement d'avant : le moindre libellé cité protège.
  assert.equal(crieLeTitre('LA CARTE N’EST PLUS « EN TRAVAIL » NULLE PART'), false);
  // Avec le titre, seul un repère NEUF protège.
  assert.equal(
    crieLeTitre('LA CARTE N’EST PLUS « EN TRAVAIL » NULLE PART', 'Une carte arrêtée n’est plus en travail'),
    true,
  );
  assert.equal(
    crieLeTitre('LA CARTE REVIENT EN « PLANIFIÉ »', 'Une carte arrêtée n’est plus en travail'),
    false,
  );
  // Un chiffre suit la même logique : déjà dans le titre, il n'apprend rien…
  assert.equal(
    ligneDeContrat('Le tableau pose les cartes par paquets de 20', 'LES CARTES ARRIVENT PAR PAQUETS DE 20'),
    '- **Le tableau pose les cartes par paquets de 20**',
  );
  // …et « 20 » n'est pas « 200 » : un nombre se compare en entier, pas chiffre à chiffre.
  assert.match(
    ligneDeContrat('Le tableau pose les cartes par paquets de 20', 'LES CARTES ARRIVENT PAR PAQUETS, 200 AU PLUS'),
    / — LES CARTES/,
  );
  assert.deepEqual(reperesNouveaux('Un trait suit `--faint`', 'avec `--faint`, pas `--border`'), ['`--border`']);
});

test('une suite en minuscules qui porte un repère neuf, ou qui parle d’autre chose, reste entière', () => {
  // Tous les mots du titre sont repris, mais la suite nomme un fichier : on garde.
  assert.match(
    ligneDeContrat(
      'Le rangement de nuit enregistre toujours son travail',
      'le rangement de nuit enregistre toujours son travail, par `server/src/instructions-en-attente.ts`',
    ),
    / — le rangement/,
  );
  // Un titre trop court ne prouve rien : deux mots repris ne font pas une redite.
  assert.match(
    ligneDeContrat('Un titre court', 'ce titre court vaut aussi pour les branches poussées hier'),
    / — ce titre/,
  );
  // Une suite qui parle d'autre chose, sans repère, reste entière elle aussi.
  assert.match(
    ligneDeContrat(
      'Le rangement de nuit enregistre toujours son travail',
      'sinon la publication du lendemain défait chaque matin ce que le démon a écrit',
    ),
    / — sinon/,
  );
});

test('le compactage regagne les redites de référence sans perdre un nom ni toucher un témoin', () => {
  const ligne = ([titre, suite]: readonly [string, string]) => `- **${titre}** — ${suite}`;
  const avant = ['### Cartes', '', ...REDITES_DE_REFERENCE.map(ligne), ...SECONDS_TITRES_RETIRES.map(([t, s]) => ligne([t, s])), ...TEMOINS_A_GARDER.map(ligne), ''].join('\n');
  const apres = compacterInstructions(avant);
  assert.equal(apres.compactees, REDITES_DE_REFERENCE.length + SECONDS_TITRES_RETIRES.length);
  assert.ok(apres.secondsTitres.length >= SECONDS_TITRES_RETIRES.length);
  assert.equal(apres.texte.split('\n').length, avant.split('\n').length, 'aucun invariant perdu');
  for (const temoin of TEMOINS_A_GARDER) assert.ok(apres.texte.includes(ligne(temoin)), temoin[0]);
  for (const [titre] of REDITES_DE_REFERENCE) assert.ok(apres.texte.includes(`- **${titre}**\n`), titre);
  // Rejoué sur son propre résultat, il ne trouve plus rien : le rangement de nuit ne tourne pas en rond.
  assert.equal(compacterInstructions(apres.texte).gagnes, 0);
});

/* ------------------------------------------------------------------ */
/* L'OPTIMISATION : NE LIRE LES FICHIERS QUE SI L'HEURE LE PERMET.     */
/*                                                                     */
/* La veille tourne 144 fois par jour. La fenetre utile de rangement  */
/* est de 2 h a 5 h — 3 heures sur 24. Sans cette optimisation, les   */
/* 141 passages rejetes lisent quand meme tous les fichiers du disque. */
/* Le pre-test de l heure ET de la periodicite doit se faire AVANT    */
/* tout appel a `depotsDAttente` ou `lireEntrees`.                    */
/* ------------------------------------------------------------------ */

test('rendezVousDeRangement teste heure AVANT de lire les fichiers', async () => {
  const { rendezVousDeRangement } = await import('../instructions-en-attente.js');

  // En dehors de la fenetre 2 h - 5 h (ici, 14 h), aucun rangement.
  const jourApresmidi = await rendezVousDeRangement(new Date(2026, 8, 10, 14, 30, 0));
  assert.equal(jourApresmidi.lance, false);
  assert.match(jourApresmidi.raison ?? '', /fen.tre.*2.*5/i);

  // La nuit, mais trop tot (1 h), aucun rangement.
  const nuitTrop = await rendezVousDeRangement(new Date(2026, 8, 10, 1, 30, 0));
  assert.equal(nuitTrop.lance, false);
  assert.match(nuitTrop.raison ?? '', /fen.tre.*2.*5/i);

  // La nuit, mais trop tard (6 h), aucun rangement.
  const nuitTard = await rendezVousDeRangement(new Date(2026, 8, 10, 6, 30, 0));
  assert.equal(nuitTard.lance, false);
  assert.match(nuitTard.raison ?? '', /fen.tre.*2.*5/i);

  // A la bonne heure, mais sans projet, aucun rangement lance.
  // (Les projets vides refusent via `decisionDeFusion`.)
  const bonneHeure = await rendezVousDeRangement(new Date(2026, 8, 10, 3, 30, 0));
  assert.equal(bonneHeure.lance, false);
  assert.equal(bonneHeure.projets, 0);
});
