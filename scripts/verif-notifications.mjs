#!/usr/bin/env node
/**
 * Le guichet des notifications tient-il ses promesses, POUR DE VRAI ?
 *
 * Les règles pures sont déjà vérifiées par `notification-tri.test.ts`. Ici on
 * fait tourner le VRAI guichet du démon (`server/dist/notify.js`), avec une
 * vraie base, un vrai projet et de vraies cartes, en écoutant ce qui part sur
 * le bus. On vérifie six choses :
 *
 *   1. la clôture d'une carte par deux chemins ne fait qu'UNE notification ;
 *   2. cette notification porte le NOM DU PROJET et une phrase claire ;
 *   3. ce qui ne mérite pas d'interrompre reste dans l'application ;
 *   4. la surconsommation et l'emballement de quota n'en sortent plus ;
 *   5. une publication en échec sort, et emporte le motif qui choisit son image ;
 *   6. un groupe NOMME ses éléments au lieu de les compter.
 *
 * Rien n'est touché dans la vraie base : tout se passe dans un dossier
 * temporaire, effacé en partant.
 *
 *   npm run build:server && node scripts/verif-notifications.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// La racine se déduit du script : lancé depuis une copie de travail, il juge
// CETTE copie et non le dossier principal.
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// AVANT tout import du démon : la configuration lit cette variable au chargement.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-notifs-'));
process.env.HAIKODEV_DATA = dataDir;

const { bus } = await import('../server/dist/bus.js');
const store = await import('../server/dist/store.js');
const { notify } = await import('../server/dist/notify.js');
const { imageDeLAlerte } = await import('../shared/dist/index.js');

const resultats = [];
function noter(nom, ok, detail = '') {
  resultats.push({ nom, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${nom}${detail ? ` — ${detail}` : ''}`);
}

/** Le regroupement dure quatre secondes : on attend un peu plus. */
const ATTENTE_GROUPE_MS = 4600;
const attendre = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const notifications = [];
const bannieres = [];
bus.subscribe((event) => {
  if (event.type === 'notify') notifications.push(event);
  if (event.type === 'toast') bannieres.push(event);
});

/** Repart d'une page blanche entre deux essais. */
function vider() {
  notifications.length = 0;
  bannieres.length = 0;
}

try {
  // Les heures de silence couperaient tout selon l'heure du jour : on les
  // désactive, elles ne font pas partie de ce qu'on juge ici.
  store.saveSettings({ quietHoursStart: undefined, quietHoursEnd: undefined });

  store.saveProject({
    id: 'projet-essai',
    name: 'Projet d’essai',
    path: dataDir,
    defaultEngine: 'claude',
    rank: 1000,
    isSelf: false,
    archived: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  const carte = (id, title) =>
    store.saveCard({
      id,
      projectId: 'projet-essai',
      title,
      description: '',
      labels: [],
      column: 'done',
      position: 1,
      origin: 'user',
      run: { engine: 'claude' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

  /* --- 1 et 2 : un événement, une seule notification, qui se comprend --- */
  carte('carte-1', 'Refondre les notifications');
  vider();
  // L'ordonnanceur clôt la carte…
  notify({
    motif: 'tache-terminee',
    title: 'Tâche terminée',
    body: 'Refondre les notifications',
    reference: 'carte-1',
    element: 'Refondre les notifications',
    cardId: 'carte-1',
    projectId: 'projet-essai',
  });
  // …et la clôture manuelle raconte le MÊME événement, depuis un autre fichier.
  notify({
    motif: 'tache-terminee',
    title: 'Tâche terminée',
    body: 'Refondre les notifications',
    reference: 'carte-1',
    element: 'Refondre les notifications',
    cardId: 'carte-1',
    projectId: 'projet-essai',
  });
  await attendre(ATTENTE_GROUPE_MS);

  noter(
    'une carte close par deux chemins ne fait qu’UNE notification',
    notifications.length === 1,
    `${notifications.length} reçue(s)`,
  );
  const seule = notifications[0];
  noter(
    'la notification porte le nom du projet',
    !!seule && seule.title.startsWith('Projet d’essai —'),
    seule?.title,
  );
  noter(
    'elle dit ce qui s’est passé et emmène à la bonne carte',
    !!seule && seule.body.includes('Refondre les notifications') && seule.cardId === 'carte-1',
    seule?.body,
  );

  /* --- 3 : ce qui n'interrompt pas reste dans l'application --- */
  vider();
  notify({
    motif: 'charge-machine',
    title: 'Serveur très chargé',
    body: 'Charge à 95 % depuis 10 minutes.',
    reference: 'machine',
  });
  notify({
    motif: 'liste-taches',
    title: 'Liste de tâches terminée',
    body: 'Un agent — 4 tâches cochées',
    reference: 'carte-1',
    cardId: 'carte-1',
    projectId: 'projet-essai',
  });
  await attendre(ATTENTE_GROUPE_MS);
  noter(
    'la charge machine et la liste cochée ne sortent plus de l’application',
    notifications.length === 0,
    `${notifications.length} notification(s)`,
  );
  noter(
    'elles restent visibles dans l’application',
    bannieres.length === 2,
    `${bannieres.length} bannière(s)`,
  );

  /* --- 4 : la surconsommation de quota ne réveille plus personne --- */
  vider();
  notify({
    motif: 'quota-surconsommation',
    title: 'Le quota de la semaine va manquer',
    body: 'Compte d’essai : épuisé jeudi (78 % consommés).',
    reference: 'compte-essai:epuisement',
  });
  notify({
    motif: 'quota-emballement',
    title: 'Consommation inhabituelle',
    body: 'Compte d’essai : 4 fois l’habitude.',
    reference: 'compte-essai:emballement',
  });
  await attendre(ATTENTE_GROUPE_MS);
  noter(
    'la surconsommation et l’emballement de quota restent dans l’application',
    notifications.length === 0 && bannieres.length === 2,
    `${notifications.length} notification(s), ${bannieres.length} bannière(s)`,
  );

  /* --- 5 : chaque genre d'alerte porte SON image --- */
  vider();
  notify({
    motif: 'publication-echec',
    title: 'Publication en échec',
    body: '2 tâche(s) restent à déployer — les contrôles sont tombés',
    reference: 'projet-essai:echec:run-1',
    projectId: 'projet-essai',
  });
  await attendre(ATTENTE_GROUPE_MS);
  const echec = notifications[0];
  noter(
    'une publication en échec sort de l’application et dit pourquoi',
    !!echec && echec.body.includes('les contrôles sont tombés'),
    echec?.body,
  );
  noter(
    'elle emporte son motif, donc son image',
    !!echec && echec.motif === 'publication-echec' && imageDeLAlerte(echec.motif) === '/notif/erreur.png',
    `${echec?.motif} → ${imageDeLAlerte(echec?.motif)}`,
  );
  noter(
    'les six images existent réellement dans l’application',
    ['termine', 'attention', 'erreur', 'publication', 'quota', 'redemarrage'].every((nom) =>
      fs.existsSync(path.join(RACINE, 'web', 'public', 'notif', `${nom}.png`)),
    ),
  );

  /* --- 6 : un groupe nomme ses éléments --- */
  vider();
  for (const [id, titre] of [
    ['carte-2', 'Le volet des quotas'],
    ['carte-3', 'La ligne de projet'],
    ['carte-4', 'Le fondu de défilement'],
  ]) {
    carte(id, titre);
    notify({
      motif: 'tache-terminee',
      title: 'Tâche terminée',
      body: titre,
      reference: id,
      element: titre,
      cardId: id,
      projectId: 'projet-essai',
    });
  }
  await attendre(ATTENTE_GROUPE_MS);

  const groupe = notifications[0];
  noter('trois fins de tâche ne font qu’une alerte', notifications.length === 1, `${notifications.length} reçue(s)`);
  noter(
    'le titre du groupe compte ET nomme le projet',
    !!groupe && groupe.title === 'Projet d’essai — 3 tâches terminées',
    groupe?.title,
  );
  noter(
    'le corps NOMME les trois éléments, au lieu d’un compte muet',
    !!groupe &&
      ['Le volet des quotas', 'La ligne de projet', 'Le fondu de défilement'].every((titre) =>
        groupe.body.includes(titre),
      ),
    groupe?.body,
  );
} finally {
  fs.rmSync(dataDir, { recursive: true, force: true });
}

const echecs = resultats.filter((r) => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} contrôle(s) réussi(s).`);
process.exit(echecs ? 1 : 0);
