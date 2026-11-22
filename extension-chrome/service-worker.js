/**
 * BELUGA POUR CHROME — le service worker (carte « Pilotage de Chrome par Beluga », 09/11/2026).
 *
 * Il tient la voie avec le démon (`/ws/chrome`, signée par la clé de ce Chrome), exécute les gestes des agents par
 * le débogueur de Chrome, et relaie le panneau latéral. Les règles qu'il applique en double du démon :
 *  - un agent ne touche QUE les onglets de son groupe, dans la fenêtre EN COURS de la personne (aucune fenêtre à
 *    part depuis la carte « Panneau Chrome façon discussion ») : le panneau latéral y reste ouvert sur chaque onglet ;
 *  - Chrome SUIT l'agent (active l'onglet où il agit) seulement si la personne regarde déjà un onglet de son groupe ;
 *    sinon rien n'est arraché, et le panneau dit où l'agent travaille ;
 *  - un site en lecture seule refuse tout clic, toute saisie et toute touche, même si le démon se trompait ;
 *  - aucun JavaScript venu d'un agent : seuls les scripts de ce fichier s'exécutent dans les pages ;
 *  - le débogueur se détache après 20 s de silence : le bandeau de Chrome ne reste que pendant le travail ;
 *  - une SOURIS VIRTUELLE glisse jusqu'à chaque cible avant le clic ou la saisie (trajet courbe, vitesse en
 *    cloche, vrais `mouseMoved`) ; elle est masquée le temps des captures, et la capture qui suit un clic emporte
 *    l'endroit cliqué (point violet sur la vignette du panneau, jamais dans l'image).
 */
/* EN PREMIER : la couche « navigateur ». Rien dans Chrome ; dans Safari, débogueur absent et groupes tenus par
   l'extension (`compat-safari.js`). */
import { SAFARI } from './compat-safari.js';
import { lireUnePage, sonderUnElement, centreDUnRepere, focaliserUnRepere, reperesDeConnexion, texteVisible, retirerLesCadresDAutresExtensions, saisirSansDebogueur, deposerUneImage } from './pages.js';

/* La souris virtuelle et le dépôt d'un fichier : à part, pour que la ligne d'import ci-dessus reste commune aux
   autres cartes de l'extension. */
import { poserLaSouris, natureDuDepot, poserDesFichiers, deposerSurUneZone } from './pages.js';
/* Safari : clic et touche joués par la page (événements simulés), jamais par un script venu d'un agent. */
import { cliquerSansDebogueur, frapperSansDebogueur } from './pages.js';

const BATTEMENT_MS = 15_000;
const DETACHER_APRES_MS = 20_000;
const GESTES_QUI_AGISSENT = new Set(['cliquer', 'ecrire', 'touche', 'se_connecter', 'deposer']);

/* ------------------------------------------------------------------ */
/* La liaison                                                           */
/* ------------------------------------------------------------------ */

async function configuration() {
  const stockee = await chrome.storage.local.get(['adresse']);
  if (stockee.adresse) return { adresse: stockee.adresse };
  const r = await fetch(chrome.runtime.getURL('config.json'));
  return r.json();
}

async function liaison() {
  return chrome.storage.local.get(['identifiant', 'secret', 'nom', 'dernierTs']);
}

function base64url(octets) {
  let s = '';
  for (const o of new Uint8Array(octets)) s += String.fromCharCode(o);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function signer(secret, message) {
  const cle = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64url(await crypto.subtle.sign('HMAC', cle, new TextEncoder().encode(message)));
}

/* `adresseImposee` : celle du Beluga qui a émis le code (posée par Beluga Connect dans `liaison.json`) ; retenue à la
   liaison, pour que la voie s'ouvre sur le MÊME Beluga même si `config.json` en vise un autre. */
async function relier(code, nom, adresseImposee) {
  const adresse = adresseImposee || (await configuration()).adresse;
  const r = await fetch(`${adresse}/api/extension-chrome/relier`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, nom: nom || (SAFARI ? 'Safari · macOS' : navigator.userAgentData?.platform ?? ''), version: chrome.runtime.getManifest().version, navigateur: SAFARI ? 'safari' : 'chrome' }),
  });
  /* Beluga qui redémarre (502, 503…) n'a rien refusé : l'appelant réessaiera. */
  if (r.status >= 500) throw new Error(`Beluga indisponible (${r.status})`);
  const data = await r.json().catch(() => ({ ok: false, raison: 'Réponse illisible.' }));
  if (!data.ok) return data;
  await chrome.storage.local.set({ identifiant: data.identifiant, secret: data.secret, nom: data.nom, dernierTs: 0, ...(adresseImposee ? { adresse: adresseImposee } : {}) });
  void connecter();
  return { ok: true, nom: data.nom };
}

async function delier() {
  await chrome.storage.local.remove(['identifiant', 'secret', 'nom', 'dernierTs']);
  if (voie) voie.close();
  voie = null;
  diffuser({ type: 'liaison', relie: false });
}

/* ------------------------------------------------------------------ */
/* La voie                                                              */
/* ------------------------------------------------------------------ */

let voie = null;
let enConnexion = false;
let battement = null;
let langue = 'fr';
const enAttente = new Map();

async function connecter() {
  if (enConnexion || (voie && voie.readyState <= 1)) return;
  const { identifiant, secret, dernierTs } = await liaison();
  if (!identifiant || !secret) return;
  enConnexion = true;
  try {
    const { adresse } = await configuration();
    /* Un horodatage STRICTEMENT croissant : le démon refuse un rejeu, même le nôtre. */
    const ts = Math.max(Math.floor(Date.now() / 1000), (dernierTs ?? 0) + 1);
    await chrome.storage.local.set({ dernierTs: ts });
    const sig = await signer(secret, `${ts}.${identifiant}.`);
    const url = `${adresse.replace(/^http/, 'ws')}/ws/chrome?id=${encodeURIComponent(identifiant)}&ts=${ts}&sig=${encodeURIComponent(sig)}`;
    const ws = new WebSocket(url);
    voie = ws;
    let ouverte = false;
    ws.onopen = () => {
      ouverte = true;
      const nom = SAFARI ? 'Safari · macOS' : `${navigator.userAgentData?.platform ?? 'Chrome'}`;
      /* 1.0.11 : l'extension dit aussi si elle est autorisée en navigation privée et son identifiant, pour que Beluga
         vérifie AVANT un audit GEO et sache quel dossier le programme du Mac doit mettre à jour. */
      void autorisationPrivee().then((incognito) =>
        ws.send(JSON.stringify({ type: 'bonjour', version: chrome.runtime.getManifest().version, plateforme: nom, incognito, extensionId: chrome.runtime.id })),
      );
      clearInterval(battement);
      /* Un service worker MV3 s'endort après 30 s sans échange : le battement le garde éveillé (Chrome ≥ 116). */
      battement = setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'ping' })), BATTEMENT_MS);
      diffuser({ type: 'liaison', relie: true, enLigne: true });
    };
    ws.onmessage = (e) => void recevoir(ws, e.data);
    ws.onclose = (e) => {
      clearInterval(battement);
      if (voie === ws) voie = null;
      diffuser({ type: 'liaison', relie: true, enLigne: false });
      /* Délié depuis Beluga (4001) : on oublie la clé. */
      if (e.code === 4001) void delier();
      /* REFUSÉE À L'OUVERTURE (1.0.15) : un refus (clé révoquée pendant que Chrome était fermé) et un démon qui redémarre
         se ressemblent (1006). On demande au démon, signé : seule une réponse ferme « plus valable » fait oublier la clé,
         et `liaison.json` peut alors relier ce Chrome de nouveau. Démon injoignable : la clé est gardée. */
      else if (!ouverte) void verifierLaCle();
    };
    ws.onerror = () => {};
  } finally {
    enConnexion = false;
  }
}

let derniereSonde = 0;
async function verifierLaCle() {
  if (Date.now() - derniereSonde < 60_000) return;
  derniereSonde = Date.now();
  const { identifiant, secret } = await liaison();
  if (!identifiant || !secret) return;
  try {
    const { adresse } = await configuration();
    const ts = Math.floor(Date.now() / 1000);
    const sig = await signer(secret, `${ts}.${identifiant}.sonde`);
    const r = await fetch(`${adresse}/api/extension-chrome/cle`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: identifiant, ts, sig }) });
    if (!r.ok) return;
    const data = await r.json().catch(() => null);
    if (data?.ok === true && data.valable === false) {
      await delier();
      void lierParLeFichier();
    }
  } catch {
    /* Beluga injoignable : rien n'est oublié. */
  }
}

function envoyer(message) {
  if (voie && voie.readyState === 1) voie.send(JSON.stringify(message));
}

async function recevoir(ws, brut) {
  let m;
  try {
    m = JSON.parse(brut);
  } catch {
    return;
  }
  if (m.type === 'bienvenue') {
    langue = m.langue || 'fr';
    await chrome.storage.local.set({ langue });
    diffuser({ type: 'liaison', relie: true, enLigne: true, langue });
    void rafraichirLeCompteur();
    return;
  }
  if (m.type === 'ack') {
    const attente = enAttente.get(m.id);
    if (attente) {
      enAttente.delete(m.id);
      attente(m);
    }
    return;
  }
  if (m.type === 'evenement') {
    diffuser(m);
    if (m.genre === 'agents' || m.genre === 'message') void rafraichirLeCompteur();
    return;
  }
  if (m.type === 'geste') {
    try {
      const data = await executer(m.geste, m.args ?? {});
      ws.send(JSON.stringify({ type: 'resultat', id: m.id, ok: true, data }));
    } catch (err) {
      ws.send(JSON.stringify({ type: 'resultat', id: m.id, ok: false, erreur: String(err?.message ?? err) }));
    }
  }
}

/** Une commande du panneau vers le démon, avec sa réponse. */
function commande(cmd, delaiMs = 60_000) {
  return new Promise((resolve) => {
    if (!voie || voie.readyState !== 1) return resolve({ ok: false, error: 'Beluga est injoignable : vérifiez la connexion.' });
    const id = Math.random().toString(36).slice(2);
    const minuterie = setTimeout(() => {
      enAttente.delete(id);
      resolve({ ok: false, error: 'Beluga n’a pas répondu à temps.' });
    }, delaiMs);
    enAttente.set(id, (m) => {
      clearTimeout(minuterie);
      resolve(m);
    });
    envoyer({ type: 'cmd', id, cmd });
  });
}

/* ------------------------------------------------------------------ */
/* Le signal : pastille sur l'icône et groupe qui clignote               */
/* ------------------------------------------------------------------ */

/*
 * UN AGENT EST « À REGARDER » (carte « Images dans l'extension Chrome », 09/11/2026) quand il attend quelqu'un
 * (accord, question, réponse) — « attente », jaune — ou quand son tour vient de finir sans que la personne ait
 * regardé son groupe depuis — « reponse », violet. La pastille de l'icône compte ces agents ; le groupe d'onglets
 * de chacun clignote (titre « ● » et couleur) jusqu'à ce qu'un de ses onglets soit regardé. Rien n'est écrit dans
 * les pages des sites. Les marques vivent dans chrome.storage.session (« nonVus », « statuts ») : un service
 * worker réveillé reprend où il en était.
 */
const CLIGNOTEMENT_MS = 800;
const VIOLET = '#6d28d9';
const JAUNE = '#eab308';
let clignotement = null;
let phase = false;
/** groupId → { title, color } d'origine, à rendre à l'arrêt. */
let originaux = new Map();
let signaux = new Map();

function estAuTravail(a) {
  return !!a && (a.statut === 'running' || a.statut === 'starting');
}

/** La règle, pure : ce que chaque agent signale, à partir de son état, de l'état d'avant et des marques. */
function signauxDesAgents(agents, statutsAvant, nonVus, regardes) {
  const marques = { ...nonVus };
  const resultat = new Map();
  for (const a of agents) {
    if (estAuTravail(a)) delete marques[a.agentId];
    else if (estAuTravail({ statut: statutsAvant[a.agentId] }) && !regardes.has(a.agentId)) marques[a.agentId] = true;
    if (regardes.has(a.agentId)) delete marques[a.agentId];
    if ((a.accords || 0) > 0 || a.attend) resultat.set(a.agentId, 'attente');
    else if (marques[a.agentId]) resultat.set(a.agentId, 'reponse');
  }
  for (const id of Object.keys(marques)) if (!agents.some((a) => a.agentId === id)) delete marques[id];
  return { signaux: resultat, nonVus: marques };
}

/** Les agents dont la personne regarde un onglet du groupe en ce moment (fenêtre au premier plan). */
async function agentsRegardes(espace) {
  const vus = new Set();
  const actifs = await chrome.tabs.query({ active: true }).catch(() => []);
  const fenetre = await chrome.windows.getLastFocused().catch(() => null);
  for (const tab of actifs) {
    if (tab.groupId < 0 || (fenetre && tab.windowId !== fenetre.id)) continue;
    const id = Object.entries(espace.groupes).find(([, g]) => g === tab.groupId)?.[0];
    if (id) vus.add(id);
  }
  return vus;
}

/* LE COMPTEUR SUR L'ICÔNE et le clignotement des groupes, recalculés à chaque nouvelle du démon. */
let dernierEtat = null;
async function rafraichirLeCompteur(agents) {
  if (!agents) {
    const r = await commande({ type: 'panneau.etat' }, 15_000);
    if (!r.ok) return;
    agents = r.data.agents ?? [];
  }
  dernierEtat = agents;
  await appliquerLesSignaux(agents);
}

/* Les nouvelles du démon arrivent par rafales (« agents », « message ») : un seul calcul à la fois, sinon deux
   minuteries de clignotement survivraient côte à côte et l'une ne s'arrêterait jamais. */
let fileDesSignaux = Promise.resolve();
function appliquerLesSignaux(agents) {
  fileDesSignaux = fileDesSignaux.then(() => calculerLesSignaux(agents)).catch(() => {});
  return fileDesSignaux;
}

async function calculerLesSignaux(agents) {
  const espace = await etat();
  const { statuts = {}, nonVus = {} } = await chrome.storage.session.get(['statuts', 'nonVus']);
  const calcul = signauxDesAgents(agents, statuts, nonVus, await agentsRegardes(espace));
  await chrome.storage.session.set({ statuts: Object.fromEntries(agents.map((a) => [a.agentId, a.statut])), nonVus: calcul.nonVus });
  signaux = calcul.signaux;
  const attente = [...signaux.values()].includes('attente');
  await chrome.action.setBadgeBackgroundColor({ color: attente ? JAUNE : VIOLET });
  await chrome.action.setBadgeTextColor?.({ color: attente ? '#111111' : '#ffffff' });
  await chrome.action.setBadgeText({ text: signaux.size ? String(signaux.size) : '' });
  await clignoter(espace);
}

/** Les groupes à faire clignoter : ceux des agents à regarder, sauf celui qu'on regarde déjà. */
async function clignoter(espace) {
  const regardes = await agentsRegardes(espace);
  const groupes = new Map();
  for (const [agentId, genre] of signaux) {
    const g = espace.groupes[agentId];
    if (Number.isInteger(g) && !regardes.has(agentId)) groupes.set(g, genre);
  }
  /* Les groupes qui ne doivent plus clignoter retrouvent leur titre et leur couleur. */
  for (const g of [...originaux.keys()]) if (!groupes.has(g)) await rendreLeGroupe(g);
  for (const g of groupes.keys()) {
    if (originaux.has(g)) continue;
    try {
      const groupe = await chrome.tabGroups.get(g);
      originaux.set(g, { title: groupe.title.replace(/^● /, ''), color: groupe.color });
    } catch {
      /* groupe fermé */
    }
  }
  await chrome.storage.session.set({ originaux: Object.fromEntries(originaux) });
  genres = groupes;
  if (!originaux.size) {
    clearInterval(clignotement);
    clignotement = null;
    return;
  }
  if (clignotement === null) clignotement = setInterval(() => void battre(), CLIGNOTEMENT_MS);
}

/** Un battement : chaque groupe signalé passe de « ● titre » en couleur du signal à son titre d'origine. */
let genres = new Map();
async function battre() {
  phase = !phase;
  for (const [g, o] of [...originaux]) {
    /* Un groupe rendu entre-temps ne reprend pas son « ● ». */
    if (!originaux.has(g)) continue;
    const genre = genres.get(g) === 'attente' ? 'yellow' : 'purple';
    try {
      await chrome.tabGroups.update(g, phase ? { title: `● ${o.title}`.slice(0, 40), color: o.color === genre ? 'grey' : genre } : { title: o.title, color: o.color });
    } catch {
      originaux.delete(g);
    }
  }
  if (!originaux.size) {
    clearInterval(clignotement);
    clignotement = null;
  }
}

async function rendreLeGroupe(g) {
  const o = originaux.get(g);
  originaux.delete(g);
  if (!o) return;
  await chrome.tabGroups.update(g, { title: o.title, color: o.color }).catch(() => {});
}

/** Au réveil : un groupe resté en plein clignotement retrouve son titre d'origine avant tout. */
async function reprendreLesGroupes() {
  const { originaux: gardes = {} } = await chrome.storage.session.get('originaux');
  for (const [g, o] of Object.entries(gardes)) originaux.set(Number(g), o);
  if (dernierEtat) return;
  for (const g of [...originaux.keys()]) await rendreLeGroupe(g);
  await chrome.storage.session.set({ originaux: {} });
}

/** La personne regarde peut-être un groupe signalé : on efface sa marque, sans redemander l'état au démon. */
async function regardEnChange() {
  if (dernierEtat) await appliquerLesSignaux(dernierEtat);
}

/* ------------------------------------------------------------------ */
/* Le panneau latéral                                                   */
/* ------------------------------------------------------------------ */

const panneaux = new Set();

function diffuser(message) {
  for (const port of panneaux) {
    try {
      port.postMessage(message);
    } catch {
      panneaux.delete(port);
    }
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'panneau') return;
  panneaux.add(port);
  void publierLesOnglets();
  port.onDisconnect.addListener(() => {
    panneaux.delete(port);
    void publierLesOnglets();
  });
  port.onMessage.addListener(async (m) => {
    /* Le type et le numéro passent EN DERNIER : une réponse du démon porte les siens (« ack »). */
    const repondre = (data) => port.postMessage({ ...data, type: 'reponse', id: m.id });
    try {
      if (m.type === 'etat-liaison') {
        const { identifiant, nom, langue: l } = await chrome.storage.local.get(['identifiant', 'nom', 'langue']);
        if (identifiant) void connecter();
        return repondre({ relie: !!identifiant, enLigne: !!(voie && voie.readyState === 1), nom: nom ?? null, langue: l ?? langue });
      }
      if (m.type === 'relier') return repondre(await relier(String(m.code ?? ''), String(m.nom ?? '')));
      if (m.type === 'delier') {
        await delier();
        return repondre({ ok: true });
      }
      if (m.type === 'cmd') return repondre(await commande(m.cmd));
      if (m.type === 'agent-de-l-onglet') return repondre({ agentId: await agentDeLOnglet(m.tabId) });
      if (m.type === 'capturer-l-onglet') return repondre(await captureVisible(m.tabId, m.pleinePage));
      if (m.type === 'demande-en-attente') {
        const { demandeEnAttente } = await chrome.storage.session.get('demandeEnAttente');
        await chrome.storage.session.remove('demandeEnAttente');
        return repondre({ demande: demandeEnAttente ?? null });
      }
      if (m.type === 'confier') return repondre(await confierLOnglet(m.tabId, m.agentId));
    } catch (err) {
      repondre({ ok: false, error: String(err?.message ?? err) });
    }
  });
});

/*
 * LE PANNEAU EST CELUI DE LA FENÊTRE, ET IL RESTE OUVERT D'UN ONGLET À L'AUTRE (1.0.13, carte « Extension, rapport
 * SEO-GEO et menus », 21/11/2026 — revient sur DEC-509 à la demande de l'utilisateur : « le volet se ferme à chaque
 * changement d'onglet »). UN SEUL panneau GLOBAL (`setOptions({ path, enabled: true })` sans onglet), ouvert par un
 * geste de la personne (icône, clic droit, « Y aller ») sur sa fenêtre (`sidePanel.open({ windowId })`) : Chrome le
 * garde affiché quel que soit l'onglet choisi, jusqu'à ce qu'on le ferme. Le panneau suit l'onglet actif lui-même
 * (message « onglet » → `suivreLOnglet`, qui choisit l'agent de l'onglet).
 * PLUS AUCUN PANNEAU PROPRE À UN ONGLET : un réglage par onglet (`tabId`) masque le panneau global sur cet onglet —
 * c'est exactement ce qui le faisait disparaître. `ongletsPermis` et `panneauxPermis` restent vides (le panneau
 * n'a plus rien à « étendre »).
 */
const CHEMIN_DU_PANNEAU = 'panneau.html';
const ouvertsALaMain = new Set();
/** Gardé pour les panneaux d'une version précédente qui le lisent encore : toujours vide. */
const ongletsPermis = new Set();
let ongletActifAvant = null;

/** Les onglets où un panneau est réellement ouvert : un panneau d'onglet (`?onglet=`) d'une version précédente. */
function ongletsAvecPanneau() {
  const ids = new Set();
  for (const p of panneaux) {
    const id = Number(new URL(p.sender?.url ?? 'chrome-extension://x/').searchParams.get('onglet'));
    if (Number.isInteger(id) && id > 0) ids.add(id);
  }
  return ids;
}

function publierLesOnglets() {
  return chrome.storage.session.set({ panneauxPermis: [], panneauxOuverts: [...ongletsAvecPanneau()] }).catch(() => {});
}

function garderLesOuvertsALaMain() {
  return chrome.storage.session.set({ ouvertsALaMain: [...ouvertsALaMain] });
}

async function groupesDesAgents() {
  const espace = await etat();
  /* Une fenêtre privée réduite (passage du suivi GEO) ne porte jamais de panneau : rien n'y attire le regard. */
  return new Set(Object.entries(espace.groupes).filter(([agentId, g]) => Number.isInteger(g) && !espace.privees[agentId]).map(([, g]) => g));
}

/** Le panneau global de toutes les fenêtres : posé au réveil, jamais retiré. */
async function poserLesPanneaux() {
  await chrome.sidePanel.setOptions({ path: CHEMIN_DU_PANNEAU, enabled: true }).catch(() => {});
  await publierLesOnglets();
}

/** Gardée pour les appels existants : un onglet n'a plus de réglage à lui. */
async function poserLePanneau() {}

/**
 * DANS UN GESTE de la personne (aucun await avant) : le panneau de la fenêtre de `tabId` s'ouvre (`windowId` connu
 * par l'onglet : la fenêtre au premier plan sinon).
 */
function ouvrirSurLesOngletsPermis(tabId, windowId) {
  if (Number.isInteger(windowId)) chrome.sidePanel.open({ windowId }).catch(() => {});
  else if (Number.isInteger(tabId)) chrome.sidePanel.open({ tabId }).catch(() => {});
}

/** Le clic de la personne : le panneau de SA fenêtre s'ouvre ici, dans le geste (avant tout await). */
function ouvrirALaMain(tab) {
  ouvertsALaMain.add(tab.id);
  void garderLesOuvertsALaMain();
  ouvrirSurLesOngletsPermis(tab.id, tab.windowId);
  void publierLesOnglets();
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() =>
    chrome.contextMenus.create({ id: 'beluga-demander', title: chrome.i18n.getMessage('demander'), contexts: ['selection', 'image', 'link', 'page'] }),
  );
});
/* L'icône ne s'ouvre plus d'elle-même : c'est `action.onClicked` qui permet l'onglet courant, puis ouvre. */
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
chrome.action.onClicked.addListener((tab) => tab && ouvrirALaMain(tab));

/* LE CLIC DROIT « DEMANDER À BELUGA » : le panneau s'ouvre (le clic est un geste de la personne) sur une nouvelle
   demande, la sélection, l'image ou le lien déjà joints. */
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'beluga-demander' || !tab) return;
  ouvrirALaMain(tab);
  const demande = {
    selection: info.selectionText ?? '',
    image: info.srcUrl ?? '',
    lien: info.linkUrl ?? '',
    onglet: { id: tab.id, url: tab.url, titre: tab.title },
  };
  void chrome.storage.session.set({ demandeEnAttente: demande });
  diffuser({ type: 'demande', demande });
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  /* LE PANNEAU RESTE OUVERT (1.0.13) : changer d'onglet ne retire plus rien, le panneau suit l'onglet choisi. */
  ongletActifAvant = tabId;
  void agentDeLOnglet(tabId).then((agentId) => diffuser({ type: 'onglet', tabId, agentId }));
  void regardEnChange();
});
chrome.windows.onFocusChanged.addListener(() => void regardEnChange());
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.groupId !== undefined) void groupesDesAgents().then((g) => poserLePanneau(tab, g));
  if (change.groupId !== undefined || change.url) void agentDeLOnglet(tabId).then((agentId) => diffuser({ type: 'onglet', tabId, agentId, url: change.url }));
});
chrome.tabs.onCreated.addListener((tab) => void groupesDesAgents().then((g) => poserLePanneau(tab, g)));
chrome.tabs.onRemoved.addListener((tabId) => {
  ongletsPermis.delete(tabId);
  if (ouvertsALaMain.delete(tabId)) void garderLesOuvertsALaMain();
  void publierLesOnglets();
});
chrome.tabGroups.onRemoved.addListener((groupe) => {
  originaux.delete(groupe.id);
  void regardEnChange();
});
void chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([t]) => (ongletActifAvant = t?.id ?? null));
void chrome.storage.session.get('ouvertsALaMain').then(({ ouvertsALaMain: gardes = [] }) => {
  for (const id of gardes) ouvertsALaMain.add(id);
  return poserLesPanneaux();
});
void reprendreLesGroupes();

/*
 * 1.0.12 — LA LIAISON POSÉE PAR BELUGA CONNECT (carte « Liaison de l'extension Chrome simplifiée », 20/11/2026) : quand
 * l'application du Mac installe l'extension, elle pose à côté d'elle `liaison.json` ({ code }), un code de liaison à
 * usage unique émis par Beluga pour CET ordinateur. Tant qu'elle n'est pas reliée, l'extension le lit (au démarrage,
 * puis à chaque réveil) et se relie seule : personne n'a de code à taper. Un code déjà essayé n'est jamais rejoué.
 */
async function lierParLeFichier() {
  const { identifiant } = await liaison();
  if (identifiant) return;
  let fiche = null;
  try {
    const r = await fetch(chrome.runtime.getURL('liaison.json'), { cache: 'no-store' });
    if (r.ok) fiche = await r.json();
  } catch {
    return;
  }
  const code = String(fiche?.code ?? '');
  if (!/^\d{6}$/.test(code)) return;
  const adresse = typeof fiche?.adresse === 'string' && /^https?:\/\/[A-Za-z0-9.:\[\]-]+$/.test(fiche.adresse) ? fiche.adresse : null;
  /* 1.0.15 : un code n'est abandonné que sur un REFUS de Beluga (expiré, inconnu) ; une panne de réseau le fait
     réessayer au réveil suivant (toutes les 30 s), vingt fois au plus. Chaque refus est signalé à Beluga. */
  const { liaisonEssayee } = await chrome.storage.local.get('liaisonEssayee');
  const deja = typeof liaisonEssayee === 'string' ? { code: liaisonEssayee, fini: true, essais: 1 } : liaisonEssayee ?? null;
  if (deja?.code === code && deja.fini) return;
  const essais = deja?.code === code ? (deja.essais ?? 0) + 1 : 1;
  await chrome.storage.local.set({ liaisonEssayee: { code, fini: false, essais } });
  let issue;
  try {
    issue = await relier(code, undefined, adresse);
  } catch (err) {
    const fini = essais >= 20;
    await chrome.storage.local.set({ liaisonEssayee: { code, fini, essais } });
    if (fini) void signalerLEchec(code, `Beluga injoignable : ${String(err?.message ?? err)}`, adresse);
    return;
  }
  if (issue?.ok) {
    await chrome.storage.local.set({ liaisonEssayee: { code, fini: true, essais } });
    return;
  }
  /* « Trop d'essais » n'est pas un refus du code : il se retente au réveil suivant. */
  const fini = !/^Trop/.test(String(issue?.raison ?? '')) || essais >= 20;
  await chrome.storage.local.set({ liaisonEssayee: { code, fini, essais } });
  if (fini) void signalerLEchec(code, issue?.raison ?? 'refusé', adresse);
}

async function signalerLEchec(code, raison, adresseImposee) {
  try {
    const adresse = adresseImposee || (await configuration()).adresse;
    await fetch(`${adresse}/api/extension-chrome/echec`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, raison: String(raison).slice(0, 200) }) });
  } catch {
    /* rien à faire de plus : l'écran de Beluga passera au code de secours */
  }
}

const seReveiller = () => void lierParLeFichier().finally(() => connecter());
chrome.alarms.create('beluga-reveil', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => a.name === 'beluga-reveil' && seReveiller());
chrome.runtime.onStartup.addListener(seReveiller);
seReveiller();

/* ------------------------------------------------------------------ */
/* La fenêtre et les groupes des agents                                 */
/* ------------------------------------------------------------------ */

async function etat() {
  const { espace } = await chrome.storage.session.get('espace');
  /* `fenetreId` (l'ancienne fenêtre réservée) est ignoré : un groupe déjà ouvert là-bas reste utilisable. */
  const e = espace ?? { groupes: {}, courants: {}, titres: {} };
  e.fenetres ??= {};
  /* Les agents qui travaillent dans LEUR fenêtre privée réduite, à part (et l'onglet vide qu'elle a ouvert). */
  e.privees ??= {};
  e.vierges ??= {};
  return e;
}
async function ecrire(espace) {
  await chrome.storage.session.set({ espace });
  /* Un onglet entré dans le groupe d'un agent (ou un groupe neuf) reçoit le panneau. */
  await poserLesPanneaux();
}

async function fenetreExiste(id) {
  if (!Number.isInteger(id)) return false;
  try {
    await chrome.windows.get(id);
    return true;
  } catch {
    return false;
  }
}

/**
 * LA FENÊTRE PRIVÉE RÉDUITE D'UN AGENT (carte « Audits SEO et GEO dans le Marketing », 18/11/2026). Les passages du
 * suivi GEO posent leurs questions aux IA dans une fenêtre de navigation PRIVÉE — aucun compte ni historique de la
 * personne —, ouverte RÉDUITE et sans focus : elle ne passe jamais devant son travail. Sans l'autorisation de
 * l'extension en navigation privée, RIEN ne s'ouvre ailleurs (jamais de repli sur la fenêtre de travail, qui porte les
 * comptes de la personne). Fermée par la personne, elle est recréée au geste suivant.
 */
const REFUS_NAVIGATION_PRIVEE = 'navigation-privee-non-autorisee';

async function fenetrePriveeDeLAgent(espace, agentId) {
  const id = espace.fenetres[agentId];
  if (Number.isInteger(id)) {
    try {
      const w = await chrome.windows.get(id);
      if (w.incognito) return id;
    } catch {
      /* fermée par la personne : on la recrée */
    }
  }
  if (!(await chrome.extension.isAllowedIncognitoAccess())) {
    throw new Error(`${REFUS_NAVIGATION_PRIVEE} : cochez « Autoriser en navigation privée » pour l'extension Beluga (chrome://extensions).`);
  }
  const w = await chrome.windows.create({ incognito: true, focused: false, state: 'minimized', type: 'normal', url: 'about:blank' });
  espace.fenetres[agentId] = w.id;
  delete espace.groupes[agentId];
  delete espace.courants[agentId];
  const vierge = w.tabs?.[0]?.id;
  if (Number.isInteger(vierge)) espace.vierges[agentId] = vierge;
  return w.id;
}

/**
 * LA FENÊTRE DE L'AGENT : celle de son groupe s'il en a un, sinon celle d'où la demande est partie (retenue à la
 * préparation), sinon la dernière fenêtre ordinaire que la personne a utilisée. JAMAIS une fenêtre neuve — sauf pour un
 * agent en fenêtre privée, qui a la sienne.
 */
async function fenetreDeLAgent(espace, agentId) {
  if (espace.privees[agentId]) return fenetrePriveeDeLAgent(espace, agentId);
  const groupe = await groupeDeLAgent(espace, agentId);
  if (groupe !== null) {
    try {
      return (await chrome.tabGroups.get(groupe)).windowId;
    } catch {
      /* groupe disparu entre-temps */
    }
  }
  if (await fenetreExiste(espace.fenetres[agentId])) return espace.fenetres[agentId];
  const derniere = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
  if (derniere?.id !== undefined) {
    espace.fenetres[agentId] = derniere.id;
    return derniere.id;
  }
  throw new Error('Aucune fenêtre Chrome ouverte : la personne doit en ouvrir une.');
}

async function groupeDeLAgent(espace, agentId) {
  const id = espace.groupes[agentId];
  if (id === undefined) return null;
  try {
    await chrome.tabGroups.get(id);
    return id;
  } catch {
    delete espace.groupes[agentId];
    return null;
  }
}

/** L'onglet rejoint le groupe de l'agent, SUR PLACE : le groupe naît dans la fenêtre de l'onglet. */
async function rangerDansLeGroupe(espace, agentId, tabId) {
  const groupe = await groupeDeLAgent(espace, agentId);
  const nouveau = await chrome.tabs.group({ tabIds: [tabId], ...(groupe !== null ? { groupId: groupe } : {}) });
  if (groupe === null) {
    const t = espace.titres[agentId] ?? { titre: 'Agent', couleur: 'purple' };
    await chrome.tabGroups.update(nouveau, { title: `Beluga · ${t.titre}`.slice(0, 40), color: t.couleur });
  }
  espace.groupes[agentId] = nouveau;
}

async function agentDeLOnglet(tabId) {
  if (!Number.isInteger(tabId)) return null;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.groupId < 0) return null;
    const espace = await etat();
    return Object.entries(espace.groupes).find(([, g]) => g === tab.groupId)?.[0] ?? null;
  } catch {
    return null;
  }
}

async function confierLOnglet(tabId, agentId) {
  const espace = await etat();
  const tab = await chrome.tabs.get(tabId);
  espace.fenetres[agentId] = tab.windowId;
  await rangerDansLeGroupe(espace, agentId, tabId);
  espace.courants[agentId] = tabId;
  await ecrire(espace);
  return { ok: true };
}

/**
 * LE SUIVI EN DIRECT (décision du 09/11/2026 : « suivre l'agent, sauf si vous êtes ailleurs »). L'agent vient d'agir
 * sur un onglet : si la personne regarde un onglet du MÊME groupe, Chrome l'amène sur celui-ci ; sinon on ne lui
 * arrache rien, et le panneau affiche une ligne « l'agent agit sur … » avec « Y aller ».
 */
async function suivreLAgent(agentId, tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.active) return;
    /* Fenêtre privée réduite : l'onglet devient l'onglet actif DE SA fenêtre (la page se dessine mieux), sans jamais
       toucher à la fenêtre elle-même — elle reste réduite, derrière. Aucun signal vers les panneaux de la personne. */
    if (tab.incognito) {
      await chrome.tabs.update(tabId, { active: true });
      return;
    }
    const [actif] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    /* Un panneau d'onglet ne suit pas tout seul : amener la personne, panneau sous les yeux, sur un onglet qui n'a pas
       le sien le lui retirerait. On le lui propose alors (« Y aller », dont le clic ouvre le panneau là-bas). */
    const ouverts = ongletsAvecPanneau();
    const perdrait = actif && ouverts.has(actif.id) && !ouverts.has(tabId);
    if (actif && tab.groupId >= 0 && actif.groupId === tab.groupId && !perdrait) {
      await chrome.tabs.update(tabId, { active: true });
      return;
    }
    diffuser({ type: 'evenement', genre: 'agit', agentId, tabId, titre: tab.title || tab.url || '' });
  } catch {
    /* onglet fermé entre-temps */
  }
}

/** L'onglet visé : celui donné s'il est DANS le groupe de l'agent, sinon son dernier onglet. */
async function ongletDeLAgent(espace, agentId, demande) {
  const groupe = await groupeDeLAgent(espace, agentId);
  const id = Number.isInteger(demande) ? demande : espace.courants[agentId];
  if (!Number.isInteger(id)) throw new Error('Tu n’as encore aucun onglet : ouvre-en un avec « ouvrir ».');
  let tab;
  try {
    tab = await chrome.tabs.get(id);
  } catch {
    throw new Error(`L’onglet ${id} a été fermé.`);
  }
  if (groupe === null || tab.groupId !== groupe) throw new Error(`L’onglet ${id} n’est pas dans ton groupe : la personne ne te l’a pas confié.`);
  espace.courants[agentId] = id;
  return tab;
}

/* ------------------------------------------------------------------ */
/* Le débogueur                                                         */
/* ------------------------------------------------------------------ */

const attaches = new Map();

async function attacher(tabId) {
  const deja = attaches.get(tabId);
  if (deja) {
    clearTimeout(deja);
  } else {
    try {
      await chrome.debugger.attach({ tabId }, '1.3');
    } catch (err) {
      let texte = String(err?.message ?? err);
      if (/already attached|Another debugger/i.test(texte)) throw new Error('Les outils de développement sont ouverts sur cet onglet : fermez-les pour que je puisse y agir.');
      /* Un cadre d'une AUTRE extension (menu de 1Password…) interdit le débogueur : on le retire de la page, puis
         on réessaie une fois. Le gestionnaire de mots de passe le reposera au prochain champ, d'où le ménage à
         chaque attache refusée plutôt qu'une seule fois. */
      if (/chrome-extension:\/\/ URL of different extension/i.test(texte)) {
        try {
          await jouer(tabId, retirerLesCadresDAutresExtensions);
          await chrome.debugger.attach({ tabId }, '1.3');
          texte = '';
        } catch (encore) {
          texte = String(encore?.message ?? encore);
        }
      }
      if (texte) throw new Error(`Chrome refuse le pilotage de cet onglet (${texte}). Un autre module de Chrome (gestionnaire de mots de passe) y affiche peut-être un menu : fermez-le.`);
    }
  }
  attaches.set(tabId, setTimeout(() => detacher(tabId), DETACHER_APRES_MS));
}

function detacher(tabId) {
  const t = attaches.get(tabId);
  if (t) clearTimeout(t);
  attaches.delete(tabId);
  chrome.debugger.detach({ tabId }).catch(() => {});
}

chrome.debugger.onDetach.addListener(({ tabId }) => {
  const t = attaches.get(tabId);
  if (t) clearTimeout(t);
  attaches.delete(tabId);
});

/** Le débogueur a lâché l'onglet en pleine commande, ou un cadre d'une autre extension l'y empêche. */
const LACHE_PAR_UN_AUTRE_MODULE = /Detached while handling command|chrome-extension:\/\/ URL of different extension|Debugger is not attached/i;

async function cdp(tabId, methode, params = {}) {
  await attacher(tabId);
  try {
    return await chrome.debugger.sendCommand({ tabId }, methode, params);
  } catch (err) {
    /* Le menu d'un gestionnaire de mots de passe, posé au focus d'un champ, fait DÉTACHER le débogueur : on
       retire ses cadres, on se rattache, et la commande repart une fois. */
    if (!LACHE_PAR_UN_AUTRE_MODULE.test(String(err?.message ?? err))) throw err;
    detacher(tabId);
    await jouer(tabId, retirerLesCadresDAutresExtensions).catch(() => {});
    await attacher(tabId);
    return chrome.debugger.sendCommand({ tabId }, methode, params);
  }
}

/** Une fonction DE CE FICHIER (`pages.js`), jouée dans la page : jamais un texte venu d'un agent. */
async function jouer(tabId, fonction, ...args) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: fonction, args, world: 'ISOLATED' });
  return r?.result;
}

/**
 * Le texte dans le champ qui a le focus : par le débogueur d'abord (frappe fidèle), par un script de page si le
 * débogueur refuse encore — un gestionnaire de mots de passe qui repose son menu à chaque focus.
 */
async function insererLeTexte(tabId, repere, texte) {
  if (SAFARI) {
    if (!(await jouer(tabId, saisirSansDebogueur, repere, texte, false))) throw new Error('Ce champ refuse la saisie dans Safari : relis la page.');
    return;
  }
  try {
    await cdp(tabId, 'Input.insertText', { text: texte });
  } catch (err) {
    const ok = await jouer(tabId, saisirSansDebogueur, repere, texte, false);
    if (!ok) throw err;
  }
}

/** La même chose dans le monde PRINCIPAL de la page : seulement pour intercepter un sélecteur de fichiers. */
async function jouerDansLaPage(tabId, fonction, ...args) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: fonction, args, world: 'MAIN' });
  return r?.result;
}

async function attendreLeChargement(tabId, ms = 30_000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    const t = await chrome.tabs.get(tabId);
    if (t.status === 'complete') return t;
    await new Promise((r) => setTimeout(r, 250));
  }
  return chrome.tabs.get(tabId);
}

/** Une promesse bornée : un onglet en arrière-plan peut ne jamais rendre d'image, le geste n'attend pas pour autant. */
function borne(promesse, ms, message) {
  return Promise.race([promesse, new Promise((_, rejeter) => setTimeout(() => rejeter(new Error(message)), ms))]);
}

/** Safari : l'image de la partie visible, seulement si l'onglet est affiché (Safari ne dessine pas un onglet caché). */
async function captureSafari(tabId, format) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.active) throw new Error('L’onglet est en arrière-plan : la capture reprendra quand la personne l’affichera.');
  const url = await chrome.tabs.captureVisibleTab(tab.windowId, format === 'jpeg' ? { format: 'jpeg', quality: 50 } : { format: 'png' });
  return String(url).replace(/^data:image\/\w+;base64,/, '');
}

async function imageDuFilm(tabId) {
  if (SAFARI) return captureSafari(tabId, 'jpeg').catch(() => undefined);
  try {
    const r = await borne(cdp(tabId, 'Page.captureScreenshot', { format: 'jpeg', quality: 50 }), 3000, 'image en retard');
    return r.data;
  } catch {
    return undefined;
  }
}

async function captureVisible(tabId, pleinePage) {
  return borne(captureSansBorne(tabId, pleinePage), 10_000, 'L’onglet est en arrière-plan et ne se dessine pas : la capture reprendra quand la personne l’affichera (ligne « Y aller » du panneau).');
}

/**
 * LA CAPTURE QUE L'AGENT LIRA : la souris virtuelle est masquée le temps de la prise, puis remontrée, même si la
 * capture échoue. Si l'agent a cliqué depuis la dernière capture de cet onglet, l'endroit cliqué part avec l'image,
 * en fraction de sa largeur et de sa hauteur (`pointClic`), pour le point violet de la vignette.
 */
async function captureSansBorne(tabId, pleinePage) {
  const clic = clicsNonCaptures.get(tabId);
  clicsNonCaptures.delete(tabId);
  await dessinerLaSouris(tabId, 'cacher');
  try {
    const r = await prendreLaCapture(tabId, pleinePage);
    if (clic && clic.w > 0 && clic.h > 0) {
      const point = pleinePage
        ? { x: (clic.x + clic.sx) / r.largeur, y: (clic.y + clic.sy) / r.hauteur }
        : { x: clic.x / clic.w, y: clic.y / clic.h };
      if (point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1) r.pointClic = { x: Math.round(point.x * 1000) / 1000, y: Math.round(point.y * 1000) / 1000 };
    }
    delete r.largeur;
    delete r.hauteur;
    return r;
  } finally {
    await dessinerLaSouris(tabId, 'montrer');
  }
}

async function prendreLaCapture(tabId, pleinePage) {
  /* Safari : la partie visible seulement, même pour « pleinePage » (le démon le dit à l'agent). */
  if (SAFARI) return { png: await captureSafari(tabId, 'png'), largeur: 0, hauteur: 0 };
  if (pleinePage) {
    const m = await cdp(tabId, 'Page.getLayoutMetrics');
    const l = m.cssContentSize ?? m.contentSize;
    const r = await cdp(tabId, 'Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: Math.min(l.width, 1600), height: Math.min(l.height, 12000), scale: 1 },
    });
    return { png: r.data, largeur: Math.min(l.width, 1600), hauteur: Math.min(l.height, 12000) };
  }
  const r = await cdp(tabId, 'Page.captureScreenshot', { format: 'png' });
  return { png: r.data, largeur: 0, hauteur: 0 };
}

const CODES = {
  Enter: [13, 'Enter', '\r'],
  Tab: [9, 'Tab'],
  'Shift+Tab': [9, 'Tab', undefined, 8],
  Escape: [27, 'Escape'],
  Backspace: [8, 'Backspace'],
  Delete: [46, 'Delete'],
  ArrowDown: [40, 'ArrowDown'],
  ArrowUp: [38, 'ArrowUp'],
  ArrowLeft: [37, 'ArrowLeft'],
  ArrowRight: [39, 'ArrowRight'],
  PageDown: [34, 'PageDown'],
  PageUp: [33, 'PageUp'],
  Home: [36, 'Home'],
  End: [35, 'End'],
  Space: [32, 'Space', ' '],
};

async function frapper(tabId, touche) {
  const c = CODES[touche];
  if (!c) throw new Error(`Touche inconnue : ${touche}. Touches : ${Object.keys(CODES).join(', ')}.`);
  if (SAFARI) {
    await jouer(tabId, frapperSansDebogueur, touche);
    return;
  }
  const [code, nom, texte, modifiers = 0] = c;
  await cdp(tabId, 'Input.dispatchKeyEvent', { type: texte ? 'keyDown' : 'rawKeyDown', key: nom, code: nom, windowsVirtualKeyCode: code, modifiers, ...(texte ? { text: texte } : {}) });
  await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: nom, code: nom, windowsVirtualKeyCode: code, modifiers });
}

/* ------------------------------------------------------------------ */
/* La souris virtuelle                                                  */
/* ------------------------------------------------------------------ */

/** La dernière position de la souris dessinée, par onglet. */
const souris = new Map();
/** Le dernier clic de chaque onglet, pas encore emporté par une capture : { x, y, sx, sy, w, h }. */
const clicsNonCaptures = new Map();
const hasard = (a, b) => a + Math.random() * (b - a);
const attendreMs = (ms) => new Promise((r) => setTimeout(r, ms));

/** La souris dessinée dans la page ; jamais bloquante (une page interdite aux scripts n'empêche pas le clic). */
async function dessinerLaSouris(tabId, phase, a, b) {
  try {
    return await jouer(tabId, poserLaSouris, phase, a ?? null, b ?? null);
  } catch {
    return null;
  }
}

/** Une courbe de Bézier cubique, échantillonnée sur une vitesse en cloche (lente, rapide, lente). */
function courbe(p0, p1, p2, p3, n) {
  const points = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const t = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    const m = 1 - t;
    const x = m * m * m * p0[0] + 3 * m * m * t * p1[0] + 3 * m * t * t * p2[0] + t * t * t * p3[0];
    const y = m * m * m * p0[1] + 3 * m * m * t * p1[1] + 3 * m * t * t * p2[1] + t * t * t * p3[1];
    /* Un léger tremblement de la main, jamais aux deux bouts. */
    const bruit = i > 0 && i < n ? 0.6 : 0;
    points.push([x + hasard(-bruit, bruit), y + hasard(-bruit, bruit)]);
  }
  return points;
}

/**
 * LE TRAJET D'UNE VRAIE MAIN, du point actuel jusqu'à (x, y) : courbe décalée d'un côté au hasard, durée selon la
 * distance et la taille de la cible (loi de Fitts, 0,3 à 0,9 s), léger dépassement puis correction sur un long
 * trajet. Chaque point part en `mouseMoved` (la page voit le survol) pendant que la page dessine la même courbe.
 */
async function allerA(tabId, x, y, largeurCible = 24) {
  let depart = souris.get(tabId);
  const vue = await dessinerLaSouris(tabId, 'montrer');
  if (!depart) depart = vue ? { x: vue.x, y: vue.y } : { x, y };
  const dx = x - depart.x;
  const dy = y - depart.y;
  const d = Math.hypot(dx, dy);
  if (d < 2) {
    await dessinerLaSouris(tabId, 'poser', x, y);
    await bouger(tabId, x, y);
    souris.set(tabId, { x, y });
    return;
  }
  const duree = Math.round(Math.min(900, Math.max(300, 250 + 120 * Math.log2(1 + d / Math.max(16, largeurCible)))));
  const nx = -dy / d;
  const ny = dx / d;
  const cote = Math.random() < 0.5 ? -1 : 1;
  const ecart = d * hasard(0.1, 0.25) * cote;
  const p0 = [depart.x, depart.y];
  const p1 = [depart.x + dx * 0.3 + nx * ecart, depart.y + dy * 0.3 + ny * ecart];
  const p2 = [depart.x + dx * 0.75 + nx * ecart * 0.5, depart.y + dy * 0.75 + ny * ecart * 0.5];
  /* Sur un long trajet, la main dépasse un peu la cible, puis revient. */
  const depasse = d > 400 ? hasard(6, 14) : 0;
  const bout = [x + (dx / d) * depasse, y + (dy / d) * depasse];
  const dureeAller = depasse ? Math.round(duree * 0.85) : duree;
  const segments = [{ points: courbe(p0, p1, p2, bout, Math.max(8, Math.round(dureeAller / 16))), duree: dureeAller }];
  if (depasse) {
    const dureeRetour = duree - dureeAller;
    segments.push({ points: courbe(bout, bout, [x, y], [x, y], Math.max(4, Math.round(dureeRetour / 16))), duree: dureeRetour });
  }
  for (const seg of segments) {
    await dessinerLaSouris(tabId, 'trajet', seg.points, seg.duree);
    const debut = Date.now();
    for (let i = 1; i < seg.points.length; i++) {
      const [px, py] = seg.points[i];
      await bouger(tabId, Math.round(px), Math.round(py));
      const cible = debut + (seg.duree * i) / (seg.points.length - 1);
      const reste = cible - Date.now();
      if (reste > 0) await attendreMs(reste);
    }
  }
  /* L'arrivée tombe EXACTEMENT sur le point du clic. */
  await dessinerLaSouris(tabId, 'poser', x, y);
  souris.set(tabId, { x, y });
}

/** Un pas de souris : par le débogueur dans Chrome ; dans Safari, seule la souris dessinée bouge. */
async function bouger(tabId, x, y) {
  if (SAFARI) return;
  await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
}

async function cliquerA(tabId, x, y, largeurCible) {
  await allerA(tabId, x, y, largeurCible);
  if (SAFARI) {
    await attendreMs(hasard(60, 140));
    const vue = await dessinerLaSouris(tabId, 'appuyer');
    const touche = await jouer(tabId, cliquerSansDebogueur, x, y);
    if (touche === null) throw new Error('Rien à cliquer à cet endroit : relis la page avec « lire ».');
    clicsNonCaptures.set(tabId, { x, y, sx: vue?.sx ?? 0, sy: vue?.sy ?? 0, w: vue?.w ?? 0, h: vue?.h ?? 0 });
    return;
  }
  await attendreMs(hasard(60, 140));
  await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  const vue = await dessinerLaSouris(tabId, 'appuyer');
  await attendreMs(hasard(40, 90));
  await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  clicsNonCaptures.set(tabId, { x, y, sx: vue?.sx ?? 0, sy: vue?.sy ?? 0, w: vue?.w ?? 0, h: vue?.h ?? 0 });
}

/** Avant une saisie : la souris va sur le champ, comme une main qui s'y pose. */
async function survolerUnRepere(tabId, repere) {
  try {
    const c = await jouer(tabId, centreDUnRepere, repere);
    if (c) await allerA(tabId, c.x, c.y, c.l);
  } catch {
    /* la saisie se fait quand même */
  }
}

/* ------------------------------------------------------------------ */
/* Le dépôt d'un fichier                                                */
/* ------------------------------------------------------------------ */

/**
 * Le fichier vient du SERVEUR, en base64 : il est posé dans la page par le débogueur, dans le monde de la page.
 * Jamais `DOM.setFileInputFiles` (il veut un chemin sur CET ordinateur), jamais la fenêtre de sélection de
 * l'ordinateur : un bouton qui l'ouvrirait est intercepté (`Page.setInterceptFileChooserDialog`).
 */
async function jouerSurLaCible(tabId, jeton, fonction, fichier, ...autres) {
  const { result } = await cdp(tabId, 'Runtime.evaluate', { expression: `document.querySelector('[data-beluga-depot="${jeton}"]')` });
  if (!result?.objectId) throw new Error('La cible du dépôt a disparu de la page : relis-la.');
  return appelerSurUnObjet(tabId, result.objectId, fonction, fichier, ...autres);
}

async function appelerSurUnObjet(tabId, objectId, fonction, fichier, ...autres) {
  const r = await cdp(tabId, 'Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: fonction.toString(),
    arguments: [{ value: fichier }, ...autres.map((value) => ({ value }))],
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error(`La page a refusé le fichier (${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}).`);
  return r.result?.value;
}

/** Clique le bouton en interceptant la sélection qu'il ouvre ; null si aucune ne s'ouvre en 8 s. */
async function deposerParLaSelection(tabId, cible, fichier) {
  let signaler;
  const ouverte = new Promise((r) => (signaler = r));
  const ecoute = (source, methode, params) => {
    if (source.tabId === tabId && methode === 'Page.fileChooserOpened') signaler(params);
  };
  chrome.debugger.onEvent.addListener(ecoute);
  try {
    await cdp(tabId, 'Page.enable');
    await cdp(tabId, 'Page.setInterceptFileChooserDialog', { enabled: true });
    await cliquerA(tabId, cible.x, cible.y, cible.l);
    const p = await Promise.race([ouverte, attendreMs(8000).then(() => null)]);
    if (!p?.backendNodeId) return null;
    const { object } = await cdp(tabId, 'DOM.resolveNode', { backendNodeId: p.backendNodeId });
    return await appelerSurUnObjet(tabId, object.objectId, poserDesFichiers, fichier);
  } finally {
    chrome.debugger.onEvent.removeListener(ecoute);
    /* Toujours relâché : sinon plus aucun « Choisir un fichier » ne s'ouvrirait pour la personne dans cet onglet. */
    await cdp(tabId, 'Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {});
  }
}

/**
 * Sans débogueur (un gestionnaire de mots de passe le fait lâcher, ou Chrome le refuse) : le dépôt se rejoue par un
 * script du monde de la page (`deposerUneImage`), qui capte le `click()` / `showPicker()` du champ au lieu d'ouvrir
 * la sélection. Seulement sur un repère : jamais au hasard d'un champ de la page.
 */
async function deposerSansDebogueur(tabId, args, fichier) {
  const r = await jouerDansLaPage(tabId, deposerUneImage, args.repere, fichier.base64, fichier.nom, fichier.mime);
  if (!r?.ok) throw new Error(r?.raison === 'repere' ? `Repère ${args.repere} introuvable : relis la page avec « lire ».` : 'Cet élément n’accepte pas de fichier : vise le bouton « Ajouter une photo », le champ de fichier ou la zone de dépôt.');
  await new Promise((r2) => setTimeout(r2, 800));
  const ko = Math.max(1, Math.round((r.taille ?? 0) / 1024));
  return { texte: `Déposé « ${fichier.nom} » (${ko} ko) sans le débogueur (${r.mode}).`, image: await imageDuFilm(tabId) };
}

async function deposer(tabId, args) {
  if (SAFARI) {
    if (!Number.isInteger(args.repere)) throw new Error('Dans Safari, vise le bouton ou le champ de fichier par son repère.');
    return deposerSansDebogueur(tabId, args, { nom: String(args.nom ?? 'fichier'), mime: String(args.mime ?? 'application/octet-stream'), base64: String(args.base64 ?? '') });
  }
  try {
    return await deposerParLeDebogueur(tabId, args);
  } catch (err) {
    const texte = String(err?.message ?? err);
    if (!Number.isInteger(args.repere) || !(LACHE_PAR_UN_AUTRE_MODULE.test(texte) || /refuse le pilotage/.test(texte))) throw err;
    return deposerSansDebogueur(tabId, args, { nom: String(args.nom ?? 'fichier'), mime: String(args.mime ?? 'application/octet-stream'), base64: String(args.base64 ?? '') });
  }
}

async function deposerParLeDebogueur(tabId, args) {
  const fichier = { nom: String(args.nom ?? 'fichier'), mime: String(args.mime ?? 'application/octet-stream'), base64: String(args.base64 ?? '') };
  if (!fichier.base64) throw new Error('Aucun contenu de fichier reçu.');
  const jeton = Math.random().toString(36).slice(2, 10);
  const cible = await jouer(
    tabId,
    natureDuDepot,
    Number.isInteger(args.repere) ? args.repere : null,
    Number.isFinite(args.x) ? args.x : null,
    Number.isFinite(args.y) ? args.y : null,
    jeton,
  );
  if (!cible) throw new Error(`${Number.isInteger(args.repere) ? `Repère ${args.repere}` : 'Ce point'} introuvable : relis la page avec « lire ».`);
  let fait = null;
  let chemin = '';
  if (cible.nature === 'champ') {
    await allerA(tabId, cible.x, cible.y, cible.l);
    const r = await jouerSurLaCible(tabId, jeton, poserDesFichiers, fichier);
    if (r?.recu) fait = r;
    chemin = 'champ';
  } else if (cible.nature === 'bouton') {
    fait = await deposerParLaSelection(tabId, cible, fichier);
    chemin = 'sélection';
    if (!fait) {
      const r = await jouerSurLaCible(tabId, jeton, deposerSurUneZone, fichier, false).catch(() => null);
      if (r?.accepte) {
        fait = r;
        chemin = 'zone';
      }
    }
  } else {
    await allerA(tabId, cible.x, cible.y, cible.l);
    const r = await jouerSurLaCible(tabId, jeton, deposerSurUneZone, fichier, true);
    if (r?.accepte) {
      fait = r;
      chemin = r.champ ? 'champ' : 'zone';
    } else {
      fait = await deposerParLaSelection(tabId, cible, fichier);
      chemin = 'sélection';
    }
  }
  if (!fait) throw new Error(`« ${cible.nom || 'cet élément'} » n'accepte pas de fichier (aucune sélection ouverte, aucun dépôt accepté) : vise le bouton « Ajouter une photo », le champ de fichier ou la zone de dépôt.`);
  await new Promise((r) => setTimeout(r, 800));
  const ko = Math.max(1, Math.round((fait.taille ?? 0) / 1024));
  return { texte: `Déposé « ${fichier.nom} » (${ko} ko) dans « ${cible.nom || 'la page'} » (${chemin}).`, image: await imageDuFilm(tabId) };
}

/* ------------------------------------------------------------------ */
/* Les gestes                                                           */
/* ------------------------------------------------------------------ */

/** Autorisée en navigation privée ? `null` quand le navigateur ne sait pas le dire (Safari). */
async function autorisationPrivee() {
  try {
    return typeof chrome.extension?.isAllowedIncognitoAccess === 'function' ? await chrome.extension.isAllowedIncognitoAccess() : null;
  } catch {
    return null;
  }
}

/**
 * LES GESTES DE L'EXTENSION ELLE-MÊME (1.0.11), sans agent : se recharger après que le programme du Mac a remplacé ses
 * fichiers (même dossier, même identifiant), et ouvrir sa page de réglages pour cocher « Autoriser en navigation
 * privée ». Rien d'autre.
 */
async function gesteDeLExtension(geste) {
  if (geste === 'se_recharger') {
    setTimeout(() => chrome.runtime.reload(), 300);
    return { recharge: true, version: chrome.runtime.getManifest().version };
  }
  if (geste === 'ouvrir_reglages_extension') {
    await chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
    return { ouvert: true };
  }
  if (geste === 'etat_extension') {
    return { version: chrome.runtime.getManifest().version, incognito: await autorisationPrivee(), extensionId: chrome.runtime.id };
  }
  return undefined;
}

async function executer(geste, args) {
  const propre = await gesteDeLExtension(geste);
  if (propre !== undefined) return propre;
  const agentId = String(args.agentId ?? '');
  if (!agentId) throw new Error('Geste sans agent.');
  /* La garde du site, en double du démon : lecture seule = aucune action, refusé = rien. */
  if (args.garde === 'lecture_seule' && GESTES_QUI_AGISSENT.has(geste)) throw new Error('Ce site est en lecture seule : aucun clic ni aucune saisie.');
  if (args.garde === 'refuse' && geste !== 'detacher') throw new Error('Ce site est refusé.');
  const espace = await etat();

  switch (geste) {
    case 'preparer': {
      espace.titres[agentId] = { titre: String(args.titre ?? 'Agent'), couleur: String(args.couleur ?? 'purple') };
      /* Une fenêtre demandée que l'extension ne sait pas ouvrir est REFUSÉE (1.0.10) : jamais de repli sur la fenêtre de
         travail. La fenêtre privée ouverte est rendue au démon, qui vérifie qu'elle l'est vraiment. */
      if (args.fenetre !== undefined && args.fenetre !== 'privee-reduite') throw new Error(`Fenêtre « ${args.fenetre} » inconnue de cette extension : rien n'a été ouvert.`);
      if (args.fenetre === 'privee-reduite') {
        espace.privees[agentId] = true;
        const id = await fenetrePriveeDeLAgent(espace, agentId);
        const w = await chrome.windows.get(id);
        if (!w.incognito) throw new Error(`${REFUS_NAVIGATION_PRIVEE} : la fenêtre ouverte n'est pas privée, rien n'a été fait.`);
        await ecrire(espace);
        return { fenetre: id, incognito: true };
      }
      if (espace.privees[agentId]) {
        /* La même carte repart en fenêtre ordinaire : sa fenêtre privée n'est plus la sienne. */
        delete espace.privees[agentId];
        delete espace.fenetres[agentId];
        delete espace.groupes[agentId];
        delete espace.courants[agentId];
      }
      /* L'onglet confié à la carte (demande lancée depuis le panneau) rejoint le groupe de l'agent, SUR PLACE, une
         fois : sa fenêtre devient celle de l'agent. Rien n'est déplacé, aucune fenêtre ne s'ouvre. */
      if (Number.isInteger(args.ongletConfie) && espace.courants[agentId] === undefined) {
        try {
          const confie = await chrome.tabs.get(args.ongletConfie);
          espace.fenetres[agentId] = confie.windowId;
          await rangerDansLeGroupe(espace, agentId, args.ongletConfie);
          espace.courants[agentId] = args.ongletConfie;
        } catch {
          /* l'onglet confié a été fermé entre-temps */
        }
      }
      if (!(await fenetreExiste(espace.fenetres[agentId]))) await fenetreDeLAgent(espace, agentId).catch(() => {});
      await ecrire(espace);
      diffuser({ type: 'evenement', genre: 'agents' });
      return {};
    }
    case 'onglets': {
      const groupe = await groupeDeLAgent(espace, agentId);
      if (groupe === null) return { onglets: [] };
      const tabs = await chrome.tabs.query({ groupId: groupe });
      return { onglets: tabs.map((t) => ({ id: t.id, titre: t.title ?? '', url: t.url ?? '', actif: t.id === espace.courants[agentId] })) };
    }
    case 'ouvrir': {
      /* Dans la fenêtre de la personne, au bout du groupe de l'agent ; jamais au premier plan d'office : le suivi
         décide (`suivreLAgent`). */
      const fenetre = await fenetreDeLAgent(espace, agentId);
      const prive = !!espace.privees[agentId];
      /* Dans la fenêtre privée réduite, l'onglet neuf est l'actif de SA fenêtre : la fenêtre, elle, ne bouge pas. */
      const tab = await chrome.tabs.create({ windowId: fenetre, url: args.url, active: prive });
      await rangerDansLeGroupe(espace, agentId, tab.id);
      espace.courants[agentId] = tab.id;
      if (prive && Number.isInteger(espace.vierges[agentId])) {
        await chrome.tabs.remove(espace.vierges[agentId]).catch(() => {});
        delete espace.vierges[agentId];
      }
      await ecrire(espace);
      await suivreLAgent(agentId, tab.id);
      const fini = await attendreLeChargement(tab.id);
      return { id: tab.id, url: fini.url ?? args.url, titre: fini.title ?? '' };
    }
    case 'aller': {
      const tab = await ongletDeLAgent(espace, agentId, args.onglet);
      await suivreLAgent(agentId, tab.id);
      await ecrire(espace);
      await chrome.tabs.update(tab.id, { url: args.url });
      const fini = await attendreLeChargement(tab.id);
      return { id: tab.id, url: fini.url ?? args.url, titre: fini.title ?? '' };
    }
    case 'fermer': {
      const tab = await ongletDeLAgent(espace, agentId, args.onglet);
      detacher(tab.id);
      await chrome.tabs.remove(tab.id);
      delete espace.courants[agentId];
      await ecrire(espace);
      return {};
    }
    case 'info': {
      const tab = await ongletDeLAgent(espace, agentId, args.onglet);
      await ecrire(espace);
      return { id: tab.id, url: tab.url ?? '', titre: tab.title ?? '' };
    }
    case 'detacher': {
      const groupe = await groupeDeLAgent(espace, agentId);
      if (groupe !== null) for (const t of await chrome.tabs.query({ groupId: groupe })) detacher(t.id);
      return {};
    }
    case 'lire': {
      const tab = await ongletDeLAgent(espace, agentId, args.onglet);
      await suivreLAgent(agentId, tab.id);
      await ecrire(espace);
      const r = await jouer(tab.id, lireUnePage);
      return { url: tab.url ?? '', titre: tab.title ?? '', texte: r.texte, reperes: r.reperes };
    }
    case 'capturer': {
      const tab = await ongletDeLAgent(espace, agentId, args.onglet);
      await suivreLAgent(agentId, tab.id);
      await ecrire(espace);
      const r = await captureVisible(tab.id, !!args.pleinePage);
      return { ...r, url: tab.url ?? '' };
    }
    case 'defiler': {
      const tab = await ongletDeLAgent(espace, agentId, args.onglet);
      await suivreLAgent(agentId, tab.id);
      await ecrire(espace);
      const sens = args.direction === 'haut' ? -1 : 1;
      const q = Math.max(0.25, Math.min(10, Number(args.quantite) || 1));
      const r = await jouer(tab.id, (s, n) => {
        window.scrollBy({ top: s * n * window.innerHeight * 0.85, behavior: 'instant' });
        return { y: Math.round(window.scrollY), h: document.documentElement.scrollHeight, v: window.innerHeight };
      }, sens, q);
      return { texte: `Page à ${Math.round(((r.y + r.v) / Math.max(1, r.h)) * 100)} % de sa hauteur. Relis-la avec « lire ».` };
    }
    case 'attendre': {
      const tab = await ongletDeLAgent(espace, agentId, args.onglet);
      await suivreLAgent(agentId, tab.id);
      await ecrire(espace);
      const ms = Math.max(200, Math.min(30_000, Number(args.ms) || 5000));
      const cherche = String(args.texte ?? '').trim();
      const fin = Date.now() + ms;
      while (Date.now() < fin) {
        if (cherche) {
          const vu = await jouer(tab.id, texteVisible, cherche).catch(() => false);
          if (vu) return { texte: `« ${cherche} » est affiché.` };
        }
        await new Promise((r) => setTimeout(r, 300));
      }
      return { texte: cherche ? `« ${cherche} » n’est pas apparu en ${ms} ms.` : `Attendu ${ms} ms.` };
    }
    case 'sonder': {
      const tab = await ongletDeLAgent(espace, agentId, args.onglet);
      await ecrire(espace);
      return jouer(tab.id, sonderUnElement, args.repere ?? null, Number.isFinite(args.x) ? args.x : null, Number.isFinite(args.y) ? args.y : null, args.touche ?? null);
    }
    case 'cliquer': {
      const tab = await ongletDeLAgent(espace, agentId, args.onglet);
      await suivreLAgent(agentId, tab.id);
      await ecrire(espace);
      let x = args.x;
      let y = args.y;
      let nom = '';
      let largeur = 24;
      if (Number.isInteger(args.repere)) {
        const c = await jouer(tab.id, centreDUnRepere, args.repere);
        if (!c) throw new Error(`Repère ${args.repere} introuvable : relis la page avec « lire ».`);
        ({ x, y, nom } = c);
        largeur = c.l ?? largeur;
        /* Une main vise à quelques pixels près, toujours DANS l'élément. */
        x = Math.round(x + hasard(-1, 1) * Math.min(3, (c.l ?? 8) / 4));
        y = Math.round(y + hasard(-1, 1) * Math.min(3, (c.h ?? 8) / 4));
      }
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Donne un repère (rendu par « lire ») ou des coordonnées.');
      await cliquerA(tab.id, x, y, largeur);
      await new Promise((r) => setTimeout(r, 700));
      await attendreLeChargement(tab.id, 10_000);
      return { texte: `Cliqué${nom ? ` sur « ${nom} »` : ''}.`, image: await imageDuFilm(tab.id) };
    }
    case 'ecrire': {
      const tab = await ongletDeLAgent(espace, agentId, args.onglet);
      await suivreLAgent(agentId, tab.id);
      await ecrire(espace);
      const texte = String(args.texte ?? '');
      if (Number.isInteger(args.repere)) {
        await survolerUnRepere(tab.id, args.repere);
        const ok = await jouer(tab.id, focaliserUnRepere, args.repere, !!args.effacer);
        if (!ok) throw new Error(`Repère ${args.repere} introuvable ou non modifiable : relis la page.`);
      }
      const corps = texte.replace(/\n$/, '');
      if (corps) {
        await insererLeTexte(tab.id, Number.isInteger(args.repere) ? args.repere : null, corps);
      }
      if (texte.endsWith('\n')) await frapper(tab.id, 'Enter');
      await new Promise((r) => setTimeout(r, 300));
      return { texte: `Écrit (${corps.length} signes).`, image: await imageDuFilm(tab.id) };
    }
    case 'touche': {
      const tab = await ongletDeLAgent(espace, agentId, args.onglet);
      await suivreLAgent(agentId, tab.id);
      await ecrire(espace);
      await frapper(tab.id, String(args.touche ?? ''));
      await new Promise((r) => setTimeout(r, 500));
      return { texte: `Touche ${args.touche} frappée.`, image: await imageDuFilm(tab.id) };
    }
    case 'se_connecter': {
      /* Les valeurs ne vivent qu'ici, le temps de la saisie : jamais renvoyées, jamais écrites. */
      const tab = await ongletDeLAgent(espace, agentId, args.onglet);
      await suivreLAgent(agentId, tab.id);
      await ecrire(espace);
      const champs = await jouer(tab.id, reperesDeConnexion);
      if (!champs?.motDePasse) throw new Error('Aucun champ de mot de passe sur cette page.');
      if (champs.identifiant && args.identifiant) {
        await survolerUnRepere(tab.id, champs.identifiant);
        await jouer(tab.id, focaliserUnRepere, champs.identifiant, true);
        await insererLeTexte(tab.id, champs.identifiant, String(args.identifiant));
      }
      await survolerUnRepere(tab.id, champs.motDePasse);
      await jouer(tab.id, focaliserUnRepere, champs.motDePasse, true);
      await insererLeTexte(tab.id, champs.motDePasse, String(args.motDePasse ?? ''));
      await frapper(tab.id, 'Enter');
      await new Promise((r) => setTimeout(r, 1200));
      await attendreLeChargement(tab.id, 15_000);
      return { texte: 'champs remplis et formulaire envoyé', image: await imageDuFilm(tab.id) };
    }
    case 'deposer': {
      const tab = await ongletDeLAgent(espace, agentId, args.onglet);
      await suivreLAgent(agentId, tab.id);
      await ecrire(espace);
      return deposer(tab.id, args);
    }
    default:
      throw new Error(`Geste inconnu : ${geste}`);
  }
}

/*
 * 1.0.14 — L'EXTENSION SE PRÉSENTE À LA PAGE BELUGA (carte « Beluga Connect : installation simplifiée », 21/11/2026) :
 * sur un onglet de SON Beluga (même origine que son adresse), elle pose sur la page l'identifiant d'appareil de ce
 * navigateur — la partie du milieu de sa clé, JAMAIS le compte ni le nonce, et jamais le secret — dans
 * `data-beluga-navigateur`, avec sa version dans `data-beluga-extension`. Réglages › Ordinateurs reconnaît ainsi
 * l'ordinateur sur lequel on est : « Connecter cet ordinateur » ne repart pas de zéro sur un ordinateur déjà relié.
 */
async function seRepresenterA(tabId, adresseDeLOnglet) {
  try {
    const { adresse } = await configuration();
    if (!adresse || !adresseDeLOnglet || new URL(adresseDeLOnglet).origin !== new URL(adresse).origin) return;
    const { identifiant } = await liaison();
    const appareil = typeof identifiant === 'string' ? identifiant.split('.')[1] ?? '' : '';
    const version = chrome.runtime.getManifest().version;
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (id, v) => {
        const racine = document.documentElement;
        if (id) racine.dataset.belugaNavigateur = id;
        else delete racine.dataset.belugaNavigateur;
        racine.dataset.belugaExtension = v;
        window.dispatchEvent(new CustomEvent('beluga:extension-presente'));
      },
      args: [appareil, version],
    });
  } catch {
    /* onglet fermé, page interdite : rien à dire */
  }
}
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === 'complete') void seRepresenterA(tabId, tab.url);
});
/* À la liaison (code ou liaison.json), les onglets Beluga déjà ouverts l'apprennent tout de suite. */
chrome.storage.onChanged.addListener((changes, zone) => {
  if (zone !== 'local' || !changes.identifiant) return;
  void chrome.tabs.query({}).then((onglets) => onglets.forEach((o) => o.id && void seRepresenterA(o.id, o.url)));
});
void chrome.tabs.query({}).then((onglets) => onglets.forEach((o) => o.id && void seRepresenterA(o.id, o.url)));
