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
const VERSION_DU_RELAIS = 2;
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
  const url = `${config.base}/api/relais-mac/attendre?recopie=${etat.recopie ? 1 : 0}&verrouille=${etat.verrouille ? 1 : 0}&acces=${oui(etat.accessibilite)}&ecran=${oui(etat.ecran)}&v=${VERSION_DU_RELAIS}&lanceur=${SOUS_LANCEUR ? 1 : 0}`;
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
  relancerLeNavigateur('chrome');
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

function jouerSurLOrdinateur(commande) {
  const a = commande.args || {};
  switch (commande.geste) {
    case 'mettre_a_jour_extension':
      return mettreAJourLExtension(lireConfig(), a);
    case 'se_mettre_a_jour':
      return seMettreAJour(lireConfig(), a);
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
    /* Relais remplacé : on s'arrête, launchd (KeepAlive) relance le lanceur sur le nouveau fichier. */
    if (aRelancer) {
      journal('arrêt pour relance');
      return;
    }
  }
}
