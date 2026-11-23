import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FRAGMENT_DE_DISCUSSION,
  RUBRIQUE_CONFIG_PAR_DEFAUT,
  VUES_CENTRALES,
  carteVisibleSurLaVue,
  construireFragment,
  construireFragmentDeDemande,
  destinationDeLEcran,
  fragmentDeLEspaceClient,
  lireFragment,
  lireFragmentDeDemande,
  ecranDeLaVue,
  lireFragmentDeLEspaceClient,
  memeEcran,
  slugTitre,
  type EcranNavigateur,
} from '@beluga/shared';

const CARTE = '0073bde7-0ef0-4fd6-be06-6d53e1e823c8';
const PROJET = 'projet-42';

/* ------------------------------------------------------------------ */
/* Construire le fragment d'adresse depuis l'écran courant             */
/* ------------------------------------------------------------------ */

test('chaque écran a son fragment', () => {
  assert.equal(construireFragment({ vue: 'accueil' }), '');
  assert.equal(construireFragment({ vue: 'reglages' }), 'reglages');
  assert.equal(construireFragment({ vue: 'tableau-de-bord' }), 'tableau-de-bord');
  assert.equal(construireFragment({ vue: 'projet', projectId: PROJET }), 'projet/projet-42');
});

test('une carte ouverte ajoute son identifiant puis le slug du titre', () => {
  const fragment = construireFragment({
    vue: 'projet',
    projectId: PROJET,
    cardId: CARTE,
    titreCarte: 'Adresse du navigateur avec # pour chaque écran',
  });
  assert.equal(fragment, `projet/projet-42/tache/${CARTE}-adresse-du-navigateur-avec-pour-chaque-ecran`);
});

test('sans titre, la carte ne porte que son identifiant', () => {
  const fragment = construireFragment({ vue: 'projet', projectId: PROJET, cardId: CARTE });
  assert.equal(fragment, `projet/projet-42/tache/${CARTE}`);
});

/* ------------------------------------------------------------------ */
/* Relire un fragment d'adresse                                        */
/* ------------------------------------------------------------------ */

test('le « # » de tête et son absence donnent le même écran', () => {
  assert.deepEqual(lireFragment('#reglages'), { vue: 'reglages' });
  assert.deepEqual(lireFragment('reglages'), { vue: 'reglages' });
  assert.deepEqual(lireFragment('#tableau-de-bord'), { vue: 'tableau-de-bord' });
});

test('un fragment vide, inconnu ou abîmé ramène à l accueil', () => {
  assert.deepEqual(lireFragment(''), { vue: 'accueil' });
  assert.deepEqual(lireFragment('#'), { vue: 'accueil' });
  assert.deepEqual(lireFragment('#nimportequoi'), { vue: 'accueil' });
  assert.deepEqual(lireFragment('#projet'), { vue: 'accueil' });
});

test('le projet et la carte se relisent, slug jeté', () => {
  assert.deepEqual(lireFragment('#projet/projet-42'), { vue: 'projet', projectId: PROJET });
  assert.deepEqual(lireFragment(`#projet/projet-42/tache/${CARTE}-vieux-titre`), {
    vue: 'projet',
    projectId: PROJET,
    cardId: CARTE,
  });
});

test('l identifiant reste la clé : un slug modifié pointe la même carte', () => {
  const a = lireFragment(`#projet/projet-42/tache/${CARTE}-un-titre`);
  const b = lireFragment(`#projet/projet-42/tache/${CARTE}-autre-titre`);
  assert.equal(a.vue === 'projet' && a.cardId, CARTE);
  assert.equal(b.vue === 'projet' && b.cardId, CARTE);
});

/* ------------------------------------------------------------------ */
/* Aller-retour et comparaison d'écrans                                */
/* ------------------------------------------------------------------ */

test('construire puis relire retrouve l écran, slug compris', () => {
  const ecran = { vue: 'projet', projectId: PROJET, cardId: CARTE, titreCarte: 'Mon Titre' } as const;
  const relu = lireFragment('#' + construireFragment(ecran));
  assert.deepEqual(relu, { vue: 'projet', projectId: PROJET, cardId: CARTE });
});

test('memeEcran ignore le slug mais distingue les identifiants', () => {
  assert.ok(
    memeEcran(
      { vue: 'projet', projectId: PROJET, cardId: CARTE, titreCarte: 'A' },
      { vue: 'projet', projectId: PROJET, cardId: CARTE },
    ),
  );
  assert.ok(!memeEcran({ vue: 'projet', projectId: PROJET }, { vue: 'projet', projectId: 'autre' }));
  assert.ok(!memeEcran({ vue: 'reglages' }, { vue: 'tableau-de-bord' }));
});

test('le slug retire accents et ponctuation, borne la longueur', () => {
  assert.equal(slugTitre('Été à Zürich !'), 'ete-a-zurich');
  assert.equal(slugTitre('  ---  '), '');
  assert.ok(slugTitre('x'.repeat(200)).length <= 60);
});

/* ------------------------------------------------------------------ */
/* L'espace client, ouvert depuis un courriel                          */
/* ------------------------------------------------------------------ */

test('l’adresse de l’espace désigne un client et une fiche', () => {
  assert.equal(construireFragment({ vue: 'espace' }), 'espace');
  assert.equal(construireFragment({ vue: 'espace', clientId: 'c1' }), 'espace/c1');
  assert.equal(
    construireFragment({ vue: 'espace', clientId: 'c1', demandeId: 'd7' }),
    'espace/c1/demande/d7',
  );
});

test('…et se relit à l’identique, y compris amputée', () => {
  assert.deepEqual(lireFragment('#espace/c1/demande/d7'), {
    vue: 'espace',
    clientId: 'c1',
    demandeId: 'd7',
  });
  assert.deepEqual(lireFragment('#espace/c1'), { vue: 'espace', clientId: 'c1' });
  assert.deepEqual(lireFragment('#espace'), { vue: 'espace' });
});

test('l’adresse d’une fiche côté client porte son projet', () => {
  const fragment = construireFragmentDeDemande(PROJET, 'd7');
  assert.equal(fragment, 'projet/projet-42/demande/d7');
  assert.deepEqual(lireFragmentDeDemande('#' + fragment), { projectId: PROJET, demandeId: 'd7' });
});

test('une adresse sans fiche ne désigne rien, et ne bloque pas l’ouverture', () => {
  assert.deepEqual(lireFragmentDeDemande(''), {});
  assert.deepEqual(lireFragmentDeDemande('#projet/projet-42'), {});
  assert.deepEqual(lireFragmentDeDemande('#n’importe/quoi'), {});
  // L'ancienne adresse d'une CARTE n'est pas celle d'une demande.
  assert.deepEqual(lireFragmentDeDemande(`#projet/${PROJET}/tache/${CARTE}`), {});
});


/* ------------------------------------------------------------------ */
/* Ce que l'espace client ÉCRIT dans son adresse                       */
/* ------------------------------------------------------------------ */

test('l’espace client écrit l’adresse de ce qui est ouvert', () => {
  // Une fiche : exactement ce que le courriel porte, et ce que l'espace relit.
  const fiche = fragmentDeLEspaceClient({ projectId: PROJET, demandeId: 'd7' });
  assert.equal(fiche, construireFragmentDeDemande(PROJET, 'd7'));
  assert.deepEqual(lireFragmentDeDemande(`#${fiche}`), { projectId: PROJET, demandeId: 'd7' });

  // La discussion : le même mot que celui du service worker et de la cloche.
  assert.equal(fragmentDeLEspaceClient({ discussion: true }), FRAGMENT_DE_DISCUSSION);
  // La discussion l'emporte : c'est elle qui est au premier plan.
  assert.equal(fragmentDeLEspaceClient({ projectId: PROJET, demandeId: 'd7', discussion: true }), 'discussion');

  // Le tableau : une adresse NUE, jamais un fragment qui ne désigne rien.
  assert.equal(fragmentDeLEspaceClient({ projectId: PROJET }), '');
  assert.equal(fragmentDeLEspaceClient({}), '');
});

/* ------------------------------------------------------------------ */
/* LES HUIT DESTINATIONS DE LA COLONNE, ET L'ÉLÉMENT OUVERT DEDANS     */
/* ------------------------------------------------------------------ */

/* Un écran nu par destination, et l'écran « chargé » qui va avec : c'est la
   table que l'aller-retour doit traverser sans rien perdre. */
const ECRANS: EcranNavigateur[] = [
  { vue: 'accueil' },
  { vue: 'reglages' },
  { vue: 'reglages', page: 'apparence' },
  { vue: 'tableau-de-bord' },
  { vue: 'coffre' },
  { vue: 'coffre', ficheId: 'acces-9' },
  { vue: 'memoire' },
  { vue: 'memoire', ficheId: '05_decisions' },
  { vue: 'memoire', porteeId: 'projet-42', ficheId: '05_decisions' },
  { vue: 'memoire', ficheId: '05_decisions', uniteId: 'DEC-024' },
  { vue: 'memoire', uniteId: 'MEM-1304' },
  { vue: 'backups' },
  { vue: 'backups', siteId: 'site-3' },
  { vue: 'surveillance' },
  { vue: 'surveillance', siteId: 'site-3' },
  { vue: 'espace' },
  { vue: 'espace', clientId: 'c1' },
  { vue: 'espace', clientId: 'c1', demandeId: 'd7' },
  { vue: 'projet', projectId: PROJET },
  { vue: 'projet', projectId: PROJET, cardId: CARTE },
  { vue: 'projet', projectId: PROJET, cardId: CARTE, onglet: 'github' },
  { vue: 'config-projet', projectId: PROJET },
  { vue: 'config-projet', projectId: PROJET, rubrique: 'deploiement' },
  { vue: 'config-projet', projectId: PROJET, rubrique: 'production' },
];

test('chaque endroit se transforme en adresse et se relit à l’identique', () => {
  for (const ecran of ECRANS) {
    const relu = lireFragment('#' + construireFragment(ecran));
    assert.deepEqual(relu, ecran, `aller-retour cassé sur ${construireFragment(ecran)}`);
  }
});

test('les huit destinations de la colonne ont toutes leur adresse', () => {
  const adressees = new Set(
    VUES_CENTRALES.map((vue) => {
      /* L'atelier Réseaux (vue interne « marketing ») s'écrit « reseaux-sociaux » : « #marketing » est le Marketing. */
      const ecran = lireFragment('#' + (vue === 'espace-client' ? 'espace' : vue === 'marketing' ? 'reseaux-sociaux' : vue));
      return destinationDeLEcran(ecran);
    }),
  );
  // « projet » n'a d'adresse qu'avec son identifiant : on le vérifie à part.
  assert.equal(destinationDeLEcran({ vue: 'projet', projectId: PROJET }), 'projet');
  for (const vue of VUES_CENTRALES) {
    if (vue === 'projet') continue;
    assert.ok(adressees.has(vue), `destination sans adresse : ${vue}`);
  }
});

test('l’élément ouvert descend dans l’adresse, service par service', () => {
  assert.equal(construireFragment({ vue: 'coffre', ficheId: 'a9' }), 'coffre/a9');
  assert.equal(construireFragment({ vue: 'backups', siteId: 's3' }), 'backups/s3');
  assert.equal(construireFragment({ vue: 'surveillance', siteId: 's3' }), 'surveillance/s3');
  assert.equal(
    construireFragment({ vue: 'memoire', ficheId: '05', uniteId: 'DEC-024' }),
    'memoire/fiche/05/unite/DEC-024',
  );
});

test('l’onglet d’une carte s’écrit, sauf la conversation qui est le défaut', () => {
  const base = `projet/projet-42/tache/${CARTE}`;
  assert.equal(construireFragment({ vue: 'projet', projectId: PROJET, cardId: CARTE, onglet: 'chat' }), base);
  assert.equal(
    construireFragment({ vue: 'projet', projectId: PROJET, cardId: CARTE, onglet: 'github' }),
    `${base}/github`,
  );
});

test('une adresse abîmée retombe proprement, jamais sur un écran vide', () => {
  assert.deepEqual(lireFragment('#coffre/'), { vue: 'coffre' });
  assert.deepEqual(lireFragment('#memoire/fiche'), { vue: 'memoire' });
  assert.deepEqual(lireFragment('#memoire/n’importe/quoi'), { vue: 'memoire' });
  assert.deepEqual(lireFragment('#surveillance/%E0%A4%A'), { vue: 'surveillance', siteId: '%E0%A4%A' });
  assert.deepEqual(lireFragment('#notes/a/b/c'), { vue: 'accueil' });
});

/* ------------------------------------------------------------------ */
/* Ce qui empile une entrée d'historique, et ce qui n'en empile pas    */
/* ------------------------------------------------------------------ */

test('un élément ouvert est une destination ; l’onglet d’une carte non', () => {
  assert.ok(!memeEcran({ vue: 'coffre' }, { vue: 'coffre', ficheId: 'a9' }));
  assert.ok(!memeEcran({ vue: 'memoire', ficheId: '05' }, { vue: 'memoire', ficheId: '05', uniteId: 'DEC-1' }));
  assert.ok(!memeEcran({ vue: 'backups', siteId: 's1' }, { vue: 'backups', siteId: 's2' }));
  assert.ok(!memeEcran({ vue: 'surveillance' }, { vue: 'surveillance', siteId: 's1' }));
  // L'onglet, lui, n'est qu'un détail d'affichage DANS la carte.
  assert.ok(
    memeEcran(
      { vue: 'projet', projectId: PROJET, cardId: CARTE },
      { vue: 'projet', projectId: PROJET, cardId: CARTE, onglet: 'github' },
    ),
  );
  // Deux destinations différentes ne se confondent jamais.
  assert.ok(!memeEcran({ vue: 'coffre' }, { vue: 'memoire' }));
  // Les services Notes et Leads (retirés le 11/11/2026) : leurs anciennes adresses rendent l'accueil.
  assert.deepEqual(lireFragment('#notes/n1'), { vue: 'accueil' });
  assert.deepEqual(lireFragment('#leads/annonces'), { vue: 'accueil' });
});

/* ------------------------------------------------------------------ */
/* NON-RÉGRESSION : les liens déjà partis par courriel                 */
/* ------------------------------------------------------------------ */

test('les fragments des courriels déjà envoyés restent identiques au signe près', () => {
  // Ces quatre chaînes sont FIGÉES : elles sont dans des courriels reçus.
  assert.equal(construireFragment({ vue: 'espace' }), 'espace');
  assert.equal(construireFragment({ vue: 'espace', clientId: 'c1' }), 'espace/c1');
  assert.equal(
    construireFragment({ vue: 'espace', clientId: 'c1', demandeId: 'd7' }),
    'espace/c1/demande/d7',
  );
  assert.equal(construireFragmentDeDemande('p1', 'd7'), 'projet/p1/demande/d7');
  assert.equal(FRAGMENT_DE_DISCUSSION, 'discussion');
  // Et l'adresse d'une carte, elle aussi partagée telle quelle.
  assert.equal(
    construireFragment({ vue: 'projet', projectId: 'p1', cardId: CARTE, titreCarte: 'Un titre' }),
    `projet/p1/tache/${CARTE}-un-titre`,
  );
});

/* ------------------------------------------------------------------ */
/* L'ESPACE CLIENT : tous ses écrans, pas seulement une fiche          */
/* ------------------------------------------------------------------ */

test('chaque écran de l’espace client a son adresse, et se relit', () => {
  const ecrans = [
    { ecran: 'demandes' as const },
    { ecran: 'discussion' as const },
    { ecran: 'profil' as const },
    { ecran: 'acces' as const },
    { ecran: 'backups' as const },
    { ecran: 'nouvelle-demande' as const },
    { ecran: 'demande' as const, projectId: PROJET, demandeId: 'd7' },
  ];
  for (const attendu of ecrans) {
    const fragment = fragmentDeLEspaceClient(attendu);
    assert.deepEqual(lireFragmentDeLEspaceClient('#' + fragment), attendu, `cassé sur « ${fragment} »`);
  }
});

test('un fragment inconnu de l’espace client ouvre le tableau des demandes', () => {
  assert.deepEqual(lireFragmentDeLEspaceClient(''), { ecran: 'demandes' });
  assert.deepEqual(lireFragmentDeLEspaceClient('#n’importe-quoi'), { ecran: 'demandes' });
  assert.deepEqual(lireFragmentDeLEspaceClient('#projet/p1'), { ecran: 'demandes' });
});

test('la mémoire n’écrit pas son classeur par défaut, et ouvrir la mémoire ne pose qu’une étape', () => {
  const nu = ecranDeLaVue({ vue: 'memoire', element: { memoirePortee: 'global' } });
  assert.deepEqual(nu, { vue: 'memoire' });
  assert.equal(construireFragment(nu), 'memoire');
  // Le premier affichage et celui d'après décrivent donc le MÊME écran :
  // aucune seconde entrée d'historique n'est empilée.
  assert.ok(memeEcran(ecranDeLaVue({ vue: 'memoire' }), nu));
  // Un autre classeur, lui, se dit.
  assert.deepEqual(ecranDeLaVue({ vue: 'memoire', element: { memoirePortee: 'projet-42' } }), {
    vue: 'memoire',
    porteeId: 'projet-42',
  });
});

/* ------------------------------------------------------------------ */
/* LA CONFIGURATION D'UN PROJET, RUBRIQUE PAR RUBRIQUE                  */
/* ------------------------------------------------------------------ */

test('la configuration d’un projet porte sa rubrique dans l’adresse', () => {
  assert.equal(
    construireFragment({ vue: 'config-projet', projectId: PROJET, rubrique: 'deploiement' }),
    `projet/${PROJET}/config/deploiement`,
  );
  assert.deepEqual(lireFragment(`#projet/${PROJET}/config/production`), {
    vue: 'config-projet',
    projectId: PROJET,
    rubrique: 'production',
  });
  // La configuration se pose PAR-DESSUS le tableau du projet : la colonne de
  // gauche reste sur ce projet, elle ne se vide pas.
  assert.equal(destinationDeLEcran({ vue: 'config-projet', projectId: PROJET }), 'projet');
});

test('la rubrique par défaut ne s’écrit pas, et n’empile pas une seconde étape', () => {
  const nu: EcranNavigateur = { vue: 'config-projet', projectId: PROJET };
  assert.equal(construireFragment(nu), `projet/${PROJET}/config`);
  assert.equal(
    construireFragment({ vue: 'config-projet', projectId: PROJET, rubrique: RUBRIQUE_CONFIG_PAR_DEFAUT }),
    `projet/${PROJET}/config`,
  );
  assert.ok(
    memeEcran(nu, { vue: 'config-projet', projectId: PROJET, rubrique: RUBRIQUE_CONFIG_PAR_DEFAUT }),
  );
});

test('changer de rubrique change d’écran : la flèche Précédent y revient', () => {
  assert.ok(
    !memeEcran(
      { vue: 'config-projet', projectId: PROJET, rubrique: 'deploiement' },
      { vue: 'config-projet', projectId: PROJET, rubrique: 'production' },
    ),
  );
  // Deux projets différents ne sont jamais le même écran non plus.
  assert.ok(
    !memeEcran(
      { vue: 'config-projet', projectId: PROJET, rubrique: 'deploiement' },
      { vue: 'config-projet', projectId: 'autre', rubrique: 'deploiement' },
    ),
  );
});

test('une adresse de configuration abîmée ouvre le projet sans bloquer', () => {
  // Une rubrique inconnue reste LUE telle quelle : c'est la fenêtre qui
  // retombe sur la première et le dit, l'adresse ne bloque jamais l'ouverture.
  assert.deepEqual(lireFragment(`#projet/${PROJET}/config/rubrique-disparue`), {
    vue: 'config-projet',
    projectId: PROJET,
    rubrique: 'rubrique-disparue',
  });
  assert.deepEqual(lireFragment('#projet//config/deploiement'), { vue: 'accueil' });
});

/* ------------------------------------------------------------------ */
/* La pile des tiroirs ouverts par-dessus l'écran                      */
/* ------------------------------------------------------------------ */

test('un tiroir s écrit en segment après l écran et se relit à l identique', () => {
  const ecran: EcranNavigateur = { vue: 'espace', clientId: 'c1', tiroirs: ['acces-clients'] };
  assert.equal(construireFragment(ecran), 'espace/c1/volet/acces-clients');
  assert.deepEqual(lireFragment('#espace/c1/volet/acces-clients'), ecran);
});

test('deux tiroirs empilés gardent leur ordre', () => {
  const ecran: EcranNavigateur = { vue: 'espace', tiroirs: ['acces-clients', 'nouvel-acces'] };
  assert.equal(construireFragment(ecran), 'espace/volet/acces-clients/nouvel-acces');
  assert.deepEqual(lireFragment('#espace/volet/acces-clients/nouvel-acces'), ecran);
});

test('un tiroir ouvert sur l accueil se relit aussi', () => {
  assert.equal(construireFragment({ vue: 'accueil', tiroirs: ['notifications'] }), 'volet/notifications');
  assert.deepEqual(lireFragment('#volet/notifications'), { vue: 'accueil', tiroirs: ['notifications'] });
});

test('un tiroir posé sur une carte ne se confond pas avec son onglet ni son slug', () => {
  const ecran: EcranNavigateur = {
    vue: 'projet',
    projectId: 'p1',
    cardId: '11111111-2222-3333-4444-555555555555',
    titreCarte: 'Fin des volets intempestifs',
    onglet: 'details',
    tiroirs: ['pieces-jointes'],
  };
  const fragment = construireFragment(ecran);
  assert.equal(
    fragment,
    'projet/p1/tache/11111111-2222-3333-4444-555555555555-fin-des-volets-intempestifs/details/volet/pieces-jointes',
  );
  const relu = lireFragment('#' + fragment);
  assert.equal(relu.vue, 'projet');
  assert.deepEqual(relu.tiroirs, ['pieces-jointes']);
  assert.equal(memeEcran(relu, ecran), true);
});

test('l ancienne forme « ?tiroir= » se lit encore', () => {
  assert.deepEqual(lireFragment('#espace/c1?tiroir=acces-clients'), {
    vue: 'espace',
    clientId: 'c1',
    tiroirs: ['acces-clients'],
  });
  assert.deepEqual(lireFragment('#espace?tiroir=acces-clients,nouvel-acces'), {
    vue: 'espace',
    tiroirs: ['acces-clients', 'nouvel-acces'],
  });
  assert.deepEqual(lireFragment('#?tiroir=notifications'), { vue: 'accueil', tiroirs: ['notifications'] });
});

test('un tiroir abîmé, vide ou en double est ignoré sans bloquer', () => {
  assert.deepEqual(lireFragment('#backups/volet'), { vue: 'backups' });
  assert.deepEqual(lireFragment('#backups/volet/'), { vue: 'backups' });
  assert.deepEqual(lireFragment('#backups/volet/A B/liste/liste'), { vue: 'backups', tiroirs: ['liste'] });
  assert.deepEqual(lireFragment('#backups?tiroir='), { vue: 'backups' });
  assert.deepEqual(lireFragment('#backups?tiroir=../x,A B,liste,liste'), { vue: 'backups', tiroirs: ['liste'] });
  assert.equal(construireFragment({ vue: 'backups', tiroirs: ['pas valide!'] }), 'backups');
  assert.equal(construireFragment({ vue: 'backups', tiroirs: ['volet'] }), 'backups');
});

test('les tiroirs sont une destination : ouvrir ou fermer change d écran', () => {
  const seul: EcranNavigateur = { vue: 'backups' };
  const avec: EcranNavigateur = { vue: 'backups', tiroirs: ['liste'] };
  assert.equal(memeEcran(seul, avec), false);
  assert.equal(memeEcran(avec, { vue: 'backups', tiroirs: ['liste'] }), true);
  assert.equal(memeEcran(seul, { vue: 'backups', tiroirs: [] }), true);
});

test('les fragments des courriels déjà partis sont identiques au signe près', () => {
  assert.equal(construireFragment({ vue: 'espace', clientId: 'c1' }), 'espace/c1');
  assert.equal(construireFragment({ vue: 'espace', clientId: 'c1', demandeId: 'd9' }), 'espace/c1/demande/d9');
  assert.equal(construireFragmentDeDemande('p1', 'd9'), 'projet/p1/demande/d9');
  assert.equal(fragmentDeLEspaceClient({ discussion: true }), FRAGMENT_DE_DISCUSSION);
});

/* ------------------------------------------------------------------ */
/* Le volet d'une carte ne s'affiche que là où il a sa place           */
/* ------------------------------------------------------------------ */

test('le volet d une carte ne s affiche jamais sur un service plein', () => {
  for (const vue of ['coffre', 'memoire', 'backups', 'surveillance', 'marketing', 'statistiques', 'espace-client'] as const) {
    assert.equal(carteVisibleSurLaVue(vue, 'projet'), false, vue);
    assert.equal(carteVisibleSurLaVue(vue, vue), false, vue);
  }
});

test('sur le tableau du projet la carte s affiche toujours, ailleurs seulement si elle y a été ouverte', () => {
  assert.equal(carteVisibleSurLaVue('projet', 'projet'), true);
  assert.equal(carteVisibleSurLaVue('projet', 'coffre'), true);
  assert.equal(carteVisibleSurLaVue('en-route', 'en-route'), true);
  assert.equal(carteVisibleSurLaVue('en-route', 'projet'), false);
  assert.equal(carteVisibleSurLaVue('tableau-de-bord', 'tableau-de-bord'), true);
  assert.equal(carteVisibleSurLaVue('tableau-de-bord', 'en-route'), false);
});

/* ------------------------------------------------------------------ */
/* Une carte ouverte sur un tableau de bord a SON adresse              */
/* ------------------------------------------------------------------ */

test('une carte ouverte sur « En route » nomme son projet, sa carte et son onglet', () => {
  assert.equal(construireFragment({ vue: 'en-route' }), 'en-route');
  assert.equal(
    construireFragment({ vue: 'en-route', projectId: PROJET, cardId: CARTE, titreCarte: 'Ambiances renouvelées' }),
    `en-route/projet/projet-42/tache/${CARTE}-ambiances-renouvelees`,
  );
  assert.equal(
    construireFragment({ vue: 'tableau-de-bord', projectId: PROJET, cardId: CARTE, onglet: 'github' }),
    `tableau-de-bord/projet/projet-42/tache/${CARTE}/github`,
  );
  /* L'onglet par défaut ne s'écrit pas, comme sur le tableau d'un projet. */
  assert.equal(
    construireFragment({ vue: 'en-route', projectId: PROJET, cardId: CARTE, onglet: 'chat' }),
    `en-route/projet/projet-42/tache/${CARTE}`,
  );
  /* Sans projet connu, l'adresse reste celle du tableau : jamais une adresse illisible. */
  assert.equal(construireFragment({ vue: 'en-route', cardId: CARTE }), 'en-route');
});

test('l’adresse d’une carte sur un tableau de bord se relit à l’identique, slug jeté', () => {
  for (const vue of ['en-route', 'tableau-de-bord'] as const) {
    const ecran = { vue, projectId: PROJET, cardId: CARTE, onglet: 'commentaires' } as const;
    assert.deepEqual(lireFragment(`#${construireFragment({ ...ecran, titreCarte: 'Un titre' })}`), ecran);
    assert.deepEqual(lireFragment(`#${vue}/projet/${PROJET}/tache/${CARTE}-vieux-slug`), {
      vue,
      projectId: PROJET,
      cardId: CARTE,
    });
  }
});

test('les anciennes adresses des tableaux de bord et une suite abîmée ouvrent le tableau nu', () => {
  assert.deepEqual(lireFragment('#en-route'), { vue: 'en-route' });
  assert.deepEqual(lireFragment('#tableau-de-bord'), { vue: 'tableau-de-bord' });
  assert.deepEqual(lireFragment('#en-route/projet'), { vue: 'en-route' });
  assert.deepEqual(lireFragment(`#en-route/projet/${PROJET}`), { vue: 'en-route' });
  assert.deepEqual(lireFragment(`#en-route/projet/${PROJET}/tache`), { vue: 'en-route' });
  assert.deepEqual(lireFragment('#en-route/n-importe-quoi/x/y'), { vue: 'en-route' });
});

test('ouvrir une carte sur un tableau de bord change d’écran ; l’onglet non', () => {
  const nu: EcranNavigateur = { vue: 'en-route' };
  const a: EcranNavigateur = { vue: 'en-route', projectId: PROJET, cardId: CARTE };
  const b: EcranNavigateur = { vue: 'en-route', projectId: PROJET, cardId: 'autre-carte' };
  assert.equal(memeEcran(nu, a), false);
  assert.equal(memeEcran(a, b), false);
  assert.equal(memeEcran(a, { ...a, titreCarte: 'Autre titre', onglet: 'github' }), true);
  assert.equal(memeEcran(nu, { vue: 'en-route' }), true);
  assert.equal(memeEcran(a, { vue: 'tableau-de-bord', projectId: PROJET, cardId: CARTE }), false);
});

test('l’écran déduit de l’interface porte la carte d’un tableau de bord, et seulement elle', () => {
  assert.deepEqual(
    ecranDeLaVue({ vue: 'en-route', projectId: PROJET, cardId: CARTE, titreCarte: 'T', onglet: 'github' }),
    { vue: 'en-route', projectId: PROJET, cardId: CARTE, titreCarte: 'T', onglet: 'github' },
  );
  assert.deepEqual(ecranDeLaVue({ vue: 'en-route', projectId: PROJET }), { vue: 'en-route' });
  assert.deepEqual(ecranDeLaVue({ vue: 'tableau-de-bord', cardId: CARTE }), { vue: 'tableau-de-bord' });
  assert.equal(destinationDeLEcran(lireFragment(`#en-route/projet/${PROJET}/tache/${CARTE}`)), 'en-route');
});

test('chaque vue centrale a une adresse écrite par l’interface — une vue sans adresse échoue ici', () => {
  for (const vue of VUES_CENTRALES) {
    const ecran = ecranDeLaVue({ vue, projectId: PROJET });
    const fragment = construireFragment(ecran);
    assert.ok(fragment, `la vue « ${vue} » n'écrit aucune adresse`);
    assert.equal(destinationDeLEcran(lireFragment(`#${fragment}`)), vue, `la vue « ${vue} » ne se relit pas`);
  }
});

test('« Tâches récurrentes » : le projet, puis la veille ouverte dans son tiroir', () => {
  assert.equal(construireFragment({ vue: 'taches-recurrentes' }), 'taches-recurrentes');
  const complet = { vue: 'taches-recurrentes' as const, projectId: 'p1', veilleId: 'v1' };
  assert.equal(construireFragment(complet), 'taches-recurrentes/p1/veille/v1');
  assert.deepEqual(lireFragment('#taches-recurrentes/p1/veille/v1'), complet);
  assert.deepEqual(lireFragment('#taches-recurrentes/p1'), { vue: 'taches-recurrentes', projectId: 'p1' });
  assert.ok(!memeEcran(complet, { vue: 'taches-recurrentes', projectId: 'p1' }), 'ouvrir une veille empile une entrée');
  assert.deepEqual(ecranDeLaVue({ vue: 'taches-recurrentes', element: { recurrentes: 'p1', recurrenteVeille: 'v1' } }), complet);
  // Une veille sans projet ne s'écrit pas.
  assert.deepEqual(ecranDeLaVue({ vue: 'taches-recurrentes', element: { recurrenteVeille: 'v1' } }), { vue: 'taches-recurrentes' });
});

/* ------------------------------------------------------------------ */
/* L'atelier Réseaux sociaux : nouveau mot d'adresse, ancien lu en alias */
/* ------------------------------------------------------------------ */

test('l’atelier Réseaux sociaux s’écrit « reseaux-sociaux » ; le mot « marketing » appartient désormais au service Marketing', () => {
  assert.equal(construireFragment({ vue: 'marketing', projectId: 'p1' }), 'reseaux-sociaux/p1');
  assert.equal(construireFragment({ vue: 'marketing' }), 'reseaux-sociaux');
  assert.deepEqual(lireFragment('#reseaux-sociaux/p1'), { vue: 'marketing', projectId: 'p1' });
  assert.deepEqual(lireFragment('#reseaux-sociaux'), { vue: 'marketing' });
  /* « #marketing/<projet> » (lien de l'ancien atelier) ouvre le service Marketing, qui reconnaît un identifiant de projet
     et mène à Communication (marketing-2.tsx). */
  assert.deepEqual(lireFragment('#marketing/p1'), { vue: 'marketing2', chemin: 'p1' });
  assert.deepEqual(lireFragment('#marketing'), { vue: 'marketing2' });
  assert.equal(destinationDeLEcran(lireFragment('#marketing')), 'marketing2');
});

test('les adresses des services portent leur nom, sans chiffre, et les anciennes mènent au même écran', () => {
  assert.equal(construireFragment({ vue: 'marketing2' }), 'marketing');
  assert.equal(construireFragment({ vue: 'marketing2', chemin: 'd1/evolution' }), 'marketing/d1/evolution');
  assert.equal(construireFragment({ vue: 'communication2' }), 'communication');
  assert.equal(construireFragment({ vue: 'communication2', chemin: 'm1/campagnes/c1' }), 'communication/m1/campagnes/c1');
  assert.equal(construireFragment({ vue: 'plaquettes' }), 'charte');
  assert.equal(construireFragment({ vue: 'plaquettes', projectId: 'p1' }), 'charte/p1');
  assert.equal(construireFragment({ vue: 'plaquettes', projectId: 'p1', plaquetteId: 'q1' }), 'charte/p1/q1');
  assert.equal(construireFragment({ vue: 'plaquettes', plaquetteId: 'q1' }), 'charte/tous/q1');
  for (const vue of ['marketing2', 'communication2', 'plaquettes'] as const) assert.ok(!/\d/.test(construireFragment({ vue })), vue);
  /* Les anciennes adresses : mêmes écrans. */
  assert.deepEqual(lireFragment('#marketing2'), { vue: 'marketing2' });
  assert.deepEqual(lireFragment('#marketing2/d1/documents'), { vue: 'marketing2', chemin: 'd1/documents' });
  assert.deepEqual(lireFragment('#communication2'), { vue: 'communication2' });
  assert.deepEqual(lireFragment('#communication2/m1/campagnes/c1'), { vue: 'communication2', chemin: 'm1/campagnes/c1' });
  assert.deepEqual(lireFragment('#plaquettes'), { vue: 'plaquettes' });
  assert.deepEqual(lireFragment('#plaquettes/p1/q1'), { vue: 'plaquettes', projectId: 'p1', plaquetteId: 'q1' });
  /* Les nouvelles font l'aller-retour. */
  assert.deepEqual(lireFragment('#charte/tous/q1'), { vue: 'plaquettes', plaquetteId: 'q1' });
  assert.deepEqual(lireFragment('#communication/m1/canaux/reglages/instagram'), { vue: 'communication2', chemin: 'm1/canaux/reglages/instagram' });
  assert.deepEqual(lireFragment('#communication/m1/calendrier'), { vue: 'communication2', chemin: 'm1/calendrier' });
  /* Les lieux de l'ANCIEN espace Communication (retiré le 11/11/2026) restent traduits. */
  assert.deepEqual(lireFragment('#communication/m1/publications'), { vue: 'communication2', chemin: 'm1/calendrier' });
  assert.deepEqual(lireFragment('#communication/m1/messages'), { vue: 'communication2', chemin: 'm1/reponses' });
  assert.deepEqual(lireFragment('#communication/m1/canaux/instagram'), { vue: 'communication2', chemin: 'm1/canaux/reglages/instagram' });
});

test('la portée d’une page de service s’écrit au bout de l’adresse et se relit', () => {
  assert.equal(construireFragment({ vue: 'communication2', portee: 'p1' }), 'communication?projet=p1');
  assert.deepEqual(lireFragment('#communication?projet=p1'), { vue: 'communication2', portee: 'p1' });
  assert.deepEqual(lireFragment('#marketing/d1/evolution?projet=p1'), { vue: 'marketing2', chemin: 'd1/evolution', portee: 'p1' });
  assert.equal(construireFragment({ vue: 'backups', portee: 'p1', tiroirs: ['nouveau-site'] }), 'backups/volet/nouveau-site?projet=p1');
  assert.deepEqual(lireFragment('#backups/volet/nouveau-site?projet=p1'), { vue: 'backups', tiroirs: ['nouveau-site'], portee: 'p1' });
  /* La Charte garde sa forme : la portée passe dans son chemin. */
  assert.equal(construireFragment({ vue: 'plaquettes', portee: 'p1' }), 'charte/p1');
  /* Sans portée : tous les projets — et deux portées différentes ne sont pas le même écran. */
  assert.deepEqual(lireFragment('#communication'), { vue: 'communication2' });
  assert.ok(!memeEcran(lireFragment('#communication'), lireFragment('#communication?projet=p1')));
  /* L'accueil ne porte jamais de portée. */
  assert.deepEqual(lireFragment('#?projet=p1'), { vue: 'accueil' });
});

test('une adresse retenue avec un ancien mot de service passe dans sa forme neuve', async () => {
  const { adresseAuMotDuJour, lireLesOnglets, ongletDObjet } = await import('@beluga/shared');
  assert.equal(adresseAuMotDuJour('communication2/m1/campagnes/c1'), 'communication/m1/campagnes/c1');
  assert.equal(adresseAuMotDuJour('marketing2/d1'), 'marketing/d1');
  assert.equal(adresseAuMotDuJour('plaquettes/p1/q1'), 'charte/p1/q1');
  assert.equal(adresseAuMotDuJour('projet/p1/tache/c1'), 'projet/p1/tache/c1');
  const relus = lireLesOnglets([ongletDObjet('communication2', 'communication2/m1/campagnes/c1', 'Lancement')]);
  assert.deepEqual(relus, [ongletDObjet('communication2', 'communication/m1/campagnes/c1', 'Lancement')]);
});

test('statistiques et réseaux sociaux : l’onglet, le groupe et le canal ont leur adresse, les anciens liens restent lus', () => {
  const aller = (e: EcranNavigateur) => lireFragment(construireFragment(e));
  assert.equal(construireFragment({ vue: 'statistiques', siteId: 'haiko/parcours' }), 'statistiques/haiko/parcours');
  assert.deepEqual(aller({ vue: 'statistiques', siteId: 'liste/actifs' }), { vue: 'statistiques', siteId: 'liste/actifs' });
  assert.deepEqual(lireFragment('#statistiques/haiko'), { vue: 'statistiques', siteId: 'haiko' });
  const projet = '0b8a7c2e-1111-4222-8333-444455556666';
  assert.equal(construireFragment({ vue: 'marketing', projectId: `${projet}/canaux/instagram` }), `reseaux-sociaux/${projet}/canaux/instagram`);
  assert.deepEqual(aller({ vue: 'marketing', projectId: `${projet}/contenus` }), { vue: 'marketing', projectId: `${projet}/contenus` });
  assert.deepEqual(lireFragment(`#reseaux-sociaux/${projet}`), { vue: 'marketing', projectId: projet });
  // Un tiroir posé par-dessus une rubrique reste dans la pile.
  assert.deepEqual(aller({ vue: 'marketing', projectId: `${projet}/contenus`, tiroirs: ['nouveau-contenu-marketing'] }).tiroirs, ['nouveau-contenu-marketing']);
  assert.ok(!memeEcran({ vue: 'statistiques', siteId: 'haiko' }, { vue: 'statistiques', siteId: 'haiko/parcours' }));
});

test('l’ancien Marketing est retiré : chacune de ses adresses ouvre la même page du nouveau', () => {
  assert.deepEqual(lireFragment('#strategie'), { vue: 'marketing2' });
  assert.deepEqual(lireFragment('#strategie/dossiers'), { vue: 'marketing2' });
  assert.deepEqual(lireFragment('#strategie/reglages'), { vue: 'marketing2', chemin: 'reglages' });
  assert.deepEqual(lireFragment('#strategie/nouveau/entreprise'), { vue: 'marketing2', chemin: 'nouveau' });
  assert.deepEqual(lireFragment('#strategie/d1'), { vue: 'marketing2', chemin: 'd1' });
  assert.deepEqual(lireFragment('#strategie/d1/analyse/evolution'), { vue: 'marketing2', chemin: 'd1/evolution' });
  assert.deepEqual(lireFragment('#strategie/d1/analyse/m1'), { vue: 'marketing2', chemin: 'd1/etude/m1' });
  assert.deepEqual(lireFragment('#strategie/d1/analyse/m1/etape/rapport'), { vue: 'marketing2', chemin: 'd1/etude/m1/rapport' });
  /* Les étapes d'avant (« besoin », « mise-au-point ») mènent toujours au Client et au Rapport. */
  assert.deepEqual(lireFragment('#strategie/d1/analyse/m1/etape/besoin'), { vue: 'marketing2', chemin: 'd1/etude/m1/client' });
  assert.deepEqual(lireFragment('#strategie/d1/analyse/m1/etape/mise-au-point'), { vue: 'marketing2', chemin: 'd1/etude/m1/rapport' });
  /* L'adresse de service d'un agent marketing (« strategie/<dossier>/marketing2 ») ouvre son client. */
  assert.deepEqual(lireFragment('#strategie/d1/marketing2'), { vue: 'marketing2', chemin: 'd1' });
  /* Les nouvelles adresses font l'aller-retour. */
  for (const chemin of ['reglages', 'd1/evolution', 'd1/reglages', 'd1/etude/m1/analyse']) assert.deepEqual(lireFragment(construireFragment({ vue: 'marketing2', chemin })), { vue: 'marketing2', chemin });
});

test('à froid, seule une adresse nue arrive sur « Tableaux de bord »', async () => {
  const { vueDeDemarrage, lireFragment } = await import('@beluga/shared');
  assert.equal(vueDeDemarrage(lireFragment('')), 'en-route');
  assert.equal(vueDeDemarrage(lireFragment('#')), 'en-route');
  assert.equal(vueDeDemarrage(lireFragment('#projet/abc')), null);
  assert.equal(vueDeDemarrage(lireFragment('#coffre')), null);
  assert.equal(vueDeDemarrage(lireFragment('#en-route')), null);
});
