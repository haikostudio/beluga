import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  demandeDuPromptEnvoye,
  filVisuelDeLAgent,
  messageDeLaDemande,
  partiesDuPromptEnvoye,
  toursSansBulleParPoint,
  type SentContextEtat,
} from '@beluga/shared';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function tourEssai(extra: Partial<SentContextEtat> = {}): SentContextEtat {
  return {
    engine: 'claude',
    model: 'claude-sonnet-5',
    session: 'new',
    prompt: 'DEMANDE : montre le prompt réel.',
    systemInstruction: { kind: 'full', content: 'MÉTHODE', transport: 'separate' },
    blocks: [
      { kind: 'request', label: 'Demande utilisateur', characters: 30, text: 'DEMANDE : montre le prompt réel.' },
      { kind: 'system', label: 'Rappel de méthode', characters: 7, text: 'MÉTHODE', cached: true },
      { kind: 'format', label: 'Gabarit Beluga Build', characters: 12 },
    ],
    passages: [],
    consultationsMemoire: [],
    history: 'none',
    sentAt: 1_000,
    ...extra,
  } as SentContextEtat;
}

test('la conversation ne pose plus ni pastille ni tiroir : un fil côté agent', () => {
  const vue = fs.readFileSync(path.join(RACINE, 'web', 'src', 'components', 'message-view.tsx'), 'utf8');
  assert.ok(!vue.includes('function ContexteEnvoye'), 'l’ancien bloc doit être retiré');
  assert.ok(!vue.includes('RepereDuPrompt'), 'l’ancienne pastille doit être retirée');
  assert.ok(vue.includes('<BullesDuPromptEnvoye'), 'les bulles se posent dans la conversation');
  assert.ok(vue.includes('<LienPromptEnvoye'), 'le texte entier se lit par un lien posé dans la conversation');

  const bulles = fs.readFileSync(path.join(RACINE, 'web', 'src', 'components', 'prompt-envoye.tsx'), 'utf8');
  assert.ok(bulles.includes('filVisuelDeLAgent'), 'l’affichage lit la règle du fil partagé');
  assert.ok(bulles.includes('data-fil-agent'), 'le fil porte son repère d’écran');
  assert.ok(!/<Drawer/.test(bulles), 'plus aucun tiroir à ouvrir pour lire le prompt');
  assert.ok(!bulles.includes('Mémoire transmise'), 'l’ancien pavé n’est plus rendu');
});

test('chaque résultat ajoute ses propres étapes sans modifier celles déjà affichées', () => {
  const premiereConsultation = {
    id: 'memoire',
    source: 'memoire' as const,
    requete: 'ui-memoire',
    resultat: '- UI Mémoire : les étapes gardent la requête et un résultat lisible.',
    reussie: true,
    at: 2_000,
  };
  const premierFil = filVisuelDeLAgent(tourEssai({ consultationsMemoire: [premiereConsultation] }));
  const filComplet = filVisuelDeLAgent(
    tourEssai({
      consultationsMemoire: [
        premiereConsultation,
        {
          id: 'competence',
          source: 'competence',
          requete: 'catalogue partagé',
          resultat: '- tracer-appels-outils-dans-le-tour : rattacher chaque résultat au bon tour.',
          reussie: true,
          at: 3_000,
        },
      ],
    }),
  );

  assert.deepEqual(premierFil.map((bulle) => bulle.nature), ['requete', 'recherche', 'resume']);
  assert.deepEqual(filComplet.slice(0, premierFil.length), premierFil, 'la première consultation reste inchangée');
  assert.deepEqual(filComplet.map((bulle) => bulle.nature), [
    'requete',
    'recherche',
    'resume',
    'recherche',
    'directives',
  ]);
  assert.deepEqual(filComplet.map((bulle) => bulle.cle), [
    'requete',
    'memoire-recherche',
    'memoire-resume',
    'competence-recherche',
    'competence-directives',
  ]);
  assert.match(filComplet[1].texte, /mémoire du projet/i);
  assert.doesNotMatch(filComplet[1].texte, /compétences partagées/i);
  assert.match(filComplet[2].texte, /étapes gardent la requête/i);
  assert.match(filComplet[3].texte, /compétences partagées/i);
  assert.match(filComplet[4].texte, /rattacher chaque résultat au bon tour/i);
  assert.ok(filComplet.every((bulle) => bulle.texte.length <= 500), 'chaque bulle reste courte');
});

test('le second passage retrouve les règles et contrôles que le premier résumé ne montrait pas', () => {
  const fil = filVisuelDeLAgent(
    tourEssai({
      consultationsMemoire: [
        {
          id: 'memoire',
          source: 'memoire',
          requete: 'memoire',
          resultat: [
            'SUJET « memoire » — ses faits :',
            '- Messages : le fil garde les résultats réellement rendus.',
            '',
            'RÈGLES qui mentionnent « memoire » :',
            '- **Chaque ouverture reste rattachée à son tour.**',
            '- Le texte exact doit rester conservé après le premier affichage.',
            '',
            'CONTRÔLES :',
            '- Vérifier dans un vrai navigateur que la directive est lisible.',
          ].join('\n'),
          reussie: true,
          at: 2_000,
        },
      ],
    }),
  );

  assert.deepEqual(fil.map((bulle) => bulle.nature), ['requete', 'recherche', 'resume', 'directives']);
  const resume = fil.find((bulle) => bulle.nature === 'resume')?.texte ?? '';
  const directives = fil.find((bulle) => bulle.nature === 'directives')?.texte ?? '';
  assert.match(resume, /fil garde les résultats réellement rendus/i);
  assert.doesNotMatch(resume, /Chaque ouverture reste rattachée/i);
  assert.match(directives, /Chaque ouverture reste rattachée/i);
  assert.match(directives, /texte exact doit rester conservé/i);
  assert.doesNotMatch(directives, /fil garde les résultats réellement rendus/i);
});

test('sans autre directive, aucun bloc vide ou répétitif n’est ajouté', () => {
  const fil = filVisuelDeLAgent(
    tourEssai({
      consultationsMemoire: [
        {
          id: 'memoire',
          source: 'memoire',
          requete: 'quotas',
          resultat: 'Une hausse mesurée est attribuée une seule fois.',
          reussie: true,
          at: 2_000,
        },
      ],
    }),
  );

  assert.deepEqual(fil.map((bulle) => bulle.nature), ['requete', 'recherche', 'resume']);
  assert.match(fil[2].texte, /hausse mesurée/i);
  assert.ok(!fil.some((bulle) => bulle.nature === 'directives'));
});

test('le fil côté agent retire les chemins et les blocs techniques du résultat court', () => {
  const fil = filVisuelDeLAgent(
    tourEssai({
      consultationsMemoire: [
        {
          id: 'memoire',
          requete: 'interface',
          resultat: '## RÈGLES\n- Lisible sur mobile (`web/src/components/prompt-envoye.tsx`).\n```ts\nconst interne = true;\n```',
          reussie: true,
          at: 2_000,
        },
      ],
    }),
  );
  const visible = fil.map((bulle) => bulle.texte).join('\n');
  assert.doesNotMatch(visible, /web\/src|```|const interne/);
  assert.match(visible, /Lisible sur mobile/);
});

test('l’écran rend des étapes distinctes reliées côté agent', () => {
  const vue = fs.readFileSync(path.join(RACINE, 'web', 'src', 'components', 'prompt-envoye.tsx'), 'utf8');
  assert.ok(vue.includes('data-fil-agent'), 'le fil porte son repère d’écran');
  assert.ok(vue.includes('data-bulle-agent'), 'chaque bulle porte son repère d’écran');
  assert.ok(vue.includes('data-etape-fil'), 'chaque arrivée porte sa propre clé stable');
  assert.ok(vue.includes('before:w-px'), 'la ligne verticale relie les bulles');
  assert.ok(!vue.includes('<ZoneDefilement'), 'aucun bloc technique déroulant ne reste dans le fil');
});

test('l’écran ne montre plus ni poids ni résultat technique dépliable', () => {
  const vue = fs.readFileSync(path.join(RACINE, 'web', 'src', 'components', 'prompt-envoye.tsx'), 'utf8');
  assert.ok(!vue.includes('data-detail-etape-memoire'), 'l’ancien détail a disparu');
  assert.ok(!vue.includes('data-jetons-etape'), 'aucun compteur ne reste dans le fil');
  assert.ok(!vue.includes('data-voir-plus'), 'aucun pavé brut ne peut être déplié');
});

test('le bandeau des cartes à valider se replie, et retient le choix', () => {
  const vue = fs.readFileSync(path.join(RACINE, 'web', 'src', 'components', 'propositions.tsx'), 'utf8');
  assert.ok(vue.includes('data-bandeau-pli'), 'l’entête porte son bouton de repli');
  assert.ok(vue.includes('beluga.bandeau-propositions.ouvert'), 'le choix est retenu d’une fois sur l’autre');
  assert.ok(vue.includes('if (nouvelle) setOuvert(true)'), 'une proposition neuve rouvre le bandeau');
});

test('le pont rattache au tour le texte réellement rendu par l’outil memoire', () => {
  const http = fs.readFileSync(path.join(RACINE, 'server', 'src', 'http.ts'), 'utf8');
  const runtime = fs.readFileSync(path.join(RACINE, 'server', 'src', 'runtime.ts'), 'utf8');
  assert.ok(http.includes("body.name === 'memoire'"), 'le pont reconnaît l’ouverture de mémoire');
  assert.ok(http.includes('resultat: result.text'), 'il garde le texte rendu, pas seulement le sujet');
  assert.ok(runtime.includes('ajouterConsultationMemoireAuTour'), 'le résultat rejoint la bulle du tour vivant');
  assert.ok(runtime.includes('contexteMessageId: messageDuContexte'), 'une demande écrite et un lancement par bouton visent le bon message');
});

test('le pont rattache aussi le résultat d’une recherche dans les compétences', () => {
  const http = fs.readFileSync(path.join(RACINE, 'server', 'src', 'http.ts'), 'utf8');
  assert.ok(http.includes("body.name === 'competences'"), 'le pont reconnaît la recherche de compétence');
  assert.ok(http.includes("source: 'competence'"), 'la source reste distincte de la mémoire');
  assert.ok(http.includes("body.args.action === 'lister'"), 'seule la consultation du catalogue rejoint le fil');
});

test('le fil préfère des textes courts à un pavé repliable', () => {
  const bulles = fs.readFileSync(path.join(RACINE, 'web', 'src', 'components', 'prompt-envoye.tsx'), 'utf8');
  assert.ok(bulles.includes('filVisuelDeLAgent'), 'la règle pure raccourcit avant le rendu');
  assert.ok(!bulles.includes('scrollHeight'), 'aucune mesure de hauteur ne pilote le comportement');
  assert.ok(bulles.includes('[overflow-wrap:anywhere]'), 'les mots longs restent dans la largeur mobile');
});

test('l’écran place le fil à gauche, sans ancien pavé repliable', () => {
  const vue = fs.readFileSync(path.join(RACINE, 'web', 'src', 'components', 'prompt-envoye.tsx'), 'utf8');
  assert.ok(vue.includes('w-[min(92%,860px)]'), 'le fil prend la largeur de l’agent');
  assert.ok(!vue.includes('items-end'), 'il n’est plus aligné côté utilisateur');
  assert.ok(!vue.includes('<button'), 'aucun ancien pavé ne se déplie');
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
  /* `lastIndexOf` des trois : le fil de cadrage pose lui aussi ce décor, plus
     haut dans le fichier, sur le PREMIER morceau d'une réponse découpée
     (`partieDuCadrage`). Comparer un dernier repère à un premier ferait
     échouer un ordre pourtant juste dans les deux branches. */
  // L'ancien encart « Base de connaissances » n'existe plus : la mémoire lue se
  // lit en bulles de recherche, comme chez un agent de tâche.
  assert.ok(!vue.includes('<MemoryNote'), 'un seul rendu de la mémoire lue : les bulles');
  assert.ok(bloc < vue.lastIndexOf('<Steps'), 'et avant le déroulé des étapes');
});

test('la conversation ne recopie plus le contexte parallèle technique', () => {
  const vue = fs.readFileSync(path.join(RACINE, 'web', 'src', 'components', 'prompt-envoye.tsx'), 'utf8');
  assert.ok(!vue.includes('bulle.noms'), 'les noms du prompt complet ne sont plus rendus');
  assert.ok(!vue.includes('data-donnees-paralleles'), 'l’ancien bloc technique a disparu');
});

test('les anciens labels techniques ont disparu du fil', () => {
  const vue = fs.readFileSync(path.join(RACINE, 'web', 'src', 'components', 'prompt-envoye.tsx'), 'utf8');
  assert.ok(!vue.includes('data-label-cache'));
  assert.ok(!vue.includes('data-label-ajoutee'));
  assert.ok(!vue.includes('Mémoire cache'));
  assert.ok(!vue.includes('Mémoire ajoutée'));
});

test('la règle partagée expose un fil dont chaque étape porte sa nature', () => {
  const partage = fs.readFileSync(path.join(RACINE, 'shared', 'src', 'prompt-envoye.ts'), 'utf8');
  assert.ok(partage.includes('filVisuelDeLAgent'));
  assert.ok(partage.includes("nature: 'requete'") && partage.includes("nature: 'directives'"));
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

/* ------------------------------------------------------------------ */
/* LE TEXTE ENTIER ET L'ÉTAT DU CACHE                                  */
/* ------------------------------------------------------------------ */

const consigneDe = (contexte: SentContextEtat) => partiesDuPromptEnvoye(contexte)[0];

test('le prompt se lit en deux parties, dans l’ordre du moteur : consignes puis message', () => {
  const parties = partiesDuPromptEnvoye(tourEssai());
  assert.deepEqual(parties.map((p) => p.cle), ['consigne', 'message']);
  assert.equal(parties[0].texte, 'MÉTHODE');
  assert.equal(parties[0].titre, 'Consignes générales');
  assert.equal(parties[1].texte, 'DEMANDE : montre le prompt réel.');
  assert.ok(parties.every((p) => p.conserve));
  assert.ok(!JSON.stringify(parties).match(/\d+\s*(jetons|tokens)/i), 'aucun chiffre de jetons rendu');
});

test('premier tour sous Claude : la consigne est écrite au cache, jamais dite relue', () => {
  assert.equal(consigneDe(tourEssai({ session: 'new' })).etat, 'ecrit');
  // Même avec une mesure de relecture : elle cumule les allers-retours du tour.
  assert.equal(
    consigneDe(tourEssai({ session: 'new', usage: { inputTokens: 10, cachedInputTokens: 5_000 } })).etat,
    'ecrit',
  );
});

test('reprise sous Claude : relue seulement si le moteur a vraiment relu quelque chose', () => {
  const reprise = { session: 'resumed' as const, history: 'retained_by_engine' as const };
  assert.equal(
    consigneDe(tourEssai({ ...reprise, usage: { inputTokens: 40, cachedInputTokens: 30_000 } })).etat,
    'relu',
  );
  assert.equal(
    consigneDe(tourEssai({ ...reprise, usage: { inputTokens: 30_000, cachedInputTokens: 0 } })).etat,
    'neuf',
    'une mesure à zéro n’est jamais surlignée, même si le bloc se disait en cache',
  );
});

test('reprise sans mesure : on retombe sur le repère posé à l’envoi, sans rien inventer', () => {
  const reprise = { session: 'resumed' as const };
  assert.equal(consigneDe(tourEssai(reprise)).etat, 'relu', 'le bloc système est marqué en cache');
  const sansRepere = tourEssai({
    ...reprise,
    blocks: [{ kind: 'system', label: 'Consigne', characters: 7, text: 'MÉTHODE', cached: false }],
  });
  assert.equal(consigneDe(sansRepere).etat, 'neuf');
});

test('un moteur qui colle la consigne après l’historique n’affirme aucune relecture du texte', () => {
  const codex = tourEssai({
    engine: 'codex',
    session: 'resumed',
    usage: { inputTokens: 10, cachedInputTokens: 9_000 },
    systemInstruction: { kind: 'reminder', content: 'RAPPEL', transport: 'prefixed' },
  });
  const consigne = consigneDe(codex);
  assert.equal(consigne.etat, 'neuf');
  assert.equal(consigne.titre, 'Rappel de méthode');
  assert.match(consigne.note ?? '', /après l’historique/);
});

test('l’historique gardé par le moteur est dit, jamais recopié', () => {
  const [, message] = partiesDuPromptEnvoye(tourEssai({ session: 'resumed', history: 'retained_by_engine' }));
  assert.match(message.note ?? '', /gardé par le moteur/);
  const [, neuve] = partiesDuPromptEnvoye(tourEssai({ session: 'new', history: 'none' }));
  assert.equal(neuve.note, undefined);
});

test('un tour purgé dit « texte non conservé » au lieu d’inventer du contenu', () => {
  const purge = tourEssai({
    prompt: '',
    systemInstruction: { kind: 'full', content: '', transport: 'separate' },
    blocks: [{ kind: 'system', label: 'Consigne système complète', characters: 7_700, cached: true }],
  });
  const parties = partiesDuPromptEnvoye(purge);
  assert.ok(parties.every((p) => p.conserve === false && p.texte === ''));
});

test('la consigne se relit dans le bloc système quand l’instantané ne la porte plus', () => {
  const ancien = tourEssai({
    systemInstruction: { kind: 'full', content: '', transport: 'separate' },
    blocks: [{ kind: 'system', label: 'Consigne', characters: 4, text: 'BLOC', cached: false }],
  });
  const consigne = consigneDe(ancien);
  assert.equal(consigne.texte, 'BLOC');
  assert.equal(consigne.conserve, true);
});

test('le lien du prompt complet se déplie sur place : aucun tiroir, aucun chiffre, aucune couleur nouvelle', () => {
  const vue = fs.readFileSync(path.join(RACINE, 'web', 'src', 'components', 'prompt-envoye-complet.tsx'), 'utf8');
  assert.ok(vue.includes('partiesDuPromptEnvoye'), 'l’écran lit la règle partagée');
  assert.ok(vue.includes('data-prompt-complet'), 'le lien porte son repère d’écran');
  assert.ok(vue.includes('<ZoneDefilement'), 'la zone qui défile passe par ZoneDefilement');
  assert.ok(!/<Drawer|<Dialog/.test(vue), 'ni tiroir ni fenêtre');
  assert.ok(!vue.includes('line-clamp'), 'aucun texte replié par coupe de lignes');
  assert.ok(!/violet|accent|text-(red|blue|green|orange|yellow|purple)|bg-(red|blue|green|orange|yellow|purple)/.test(vue), 'aucune couleur nouvelle');
  assert.ok(!/inputTokens|cachedInputTokens|tokens/.test(vue), 'aucun chiffre de jetons à l’écran');
  assert.ok(!vue.includes('data-fil-agent') && !vue.includes('data-prompt-envoye'), 'ne se confond pas avec le fil des bulles');
});

test('le lien est posé sans dépendre du fil des recherches, masqué sur une carte', () => {
  const vue = fs.readFileSync(path.join(RACINE, 'web', 'src', 'components', 'message-view.tsx'), 'utf8');
  const lignes = vue.split('\n');
  const gardees = lignes.filter((l) => l.includes('<LienPromptEnvoye'));
  assert.equal(gardees.length, 2, 'un lien sous la demande, un au-dessus de la réponse sans bulle de demande');
  assert.ok(gardees.every((l) => !l.includes('filAgentMasque')), 'jamais conditionné au fil des recherches');
});

test('une entrée « Demande » du journal désigne le message qui porte le texte envoyé', () => {
  assert.equal(messageDeLaDemande(JSON.stringify({ messageId: 'm-42', ecriteLe: 1 })), 'm-42');
  assert.equal(messageDeLaDemande(JSON.stringify({ ecriteLe: 1 })), undefined);
  assert.equal(messageDeLaDemande('pas du JSON'), undefined);
  assert.equal(messageDeLaDemande(undefined), undefined);
});

test('chaque tour lancé par un bouton ne porte qu’un lien, au premier point où il paraît', () => {
  const parPoint = toursSansBulleParPoint([
    { ancre: 'demande', etape: 'demande', entrees: [{ tourId: 'a1', agentId: 'agent' }] },
    {
      ancre: 'travail',
      etape: 'travail',
      entrees: [
        { tourId: 't1', agentId: 'agent' },
        { tourId: 't1', agentId: 'agent' },
        { agentId: 'agent' },
      ],
    },
    { ancre: 'rapport', etape: 'rapport', entrees: [{ tourId: 't1', agentId: 'agent' }, { tourId: 't2', agentId: 'agent' }] },
  ]);
  assert.equal(parPoint.has('demande'), false, 'le point « Demande » porte ses propres liens');
  assert.deepEqual(parPoint.get('travail'), [{ tourId: 't1', agentId: 'agent' }]);
  assert.deepEqual(parPoint.get('rapport'), [{ tourId: 't2', agentId: 'agent' }]);
});

test('le parcours d’une carte pose le lien sous la demande et dans le point du tour lancé', () => {
  const flux = fs.readFileSync(path.join(RACINE, 'web', 'src', 'components', 'flux-en-points.tsx'), 'utf8');
  assert.ok(flux.includes('<LienPromptDeLaDemande'), 'sous la bulle de la demande');
  assert.ok(flux.includes('<LiensDesPromptsDuPoint'), 'dans le point d’un tour lancé par un bouton');
  assert.ok(flux.includes('toursSansBulleParPoint'), 'les tours se rangent par la règle partagée');
});
