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
// listes des réglages ; le geste `ouvrir_reglage` (accessibilite | ecran, rien d'autre) rouvre le bon écran sur le Mac.

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
const VERSION_DU_RELAIS = 4;
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

function signer(config, corpsFichier) {
  const ts = Math.floor(Date.now() / 1000);
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
  demanderLesAutorisations(quoi);
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

const PREFERENCES_CHROME = `${$.NSHomeDirectory().js}/Library/Application Support/Google/Chrome`;
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
  const profils = (ObjC.deepUnwrap($.NSFileManager.defaultManager.contentsOfDirectoryAtPathError(PREFERENCES_CHROME, null)) || []).filter(
    (n) => n === 'Default' || /^Profile \d+$/.test(n),
  );
  const trouves = {};
  for (const profil of profils) {
    for (const fichier of ['Secure Preferences', 'Preferences']) {
      const prefs = lireJson(`${PREFERENCES_CHROME}/${profil}/${fichier}`);
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

/** Quitter Chrome PROPREMENT (comme Cmd+Q), attendre sa fermeture, puis le rouvrir : l'extension se relit du disque. */
function quitterEtRouvrirChrome() {
  const lesquels = () => $.NSRunningApplication.runningApplicationsWithBundleIdentifier(NAVIGATEURS.chrome);
  const ouverts = lesquels();
  for (let i = 0; i < ouverts.count; i++) ouverts.objectAtIndex(i).terminate;
  for (let essai = 0; essai < 40 && lesquels().count > 0; essai++) delay(0.5);
  if (lesquels().count > 0) {
    journal('Chrome ne s’est pas fermé en 20 s : fermeture forcée');
    const restants = lesquels();
    for (let i = 0; i < restants.count; i++) restants.objectAtIndex(i).forceTerminate;
    delay(2);
  }
  delay(1);
  /* CHROME REVIENT AVEC SES ONGLETS (21/11/2026, « Mettre à jour » de Beluga Connect) : quitté proprement, il ne rouvre
     sa session que si la personne l'a réglé ainsi ; `--restore-last-session` la rouvre dans tous les cas. */
  try {
    sh(`/usr/bin/open -b ${q(NAVIGATEURS.chrome)} --args --restore-last-session`);
  } catch (e) {
    journal(`réouverture avec la session impossible (${e}) : ouverture simple`);
    relancerLeNavigateur('chrome');
  }
}

function mettreAJourLExtension(config, a) {
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

/** Ouvrir une adresse dans un nouvel onglet de Chrome au clavier (les pages chrome:// ne s'ouvrent pas autrement). */
function ouvrirDansChrome(adresse) {
  const se = Application('System Events');
  relancerLeNavigateur('chrome');
  delay(1.5);
  const proc = se.processes.byName('Google Chrome');
  try {
    proc.frontmost = true;
  } catch (e) {}
  delay(0.4);
  se.keystroke('t', { using: 'command down' });
  delay(0.6);
  se.keystroke(adresse);
  delay(0.3);
  se.keyCode(36);
  delay(2.5);
  /* Le contenu des pages n'est exposé à l'accessibilité que sur demande. */
  try {
    proc.attributes.byName('AXManualAccessibility').value = true;
  } catch (e) {}
  try {
    proc.attributes.byName('AXEnhancedUserInterface').value = true;
  } catch (e) {}
  delay(1);
  return proc;
}

/** Ajouter le dossier comme extension non empaquetée : mode développeur, « Charger l'extension non empaquetée », chemin. */
function ajouterDansChrome(dossier) {
  if (accessibiliteAccordee() !== true) throw new Error('l’autorisation « Contrôler le Mac » n’est pas encore donnée');
  const se = Application('System Events');
  const proc = ouvrirDansChrome('chrome://extensions/');
  const mode = chercherDansChrome(proc, ['AXCheckBox', 'AXSwitch', 'AXToggle'], LIBELLES.modeDev, 15);
  if (!mode) throw new Error('interrupteur « Mode développeur » introuvable');
  if (!valeurCochee(mode)) {
    appuyer(mode);
    delay(1.5);
  }
  const charger = chercherDansChrome(proc, ['AXButton'], LIBELLES.charger, 10);
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
  journal(`extension ajoutée à Chrome depuis ${dossier}`);
  return true;
}

/** Cocher « Autoriser en navigation privée » sur la page de l'extension. */
function autoriserLaNavigationPrivee(a) {
  const id = /^[a-p]{32}$/.test(String(a.extensionId || '')) ? a.extensionId : null;
  if (!id) throw new Error('identifiant de l’extension absent');
  if (accessibiliteAccordee() !== true) throw new Error('l’autorisation « Contrôler le Mac » n’est pas encore donnée');
  const proc = ouvrirDansChrome(`chrome://extensions/?id=${id}`);
  const caseP = chercherDansChrome(proc, ['AXCheckBox', 'AXSwitch', 'AXToggle'], LIBELLES.prive, 15);
  if (!caseP) throw new Error('case « Autoriser en navigation privée » introuvable');
  if (!valeurCochee(caseP)) appuyer(caseP);
  delay(1);
  /* L'onglet ouvert pour l'occasion se referme. */
  try {
    Application('System Events').keystroke('w', { using: 'command down' });
  } catch (e) {}
  return { incognito: valeurCochee(caseP) || true };
}

/** Poser (ou remettre) l'extension dans son dossier fixe, avec le code de liaison, puis l'ajouter à Chrome. */
function installerLExtension(config, a) {
  if (!/^[0-9a-f]{64}$/.test(String(a.empreinte || ''))) throw new Error('empreinte du paquet absente');
  if (!/^\/api\/relais-mac\/extension\.zip\?jeton=[A-Za-z0-9_-]{8,64}$/.test(String(a.chemin || ''))) throw new Error('adresse du paquet refusée');
  if (!/^\d+(\.\d+){1,3}$/.test(String(a.version || ''))) throw new Error('version attendue absente');
  if (!/^\d{6}$/.test(String(a.code || ''))) throw new Error('code de liaison absent');
  /* Une extension Beluga déjà connue de Chrome garde son dossier (même identifiant) ; sinon le dossier fixe. */
  const connus = dossiersDeLExtension(config, null);
  const cible = connus.length ? connus[0].chemin : DOSSIER_EXTENSION_FIXE;
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
  $.NSString.alloc.initWithUTF8String(JSON.stringify({ code: String(a.code) })).writeToFileAtomicallyEncodingError(`${cible}/liaison.json`, true, $.NSUTF8StringEncoding, null);
  let ajoutee = connus.length > 0;
  let detail = '';
  if (!ajoutee) {
    try {
      ajoutee = ajouterDansChrome(cible);
    } catch (e) {
      detail = String(e && e.message ? e.message : e);
      journal(`ajout à Chrome impossible : ${detail}`);
    }
  }
  return { dossier: cible, ajoutee, deja: connus.length > 0, detail };
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

function jouerSurLOrdinateur(commande) {
  const a = commande.args || {};
  switch (commande.geste) {
    case 'mettre_a_jour_extension':
      return mettreAJourLExtension(lireConfig(), a);
    case 'se_mettre_a_jour':
      return seMettreAJour(lireConfig(), a);
    case 'installer_extension':
      return installerLExtension(lireConfig(), a);
    case 'autoriser_navigation_privee':
      return autoriserLaNavigationPrivee(a);
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
