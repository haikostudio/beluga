// LE RELAIS DU MAC DE BELUGA — joué par `osascript -l JavaScript` (JavaScript pour Automation), lancé par launchd.
//
// Il interroge le démon Beluga en longue attente, reçoit UN geste à la fois, le joue UNIQUEMENT dans la fenêtre de
// l'app « Recopie de l'iPhone » (iPhone Mirroring), puis renvoie le résultat. Aucune dépendance : curl, openssl,
// shasum, screencapture et base64, tous livrés avec macOS. Chaque demande est signée (HMAC-SHA256) par la clé reçue
// à la liaison, gardée dans config.json (lisible par l'utilisateur seul).
//
// RÈGLE DE SÛRETÉ : tout point est donné en FRACTIONS de la fenêtre de recopie et converti ici, contre les limites de
// la fenêtre relues À CHAQUE GESTE ; un point hors de la fenêtre (ou dans sa barre de titre) est refusé. Rien d'autre
// du Mac n'est jamais touché par la souris ou le clavier. Même règle que `pointDansLaFenetre` (shared/src/relais-mac.ts).
//
// L'ORDINATEUR (15/11/2026, carte « Choisir l'ordinateur visé depuis le téléphone ») : trois gestes de plus, hors de la
// recopie, sans aucune commande libre — `lister_applications`, `ouvrir_application` (le nom est cherché dans la liste
// des applications installées, puis ouvert par son CHEMIN, jamais interprété par le shell) et `relancer_navigateur`
// (Chrome ou Safari, rien d'autre). Le relais garde aussi le Mac ÉVEILLÉ (`caffeinate -i -s -w <pid du relais>` : il
// meurt avec le relais, et un relais relancé par launchd n'en laisse aucun derrière lui).
//
// SON NOM (15/11/2026, carte « Installation guidée sur le Mac ») : l'installateur compile ce script en une petite
// application, « Beluga Relais.app » (osacompile, signée ad hoc), lancée par launchd. macOS attribue alors les
// autorisations à « Beluga Relais » — et non à l'outil caché « osascript », qui n'apparaissait nulle part dans les
// réglages. Le relais rapporte à chaque attente l'état de ses deux autorisations (Accessibilité, Enregistrement de
// l'écran) : l'assistant d'installation de Beluga coche l'étape tout seul. Au premier démarrage après l'installation
// (fichier « demander » posé par l'installateur), il DÉCLENCHE les demandes de macOS, ce qui l'inscrit dans les deux
// listes des réglages ; le geste `ouvrir_reglage` (accessibilite | ecran | aide, rien d'autre) rouvre le bon écran sur le Mac, ou la fenêtre « Activer » de Beluga Connect.

// L'EXTENSION CHROME À JOUR (20/11/2026, carte « Extension à jour et Jarvis tout en voix ») : `mettre_a_jour_extension`
// remplace le CONTENU du dossier de l'extension non empaquetée (trouvé dans les préférences de Chrome, jamais deviné),
// par le paquet signé que le démon sert, empreinte SHA-256 vérifiée avant tout remplacement ; le MÊME chemin garde le
// même identifiant, donc la liaison et l'autorisation de navigation privée. `config.json` de l'installation est gardé.
// Puis Chrome est quitté proprement et rouvert (extension d'avant 1.0.11), sinon le démon demande à l'extension de se
// recharger. `se_mettre_a_jour` remplace ce fichier-ci : l'application compilée n'est plus qu'un LANCEUR fixe
// (`lanceur.js`) qui lit `relais.js` sur le disque, si bien qu'une mise à jour ne change plus sa signature et que macOS
// garde les autorisations déjà données.

// BELUGA CONNECT (20/11/2026, carte « Liaison de l'extension Chrome simplifiée ») : ce relais tourne désormais comme
// PROCESSUS ENFANT de l'application signée « Beluga Connect » (connect/), par le même lanceur fixe ; macOS attribue les
// autorisations à l'application. Il rapporte sa version (`connect=`), et sait trois gestes de plus, sans commande libre :
//  - `installer_extension` : pose l'extension dans un dossier FIXE (~/Library/Application Support/Beluga/extension-chrome,
//    jamais Téléchargements), y dépose `liaison.json` (code à usage unique : l'extension 1.0.12 se relie seule), puis
//    l'ajoute à Chrome en pilotant chrome://extensions (mode développeur, « Charger l'extension non empaquetée ») —
//    chaque attente est bornée, et un échec laisse l'assistant afficher les trois clics ;
//  - `autoriser_navigation_privee` : coche « Autoriser en navigation privée » sur la page de l'extension ;
//  - `installer_connect` : migration d'un Mac équipé de « Beluga Relais » vers Beluga Connect (archive vérifiée par
//    empreinte, signature et équipe Apple) ; l'ancien relais continue tant que Beluga Connect ne l'a pas arrêté.

// PILOTER LE MAC DEPUIS BELUGA (21/11/2026, version 4) : les gestes de l'outil « ordinateur » des agents. Le DÉMON
// décide des droits (Réglages › Extension › l'ordinateur) et de l'accord de la personne pour le terminal et toute
// suppression ; ce relais ne fait que jouer, et garde ses propres bornes :
//  - `fermer_application` (nom cherché dans la liste installée, comme l'ouverture) ;
//  - `reglage` : volume, sourdine, luminosité (un cran), mode sombre, Wi-Fi, veille de l'écran — rien d'autre ;
//  - `piloter` : un AppleScript adressé à UNE application nommée, refusé s'il lance une commande du système ;
//  - `ecran_capturer` / `ecran_cliquer` / `ecran_taper` / `ecran_touche` : l'écran principal entier, en FRACTIONS de
//    la capture ; la frappe est refusée quand le Terminal est au premier plan (le terminal passe par l'accord) ;
//  - `terminal` : la commande accordée, jouée par zsh dans le dossier personnel, bornée en temps, sortie tronquée ;
//  - `supprimer` : met un fichier ou un dossier À LA CORBEILLE (jamais d'effacement définitif).

ObjC.import('Foundation');
ObjC.import('CoreGraphics');
ObjC.import('AppKit');
ObjC.import('ApplicationServices');

const app = Application.currentApplication();
app.includeStandardAdditions = true;

const DOSSIER = $.NSProcessInfo.processInfo.environment.objectForKey('BELUGA_RELAIS_DOSSIER').js ||
  `${$.NSHomeDirectory().js}/Library/Application Support/BelugaRelais`;
const MARGE_HAUTE = 28;
const MARGE_BORD = 2;
const BUNDLE_RECOPIE = 'com.apple.ScreenContinuity';
/** Lu par le démon dans ce fichier : un relais plus ancien que celui servi se met à jour seul (s'il a le lanceur). */
const VERSION_DU_RELAIS = 10;
/** La version de Beluga Connect qui joue ce relais (vide : ancien « Beluga Relais »). */
const VERSION_CONNECT = (() => {
  const v = $.NSProcessInfo.processInfo.environment.objectForKey('BELUGA_CONNECT_VERSION');
  return v && !v.isNil() ? String(v.js).replace(/[^0-9.]/g, '') : '';
})();
let aOuvrir = null;
/** Joué par le lanceur fixe (`lanceur.js`) : il peut alors se remplacer sans recompiler l'application. */
const SOUS_LANCEUR = typeof LANCEUR !== 'undefined' && LANCEUR === true;
let aRelancer = false;

function sh(commande) {
  return app.doShellScript(commande);
}
function q(texte) {
  return `'${String(texte).replace(/'/g, `'\\''`)}'`;
}
function lireConfig() {
  return JSON.parse(sh(`cat ${q(`${DOSSIER}/config.json`)}`));
}
function journal(texte) {
  try {
    sh(`printf '%s\\n' ${q(`${new Date().toISOString()} ${texte}`)} >> ${q(`${DOSSIER}/relais.log`)}`);
  } catch (e) {}
}

// --- La voie signée ----------------------------------------------------------------------------------------------

/* DEUX DEMANDES SIGNÉES DANS LA MÊME SECONDE AU MÊME CORPS SONT REFUSÉES COMME UN REJEU (401) : le téléchargement de
   l'extension, signé juste après l'attente (corps vide aussi), tombait ainsi au hasard (carte « Beluga Connect :
   liaison et suivi », 22/11/2026). Chaque signature prend donc une seconde neuve. */
let derniereSeconde = 0;
function signer(config, corpsFichier) {
  while (Math.floor(Date.now() / 1000) <= derniereSeconde) delay(0.15);
  const ts = Math.floor(Date.now() / 1000);
  derniereSeconde = ts;
  const empreinte = corpsFichier ? sh(`shasum -a 256 ${q(corpsFichier)} | cut -d' ' -f1`) : sh(`printf '' | shasum -a 256 | cut -d' ' -f1`);
  const message = `${ts}.${config.identifiant}.${empreinte}`;
  const sig = sh(`printf '%s' ${q(message)} | openssl dgst -sha256 -hmac ${q(config.secret)} -binary | base64 | tr '+/' '-_' | tr -d '='`);
  return `-H ${q(`x-relais-id: ${config.identifiant}`)} -H ${q(`x-relais-ts: ${ts}`)} -H ${q(`x-relais-sig: ${sig}`)}`;
}

function attendre(config, etat) {
  const oui = (v) => (v === true ? 1 : v === false ? 0 : '');
  const url = `${config.base}/api/relais-mac/attendre?recopie=${etat.recopie ? 1 : 0}&verrouille=${etat.verrouille ? 1 : 0}&acces=${oui(etat.accessibilite)}&ecran=${oui(etat.ecran)}&v=${VERSION_DU_RELAIS}&lanceur=${SOUS_LANCEUR ? 1 : 0}${VERSION_CONNECT ? `&connect=${VERSION_CONNECT}` : ''}`;
  const brut = sh(`curl -sS --max-time 40 ${signer(config, null)} ${q(url)}`);
  return brut ? JSON.parse(brut) : {};
}

function repondre(config, reponse) {
  const fichier = `${DOSSIER}/reponse.json`;
  $.NSString.alloc.initWithUTF8String(JSON.stringify(reponse)).writeToFileAtomicallyEncodingError(fichier, true, $.NSUTF8StringEncoding, null);
  sh(`curl -sS --max-time 60 -X POST -H 'content-type: application/json' ${signer(config, fichier)} --data-binary @${q(fichier)} ${q(`${config.base}/api/relais-mac/reponse`)}`);
}

// --- La fenêtre de recopie ---------------------------------------------------------------------------------------

function fenetreDeRecopie() {
  const liste = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1, 0))) || [];
  for (const w of liste) {
    if (w.kCGWindowLayer !== 0) continue;
    const appli = $.NSRunningApplication.runningApplicationWithProcessIdentifier(w.kCGWindowOwnerPID);
    const bundle = appli && !appli.isNil() ? ObjC.unwrap(appli.bundleIdentifier) : '';
    if (bundle !== BUNDLE_RECOPIE) continue;
    const b = w.kCGWindowBounds;
    if (!b || b.Width < 100 || b.Height < 100) continue;
    return { id: w.kCGWindowNumber, pid: w.kCGWindowOwnerPID, x: b.X, y: b.Y, largeur: b.Width, hauteur: b.Height };
  }
  return null;
}

function macVerrouille() {
  try {
    const session = ObjC.deepUnwrap(ObjC.castRefToObject($.CGSessionCopyCurrentDictionary())) || {};
    return session.CGSSessionScreenIsLocked === true || session.CGSSessionScreenIsLocked === 1;
  } catch (e) {
    return false;
  }
}

function etatCourant() {
  return { recopie: !!fenetreDeRecopie(), verrouille: macVerrouille(), ...autorisations() };
}

// --- Les autorisations de macOS ----------------------------------------------------------------------------------

const REGLAGES = {
  accessibilite: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  ecran: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  /* La fenêtre « Activer » de Beluga Connect lui-même (« La rouvrir sur le Mac », 22/11/2026). */
  aide: 'beluga-connect://autorisations',
};

/** Accessibilité : vraie, fausse, ou `null` si macOS ne répond pas. Ne demande rien. */
function accessibiliteAccordee() {
  try {
    return !!$.AXIsProcessTrusted();
  } catch (e) {
    return null;
  }
}

/**
 * Enregistrement de l'écran : `CGPreflightScreenCaptureAccess` quand le pont le connaît ; sinon, le signe connu :
 * sans l'autorisation, macOS cache le TITRE des fenêtres des autres applications. Aucune fenêtre à juger : `null`.
 */
function ecranAccorde() {
  try {
    if (typeof $.CGPreflightScreenCaptureAccess === 'function') return !!$.CGPreflightScreenCaptureAccess();
  } catch (e) {}
  try {
    const moi = $.NSProcessInfo.processInfo.processIdentifier;
    const liste = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1, 0))) || [];
    const autres = liste.filter((w) => w.kCGWindowOwnerPID !== moi && w.kCGWindowLayer === 0 && w.kCGWindowOwnerName !== 'Dock');
    if (!autres.length) return null;
    return autres.some((w) => typeof w.kCGWindowName === 'string');
  } catch (e) {
    return null;
  }
}

function autorisations() {
  return { accessibilite: accessibiliteAccordee(), ecran: ecranAccorde() };
}

/** Faire demander par macOS les autorisations qui manquent : la demande inscrit « Beluga Relais » dans la liste. */
function demanderLesAutorisations(quoi) {
  if (quoi !== 'ecran' && accessibiliteAccordee() !== true) {
    try {
      $.AXIsProcessTrustedWithOptions($({ AXTrustedCheckOptionPrompt: true }));
    } catch (e) {
      journal(`demande d'accessibilité impossible : ${e}`);
    }
  }
  if (quoi !== 'accessibilite' && ecranAccorde() !== true) {
    try {
      if (typeof $.CGRequestScreenCaptureAccess === 'function') $.CGRequestScreenCaptureAccess();
      else sh(`screencapture -x ${q(`${DOSSIER}/essai-ecran.png`)}; rm -f ${q(`${DOSSIER}/essai-ecran.png`)}`);
    } catch (e) {
      journal(`demande d'enregistrement de l'écran impossible : ${e}`);
    }
  }
}

/** Rouvrir l'écran des réglages d'UNE autorisation, après l'avoir redemandée (rien d'autre ne s'ouvre). */
function ouvrirUnReglage(quoi) {
  const url = REGLAGES[quoi];
  if (!url) throw new Error('réglage inconnu');
  if (quoi !== 'aide') demanderLesAutorisations(quoi);
  $.NSWorkspace.sharedWorkspace.openURL($.NSURL.URLWithString(url));
  return { ouvert: quoi };
}

/** Premier démarrage après l'installation : l'installateur a posé « demander ». */
function premierDemarrage() {
  const marque = `${DOSSIER}/demander`;
  if (!$.NSFileManager.defaultManager.fileExistsAtPath(marque)) return;
  $.NSFileManager.defaultManager.removeItemAtPathError(marque, null);
  journal('premier démarrage : demande des autorisations');
  demanderLesAutorisations();
  /* Les frappes passent par System Events : macOS demande aussi l'accord d'« automatisation ». */
  try {
    Application('System Events').name();
  } catch (e) {}
}

function activer(fenetre) {
  $.NSRunningApplication.runningApplicationWithProcessIdentifier(fenetre.pid).activateWithOptions(2);
  delay(0.15);
}

function pointBorne(fx, fy, f) {
  if (!(fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1)) return null;
  const x = f.x + fx * f.largeur;
  const y = f.y + fy * f.hauteur;
  if (x < f.x + MARGE_BORD || x > f.x + f.largeur - MARGE_BORD) return null;
  if (y < f.y + MARGE_HAUTE || y > f.y + f.hauteur - MARGE_BORD) return null;
  return { x: Math.round(x), y: Math.round(y) };
}

function souris(type, p) {
  const ev = $.CGEventCreateMouseEvent(null, type, $.CGPointMake(p.x, p.y), 0);
  $.CGEventPost(0, ev);
}

function exigerLaFenetre() {
  if (macVerrouille()) throw new Error('le Mac est verrouillé');
  const f = fenetreDeRecopie();
  if (!f) throw new Error('la recopie de l’iPhone n’est pas ouverte');
  return f;
}

function frappe(code, commande) {
  const se = Application('System Events');
  if (commande) se.keyCode(code, { using: 'command down' });
  else se.keyCode(code);
}

// --- Les gestes --------------------------------------------------------------------------------------------------

const TOUCHES = { entree: 36, effacer: 51, tab: 48, echap: 53, espace: 49 };

function jouer(commande) {
  const surLOrdinateur = jouerSurLOrdinateur(commande);
  if (surLOrdinateur !== undefined) return surLOrdinateur;
  const a = commande.args || {};
  switch (commande.geste) {
    case 'etat':
      return etatCourant();
    case 'ouvrir_recopie': {
      sh(`open -b ${BUNDLE_RECOPIE}`);
      for (let i = 0; i < 20 && !fenetreDeRecopie(); i++) delay(0.5);
      return { recopie: !!fenetreDeRecopie() };
    }
    case 'capturer': {
      const f = exigerLaFenetre();
      const fichier = `${DOSSIER}/capture.png`;
      sh(`screencapture -x -o -l ${f.id} ${q(fichier)}`);
      return { png: sh(`base64 -i ${q(fichier)} | tr -d '\\n'`), largeur: f.largeur, hauteur: f.hauteur };
    }
    case 'toucher': {
      const f = exigerLaFenetre();
      const p = pointBorne(a.x, a.y, f);
      if (!p) throw new Error('point hors de la fenêtre de recopie : refusé');
      activer(f);
      souris(1, p);
      delay(0.06);
      souris(2, p);
      return { texte: 'Touché.' };
    }
    case 'glisser': {
      const f = exigerLaFenetre();
      const de = pointBorne(a.x, a.y, f);
      const vers = pointBorne(a.x2, a.y2, f);
      if (!de || !vers) throw new Error('point hors de la fenêtre de recopie : refusé');
      activer(f);
      souris(1, de);
      for (let i = 1; i <= 12; i++) {
        delay(0.02);
        souris(6, { x: de.x + ((vers.x - de.x) * i) / 12, y: de.y + ((vers.y - de.y) * i) / 12 });
      }
      souris(2, vers);
      return { texte: 'Glissé.' };
    }
    case 'taper': {
      const f = exigerLaFenetre();
      activer(f);
      Application('System Events').keystroke(String(a.texte || ''));
      return {};
    }
    case 'touche': {
      const f = exigerLaFenetre();
      const code = TOUCHES[a.touche];
      if (code === undefined) throw new Error('touche inconnue');
      activer(f);
      frappe(code, false);
      return {};
    }
    case 'accueil': {
      const f = exigerLaFenetre();
      activer(f);
      frappe(18, true); // Cmd+1 : écran d'accueil de l'iPhone
      return {};
    }
    case 'ouvrir_appli': {
      const f = exigerLaFenetre();
      activer(f);
      frappe(20, true); // Cmd+3 : recherche de l'iPhone
      delay(0.6);
      Application('System Events').keystroke(String(a.nom || ''));
      delay(0.8);
      frappe(36, false);
      return {};
    }
    case 'se_connecter': {
      const f = exigerLaFenetre();
      activer(f);
      if (a.identifiant) {
        Application('System Events').keystroke(String(a.identifiant));
        frappe(48, false);
        delay(0.2);
      }
      Application('System Events').keystroke(String(a.motDePasse || ''));
      return {};
    }
    default:
      throw new Error(`geste inconnu : ${commande.geste}`);
  }
}

// --- L'ordinateur : applications, navigateur, éveil --------------------------------------------------------------

const DOSSIERS_D_APPLICATIONS = ['/Applications', '/System/Applications', '/Applications/Utilities', '/System/Applications/Utilities'];
const NAVIGATEURS = { chrome: 'com.google.Chrome', safari: 'com.apple.Safari' };

/*
 * LES NAVIGATEURS AU CHOIX (relais 9, carte « Navigateurs facultatifs à la liaison », 22/11/2026). Chaque navigateur de
 * la famille Chromium reçoit LA MÊME extension que Chrome, par le même déroulé (mode développeur posé dans ses
 * préférences, « Charger l'extension non empaquetée » sur SA page d'extensions, code de liaison posé à côté) : seuls
 * changent son identifiant d'application, son nom de processus, le dossier de ses profils et sa page d'extensions.
 * `NAV` est le navigateur visé par le geste EN COURS (le relais joue un geste à la fois) ; Chrome par défaut.
 */
const SUPPORT = `${$.NSHomeDirectory().js}/Library/Application Support`;
const FICHES_CHROMIUM = {
  chrome: { marque: 'chrome', nom: 'Chrome', bundle: 'com.google.Chrome', processus: 'Google Chrome', prefs: `${SUPPORT}/Google/Chrome`, page: 'chrome://extensions/' },
  edge: { marque: 'edge', nom: 'Edge', bundle: 'com.microsoft.edgemac', processus: 'Microsoft Edge', prefs: `${SUPPORT}/Microsoft Edge`, page: 'edge://extensions/' },
  brave: { marque: 'brave', nom: 'Brave', bundle: 'com.brave.Browser', processus: 'Brave Browser', prefs: `${SUPPORT}/BraveSoftware/Brave-Browser`, page: 'brave://extensions/' },
  arc: { marque: 'arc', nom: 'Arc', bundle: 'company.thebrowser.Browser', processus: 'Arc', prefs: `${SUPPORT}/Arc/User Data`, page: 'arc://extensions/' },
  opera: { marque: 'opera', nom: 'Opera', bundle: 'com.operasoftware.Opera', processus: 'Opera', prefs: `${SUPPORT}/com.operasoftware.Opera`, page: 'opera://extensions/' },
  vivaldi: { marque: 'vivaldi', nom: 'Vivaldi', bundle: 'com.vivaldi.Vivaldi', processus: 'Vivaldi', prefs: `${SUPPORT}/Vivaldi`, page: 'vivaldi://extensions/' },
  chromium: { marque: 'chromium', nom: 'Chromium', bundle: 'org.chromium.Chromium', processus: 'Chromium', prefs: `${SUPPORT}/Chromium`, page: 'chrome://extensions/' },
};
/** Tous les navigateurs que le relais sait reconnaître, Chromium ou non (détection). */
const BUNDLES_DES_NAVIGATEURS = {
  chrome: 'com.google.Chrome',
  safari: 'com.apple.Safari',
  firefox: 'org.mozilla.firefox',
  edge: 'com.microsoft.edgemac',
  brave: 'com.brave.Browser',
  arc: 'company.thebrowser.Browser',
  opera: 'com.operasoftware.Opera',
  vivaldi: 'com.vivaldi.Vivaldi',
  chromium: 'org.chromium.Chromium',
  orion: 'com.kagi.kagimacOS',
};
let NAV = FICHES_CHROMIUM.chrome;

/** Viser un navigateur de la famille Chromium pour le geste en cours ; une marque inconnue est refusée. */
function viser(marque) {
  const fiche = FICHES_CHROMIUM[marque || 'chrome'];
  if (!fiche) throw new Error(`navigateur inconnu : ${marque}`);
  NAV = fiche;
  return fiche;
}

/** Le dossier fixe de l'extension pour le navigateur visé : un par navigateur (chacun lit SON code de liaison). */
function dossierFixe() {
  return NAV.marque === 'chrome' ? DOSSIER_EXTENSION_FIXE : `${SUPPORT}/Beluga/extension-${NAV.marque}`;
}

/**
 * LES NAVIGATEURS INSTALLÉS (geste `navigateurs_installes`) : cherchés PAR IDENTIFIANT D'APPLICATION, jamais par
 * chemin (un navigateur peut vivre dans ~/Applications ou Setapp), avec leur version et celui ouvert par défaut.
 */
function navigateursInstalles() {
  const ws = $.NSWorkspace.sharedWorkspace;
  let parDefaut = '';
  try {
    const url = ws.URLForApplicationToOpenURL($.NSURL.URLWithString('https://example.com'));
    const b = url && !url.isNil() ? $.NSBundle.bundleWithURL(url) : null;
    parDefaut = b && !b.isNil() ? ObjC.unwrap(b.bundleIdentifier) : '';
  } catch (e) {}
  const trouves = [];
  for (const marque of Object.keys(BUNDLES_DES_NAVIGATEURS)) {
    const bundle = BUNDLES_DES_NAVIGATEURS[marque];
    const url = ws.URLForApplicationWithBundleIdentifier(bundle);
    if (!url || url.isNil()) continue;
    let version = null;
    try {
      const b = $.NSBundle.bundleWithURL(url);
      const v = b && !b.isNil() ? b.objectForInfoDictionaryKey('CFBundleShortVersionString') : null;
      version = v && !v.isNil() ? ObjC.unwrap(v) : null;
    } catch (e) {}
    trouves.push({ marque, version, parDefaut: bundle === parDefaut });
  }
  return { navigateurs: trouves };
}

/** Les applications installées : nom (sans « .app ») → chemin. Lu sur le disque, jamais par une commande composée. */
function applicationsInstallees() {
  const gestionnaire = $.NSFileManager.defaultManager;
  const dossiers = [...DOSSIERS_D_APPLICATIONS, `${$.NSHomeDirectory().js}/Applications`];
  const trouvees = {};
  for (const dossier of dossiers) {
    const contenu = ObjC.deepUnwrap(gestionnaire.contentsOfDirectoryAtPathError(dossier, null)) || [];
    for (const nom of contenu) {
      if (typeof nom === 'string' && nom.endsWith('.app') && !trouvees[nom.slice(0, -4)]) trouvees[nom.slice(0, -4)] = `${dossier}/${nom}`;
    }
  }
  return trouvees;
}

function sansAccents(texte) {
  return String(texte).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/** Ouvrir une application PAR SON CHEMIN, après l'avoir trouvée dans la liste : un nom inconnu est refusé. */
function ouvrirUneApplication(demandee) {
  const nom = String(demandee || '').replace(/\.app$/i, '').trim();
  if (!nom || nom.length > 80 || /[\/\u0000-\u001f]/.test(nom)) throw new Error('nom d’application refusé');
  const installees = applicationsInstallees();
  const cle = sansAccents(nom);
  const trouvee = Object.keys(installees).find((a) => sansAccents(a) === cle);
  if (!trouvee) throw new Error(`aucune application « ${nom} » sur ce Mac`);
  const url = $.NSURL.fileURLWithPath(installees[trouvee]);
  const ok = $.NSWorkspace.sharedWorkspace.openURL(url);
  if (!ok) throw new Error(`« ${trouvee} » ne s’ouvre pas`);
  return trouvee;
}

/** Ouvrir (ou passer devant) le navigateur Chromium visé par le geste en cours. */
function ouvrirLeNavigateurVise() {
  const url = $.NSWorkspace.sharedWorkspace.URLForApplicationWithBundleIdentifier(NAV.bundle);
  if (!url || url.isNil()) throw new Error(`${NAV.nom} n’est pas installé`);
  $.NSWorkspace.sharedWorkspace.openURL(url);
}

function relancerLeNavigateur(genre) {
  const bundle = NAVIGATEURS[genre];
  if (!bundle) throw new Error('navigateur inconnu');
  const url = $.NSWorkspace.sharedWorkspace.URLForApplicationWithBundleIdentifier(bundle);
  if (!url || url.isNil()) throw new Error(`${genre === 'safari' ? 'Safari' : 'Chrome'} n’est pas installé`);
  $.NSWorkspace.sharedWorkspace.openURL(url);
  return { relance: genre };
}

/** Le vrai nom du Mac (« Mac mini de Haiko »), donné au démon pour nommer l'ordinateur. */
function nomDuMac() {
  try {
    return ObjC.unwrap($.NSHost.currentHost.localizedName) || '';
  } catch (e) {
    return '';
  }
}

/**
 * GARDER LE MAC ÉVEILLÉ tant que le relais tourne : `caffeinate -i -s -w <pid>` s'arrête tout seul à la mort du relais.
 * Un caffeinate laissé par un relais précédent (même pid surveillé introuvable) meurt de lui-même.
 */
function garderEveille() {
  try {
    const pid = $.NSProcessInfo.processInfo.processIdentifier;
    sh(`/usr/bin/caffeinate -i -s -w ${Number(pid)} >/dev/null 2>&1 &`);
    journal(`Mac gardé éveillé (relais ${pid})`);
  } catch (e) {
    journal(`caffeinate impossible : ${e}`);
  }
}

// --- L'extension Chrome et le relais lui-même : mises à jour vérifiées ------------------------------------------

/** Le dossier des profils du navigateur visé (Chrome par défaut). */
function preferencesDuNavigateur() {
  return NAV.prefs;
}
/** Chrome range une extension « chargée non empaquetée » sous ce genre (Manifest::Location UNPACKED). */
const EXTENSION_NON_EMPAQUETEE = 4;

function existe(chemin) {
  return $.NSFileManager.defaultManager.fileExistsAtPath(chemin);
}

function lireJson(chemin) {
  try {
    const texte = $.NSString.stringWithContentsOfFileEncodingError(chemin, $.NSUTF8StringEncoding, null);
    return texte && !texte.isNil() ? JSON.parse(texte.js) : null;
  } catch (e) {
    return null;
  }
}

function hoteDe(adresse) {
  const m = /^https?:\/\/([^/:]+)/i.exec(String(adresse || ''));
  return m ? m[1].toLowerCase() : '';
}

/** Un dossier d'extension Beluga : son manifeste, son service worker, son panneau et la configuration de l'installation. */
function dossierBeluga(chemin) {
  const conf = lireJson(`${chemin}/config.json`);
  return !!(conf && typeof conf.adresse === 'string' && lireJson(`${chemin}/manifest.json`) && existe(`${chemin}/service-worker.js`) && existe(`${chemin}/panneau.html`));
}

/**
 * LES DOSSIERS DE L'EXTENSION BELUGA, lus dans les préférences de CHAQUE profil de Chrome (« Default », « Profile N ») :
 * `extensions.settings[id].path` des extensions non empaquetées. L'identifiant donné par le démon fait foi ; sans lui
 * (extension d'avant 1.0.11), on garde les dossiers Beluga dont la configuration vise le même serveur que ce relais.
 */
function dossiersDeLExtension(config, extensionId) {
  const profils = (ObjC.deepUnwrap($.NSFileManager.defaultManager.contentsOfDirectoryAtPathError(preferencesDuNavigateur(), null)) || []).filter(
    (n) => n === 'Default' || /^Profile \d+$/.test(n),
  );
  /* Opera range son profil à la racine de son dossier, sans « Default ». */
  if (existe(`${preferencesDuNavigateur()}/Preferences`)) profils.push('.');
  const trouves = {};
  for (const profil of profils) {
    for (const fichier of ['Secure Preferences', 'Preferences']) {
      const prefs = lireJson(`${preferencesDuNavigateur()}/${profil}/${fichier}`);
      const reglages = (prefs && prefs.extensions && prefs.extensions.settings) || {};
      for (const id of Object.keys(reglages)) {
        const r = reglages[id] || {};
        if (r.location !== EXTENSION_NON_EMPAQUETEE || typeof r.path !== 'string' || r.path.charAt(0) !== '/') continue;
        if (extensionId && id !== extensionId) continue;
        if (!dossierBeluga(r.path)) continue;
        trouves[r.path] = { chemin: r.path, id, profil, hote: hoteDe((lireJson(`${r.path}/config.json`) || {}).adresse) };
      }
    }
  }
  const tous = Object.keys(trouves).map((k) => trouves[k]);
  if (extensionId) return tous;
  const memeServeur = tous.filter((d) => d.hote === hoteDe(config.base));
  return memeServeur.length ? memeServeur : tous.length === 1 ? tous : [];
}

/** Télécharger par la voie signée, puis comparer l'empreinte : rien ne se remplace sur un fichier altéré. */
function telechargerVerifie(config, chemin, fichier, empreinte) {
  sh(`curl -fsS --max-time 90 ${signer(config, null)} -o ${q(fichier)} ${q(`${config.base}${chemin}`)}`);
  const lue = sh(`shasum -a 256 ${q(fichier)} | cut -d' ' -f1`);
  if (lue !== empreinte) throw new Error('paquet altéré (empreinte différente) : rien n’a été remplacé');
}

/** Chrome tourne-t-il ? */
function chromeOuvert() {
  return $.NSRunningApplication.runningApplicationsWithBundleIdentifier(NAV.bundle).count > 0;
}

/** Quitter Chrome PROPREMENT (comme Cmd+Q) et attendre sa fermeture ; forcée au bout de 20 s. */
function quitterChrome() {
  const lesquels = () => $.NSRunningApplication.runningApplicationsWithBundleIdentifier(NAV.bundle);
  const ouverts = lesquels();
  for (let i = 0; i < ouverts.count; i++) ouverts.objectAtIndex(i).terminate;
  for (let essai = 0; essai < 40 && lesquels().count > 0; essai++) delay(0.5);
  if (lesquels().count > 0) {
    journal(`${NAV.nom} ne s’est pas fermé en 20 s : fermeture forcée`);
    const restants = lesquels();
    for (let i = 0; i < restants.count; i++) restants.objectAtIndex(i).forceTerminate;
    delay(2);
  }
  delay(1);
}

/**
 * ROUVRIR CHROME AVEC SES ONGLETS, ET LE VÉRIFIER (22/11/2026 : l'étape « Chrome rouvert avec vos onglets » échouait
 * chez l'utilisateur sans que rien ne le dise). Quitté proprement, Chrome ne rouvre sa session que si la personne l'a
 * réglé ainsi ; `--restore-last-session` la rouvre dans tous les cas. Trois façons de l'ouvrir, puis on regarde.
 */
function rouvrirChrome() {
  const essais = [
    () => sh(`/usr/bin/open -b ${q(NAV.bundle)} --args --restore-last-session`),
    () => sh(`/usr/bin/open -a ${q(NAV.processus)} --args --restore-last-session`),
    () => ouvrirLeNavigateurVise(),
  ];
  for (const ouvrir of essais) {
    try {
      ouvrir();
    } catch (e) {
      journal(`réouverture de Chrome : ${e}`);
    }
    for (let i = 0; i < 20 && !chromeOuvert(); i++) delay(0.5);
    if (chromeOuvert()) {
      delay(1.5);
      return true;
    }
  }
  journal(`${NAV.nom} ne s’est pas rouvert`);
  return false;
}

/** Quitter Chrome PROPREMENT, attendre sa fermeture, puis le rouvrir avec ses onglets : l'extension se relit du disque. */
function quitterEtRouvrirChrome() {
  quitterChrome();
  return rouvrirChrome();
}

function mettreAJourLExtension(config, a) {
  /* Relais 9 : la mise à jour vise le navigateur de l'extension (Edge, Brave…), Chrome par défaut. */
  viser(FICHES_CHROMIUM[a.marque] ? a.marque : 'chrome');
  try {
    return mettreAJourLExtensionVisee(config, a);
  } finally {
    viser('chrome');
  }
}

function mettreAJourLExtensionVisee(config, a) {
  if (!/^[0-9a-f]{64}$/.test(String(a.empreinte || ''))) throw new Error('empreinte du paquet absente');
  if (!/^\/api\/relais-mac\/extension\.zip\?jeton=[A-Za-z0-9_-]{8,64}$/.test(String(a.chemin || ''))) throw new Error('adresse du paquet refusée');
  if (!/^\d+(\.\d+){1,3}$/.test(String(a.version || ''))) throw new Error('version attendue absente');
  const extensionId = /^[a-p]{32}$/.test(String(a.extensionId || '')) ? a.extensionId : null;
  const dossiers = dossiersDeLExtension(config, extensionId);
  if (!dossiers.length) throw new Error('dossier de l’extension Beluga introuvable dans les profils de Chrome de ce Mac');
  const travail = `${DOSSIER}/extension-neuve`;
  sh(`rm -rf ${q(travail)} && mkdir -p ${q(travail)}`);
  try {
    const zip = `${travail}/beluga-chrome.zip`;
    telechargerVerifie(config, a.chemin, zip, a.empreinte);
    sh(`/usr/bin/ditto -x -k ${q(zip)} ${q(travail)}`);
    const source = `${travail}/beluga-chrome`;
    const lu = lireJson(`${source}/manifest.json`);
    if (!lu || lu.version !== a.version) throw new Error(`paquet inattendu (version ${lu ? lu.version : 'illisible'})`);
    dossiers.forEach((d, i) => {
      const garde = `${travail}/config-${i}.json`;
      sh(`/bin/cp ${q(`${d.chemin}/config.json`)} ${q(garde)}`);
      sh(`/usr/bin/ditto ${q(source)} ${q(d.chemin)}`);
      sh(`/bin/cp ${q(garde)} ${q(`${d.chemin}/config.json`)}`);
      const apres = lireJson(`${d.chemin}/manifest.json`);
      if (!apres || apres.version !== a.version) throw new Error(`le dossier ${d.chemin} n’a pas pris la version ${a.version}`);
      journal(`extension Beluga mise à jour en ${a.version} : ${d.chemin} (${d.id}, ${d.profil})`);
    });
  } finally {
    sh(`rm -rf ${q(travail)}`);
  }
  if (a.relancer === true) quitterEtRouvrirChrome();
  return { version: a.version, dossiers: dossiers.map((d) => ({ chemin: d.chemin, id: d.id, profil: d.profil })), relance: a.relancer === true };
}

/** Le relais se remplace lui-même (sous le lanceur seulement) puis s'arrête : launchd le relance sur le fichier neuf. */
function seMettreAJour(config, a) {
  if (!SOUS_LANCEUR) throw new Error('ce programme ne sait pas se remplacer seul : relancez la commande d’installation');
  if (!/^[0-9a-f]{64}$/.test(String(a.empreinte || ''))) throw new Error('empreinte du relais absente');
  const neuf = `${DOSSIER}/relais-neuf.js`;
  telechargerVerifie(config, '/api/relais-mac/relais.js', neuf, a.empreinte);
  sh(`/bin/mv -f ${q(neuf)} ${q(`${DOSSIER}/relais.js`)}`);
  journal('relais remplacé : redémarrage sur la nouvelle version');
  aRelancer = true;
  return { remplace: true };
}

// --- Beluga Connect : l'extension posée et ajoutée à Chrome, la navigation privée, la migration ------------------

const DOSSIER_EXTENSION_FIXE = `${$.NSHomeDirectory().js}/Library/Application Support/Beluga/extension-chrome`;
const EQUIPE_APPLE = 'X6ZLFDBZ7M';

/** Les libellés de chrome://extensions dans les langues de Beluga (français, anglais, espagnol, allemand, chinois). */
const LIBELLES = {
  modeDev: /mode d[ée]veloppeur|developer mode|modo de desarrollador|entwicklermodus|开发者模式/i,
  charger: /non empaquet|load unpacked|sin empaquetar|entpackte erweiterung|加载已解压/i,
  prive: /navigation priv[ée]e|incognito|inc[óo]gnito|inkognito|无痕/i,
};

function texteDe(el) {
  let t = '';
  for (const p of ['name', 'description', 'title']) {
    try {
      const v = el[p]();
      if (v) t += ` ${v}`;
    } catch (e) {}
  }
  return t;
}

/**
 * Chercher dans la fenêtre de Chrome (arbre d'accessibilité, contenu web compris) le premier élément du rôle voulu
 * dont le texte répond au motif. Parcours en largeur, borné en temps et en nombre d'éléments.
 */
function chercherDansChrome(proc, roles, motif, delaiS) {
  const fin = Date.now() + delaiS * 1000;
  while (Date.now() < fin) {
    let file = [];
    try {
      file = proc.windows().slice(0, 1);
    } catch (e) {}
    let vus = 0;
    while (file.length && vus < 4000 && Date.now() < fin) {
      const el = file.shift();
      vus += 1;
      let role = '';
      try {
        role = el.role();
      } catch (e) {}
      if (roles.indexOf(role) >= 0 && motif.test(texteDe(el))) return el;
      try {
        file = file.concat(el.uiElements());
      } catch (e) {}
    }
    delay(0.8);
  }
  return null;
}

function valeurCochee(el) {
  try {
    const v = el.value();
    return v === 1 || v === true || v === '1';
  } catch (e) {
    return false;
  }
}

function appuyer(el) {
  try {
    el.actions.byName('AXPress').perform();
  } catch (e) {
    el.click();
  }
}

/** Le titre de la fenêtre de devant de Chrome (« Extensions », « Erweiterungen »…), ou vide. */
function titreDeChrome(proc) {
  try {
    const f = proc.windows();
    return f.length ? String(f[0].name() || '') : '';
  } catch (e) {
    return '';
  }
}

/** Le titre de la page des extensions dans les langues de Beluga. */
const TITRE_EXTENSIONS = /^(extensions|erweiterungen|extensiones|扩展程序)( [-–—] .*)?$/i;

/**
 * Ouvrir une adresse dans un nouvel onglet de Chrome au clavier (les pages chrome:// ne s'ouvrent pas autrement).
 * L'accessibilité du contenu web est demandée AVANT de naviguer, puis on attend le TITRE de la page (`attendu`) au lieu
 * d'un délai fixe : la page lente d'un Mac chargé faisait chercher l'interrupteur dans une page encore vide. Rend le
 * processus et `ouvert` : vrai si un onglet a été ouvert pour l'occasion (à refermer ensuite).
 */
function ouvrirDansChrome(adresse, attendu, { fenetreAPart = false } = {}) {
  const se = Application('System Events');
  if (!chromeOuvert()) rouvrirChrome();
  else ouvrirLeNavigateurVise();
  const proc = se.processes.byName(NAV.processus);
  for (let i = 0; i < 20; i++) {
    try {
      if (proc.windows().length > 0) break;
    } catch (e) {}
    delay(0.5);
  }
  try {
    proc.frontmost = true;
  } catch (e) {}
  /* Le contenu des pages n'est exposé à l'accessibilité que sur demande : avant la navigation, pas après. */
  try {
    proc.attributes.byName('AXManualAccessibility').value = true;
  } catch (e) {}
  try {
    proc.attributes.byName('AXEnhancedUserInterface').value = true;
  } catch (e) {}
  delay(0.4);
  /* Un onglet de la page déjà devant : on le réutilise, rien à refermer ensuite. `fenetreAPart` (navigation privée,
     carte « Beluga Connect : liaison sans fenêtre ») : une petite fenêtre à elle, jamais un onglet glissé parmi ceux de
     la personne, refermée d'un seul Cmd+W. */
  const dejaLa = !fenetreAPart && attendu && attendu.test(titreDeChrome(proc));
  se.keystroke(dejaLa ? 'l' : fenetreAPart ? 'n' : 't', { using: 'command down' });
  if (fenetreAPart) {
    delay(0.6);
    try {
      const f = proc.windows[0];
      f.size = [560, 420];
      f.position = [80, 80];
    } catch (e) {}
  }
  delay(0.6);
  se.keystroke(adresse);
  delay(0.3);
  se.keyCode(36);
  const fin = Date.now() + 15000;
  while (Date.now() < fin && attendu && !attendu.test(titreDeChrome(proc))) delay(0.4);
  delay(1.2);
  return { proc, ouvert: !dejaLa };
}

/** Refermer l'onglet ouvert pour l'occasion (Cmd+W), seulement s'il montre encore la page attendue. */
function refermerLOnglet(proc, attendu) {
  try {
    if (attendu.test(titreDeChrome(proc))) Application('System Events').keystroke('w', { using: 'command down' });
  } catch (e) {}
}

/** Les fichiers « Preferences » des profils de Chrome (« Default », « Profile N »). */
function preferencesDesProfils() {
  return (ObjC.deepUnwrap($.NSFileManager.defaultManager.contentsOfDirectoryAtPathError(preferencesDuNavigateur(), null)) || [])
    .filter((n) => n === 'Default' || /^Profile \d+$/.test(n))
    .concat(existe(`${preferencesDuNavigateur()}/Preferences`) ? ['.'] : [])
    .map((n) => `${preferencesDuNavigateur()}/${n}/Preferences`)
    .filter((f) => existe(f));
}

/** Le mode développeur est-il déjà allumé dans tous les profils ? */
function modeDeveloppeurPartout() {
  const fichiers = preferencesDesProfils();
  return fichiers.length > 0 && fichiers.every((f) => {
    const p = lireJson(f);
    return !!(p && p.extensions && p.extensions.ui && p.extensions.ui.developer_mode === true);
  });
}

/**
 * ALLUMER LE MODE DÉVELOPPEUR SANS LE CHERCHER À L'ÉCRAN (22/11/2026 : « interrupteur « Mode développeur »
 * introuvable » chez l'utilisateur). Chrome FERMÉ (sinon il réécrit le fichier en quittant), on pose
 * `extensions.ui.developer_mode` dans le « Preferences » de chaque profil : copie de sauvegarde d'abord, JSON relu
 * ensuite ; un fichier qui ne se relit pas est remis tel quel.
 */
function allumerLeModeDeveloppeur() {
  if (chromeOuvert()) return false;
  let poses = 0;
  for (const fichier of preferencesDesProfils()) {
    const prefs = lireJson(fichier);
    if (!prefs) continue;
    prefs.extensions = prefs.extensions || {};
    prefs.extensions.ui = prefs.extensions.ui || {};
    if (prefs.extensions.ui.developer_mode === true) {
      poses += 1;
      continue;
    }
    const garde = `${fichier}.beluga-avant`;
    try {
      sh(`/bin/cp -p ${q(fichier)} ${q(garde)}`);
      prefs.extensions.ui.developer_mode = true;
      $.NSString.alloc.initWithUTF8String(JSON.stringify(prefs)).writeToFileAtomicallyEncodingError(fichier, true, $.NSUTF8StringEncoding, null);
      const relu = lireJson(fichier);
      if (!relu || !relu.extensions || !relu.extensions.ui || relu.extensions.ui.developer_mode !== true) throw new Error('relecture impossible');
      poses += 1;
    } catch (e) {
      journal(`mode développeur non posé dans ${fichier} : ${e}`);
      try {
        sh(`/bin/cp -p ${q(garde)} ${q(fichier)}`);
      } catch (e2) {}
    }
  }
  journal(`mode développeur posé dans ${poses} profil(s) de Chrome`);
  return poses > 0;
}

/** L'extension est-elle VRAIMENT connue de Chrome (ses préférences la nomment, depuis ce dossier) ? */
function extensionPresente(config, dossier, delaiS) {
  const fin = Date.now() + delaiS * 1000;
  while (Date.now() < fin) {
    if (dossiersDeLExtension(config, null).some((d) => d.chemin === dossier)) return true;
    delay(1);
  }
  return false;
}

/** Un essai d'ajout : la page des extensions, l'interrupteur s'il le faut, « Charger l'extension non empaquetée », le chemin. */
function unEssaiDAjout(dossier) {
  const se = Application('System Events');
  const { proc, ouvert } = ouvrirDansChrome(NAV.page, TITRE_EXTENSIONS);
  try {
    let charger = chercherDansChrome(proc, ['AXButton'], LIBELLES.charger, 4);
    if (!charger) {
      /* Bouton absent : le mode développeur n'est pas allumé dans CE profil — on le cherche alors à l'écran. */
      const mode = chercherDansChrome(proc, ['AXCheckBox', 'AXSwitch', 'AXToggle'], LIBELLES.modeDev, 12);
      if (!mode) throw new Error('interrupteur « Mode développeur » introuvable');
      if (!valeurCochee(mode)) {
        appuyer(mode);
        delay(1.5);
      }
      charger = chercherDansChrome(proc, ['AXButton'], LIBELLES.charger, 10);
    }
    if (!charger) throw new Error('bouton « Charger l’extension non empaquetée » introuvable');
    appuyer(charger);
    delay(1.8);
    /* La fenêtre de choix du dossier : « Aller au dossier » (Cmd+Maj+G), le chemin, Entrée, puis « Sélectionner ». */
    se.keystroke('g', { using: ['command down', 'shift down'] });
    delay(1);
    se.keystroke(dossier);
    delay(0.6);
    se.keyCode(36);
    delay(1.5);
    se.keyCode(36);
    delay(3);
  } finally {
    if (ouvert) refermerLOnglet(proc, TITRE_EXTENSIONS);
  }
}

/**
 * AJOUTER LE DOSSIER À CHROME, POUR DE BON (carte « Beluga Connect : liaison et suivi », 22/11/2026). Avant : une
 * seule tentative, un délai fixe, et « ajoutée » écrit sur la foi des frappes. Maintenant : mode développeur posé
 * Chrome fermé (puis Chrome rouvert avec ses onglets), jusqu'à TROIS essais, et l'extension n'est dite ajoutée que si
 * les préférences de Chrome la nomment. Rend { ajoutee, developpeur, rouvert, essais, detail }.
 */
function ajouterDansChrome(config, dossier) {
  if (accessibiliteAccordee() !== true) throw new Error('l’autorisation « Contrôler le Mac » n’est pas encore donnée');
  let developpeur = modeDeveloppeurPartout();
  let rouvert = true;
  if (!developpeur) {
    const etaitOuvert = chromeOuvert();
    if (etaitOuvert) quitterChrome();
    developpeur = allumerLeModeDeveloppeur();
    if (etaitOuvert) rouvert = rouvrirChrome();
  }
  let detail = '';
  for (let essai = 1; essai <= 3; essai++) {
    try {
      unEssaiDAjout(dossier);
    } catch (e) {
      detail = String(e && e.message ? e.message : e);
      journal(`ajout à Chrome, essai ${essai} sur 3 : ${detail}`);
    }
    if (extensionPresente(config, dossier, 20)) {
      journal(`extension ajoutée à Chrome depuis ${dossier} (vérifiée, essai ${essai} sur 3)`);
      if (!chromeOuvert()) rouvert = rouvrirChrome();
      return { ajoutee: true, developpeur: true, rouvert, essais: essai, detail: '' };
    }
    if (!detail) detail = 'Chrome ne montre pas l’extension après l’ajout';
    /* Entre deux essais, Chrome repart de zéro (avec ses onglets). */
    if (essai < 3) rouvert = quitterEtRouvrirChrome();
  }
  if (!chromeOuvert()) rouvert = rouvrirChrome();
  return { ajoutee: false, developpeur, rouvert, essais: 3, detail };
}

/**
 * Cocher « Autoriser en navigation privée » sur la page de l'extension. LE RÉSULTAT EST CELUI DE LA CASE, PLUS UN
 * « OUI » DE PRINCIPE (carte « Beluga Connect : liaison sans fenêtre », 22/11/2026) : l'ancien `|| true` rendait
 * « autorisée » même quand rien n'avait été coché. La preuve finale vient de l'extension elle-même (une vraie fenêtre
 * privée réduite, ouverte puis refermée : geste `verifier_prive`).
 */
function autoriserLaNavigationPrivee(a) {
  viser(a.marque);
  try {
    return autoriserLaNavigationPriveeVisee(a);
  } finally {
    viser('chrome');
  }
}

function autoriserLaNavigationPriveeVisee(a) {
  const id = /^[a-p]{32}$/.test(String(a.extensionId || '')) ? a.extensionId : null;
  if (!id) throw new Error('identifiant de l’extension absent');
  if (accessibiliteAccordee() !== true) throw new Error('l’autorisation « Contrôler le Mac » n’est pas encore donnée');
  const { proc, ouvert } = ouvrirDansChrome(`${NAV.page}?id=${id}`, TITRE_EXTENSIONS, { fenetreAPart: true });
  try {
    const caseP = chercherDansChrome(proc, ['AXCheckBox', 'AXSwitch', 'AXToggle'], LIBELLES.prive, 15);
    if (!caseP) throw new Error('case « Autoriser en navigation privée » introuvable dans Chrome');
    const avant = valeurCochee(caseP);
    if (!avant) appuyer(caseP);
    /* Chrome recharge l'extension en cochant : la case se relit après un temps. */
    let apres = avant;
    for (let i = 0; i < 6 && !apres; i++) {
      delay(0.5);
      apres = valeurCochee(caseP);
    }
    if (!apres) throw new Error('la case « Autoriser en navigation privée » ne s’est pas cochée');
    return { incognito: true, dejaCochee: avant };
  } finally {
    /* L'onglet ouvert pour l'occasion se referme ; celui de la personne, jamais. */
    if (ouvert) refermerLOnglet(proc, TITRE_EXTENSIONS);
  }
}

/* ------------------------------------------------------------------ */
/* SAFARI D'OFFICE, APRÈS CHROME (carte « Beluga Connect : liaison sans fenêtre », 22/11/2026) */
/* ------------------------------------------------------------------ */

/** Le conteneur partagé de l'équipe : l'application « Beluga » pour Safari y lit la fiche de liaison. */
const GROUPE_SAFARI = `${$.NSHomeDirectory().js}/Library/Group Containers/${EQUIPE_APPLE}.studio.haiko.beluga`;
const IDENTIFIANT_SAFARI = 'studio.haiko.beluga';
const LIBELLES_SAFARI = {
  extensions: /^(extensions|erweiterungen|extensiones|扩展)$/i,
  sites: /sites web|websites|sitios web|webseiten|网站/i,
  autoriser: /^(autoriser|allow|permitir|erlauben|允许)$/i,
};

/** L'application « Beluga » pour Safari est-elle posée, et où ? */
function applicationSafari() {
  for (const d of ['/Applications', `${$.NSHomeDirectory().js}/Applications`]) {
    if (existe(`${d}/Beluga.app/Contents/PlugIns`)) return `${d}/Beluga.app`;
  }
  return null;
}

/** L'extension est-elle cochée dans Safari ? Lu par pluginkit (« + » devant l'identifiant) : sans fenêtre. */
function extensionSafariActivee() {
  try {
    const sortie = sh(`/usr/bin/pluginkit -m -v -i ${IDENTIFIANT_SAFARI}.Extension 2>/dev/null || true`);
    if (!sortie.trim()) return null;
    return /^\s*\+/m.test(sortie);
  } catch (e) {
    return null;
  }
}

function etatDeSafari() {
  return { installee: !!applicationSafari(), activee: extensionSafariActivee(), fiche: existe(`${GROUPE_SAFARI}/liaison.json`) };
}

/**
 * INSTALLER L'EXTENSION SAFARI : l'application signée est téléchargée par la voie signée (empreinte vérifiée), son
 * équipe Apple contrôlée, rangée dans Applications, la fiche de liaison posée dans le conteneur partagé, l'application
 * lancée une fois EN ARRIÈRE-PLAN (enregistrement de l'extension) puis refermée, et l'extension COCHÉE dans les
 * réglages de Safari par l'accessibilité (autorisation « Souris et clavier » déjà donnée). Aucun téléchargement ni code
 * pour la personne. Rend ce qui est fait ; un échec le dit en clair.
 */
function installerSafari(config, a) {
  if (!/^[0-9a-f]{64}$/.test(String(a.empreinte || ''))) throw new Error('empreinte du paquet Safari absente');
  if (String(a.chemin || '') !== '/api/relais-mac/extension-safari.zip') throw new Error('adresse du paquet Safari refusée');
  if (!/^\d{6}$/.test(String(a.code || ''))) throw new Error('code de liaison absent');
  /* LE GESTE RÉPOND TOUJOURS À TEMPS (26/11/2026) : Beluga attend six minutes ; au-delà, il ne savait que « le relais
     du Mac n'a pas répondu à temps » (deux fois le 26/11 sur le MacBook) et l'application restait sur « en cours ». Les
     essais de réglage s'arrêtent à quatre minutes et chaque étape s'écrit au journal du Mac. */
  const finDuGeste = Date.now() + 240000;
  journal('Safari : téléchargement de l’application « Beluga »');
  /* 1. L'application. */
  const travail = `${DOSSIER}/safari-neuf`;
  sh(`rm -rf ${q(travail)} && mkdir -p ${q(travail)}`);
  let cible = applicationSafari();
  try {
    telechargerVerifie(config, a.chemin, `${travail}/safari.zip`, a.empreinte);
    sh(`/usr/bin/ditto -x -k ${q(`${travail}/safari.zip`)} ${q(travail)}`);
    const appli = `${travail}/Beluga.app`;
    sh(`/usr/bin/codesign --verify --deep --strict ${q(appli)}`);
    if (sh(`/usr/bin/codesign -dv ${q(appli)} 2>&1`).indexOf(`TeamIdentifier=${EQUIPE_APPLE}`) < 0) throw new Error('application Safari signée par une autre équipe');
    const dossierApplis = sh(`[ -w /Applications ] && echo /Applications || echo "$HOME/Applications"`).trim();
    sh(`mkdir -p ${q(dossierApplis)}`);
    cible = `${dossierApplis}/Beluga.app`;
    sh(`/usr/bin/pkill -x Beluga || true; rm -rf ${q(cible)} && /usr/bin/ditto ${q(appli)} ${q(cible)} && /usr/bin/xattr -dr com.apple.quarantine ${q(cible)} || true`);
  } finally {
    sh(`rm -rf ${q(travail)}`);
  }
  /* 2. La fiche de liaison, lue par l'extension par sa messagerie native. */
  sh(`mkdir -p ${q(GROUPE_SAFARI)}`);
  $.NSString.alloc
    .initWithUTF8String(JSON.stringify({ code: String(a.code), adresse: config.base }))
    .writeToFileAtomicallyEncodingError(`${GROUPE_SAFARI}/liaison.json`, true, $.NSUTF8StringEncoding, null);
  /* 3. L'enregistrement : lancée une fois, cachée (-g -j), puis refermée ; pluginkit en renfort. */
  sh(`/usr/bin/pluginkit -a ${q(`${cible}/Contents/PlugIns/Beluga Extension.appex`)} 2>/dev/null || true`);
  sh(`/usr/bin/open -g -j ${q(cible)} || true`);
  delay(3);
  sh(`/usr/bin/pkill -x Beluga || true`);
  journal(`extension Safari posée dans ${cible}`);
  /* 4. Cochée dans Safari : la case elle-même fait foi (pluginkit ne reflète pas toujours le choix fait dans Safari). */
  const r = cocherDansSafariAvecReprises(finDuGeste);
  return { installee: true, activee: r.activee, sites: r.sites, detail: r.detail, dossier: cible };
}

/** Safari tourne-t-il en ce moment (et pas seulement « a tourné ») ? */
function safariTourne() {
  return $.NSRunningApplication.runningApplicationsWithBundleIdentifier(NAVIGATEURS.safari).count > 0;
}

/**
 * COCHER DANS SAFARI, EN TROIS ESSAIS (carte « Ordinateurs : pannes et volets alignés », 22/11/2026). Le 22/11, Safari
 * a planté pendant le réglage et l'onglet « Extensions » est resté introuvable : un seul essai suffisait à déclarer
 * l'échec. Désormais, avant chaque nouvel essai, la fenêtre des réglages est refermée, Safari est RELANCÉ s'il ne tourne
 * plus (jamais quitté de force quand il tourne : les onglets de la personne restent), puis on attend qu'il réponde.
 * Le message final dit ce qui a été tenté.
 */
function cocherDansSafariAvecReprises(finDuGeste) {
  const ESSAIS = 3;
  let relance = false;
  let detail = '';
  for (let essai = 1; essai <= ESSAIS; essai++) {
    if (finDuGeste && essai > 1 && Date.now() > finDuGeste) {
      detail = `${detail || 'réglage trop long'} — arrêté après ${essai - 1} essai(s) pour répondre à temps`;
      break;
    }
    journal(`Safari : réglage de l’extension, essai ${essai} sur ${ESSAIS}`);
    try {
      if (essai > 1) {
        if (!safariTourne()) {
          journal('Safari ne tourne plus : relance avant un nouvel essai');
          sh(`/usr/bin/open -g -b ${NAVIGATEURS.safari} || true`);
          relance = true;
          for (let i = 0; i < 20 && !safariTourne(); i++) delay(0.5);
          delay(3);
        } else {
          /* Une fenêtre de réglages restée ouverte (ou une feuille) : Échap puis Cmd+W, sans toucher aux onglets. */
          try {
            const se = Application('System Events');
            se.keyCode(53);
            delay(0.4);
          } catch (e) {}
          delay(1.5);
        }
      }
      const r = cocherDansSafari();
      if (r.activee) {
        if (essai > 1) journal(`Safari réglé au ${essai}e essai${relance ? ' (après relance)' : ''}`);
        return { activee: true, sites: r.sites, detail: '' };
      }
      detail = 'la case « Beluga » ne s’est pas cochée dans Safari';
    } catch (e) {
      detail = String(e && e.message ? e.message : e);
      /* Sans l'autorisation « Contrôler le Mac », réessayer ne sert à rien. */
      if (/Contrôler le Mac/.test(detail)) break;
    }
    journal(`activation dans Safari, essai ${essai} sur ${ESSAIS} : ${detail}`);
  }
  const tente = relance ? `${ESSAIS} essais, Safari relancé entre deux` : `${ESSAIS} essais`;
  return { activee: false, sites: false, detail: /Contrôler le Mac/.test(detail) ? detail : `${detail} (${tente})` };
}

/** Ouvrir les réglages de Safari › Extensions, cocher « Beluga », autoriser sur tous les sites, refermer. */
function cocherDansSafari() {
  if (accessibiliteAccordee() !== true) throw new Error('l’autorisation « Contrôler le Mac » n’est pas encore donnée');
  const se = Application('System Events');
  const dejaOuvert = $.NSRunningApplication.runningApplicationsWithBundleIdentifier(NAVIGATEURS.safari).count > 0;
  const safari = Application('Safari');
  safari.activate();
  delay(1.5);
  const proc = se.processes.byName('Safari');
  se.keystroke(',', { using: 'command down' });
  delay(1.5);
  let activee = false;
  let sites = false;
  try {
    /* LA FENÊTRE DES RÉGLAGES, PAS LA PREMIÈRE VENUE : Safari tout juste relancé rouvre ses fenêtres d'onglets, et
       les réglages ne sont pas toujours devant. On cherche l'onglet « Extensions » dans chacune, la première d'abord. */
    let reglages = null;
    let onglet = null;
    const fin = Date.now() + 10000;
    while (!onglet && Date.now() < fin) {
      let fenetres = [];
      try {
        fenetres = proc.windows();
      } catch (e) {}
      for (const f of fenetres) {
        if (Date.now() > fin) break;
        onglet = chercherDansFenetre(f, ['AXButton', 'AXRadioButton'], LIBELLES_SAFARI.extensions, 2);
        if (onglet) {
          reglages = f;
          break;
        }
      }
      if (!onglet) delay(1);
    }
    const fenetre = () => reglages || proc.windows()[0];
    if (!onglet) throw new Error(safariTourne() ? 'onglet « Extensions » des réglages de Safari introuvable' : 'Safari s’est fermé pendant le réglage');
    appuyer(onglet);
    delay(1.2);
    const caseB = chercherDansFenetre(fenetre(), ['AXCheckBox'], /beluga/i, 8);
    if (!caseB) throw new Error('« Beluga » absente de la liste des extensions de Safari');
    if (!valeurCochee(caseB)) appuyer(caseB);
    for (let i = 0; i < 6 && !activee; i++) {
      delay(0.5);
      activee = valeurCochee(caseB);
    }
    if (!activee) throw new Error('la case « Beluga » ne s’est pas cochée dans Safari');
    /* Sur tous les sites : « Modifier les sites web… », puis « Autoriser » pour les autres sites. Facultatif. */
    try {
      const modifier = chercherDansFenetre(fenetre(), ['AXButton'], LIBELLES_SAFARI.sites, 4);
      if (modifier) {
        appuyer(modifier);
        delay(1.2);
        const menu = chercherDansFenetre(fenetre(), ['AXPopUpButton'], /./, 4);
        if (menu) {
          appuyer(menu);
          delay(0.6);
          const choix = chercherDansFenetre(menu, ['AXMenuItem'], LIBELLES_SAFARI.autoriser, 3);
          if (choix) {
            appuyer(choix);
            sites = true;
          } else se.keyCode(53);
        }
      }
    } catch (e) {
      journal(`Safari : « sur tous les sites » non réglé (${e && e.message ? e.message : e})`);
    }
  } finally {
    se.keystroke('w', { using: 'command down' });
    delay(0.5);
    /* Safari reste ouvert en arrière-plan le temps que l'extension se relie ; caché s'il ne l'était pas. */
    if (!dejaOuvert) {
      try {
        proc.visible = false;
      } catch (e) {}
    }
  }
  return { activee, sites };
}

/** Le premier élément d'un rôle donné dont le texte répond au motif, sous une fenêtre ou un élément (borné en temps). */
function chercherDansFenetre(racine, roles, motif, delaiS) {
  const fin = Date.now() + delaiS * 1000;
  while (Date.now() < fin) {
    let file = racine ? [racine] : [];
    let vus = 0;
    while (file.length && vus < 3000 && Date.now() < fin) {
      const el = file.shift();
      vus += 1;
      let role = '';
      try {
        role = el.role();
      } catch (e) {}
      if (roles.indexOf(role) >= 0 && motif.test(texteDe(el).trim())) return el;
      try {
        file = file.concat(el.uiElements());
      } catch (e) {}
    }
    delay(0.6);
  }
  return null;
}

/** Poser (ou remettre) l'extension dans son dossier fixe, avec le code de liaison, puis l'ajouter à Chrome. */
function installerLExtension(config, a) {
  viser(a.marque);
  try {
    return installerLExtensionVisee(config, a);
  } finally {
    viser('chrome');
  }
}

function installerLExtensionVisee(config, a) {
  if (!/^[0-9a-f]{64}$/.test(String(a.empreinte || ''))) throw new Error('empreinte du paquet absente');
  if (!/^\/api\/relais-mac\/extension\.zip\?jeton=[A-Za-z0-9_-]{8,64}$/.test(String(a.chemin || ''))) throw new Error('adresse du paquet refusée');
  if (!/^\d+(\.\d+){1,3}$/.test(String(a.version || ''))) throw new Error('version attendue absente');
  if (!/^\d{6}$/.test(String(a.code || ''))) throw new Error('code de liaison absent');
  /* Une extension Beluga déjà connue de Chrome garde son dossier (même identifiant) ; sinon le dossier fixe. */
  const connus = dossiersDeLExtension(config, null);
  const fixe = dossierFixe();
  const cible = connus.length ? connus[0].chemin : fixe;
  const travail = `${DOSSIER}/extension-neuve`;
  sh(`rm -rf ${q(travail)} && mkdir -p ${q(travail)} ${q(cible)}`);
  try {
    const zip = `${travail}/beluga-chrome.zip`;
    telechargerVerifie(config, a.chemin, zip, a.empreinte);
    sh(`/usr/bin/ditto -x -k ${q(zip)} ${q(travail)}`);
    const source = `${travail}/beluga-chrome`;
    const garde = existe(`${cible}/config.json`) ? `${travail}/config-garde.json` : null;
    if (garde) sh(`/bin/cp ${q(`${cible}/config.json`)} ${q(garde)}`);
    sh(`/usr/bin/ditto ${q(source)} ${q(cible)}`);
    if (garde) sh(`/bin/cp ${q(garde)} ${q(`${cible}/config.json`)}`);
  } finally {
    sh(`rm -rf ${q(travail)}`);
  }
  /* LE CODE DANS CHAQUE DOSSIER CONNU (carte « Liaison Chrome automatique et suivie », 22/11/2026) : Chrome peut avoir
     chargé l'extension depuis un autre dossier que le premier trouvé (autre profil, ancien dossier). `liaison.json`
     est posé dans TOUS les dossiers Beluga connus de Chrome et dans le dossier fixe, avec l'adresse du Beluga qui a
     émis le code : l'extension s'y relie même si son `config.json` vise un autre serveur. */
  /* `marque` (relais 9) : l'extension la redit à Beluga — Arc et Vivaldi ne se distinguent pas de Chrome de l'intérieur. */
  const fiche = JSON.stringify({ code: String(a.code), adresse: config.base, marque: NAV.marque });
  const poses = [];
  for (const d of [cible].concat(connus.map((x) => x.chemin), existe(fixe) ? [fixe] : [])) {
    if (poses.indexOf(d) >= 0 || !existe(`${d}/manifest.json`)) continue;
    $.NSString.alloc.initWithUTF8String(fiche).writeToFileAtomicallyEncodingError(`${d}/liaison.json`, true, $.NSUTF8StringEncoding, null);
    poses.push(d);
  }
  journal(`code de liaison posé dans ${poses.length} dossier(s) : ${poses.join(', ')}`);
  let ajoutee = connus.length > 0;
  let detail = '';
  let suivi = { developpeur: ajoutee, rouvert: true, essais: 0 };
  if (!ajoutee) {
    try {
      const r = ajouterDansChrome(config, cible);
      ajoutee = r.ajoutee;
      detail = r.detail;
      suivi = { developpeur: r.developpeur, rouvert: r.rouvert, essais: r.essais };
    } catch (e) {
      detail = String(e && e.message ? e.message : e);
      journal(`ajout à Chrome impossible : ${detail}`);
    }
  } else if (!chromeOuvert()) {
    /* Déjà dans Chrome, mais Chrome fermé (réparation) : il est rouvert avec ses onglets pour lire son code. */
    suivi.rouvert = rouvrirChrome();
  }
  return { dossier: cible, ajoutee, deja: connus.length > 0, detail, dossiers: poses, developpeur: suivi.developpeur, rouvert: suivi.rouvert, essais: suivi.essais };
}

/**
 * MIGRATION « Beluga Relais » → « Beluga Connect » : l'archive est téléchargée, vérifiée (empreinte, signature, équipe
 * Apple), rangée dans Applications, puis OUVERTE après la réponse au démon. C'est Beluga Connect qui arrête ensuite ce
 * relais-ci : s'il ne démarre pas, rien n'est arrêté et ce relais continue.
 */
function installerConnect(config, a) {
  if (VERSION_CONNECT) return { deja: VERSION_CONNECT };
  if (!/^[0-9a-f]{64}$/.test(String(a.empreinte || ''))) throw new Error('empreinte de l’archive absente');
  if (String(a.chemin || '') !== '/api/connect/Beluga-Connect.zip') throw new Error('adresse de l’archive refusée');
  const travail = `${DOSSIER}/connect-neuf`;
  sh(`rm -rf ${q(travail)} && mkdir -p ${q(travail)}`);
  try {
    telechargerVerifie(config, a.chemin, `${travail}/connect.zip`, a.empreinte);
    sh(`/usr/bin/ditto -x -k ${q(`${travail}/connect.zip`)} ${q(travail)}`);
    const app = `${travail}/Beluga Connect.app`;
    sh(`/usr/bin/codesign --verify --deep --strict ${q(app)}`);
    if (sh(`/usr/bin/codesign -dv ${q(app)} 2>&1`).indexOf(`TeamIdentifier=${EQUIPE_APPLE}`) < 0) throw new Error('archive signée par une autre équipe');
    const dossierApplis = sh(`[ -w /Applications ] && echo /Applications || echo "$HOME/Applications"`).trim();
    sh(`mkdir -p ${q(dossierApplis)}`);
    const cible = `${dossierApplis}/Beluga Connect.app`;
    sh(`rm -rf ${q(cible)} && /usr/bin/ditto ${q(app)} ${q(cible)} && /usr/bin/xattr -dr com.apple.quarantine ${q(cible)} || true`);
    aOuvrir = cible;
    journal(`Beluga Connect rangé dans ${cible} : ouverture après la réponse`);
    return { installe: cible };
  } finally {
    sh(`rm -rf ${q(travail)}`);
  }
}

// --- Piloter le Mac : applications, réglages, écran, terminal (version 4) ---------------------------------------

const TERMINAUX = ['com.apple.Terminal', 'com.googlecode.iterm2', 'dev.warp.Warp-Stable', 'net.kovidgoyal.kitty', 'com.mitchellh.ghostty', 'io.alacritty'];

function lireFichierTexte(chemin) {
  const t = $.NSString.stringWithContentsOfFileEncodingError(chemin, $.NSUTF8StringEncoding, null);
  return t && !t.isNil() ? t.js : '';
}

function ecrireFichierTexte(chemin, texte) {
  $.NSString.alloc.initWithUTF8String(String(texte)).writeToFileAtomicallyEncodingError(chemin, true, $.NSUTF8StringEncoding, null);
}

function base64DuFichier(chemin) {
  const d = $.NSData.dataWithContentsOfFile(chemin);
  if (!d || d.isNil()) throw new Error('capture introuvable');
  return d.base64EncodedStringWithOptions(0).js;
}

/** Trouver une application installée par son nom (sans accents ni casse) ; refusée sinon. */
function applicationNommee(demandee) {
  const nom = String(demandee || '').replace(/\.app$/i, '').trim();
  if (!nom || nom.length > 80 || /[\/\u0000-\u001f"\\]/.test(nom)) throw new Error('nom d’application refusé');
  const installees = applicationsInstallees();
  const trouvee = Object.keys(installees).find((a) => sansAccents(a) === sansAccents(nom));
  if (!trouvee) throw new Error(`aucune application « ${nom} » sur ce Mac`);
  return { nom: trouvee, chemin: installees[trouvee] };
}

function fermerUneApplication(demandee) {
  const a = applicationNommee(demandee);
  const bundle = $.NSBundle.bundleWithPath(a.chemin);
  const id = bundle && !bundle.isNil() ? ObjC.unwrap(bundle.bundleIdentifier) : '';
  const ouvertes = id ? ObjC.unwrap($.NSRunningApplication.runningApplicationsWithBundleIdentifier(id)) || [] : [];
  if (!ouvertes.length) return { fermee: a.nom, deja: true };
  for (const r of ouvertes) r.terminate;
  return { fermee: a.nom };
}

function changerUnReglage(r, v) {
  const se = () => Application('System Events');
  switch (r) {
    case 'volume':
      app.setVolume(null, { outputVolume: Math.max(0, Math.min(100, Number(v) || 0)) });
      return { volume: app.getVolumeSettings().outputVolume };
    case 'sourdine':
      app.setVolume(null, { outputMuted: v === true });
      return { sourdine: app.getVolumeSettings().outputMuted };
    case 'luminosite':
      if (accessibiliteAccordee() !== true) throw new Error('l’autorisation « Contrôler le Mac » n’est pas donnée');
      se().keyCode(v === 'plus' ? 144 : 145);
      return { luminosite: v };
    case 'mode_sombre':
      se().appearancePreferences.darkMode = v === true;
      return { modeSombre: se().appearancePreferences.darkMode() };
    case 'wifi': {
      const port = sh(`/usr/sbin/networksetup -listallhardwareports | awk '/Wi-Fi|AirPort/{getline; print $2; exit}'`).trim();
      if (!/^en\d+$/.test(port)) throw new Error('aucune carte Wi-Fi sur ce Mac');
      sh(`/usr/sbin/networksetup -setairportpower ${port} ${v === true ? 'on' : 'off'}`);
      return { wifi: v === true };
    }
    case 'veille_ecran':
      sh('/usr/bin/pmset displaysleepnow');
      return { veille: true };
    default:
      throw new Error('réglage inconnu');
  }
}

/** Un AppleScript adressé à UNE application nommée : jamais de commande du système par ce chemin. */
function piloterUneApplication(nomDemande, script) {
  const a = applicationNommee(nomDemande);
  const texte = String(script || '');
  if (!texte.trim() || texte.length > 4000) throw new Error('script vide ou trop long');
  if (/do\s+shell\s+script|run\s+script|load\s+script|store\s+script|osascript|do\s+script/i.test(texte)) throw new Error('script refusé : il lance une commande');
  const fichier = `${DOSSIER}/pilotage.applescript`;
  ecrireFichierTexte(fichier, `tell application "${a.nom}"\n${texte}\nend tell\n`);
  try {
    const sortie = sh(`/usr/bin/osascript ${q(fichier)} 2>&1`);
    return { application: a.nom, resultat: String(sortie || '').slice(0, 8000) };
  } finally {
    sh(`rm -f ${q(fichier)}`);
  }
}

function ecranPrincipal() {
  const f = $.NSScreen.mainScreen.frame;
  return { largeur: f.size.width, hauteur: f.size.height };
}

function exigerLEcran(pourAgir) {
  if (macVerrouille()) throw new Error('le Mac est verrouillé');
  if (pourAgir && accessibiliteAccordee() !== true) throw new Error('l’autorisation « Contrôler le Mac » n’est pas donnée sur ce Mac');
}

function capturerLEcran() {
  exigerLEcran(false);
  if (ecranAccorde() === false) throw new Error('l’autorisation « Enregistrement de l’écran » n’est pas donnée sur ce Mac');
  const fichier = `${DOSSIER}/ecran.jpg`;
  sh(`/usr/sbin/screencapture -x -m -t jpg ${q(fichier)} && /usr/bin/sips -Z 1600 -s formatOptions 70 ${q(fichier)} >/dev/null`);
  try {
    const e = ecranPrincipal();
    return { jpeg: base64DuFichier(fichier), largeur: e.largeur, hauteur: e.hauteur };
  } finally {
    sh(`rm -f ${q(fichier)}`);
  }
}

function pointDeLEcran(fx, fy) {
  if (!(fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1)) return null;
  const e = ecranPrincipal();
  return { x: Math.round(Math.min(e.largeur - 1, fx * e.largeur)), y: Math.round(Math.min(e.hauteur - 1, fy * e.hauteur)) };
}

function premierPlanEstUnTerminal() {
  const devant = $.NSWorkspace.sharedWorkspace.frontmostApplication;
  const id = devant && !devant.isNil() ? ObjC.unwrap(devant.bundleIdentifier) : '';
  return TERMINAUX.indexOf(id) >= 0;
}

function cliquerSurLEcran(a) {
  exigerLEcran(true);
  const p = pointDeLEcran(a.x, a.y);
  if (!p) throw new Error('point hors de l’écran : refusé');
  const [bas, haut] = a.droit ? [3, 4] : [1, 2];
  const fois = a.double ? 2 : 1;
  for (let i = 1; i <= fois; i++) {
    const ev = $.CGEventCreateMouseEvent(null, bas, $.CGPointMake(p.x, p.y), a.droit ? 1 : 0);
    $.CGEventSetIntegerValueField(ev, 1, i);
    $.CGEventPost(0, ev);
    delay(0.04);
    const ev2 = $.CGEventCreateMouseEvent(null, haut, $.CGPointMake(p.x, p.y), a.droit ? 1 : 0);
    $.CGEventSetIntegerValueField(ev2, 1, i);
    $.CGEventPost(0, ev2);
    delay(0.06);
  }
  return { texte: 'Cliqué.' };
}

const TOUCHES_DE_L_ECRAN = { entree: 36, effacer: 51, tab: 48, echap: 53, espace: 49, haut: 126, bas: 125, gauche: 123, droite: 124, suppr: 117, debut: 115, fin: 119, page_haut: 116, page_bas: 121 };
const MODIFICATEURS = { cmd: 'command down', maj: 'shift down', option: 'option down', ctrl: 'control down' };

function taperSurLEcran(texte) {
  exigerLEcran(true);
  if (premierPlanEstUnTerminal()) throw new Error('le Terminal est au premier plan : une commande passe par le geste « terminal » et l’accord de la personne');
  Application('System Events').keystroke(String(texte || ''));
  return {};
}

function toucheSurLEcran(a) {
  exigerLEcran(true);
  if (premierPlanEstUnTerminal()) throw new Error('le Terminal est au premier plan : une commande passe par le geste « terminal » et l’accord de la personne');
  const avec = (Array.isArray(a.modificateurs) ? a.modificateurs : []).map((m) => MODIFICATEURS[m]).filter(Boolean);
  const se = Application('System Events');
  const code = TOUCHES_DE_L_ECRAN[a.touche];
  if (code !== undefined) se.keyCode(code, avec.length ? { using: avec } : {});
  else if (/^[a-z0-9]$/i.test(String(a.touche || ''))) se.keystroke(String(a.touche).toLowerCase(), avec.length ? { using: avec } : {});
  else throw new Error('touche inconnue');
  return {};
}

/**
 * UNE COMMANDE ACCORDÉE PAR LA PERSONNE : écrite dans un fichier, jouée par zsh (profil chargé) depuis le dossier
 * personnel, coupée après `delai` secondes. Sortie et erreurs réunies, lues depuis un fichier (jamais par la sortie de
 * doShellScript, qui coupe et réécrit les fins de ligne), tronquée à la fin.
 */
function jouerAuTerminal(a) {
  const commande = String(a.commande || '');
  if (!commande.trim() || commande.length > 4000) throw new Error('commande vide ou trop longue');
  const delai = Math.max(5, Math.min(600, Number(a.delai) || 120));
  const script = `${DOSSIER}/commande.zsh`;
  const sortie = `${DOSSIER}/commande.sortie`;
  ecrireFichierTexte(script, commande);
  const debut = Date.now();
  let code;
  try {
    code = Number(sh(`cd "$HOME" && /usr/bin/perl -e 'alarm shift; exec @ARGV' ${delai} /bin/zsh -l ${q(script)} > ${q(sortie)} 2>&1 < /dev/null; echo $?`).trim());
    const texte = lireFichierTexte(sortie);
    const coupee = texte.length > 20000;
    return { code, sortie: coupee ? texte.slice(-20000) : texte, coupee, secondes: Math.round((Date.now() - debut) / 1000), tempsDepasse: code === 142 };
  } finally {
    sh(`rm -f ${q(script)} ${q(sortie)}`);
  }
}

/** Mettre À LA CORBEILLE (récupérable), jamais effacer : NSFileManager.trashItemAtURL. */
function mettreALaCorbeille(brut) {
  let chemin = String(brut || '').trim();
  if (chemin.startsWith('~/')) chemin = `${$.NSHomeDirectory().js}${chemin.slice(1)}`;
  if (!chemin.startsWith('/') || /(^|\/)\.\.(\/|$)/.test(chemin) || /[\u0000-\u001f]/.test(chemin)) throw new Error('chemin refusé');
  if (!existe(chemin)) throw new Error(`rien à cet endroit : ${chemin}`);
  const ok = $.NSFileManager.defaultManager.trashItemAtURLResultingItemURLError($.NSURL.fileURLWithPath(chemin), null, null);
  if (!ok) throw new Error(`« ${chemin} » ne part pas à la corbeille`);
  return { corbeille: chemin };
}

/**
 * RETIRER LE MODULE D'UN NAVIGATEUR DÉCOCHÉ (relais 9, carte « Navigateurs facultatifs à la liaison ») : l'extension
 * 1.0.17 se retire déjà elle-même quand Beluga la délie ; ici, le relais efface en plus ce qui la ferait revenir —
 * le dossier fixe de ce navigateur (Chromium), l'application « Beluga » pour Safari (à la corbeille), ou rien de plus
 * pour Firefox (le module signé s'est retiré). Rien d'autre n'est touché : les autres navigateurs gardent le leur.
 */
function retirerLExtension(a) {
  const marque = String(a.marque || '');
  if (marque === 'safari') {
    const app = applicationSafari();
    if (!app) return { retire: false, detail: 'Beluga pour Safari n’est pas installé' };
    $.NSFileManager.defaultManager.trashItemAtURLResultingItemURLError($.NSURL.fileURLWithPath(app), null, null);
    return { retire: true, chemin: app };
  }
  if (marque === 'firefox') return { retire: true, detail: 'le module Firefox se retire lui-même' };
  viser(marque);
  try {
    const fixe = dossierFixe();
    /* Seulement le dossier propre à CE navigateur : celui de Chrome sert à Chrome. */
    if (marque !== 'chrome' && existe(fixe)) sh(`rm -rf ${q(fixe)}`);
    if (marque === 'chrome' && existe(`${fixe}/liaison.json`)) sh(`rm -f ${q(`${fixe}/liaison.json`)}`);
    return { retire: true, dossier: fixe };
  } finally {
    viser('chrome');
  }
}

/**
 * FIREFOX (relais 9) : le module SIGNÉ par Mozilla est téléchargé par la voie signée, vérifié (empreinte), puis ouvert
 * dans Firefox, qui demande « Ajouter Beluga ? » : le relais appuie sur « Ajouter » (accessibilité). Le code de liaison
 * voyage ensuite par une adresse de Beluga ouverte dans Firefox (`#beluga-liaison=`), que seul le module lit.
 */
const LIBELLES_FIREFOX = { ajouter: /^(ajouter|add|añadir|hinzufügen|添加)$/i };
function installerFirefox(config, a) {
  if (!/^[0-9a-f]{64}$/.test(String(a.empreinte || ''))) throw new Error('empreinte du module absente');
  if (String(a.chemin || '') !== '/api/relais-mac/extension-firefox.xpi') throw new Error('adresse du module refusée');
  if (!/^\d{6}$/.test(String(a.code || ''))) throw new Error('code de liaison absent');
  if (accessibiliteAccordee() !== true) throw new Error('l’autorisation « Contrôler le Mac » n’est pas encore donnée');
  const firefox = $.NSWorkspace.sharedWorkspace.URLForApplicationWithBundleIdentifier(BUNDLES_DES_NAVIGATEURS.firefox);
  if (!firefox || firefox.isNil()) throw new Error('Firefox n’est pas installé');
  const dossier = `${SUPPORT}/Beluga/extension-firefox`;
  sh(`mkdir -p ${q(dossier)}`);
  const xpi = `${dossier}/beluga.xpi`;
  telechargerVerifie(config, a.chemin, xpi, a.empreinte);
  sh(`/usr/bin/open -b ${q(BUNDLES_DES_NAVIGATEURS.firefox)} ${q(xpi)}`);
  const se = Application('System Events');
  let ajoutee = false;
  let detail = '';
  for (let essai = 0; essai < 30 && !ajoutee; essai++) {
    delay(1);
    try {
      const proc = se.processes.byName('Firefox');
      proc.frontmost = true;
      const bouton = chercherDansChrome(proc, ['AXButton'], LIBELLES_FIREFOX.ajouter, 1);
      if (bouton) {
        appuyer(bouton);
        ajoutee = true;
      }
    } catch (e) {
      detail = String(e && e.message ? e.message : e);
    }
  }
  if (!ajoutee) return { ajoutee: false, detail: detail || 'la demande « Ajouter Beluga ? » de Firefox n’est pas apparue' };
  delay(3);
  sh(`/usr/bin/open -b ${q(BUNDLES_DES_NAVIGATEURS.firefox)} ${q(`${config.base}/#beluga-liaison=${a.code}`)}`);
  return { ajoutee: true, developpeur: true, rouvert: true, essais: 1, detail: '' };
}

function jouerSurLOrdinateur(commande) {
  const a = commande.args || {};
  switch (commande.geste) {
    case 'mettre_a_jour_extension':
      return mettreAJourLExtension(lireConfig(), a);
    case 'se_mettre_a_jour':
      return seMettreAJour(lireConfig(), a);
    case 'installer_extension':
      return installerLExtension(lireConfig(), a);
    case 'installer_firefox':
      return installerFirefox(lireConfig(), a);
    case 'retirer_extension':
      return retirerLExtension(a);
    case 'navigateurs_installes':
      return navigateursInstalles();
    case 'autoriser_navigation_privee':
      return autoriserLaNavigationPrivee(a);
    case 'installer_safari':
      return installerSafari(lireConfig(), a);
    case 'etat_safari':
      return etatDeSafari();
    case 'installer_connect':
      return installerConnect(lireConfig(), a);
    case 'lister_applications':
      return { applications: Object.keys(applicationsInstallees()).sort((x, y) => x.localeCompare(y)) };
    case 'ouvrir_application':
      return { ouverte: ouvrirUneApplication(a.nom) };
    case 'relancer_navigateur':
      return relancerLeNavigateur(a.navigateur);
    case 'nom':
      return { nom: nomDuMac() };
    case 'ouvrir_reglage':
      return ouvrirUnReglage(a.reglage);
    case 'fermer_application':
      return fermerUneApplication(a.nom);
    case 'reglage':
      return changerUnReglage(a.reglage, a.valeur);
    case 'piloter':
      return piloterUneApplication(a.application, a.script);
    case 'ecran_capturer':
      return capturerLEcran();
    case 'ecran_cliquer':
      return cliquerSurLEcran(a);
    case 'ecran_taper':
      return taperSurLEcran(a.texte);
    case 'ecran_touche':
      return toucheSurLEcran(a);
    case 'terminal':
      return jouerAuTerminal(a);
    case 'supprimer':
      return mettreALaCorbeille(a.chemin);
    default:
      return undefined;
  }
}

// --- La boucle ---------------------------------------------------------------------------------------------------

function run() {
  const config = lireConfig();
  journal('relais démarré');
  garderEveille();
  premierDemarrage();
  for (;;) {
    let reponse;
    try {
      reponse = attendre(config, etatCourant());
    } catch (e) {
      journal(`démon injoignable : ${e}`);
      delay(10);
      continue;
    }
    if (reponse.raison) {
      journal(`refusé : ${reponse.raison}`);
      delay(60);
      continue;
    }
    const commande = reponse.commande;
    if (!commande) continue;
    try {
      repondre(config, { id: commande.id, ok: true, resultat: jouer(commande) });
    } catch (e) {
      try {
        repondre(config, { id: commande.id, ok: false, erreur: String(e && e.message ? e.message : e) });
      } catch (e2) {
        journal(`réponse perdue : ${e2}`);
      }
    }
    /* Beluga Connect rangé : on l'ouvre maintenant que le démon a sa réponse ; c'est lui qui arrêtera ce relais. */
    if (aOuvrir) {
      try {
        sh(`/usr/bin/open ${q(aOuvrir)}`);
      } catch (e) {
        journal(`Beluga Connect ne s’ouvre pas : ${e}`);
      }
      aOuvrir = null;
    }
    /* Relais remplacé : on s'arrête, launchd (KeepAlive) relance le lanceur sur le nouveau fichier. */
    if (aRelancer) {
      journal('arrêt pour relance');
      return;
    }
  }
}
