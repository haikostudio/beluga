/**
 * LE PANNEAU LATÉRAL DE BELUGA (cartes « Pilotage de Chrome par Beluga » puis « Panneau Chrome façon discussion »,
 * 09/11/2026).
 *
 * Il reste ouvert sur tous les onglets de la fenêtre et se lit comme une discussion de Claude :
 *  - l'en-tête tient sur UNE ligne : le logo, le menu déroulant des agents qui travaillent dans CE Chrome (rond
 *    d'état, titre, projet, pastille « à trancher »), « Je prends la main » et « Arrêter » en icônes, le menu ;
 *  - le fil suit l'ordre réel : la PREMIÈRE demande de la carte en tête, les messages de la personne à droite en
 *    bulle, puis, pour chaque tour, le travail replié en une ligne (« A utilisé Chrome (N actions) › », dépliable),
 *    les questions à leur place, la réponse de l'agent à gauche sans bulle, ses pièces, puis ses suggestions ;
 *  - aucune donnée brute : le chiffrage est retiré par le démon, et un bloc de code devient une vignette repliée ;
 *  - quand l'agent agit sur un onglet que la personne ne regarde pas, une ligne discrète le dit, avec « Y aller ».
 * Les questions et les accords se tranchent ici, dans un CADRE jaune, chaque choix en bouton PLEINE LARGEUR, un par
 * ligne, le principal en violet en premier. Aucun emoji : les icônes de Beluga (`icones.js`). Tout passe par le
 * service worker, qui tient la voie signée avec Beluga.
 */
import { poserLaLangue, t } from './langues.js';
import { icone } from './icones.js';
import { dateComplete, quandLisible } from './dates.js';
import { miseEnPage } from './mise-en-page.js';

/* ------------------------------------------------------------------ */
/* Le lien avec le service worker                                       */
/* ------------------------------------------------------------------ */

const port = chrome.runtime.connect({ name: 'panneau' });
const reponses = new Map();
let numero = 0;

function appeler(type, donnees = {}) {
  return new Promise((resolve) => {
    const id = ++numero;
    reponses.set(id, resolve);
    port.postMessage({ type, id, ...donnees });
  });
}
async function cmd(c) {
  const r = await appeler('cmd', { cmd: c });
  if (!r.ok) throw new Error(r.error || t('Beluga est injoignable : vérifiez la connexion.'));
  return r.data;
}

/* ------------------------------------------------------------------ */
/* L'état                                                               */
/* ------------------------------------------------------------------ */

const etat = {
  relie: false,
  enLigne: false,
  nom: null,
  agents: [],
  choisi: null,
  messages: [],
  mode: 'nouvelle',
  projets: [],
  projet: null,
  reconnu: null,
  onglet: null,
  demande: null,
  /** L'agent qui agit sur un onglet que la personne ne regarde pas : { agentId, tabId, titre }. */
  suivi: null,
  /** Les messages écrits pendant le travail de l'agent choisi, dans leur ordre de départ : { id, texte, enEdition }. */
  file: [],
  /** Le message en attente qu'on modifie ici (son identifiant). */
  edition: null,
  /** « Ce que l'agent a vu » : les images rangées par l'agent choisi ({ id, nom, mime }), plus anciennes d'abord. */
  images: [],
};
const images = new Map();
/**
 * LES FICHIERS COLLÉS OU DÉPOSÉS DANS LE CHAMP, en attente d'envoi : { cle, nom, mime, taille, dataUrl }. Rangés par
 * conversation affichée (l'agent choisi, ou « nouvelle »), hors du champ : un redessin ne les perd jamais.
 */
const piecesEnAttente = new Map();
/** Le poids cumulé accepté par Beluga pour un message (même borne que le démon, `POIDS_DES_PIECES_DU_PANNEAU_MAX`). */
const POIDS_MAX_DES_PIECES = 15 * 1024 * 1024;
const PIECES_MAX = 10;
/** Les tours dont la ligne de travail est dépliée (identifiants de message). */
const deplies = new Set();

/* ------------------------------------------------------------------ */
/* Petits outils de rendu                                               */
/* ------------------------------------------------------------------ */

function el(balise, attributs = {}, ...enfants) {
  const n = document.createElement(balise);
  for (const [k, v] of Object.entries(attributs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'html') n.innerHTML = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const e of enfants.flat()) if (e !== null && e !== undefined && e !== false) n.append(e instanceof Node ? e : document.createTextNode(String(e)));
  return n;
}

/** Un bloc de code : une VIGNETTE repliée « Code · langage », qu'on déplie d'un clic — jamais un pavé brut. */
function vignetteDeCode(langage, code) {
  const titre = langage || code.split('\n').find((l) => l.trim())?.trim().slice(0, 40) || '';
  return el(
    'details',
    { class: 'code', 'data-code': langage || 'texte' },
    el('summary', {}, icone('code', 14), el('span', {}, titre ? `${t('Code')} · ${titre}` : t('Code')), icone('bas', 14)),
    el('pre', {}, code.replace(/\n$/, '')),
  );
}

/**
 * La réponse de l'agent, mise en page comme dans la conversation de l'application (`mise-en-page.js`) : sommaire,
 * titres, tableaux, encadrés, listes ; ses blocs de code en vignettes (un bloc ouvert en fin de texte compris).
 */
function rendreLeTexte(s, options = {}) {
  return miseEnPage(s, options).map((m) => (m.genre === 'code' ? vignetteDeCode(m.langage, m.code) : el('div', { html: m.html })));
}

/* UNE LIGNE DU SOMMAIRE amène son titre en haut du fil, et le fait ressortir un instant (comme dans l'application). */
document.addEventListener('click', (e) => {
  const ligne = e.target instanceof Element ? e.target.closest('[data-aller-au-titre]') : null;
  if (!ligne) return;
  const reponse = ligne.closest('.reponse');
  const titre = reponse?.querySelector(`[data-titre-du-point="${ligne.dataset.allerAuTitre}"]`);
  if (!titre) return;
  titre.scrollIntoView({ behavior: 'smooth', block: 'start' });
  titre.classList.add('vise');
  setTimeout(() => titre.classList.remove('vise'), 1600);
});

/**
 * UNE DATE SOUS UN ÉLÉMENT DU FIL (1.0.6) : petite, grise, du côté de son élément (à droite pour la personne, à gauche
 * pour l'agent). Rien si la date manque. Le texte se rafraîchit chaque minute (`rafraichirLesDates`), sans redessin.
 */
function rendreLaDate(ms, cote) {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return el('time', { class: `quand ${cote}`, 'data-quand': String(ms), datetime: new Date(ms).toISOString(), title: dateComplete(ms) }, quandLisible(ms));
}

function rafraichirLesDates() {
  const maintenant = Date.now();
  for (const n of document.querySelectorAll('time[data-quand]')) {
    const texte = quandLisible(Number(n.dataset.quand), maintenant);
    if (n.textContent !== texte) n.textContent = texte;
  }
}
/* UNE seule minuterie pour tout le panneau : elle ne touche qu'au texte des dates (ni fil, ni champ, ni défilement). */
setInterval(rafraichirLesDates, 60_000);

function auTravail(a) {
  return !!a && (a.statut === 'running' || a.statut === 'starting');
}

/**
 * LE TRAVAIL DE L'AGENT CHOISI EST FINI : il ne travaille plus et n'attend aucune réponse. Écrire ouvre alors un
 * NOUVEL agent sur la page ouverte (décision du 09/11/2026) ; pendant le travail, le message va en file d'attente.
 */
function travailFini(a) {
  return !!a && !auTravail(a) && !(a.accords > 0) && !a.attend;
}

/* ------------------------------------------------------------------ */
/* La liaison                                                           */
/* ------------------------------------------------------------------ */

function rendreLaLiaison() {
  const app = document.getElementById('app');
  const erreur = el('p', { class: 'erreur', 'data-erreur-liaison': true });
  const code = el('input', { class: 'code', inputmode: 'numeric', maxlength: '7', autocomplete: 'off', placeholder: '123 456', 'data-code-liaison': true });
  const nom = el('input', { value: navigator.userAgentData?.platform ? `Chrome · ${navigator.userAgentData.platform}` : 'Chrome', maxlength: '60', 'data-nom-ordinateur': true });
  const bouton = el('button', {
    class: 'bouton principal',
    'data-relier': true,
    onclick: async () => {
      bouton.disabled = true;
      bouton.textContent = t('Liaison…');
      erreur.textContent = '';
      const r = await appeler('relier', { code: code.value.replace(/\s+/g, ''), nom: nom.value });
      if (!r.ok) {
        erreur.textContent = r.raison || r.error || '';
        bouton.disabled = false;
        bouton.textContent = t('Relier');
        return;
      }
      await demarrer();
    },
  }, t('Relier'));
  app.replaceChildren(
    el('div', { class: 'entete' }, el('span', { class: 'logo' }, 'b'), el('span', { class: 'nom' }, 'Beluga')),
    el(
      'div',
      { class: 'liaison' },
      el('h1', {}, t('Relier ce Chrome à Beluga')),
      el('p', {}, t('Dans Beluga, ouvrez Réglages → Extension, puis saisissez ici le code affiché.')),
      el('label', {}, t('Code de liaison'), code),
      el('label', {}, t('Nom de cet ordinateur'), nom),
      bouton,
      erreur,
    ),
  );
  code.focus();
}

/* ------------------------------------------------------------------ */
/* Le squelette et l'en-tête                                            */
/* ------------------------------------------------------------------ */

const zones = {};

function rendreLeSquelette() {
  const app = document.getElementById('app');
  zones.entete = el('div', { class: 'entete', 'data-entete': true });
  zones.fil = el('div', { class: 'fil', 'data-fil': true });
  zones.captures = el('div', { class: 'ancre-captures' });
  zones.file = el('div');
  zones.suivi = el('div');
  zones.avis = el('div');
  zones.saisie = el('div');
  app.replaceChildren(zones.entete, zones.fil, zones.captures, zones.file, zones.suivi, zones.avis, zones.saisie);
  rendreLEntete();
  rendreLaSaisie();
}

/** Le rond d'état, le titre, le projet et la pastille d'un agent : la même ligne dans le déclencheur et dans la liste. */
function ligneDAgent(a) {
  return [
    el('span', { class: `rond${auTravail(a) ? ' actif' : ''}` }),
    el('span', { class: 'libelle' }, a.titre, ' ', el('span', { class: 'projet' }, `· ${a.projet}`)),
    a.accords
      ? el('span', { class: 'pastille accord', 'data-accords': a.accords }, t('{n} à trancher', { n: a.accords }))
      : a.main
        ? el('span', { class: 'pastille' }, t('Vous avez la main'))
        : null,
  ];
}

/**
 * L'EN-TÊTE, SUR UNE LIGNE : logo, menu déroulant des agents (ou le nom de ce Chrome quand aucun ne travaille),
 * la main et l'arrêt en icônes pour un agent au travail, puis le menu.
 */
function rendreLEntete() {
  if (!zones.entete) return;
  const a = etat.agents.find((x) => x.agentId === etat.choisi);
  const enfants = [el('span', { class: 'logo', title: etat.nom ?? 'Beluga' }, 'b')];
  if (etat.agents.length) {
    enfants.push(
      el(
        'button',
        { class: 'selecteur', 'data-selecteur-agents': true, 'aria-haspopup': 'listbox', onclick: ouvrirLaListeDesAgents },
        ...(a ? ligneDAgent(a) : [el('span', { class: 'libelle' }, t('Nouvelle demande'))]),
        icone('bas', 14),
      ),
    );
  } else {
    enfants.push(el('span', { class: 'nom' }, 'Beluga'), el('span', { class: 'appareil' }, etat.nom ? `· ${etat.nom}` : ''));
  }
  if (!etat.enLigne) enfants.push(el('span', { class: 'hors-ligne', 'data-hors-ligne': true }, t('Hors ligne')));
  /* La main et l'arrêt ne servent qu'à un agent au travail (ou dont on a la main). */
  if (a && (a.main || auTravail(a) || a.attend)) {
    enfants.push(
      el('button', { class: `icone-bouton${a.main ? ' choisi' : ''}`, title: a.main ? t('Rendre la main') : t('Je prends la main'), 'data-main': a.main ? 'rendre' : 'prendre', onclick: () => basculerLaMain(a) }, icone('main')),
      el('button', { class: 'icone-bouton', title: t('Arrêter'), 'data-arreter': true, onclick: () => cmd({ type: 'agent.stop', agentId: a.agentId }).catch(montrerErreur) }, icone('arreter', 14)),
    );
  }
  enfants.push(el('button', { class: 'icone-bouton menu', title: t('Délier ce Chrome'), 'data-menu': true, onclick: ouvrirLeMenu }, icone('menu')));
  zones.entete.replaceChildren(...enfants);
}

function fermerLesFeuilles() {
  for (const f of document.querySelectorAll('.feuille, .liste-agents')) f.remove();
}

/** LE MENU DÉROULANT DES AGENTS : ancré sous l'en-tête, une ligne par agent, puis « Nouvelle demande ». */
function ouvrirLaListeDesAgents(e) {
  e?.stopPropagation();
  if (document.querySelector('.liste-agents')) return fermerLesFeuilles();
  fermerLesFeuilles();
  const liste = el(
    'div',
    { class: 'liste-agents', role: 'listbox', 'data-liste-agents': true },
    ...etat.agents.map((a) =>
      el(
        'button',
        { class: `agent${a.agentId === etat.choisi ? ' choisi' : ''}`, role: 'option', 'data-agent': a.agentId, onclick: () => (fermerLesFeuilles(), choisir(a.agentId)) },
        ...ligneDAgent(a),
        auTravail(a) && !a.accords && !a.main ? el('span', { class: 'pastille' }, t('En cours')) : null,
      ),
    ),
    el('button', { class: 'agent nouvelle', 'data-nouvelle-demande-liste': true, onclick: () => (fermerLesFeuilles(), choisir(null)) }, icone('plus', 14), el('span', { class: 'libelle' }, t('Nouvelle demande'))),
  );
  document.body.append(liste);
}

document.addEventListener('click', (e) => {
  const liste = document.querySelector('.liste-agents');
  if (liste && !liste.contains(e.target)) liste.remove();
});

function ouvrirLeMenu() {
  fermerLesFeuilles();
  const feuille = el(
    'div',
    { class: 'feuille', 'data-feuille-menu': true },
    etat.nom ? el('div', { class: 'titre' }, etat.nom) : null,
    el('button', {
      onclick: async () => {
        await appeler('delier');
        feuille.remove();
        etat.relie = false;
        rendreLaLiaison();
      },
    }, t('Délier ce Chrome')),
    el('button', { onclick: () => feuille.remove() }, t('Annuler')),
  );
  document.body.append(feuille);
}

/* ------------------------------------------------------------------ */
/* Les agents                                                           */
/* ------------------------------------------------------------------ */

async function chargerLesAgents() {
  try {
    const r = await cmd({ type: 'panneau.etat' });
    etat.agents = r.agents ?? [];
  } catch {
    etat.agents = [];
  }
  if (etat.choisi && !etat.agents.some((a) => a.agentId === etat.choisi)) etat.choisi = null;
  /* Rien d'affiché et un agent attend un accord : on va droit à sa question. */
  const enAttente = !etat.choisi && etat.agents.find((a) => a.accords > 0);
  if (enAttente) return choisir(enAttente.agentId);
  rendreLEntete();
  /* Le statut d'un agent change le bas du fil (ligne d'activité, suites) et la barre « en cours ». */
  if (zones.fil) rendreLeFil();
  /* … et ce que fait l'envoi : file d'attente pendant le travail, nouvel agent une fois le travail fini. */
  rafraichirLaSaisie();
}

async function basculerLaMain(a) {
  try {
    await cmd({ type: a.main ? 'main.rendre' : 'main.prendre', agentId: a.agentId });
    await chargerLesAgents();
  } catch (err) {
    montrerErreur(err);
  }
}

async function choisir(agentId) {
  if (etat.choisi !== agentId) etat.edition = null;
  etat.choisi = agentId;
  etat.mode = agentId ? 'repondre' : 'nouvelle';
  rendreLEntete();
  rendreLaSaisie();
  await chargerLeFil();
}

/* ------------------------------------------------------------------ */
/* Le fil                                                               */
/* ------------------------------------------------------------------ */

async function chargerLeFil() {
  fermerLeVolet();
  if (!etat.choisi) {
    etat.messages = [];
    etat.file = [];
    etat.images = [];
    rendreLaFile();
    return rendreLeFil();
  }
  try {
    const r = await cmd({ type: 'panneau.fil', agentId: etat.choisi });
    etat.messages = r.messages ?? [];
    etat.file = r.file ?? [];
    etat.images = r.images ?? [];
  } catch (err) {
    etat.messages = [];
    etat.file = [];
    etat.images = [];
    montrerErreur(err);
  }
  await chargerLesVues(etat.choisi);
  rendreLaFile();
  rendreLeFil();
}

function rendreLeFil() {
  const enBas = zones.fil.scrollHeight - zones.fil.scrollTop - zones.fil.clientHeight < 40;
  if (!etat.choisi) {
    zones.fil.replaceChildren(
      el('p', { class: 'vide', 'data-fil-vide': true }, etat.agents.length ? '' : t('Aucun agent ne travaille dans ce Chrome pour l’instant.'), el('br'), t('Écrivez une demande ci-dessous : une carte se crée sur la page ouverte et part tout de suite.')),
    );
    return;
  }
  const agent = etat.agents.find((a) => a.agentId === etat.choisi);
  const derniere = [...etat.messages].reverse().find((m) => m.role === 'assistant');
  const blocs = [];
  for (const m of etat.messages) {
    if (m.role === 'user') {
      if (m.contenu.trim()) blocs.push(el('div', { class: 'bulle-utilisateur', 'data-message': m.id }, m.contenu.slice(0, 2000)));
      /* Les fichiers joints par la personne, sous sa bulle, à droite : vignettes pour les images, pastilles sinon. */
      if (m.pieces?.length) {
        blocs.push(
          el('div', { class: 'pieces-personne', 'data-pieces-message': m.id }, ...m.pieces.map((p) => {
            const v = rendreUnePiece(p);
            if (v.classList.contains('image')) v.classList.add('miniature');
            return v;
          })),
        );
      }
      blocs.push(rendreLaDate(m.creeLe, 'droite'));
      continue;
    }
    if (m.role !== 'assistant') continue;
    if (Array.isArray(m.flux)) blocs.push(...rendreLeFlux(m));
    else {
      /* ANCIEN DÉMON (sans flux) : l'ordre fixe d'avant — le travail replié, les questions, la réponse, ses pièces. */
      const travail = rendreLeTravail(m, { id: m.id, nb: Math.max(m.nbEtapes ?? 0, (m.etapes ?? []).length), etapes: m.etapes ?? [] });
      if (travail) blocs.push(travail);
      for (const q of m.questions ?? []) blocs.push(rendreUneQuestion(m, q));
      if (m.contenu.trim()) blocs.push(el('div', { class: 'reponse', 'data-message': m.id }, ...rendreLeTexte(m.contenu, { enCours: !!m.streaming })));
      if (m.pieces?.length) blocs.push(el('div', { class: 'pieces' }, ...m.pieces.map(rendreUnePiece)));
    }
    const attend = (m.questions ?? []).some((q) => !q.answer);
    /* La date de la réponse, une fois le tour rendu ; jamais sous une question qui attend (elle n'en porte pas). */
    const aDuTexte = !!m.contenu?.trim() || (Array.isArray(m.flux) && m.flux.some((e) => e.sorte === 'texte'));
    if (!m.streaming && !attend && aDuTexte) blocs.push(rendreLaDate(m.rendueLe ?? m.creeLe, 'gauche'));
    if (m === derniere && auTravail(agent) && !attend) blocs.push(rendreLActivite(m));
    if (m === derniere && !auTravail(agent) && !attend && m.suites?.length) blocs.push(rendreLesSuites(m, agent));
  }
  zones.fil.replaceChildren(...blocs.filter(Boolean));
  rendreLeRond();
  if (enBas || blocs.length < 4) zones.fil.scrollTop = zones.fil.scrollHeight;
  rendreLeSuivi();
}

/**
 * UN TOUR DANS L'ORDRE OÙ IL S'EST PASSÉ (`flux`, assemblé par le démon) : les phrases de l'agent, ses actions
 * regroupées en une ligne, chaque capture en vignette juste après l'action qui l'a prise, chaque question à son
 * moment, la réponse en dernier.
 */
function rendreLeFlux(m) {
  const blocs = [];
  for (const e of m.flux) {
    if (e.sorte === 'texte') blocs.push(el('div', { class: 'reponse', 'data-message': m.id, 'data-flux': 'texte' }, ...rendreLeTexte(e.texte, { enCours: !!m.streaming })));
    else if (e.sorte === 'actions') blocs.push(rendreLeTravail(m, e));
    else if (e.sorte === 'capture') {
      const v = rendreUnePiece(e.piece, e.pointClic);
      v.classList.add('miniature');
      v.setAttribute('data-flux', 'capture');
      blocs.push(v);
      const quand = rendreLaDate(e.piece.creeLe, 'gauche');
      if (quand) blocs.push(quand);
    } else if (e.sorte === 'question') {
      const q = (m.questions ?? []).find((x) => x.id === e.question);
      if (q) blocs.push(rendreUneQuestion(m, q));
    } else if (e.sorte === 'coupe') blocs.push(el('p', { class: 'plus-tot' }, t('… et {n} étapes plus tôt', { n: e.nb })));
  }
  return blocs;
}

/** L'étape en cours du tour vivant : la dernière étape « en cours » de son flux, sinon de ses étapes. */
function etapeEnCours(m) {
  if (!m) return null;
  const etapes = Array.isArray(m.flux) ? m.flux.filter((e) => e.sorte === 'actions').flatMap((e) => e.etapes) : (m.etapes ?? []);
  return [...etapes].reverse().find((e) => e.etat === 'running') ?? null;
}

/** CE QUE L'AGENT FAIT EN CE MOMENT, à la suite du dernier texte rendu : une ligne violette qui tourne. */
function rendreLActivite(m) {
  const enCours = etapeEnCours(m);
  return el('div', { class: 'activite', 'data-activite': true }, icone('chargement', 14), el('span', { class: 'libelle' }, enCours ? enCours.label : t('Réflexion…')));
}

/**
 * UN GROUPE D'ACTIONS, EN UNE LIGNE : « A utilisé Chrome (N actions) › ». Un clic déplie la liste des étapes. Ce
 * que l'agent fait en ce moment se lit sur la ligne d'activité, au bas du fil, plus sur ce groupe.
 */
function rendreLeTravail(m, g) {
  const etapes = g.etapes ?? [];
  const total = Math.max(g.nb ?? 0, etapes.length);
  if (!total) return null;
  const chrome = etapes.filter((e) => String(e.outil ?? '').includes('chrome')).length;
  const libelle = chrome
    ? chrome === 1
      ? t('A utilisé Chrome (1 action)')
      : t('A utilisé Chrome ({n} actions)', { n: chrome })
    : total === 1
      ? t('A travaillé (1 étape)')
      : t('A travaillé ({n} étapes)', { n: total });
  const cle = `${m.id}:${g.id}`;
  const ouvert = deplies.has(cle);
  const ligne = el(
    'button',
    {
      class: `travail${ouvert ? ' ouvert' : ''}`,
      'data-travail': cle,
      'aria-expanded': ouvert ? 'true' : 'false',
      onclick: () => {
        if (deplies.has(cle)) deplies.delete(cle);
        else deplies.add(cle);
        rendreLeFil();
      },
    },
    icone(chrome ? 'globe' : 'fait', 14),
    el('span', { class: 'libelle' }, libelle),
    icone(ouvert ? 'bas' : 'droite', 14),
  );
  if (!ouvert) return ligne;
  const plusTot = total - etapes.length;
  return el(
    'div',
    { class: 'bloc-travail' },
    ligne,
    el(
      'ol',
      { class: 'etapes', 'data-etapes': true },
      plusTot > 0 ? el('li', { class: 'plus-tot' }, t('… et {n} étapes plus tôt', { n: plusTot })) : null,
      ...etapes.map((e) => el('li', { class: `etape${e.etat === 'running' ? ' en-cours' : ''}` }, icone(e.etat === 'running' ? 'chargement' : 'fait', 12), el('span', {}, e.label))),
    ),
  );
}

/** Une image du démon (data URL), gardée en mémoire : le fil et le volet la demandent une seule fois. */
function chargerLImage(id) {
  const deja = images.get(id);
  if (deja) return Promise.resolve(deja);
  return cmd({ type: 'piece.lire', id }).then((r) => {
    images.set(id, r.dataUrl);
    return r.dataUrl;
  });
}

function rendreUnePiece(p, pointClic) {
  if (!p.mime?.startsWith('image/')) {
    const video = p.mime?.startsWith('video/');
    return el('div', { class: 'piece', 'data-piece': p.id }, icone(video ? 'film' : 'trombone', 14), el('span', {}, video ? t('Film du travail · {nom}', { nom: p.nom }) : p.nom));
  }
  /* Discrète : une vignette coupée en hauteur ; un clic l'ouvre en grand par-dessus le panneau (même visionneuse que
     « Ce que l'agent a vu »). */
  const boite = el('div', { class: 'image', 'data-piece': p.id, title: p.nom, onclick: () => ouvrirEnGrand(p) });
  /* L'ENDROIT CLIQUÉ : un point violet sur la vignette. La découpe de l'image (object-position) suit le point, si
     bien qu'il tombe à la même fraction de la boîte. */
  const point = pointClic && Number.isFinite(pointClic.x) && Number.isFinite(pointClic.y) ? { x: Math.min(1, Math.max(0, pointClic.x)), y: Math.min(1, Math.max(0, pointClic.y)) } : null;
  const image = (src) => {
    const img = el('img', { src, alt: p.nom });
    if (point) img.style.objectPosition = `${(point.x * 100).toFixed(1)}% ${(point.y * 100).toFixed(1)}%`;
    return img;
  };
  if (point) {
    boite.setAttribute('data-point-clic', `${point.x.toFixed(3)},${point.y.toFixed(3)}`);
    boite.append(el('span', { class: 'point-clic', style: `left:${(point.x * 100).toFixed(1)}%;top:${(point.y * 100).toFixed(1)}%` }));
  }
  const deja = images.get(p.id);
  if (deja) boite.prepend(image(deja));
  else
    chargerLImage(p.id)
      .then((src) => boite.prepend(image(src)))
      .catch(() => boite.replaceWith(el('div', { class: 'piece' }, icone('image', 14), el('span', {}, p.nom))));
  return boite;
}

/** Une question : choix en pleine largeur, un par ligne, le premier en violet. Tranchée, elle se replie en une ligne. */
function rendreUneQuestion(m, q) {
  if (q.answer) {
    return el(
      'div',
      { class: 'question-repondue', 'data-question': q.id },
      el('span', { class: 'intitule' }, q.question),
      el('span', { class: 'repondu' }, icone('fait', 12), t('Votre réponse : {r}', { r: q.answer })),
    );
  }
  const cadre = el('div', { class: 'question', 'data-question': q.id });
  cadre.append(el('div', { class: 'intitule' }, q.question));
  if (q.description) cadre.append(el('div', { class: 'explication' }, q.description));
  const precision = q.allowFreeText || !q.options.length ? el('textarea', { placeholder: t('Une précision (facultatif)…'), rows: '3' }) : null;
  const repondre = async (libelle, bouton) => {
    const libre = precision?.value.trim() ?? '';
    const answer = libelle ? (libre ? `${libelle}\n${libre}` : libelle) : libre;
    if (!answer) return;
    for (const b of cadre.querySelectorAll('button')) b.disabled = true;
    if (bouton) bouton.textContent = '…';
    try {
      await cmd({ type: 'question.answer', messageId: m.id, questionId: q.id, answer });
    } catch (err) {
      montrerErreur(err);
      for (const b of cadre.querySelectorAll('button')) b.disabled = false;
    }
  };
  const choix = el('div', { class: 'choix', 'data-choix': true });
  q.options.forEach((o, i) => {
    const b = el('button', { class: `bouton${i === 0 ? ' principal' : ''}`, 'data-option': o.label }, o.label, o.description ? el('span', { class: 'sous' }, o.description) : null);
    b.addEventListener('click', () => repondre(o.label, b));
    choix.append(b);
  });
  /* LES BOUTONS D'ABORD, LE CHAMP DESSOUS : on tranche d'un clic, la précision vient en plus. Sans choix proposés,
     le bouton « Envoyer » suit le champ. */
  if (q.options.length) cadre.append(choix);
  if (precision) cadre.append(precision);
  if (!q.options.length) cadre.append(el('button', { class: 'bouton principal', 'data-envoyer-reponse': true, onclick: (e) => repondre('', e.currentTarget) }, t('Envoyer')));
  return cadre;
}

/**
 * LES SUGGESTIONS DE L'AGENT (outil « proposer_suites ») : une ligne cliquable chacune, sous sa dernière réponse.
 * C'est là que vivent désormais « refaire chaque semaine », « comparer avec la dernière fois » ou « relever en
 * tableau » — seulement quand l'agent les juge utiles, plus en boutons permanents.
 */
function rendreLesSuites(m, agent) {
  return el(
    'div',
    { class: 'suites', 'data-suites': true },
    ...m.suites.map((s) =>
      el(
        'button',
        { class: 'suite', 'data-suite': s.titre, title: s.description || s.titre, onclick: (e) => lancerLaSuite(s, agent, e.currentTarget) },
        el('span', { class: 'libelle' }, s.titre),
        icone('aller', 14),
      ),
    ),
  );
}

async function lancerLaSuite(s, agent, bouton) {
  if (!agent) return;
  bouton.disabled = true;
  /* Une suite de répétition reconnue s'enregistre directement ; toute autre part comme une demande à l'agent. */
  const frequence = /chaque\s+semaine|hebdomadaire|every\s+week|weekly/i.test(s.titre) ? 'semaine' : /chaque\s+mois|mensuel|every\s+month|monthly/i.test(s.titre) ? 'mois' : null;
  try {
    if (frequence && agent.cardId) {
      const r = await cmd({ type: 'routine.creer', cardId: agent.cardId, frequence });
      poserUnAvis(t('Geste répété enregistré : {phrase}.', { phrase: r.routine.phrase }));
    } else {
      await cmd({ type: 'agent.prompt', agentId: agent.agentId, text: s.titre });
    }
  } catch (err) {
    montrerErreur(err);
    bouton.disabled = false;
  }
}

/* ------------------------------------------------------------------ */
/* Le suivi en direct                                                   */
/* ------------------------------------------------------------------ */

/**
 * LES MESSAGES EN ATTENTE, DÉCROCHÉS AU-DESSUS DE LA BARRE « EN COURS » : présentés comme dans Beluga — rang, texte
 * sur une ligne, puis Modifier, Envoyer maintenant et Retirer. Ils partent seuls à la fin du tour.
 */
function rendreLaFile() {
  if (!zones.file) return;
  const file = etat.choisi ? etat.file : [];
  if (!file.length) {
    etat.edition = null;
    return zones.file.replaceChildren();
  }
  zones.file.replaceChildren(
    el(
      'div',
      { class: 'file', 'data-file-attente': true },
      el('div', { class: 'titre-file' }, file.length === 1 ? t('1 message en attente') : t('{n} messages en attente', { n: file.length })),
      ...file.map((item, i) => (etat.edition === item.id ? ligneEnEdition(item) : ligneEnAttente(item, i))),
    ),
  );
}

function ligneEnAttente(item, i) {
  const apercu = item.texte.replace(/\s+/g, ' ').trim();
  const geste = (type, bouton) => {
    bouton.disabled = true;
    cmd({ type, id: item.id })
      .catch(montrerErreur)
      .finally(() => {
        bouton.disabled = false;
      });
  };
  const modifier = () => {
    etat.edition = item.id;
    void cmd({ type: 'queue.edition', id: item.id, actif: true }).catch(montrerErreur);
    rendreLaFile();
    zones.file.querySelector('[data-file-attente-champ]')?.focus();
  };
  return el(
    'div',
    { class: 'en-attente', 'data-file-attente-element': item.id },
    el('span', { class: 'rang' }, String(i + 1)),
    el('button', { class: 'texte', title: apercu, onclick: modifier }, apercu),
    el('button', { class: 'icone-bouton', title: t('Modifier'), 'data-file-attente-modifier': true, onclick: modifier }, icone('crayon', 14)),
    el('button', { class: 'icone-bouton', title: t('Envoyer maintenant'), 'data-file-attente-envoyer': true, onclick: (e) => geste('queue.send-now', e.currentTarget) }, icone('envoyer', 14)),
    el('button', { class: 'icone-bouton retirer', title: t('Retirer de la file'), 'data-file-attente-retirer': true, onclick: (e) => geste('queue.remove', e.currentTarget) }, icone('corbeille', 14)),
  );
}

function ligneEnEdition(item) {
  const champ = el('textarea', { 'data-file-attente-champ': true, rows: '3' });
  champ.value = item.texte;
  const fermer = async (enregistrer) => {
    const texte = champ.value.trim();
    try {
      if (enregistrer && texte && texte !== item.texte) await cmd({ type: 'queue.update', id: item.id, text: texte });
      await cmd({ type: 'queue.edition', id: item.id, actif: false });
    } catch (err) {
      montrerErreur(err);
    }
    etat.edition = null;
    rendreLaFile();
  };
  champ.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void fermer(true);
    } else if (e.key === 'Escape') void fermer(false);
  });
  return el(
    'div',
    { class: 'en-attente edition', 'data-file-attente-element': item.id },
    champ,
    el(
      'div',
      { class: 'actions-edition' },
      el('button', { class: 'puce', onclick: () => fermer(false) }, t('Annuler')),
      el('button', { class: 'puce choisi', 'data-file-attente-enregistrer': true, onclick: () => fermer(true) }, t('Enregistrer')),
    ),
  );
}

/**
 * LA BARRE « EN COURS », JUSTE AU-DESSUS DU CHAMP D'ÉCRITURE : visible tant que l'agent choisi travaille et
 * n'attend pas de réponse. Quand il agit sur un onglet que la personne ne regarde pas, elle le dit, avec « Y aller ».
 */
function rendreLeSuivi() {
  if (!zones.suivi) return;
  const agent = etat.agents.find((a) => a.agentId === etat.choisi);
  const s = etat.suivi;
  const ailleurs = s ? etat.agents.find((a) => a.agentId === s.agentId) : null;
  const attend = !!agent && (agent.accords > 0 || etat.messages.some((m) => (m.questions ?? []).some((q) => !q.answer)));
  const travaille = auTravail(agent) && !attend;
  if (!travaille && !s) return zones.suivi.replaceChildren();
  const libelle = s
    ? t('{agent} agit sur « {titre} »', { agent: ailleurs?.titre ?? t('L’agent'), titre: s.titre || t('un onglet') })
    : t('Beluga travaille…');
  zones.suivi.replaceChildren(
    el(
      'div',
      { class: 'suivi', 'data-barre-en-cours': true, 'data-suivi': s ? s.tabId : null },
      icone('chargement', 14),
      el('span', { class: 'libelle' }, libelle),
      s
        ? el('button', {
            class: 'puce',
            'data-y-aller': true,
            onclick: () => {
              /* Le clic est un geste : le panneau s'ouvre sur l'onglet de l'agent AVANT d'y aller, il ne se perd pas. */
              chrome.sidePanel?.open({ tabId: s.tabId }).catch(() => {});
              void chrome.tabs.update(s.tabId, { active: true }).catch(() => {});
              etat.suivi = null;
              rendreLeSuivi();
            },
          }, t('Y aller'))
        : null,
    ),
  );
}

/* ------------------------------------------------------------------ */
/* La zone d'écriture                                                   */
/* ------------------------------------------------------------------ */

/** Ce que fait l'envoi, en un mot : « nouvelle » (une carte), « fini » (nouvel agent après un travail fini), « file ». */
function sorteDeSaisie() {
  const agent = etat.agents.find((a) => a.agentId === etat.choisi);
  if (etat.mode === 'nouvelle' || !etat.choisi) return 'nouvelle';
  return travailFini(agent) ? 'fini' : 'file';
}

/** Le statut de l'agent a changé ce que fait l'envoi : la zone se redessine, texte et curseur gardés. */
function rafraichirLaSaisie() {
  if (!zones.saisie) return;
  const actuel = zones.saisie.querySelector('[data-saisie]');
  if (actuel && actuel.dataset.sorte === sorteDeSaisie()) return;
  redessinerLaSaisie();
}

function rendreLaSaisie(prerempli, garderLeFocus) {
  const sorte = sorteDeSaisie();
  const nouvelle = sorte !== 'file';
  const agent = etat.agents.find((a) => a.agentId === etat.choisi);
  /* Après un travail fini, le nouvel agent part dans le projet de l'ancien, sauf si la page en désigne un autre. */
  if (sorte === 'fini' && !etat.reconnu && agent?.projectId && etat.projets.some((p) => p.id === agent.projectId) && zones.saisie?.querySelector('[data-saisie]')?.dataset.sorte !== 'fini') {
    etat.projet = agent.projectId;
  }
  const champ = el('textarea', {
    rows: '2',
    'data-champ': true,
    placeholder: sorte === 'nouvelle' ? t('Que doit faire Beluga sur cette page ?') : sorte === 'fini' ? t('Nouvelle demande sur cette page…') : t('Votre message attendra la fin du travail…'),
    onkeydown: (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void envoyer();
      }
    },
  });
  if (prerempli) champ.value = prerempli;
  const projet = etat.projets.find((p) => p.id === etat.projet);
  const micro = el('button', { class: `rond-bouton micro${enregistreur ? ' ecoute' : ''}`, title: t('Dictée…'), 'data-micro': true, onclick: () => dicter(micro, champ) }, icone(enregistreur ? 'arreter' : 'micro'));
  const envoyer = async () => {
    const texte = champ.value.trim();
    const cle = cleDesPieces();
    const jointes = piecesDuChamp();
    if (!texte && !jointes.length) return;
    const pieces = jointes.length ? jointes.map((p) => ({ nom: p.nom, dataUrl: p.dataUrl })) : undefined;
    bouton.disabled = true;
    try {
      if (nouvelle) {
        if (!etat.projet) return choisirLeProjet();
        const capture = etat.onglet?.windowId !== undefined ? await chrome.tabs.captureVisibleTab(etat.onglet.windowId, { format: 'png' }).catch(() => null) : null;
        const d = etat.demande;
        const complements = [d?.image ? `Image visée : ${d.image}` : '', d?.lien ? `Lien visé : ${d.lien}` : ''].filter(Boolean).join('\n');
        const r = await cmd({
          type: 'demande.creer',
          projectId: etat.projet,
          texte: complements ? `${texte}\n\n${complements}` : texte,
          onglet: etat.onglet ? { id: etat.onglet.id, url: etat.onglet.url, titre: etat.onglet.title } : null,
          selection: d?.selection || '',
          capture,
          pieces,
        });
        etat.demande = null;
        piecesEnAttente.delete(cle);
        champ.value = '';
        etat.mode = 'repondre';
        poserUnAvis(t('Carte créée : elle part tout de suite.'));
        await chargerLesAgents();
        if (r.agentId) await choisir(r.agentId);
      } else {
        /* Pendant le travail : le démon range le message dans la file de l'agent, qui part à la fin du tour. */
        await cmd({ type: 'agent.prompt', agentId: etat.choisi, text: texte, pieces });
        piecesEnAttente.delete(cle);
        champ.value = '';
        champ.blur();
        redessinerLaSaisie();
      }
    } catch (err) {
      montrerErreur(err);
    } finally {
      bouton.disabled = false;
    }
  };
  const bouton = el('button', { class: 'rond-bouton envoyer', title: t('Envoyer'), 'data-envoyer': true, onclick: envoyer }, icone('envoyer'));
  const pied = nouvelle
    ? el(
        'div',
        { class: 'pied' },
        el('button', { class: 'puce', 'data-projet': etat.projet ?? '', onclick: choisirLeProjet }, el('span', { class: 'libelle' }, projet ? projet.nom : t('Choisir le projet')), icone('bas', 12)),
        el('span', { class: 'puce' }, etat.demande?.selection ? t('Sélection jointe') : t('L’onglet sera confié')),
        micro,
        bouton,
      )
    : el(
        'div',
        { class: 'pied' },
        el('button', { class: 'puce', 'data-nouvelle-demande': true, onclick: () => ((etat.mode = 'nouvelle'), rendreLaSaisie()) }, icone('plus', 12), el('span', { class: 'libelle' }, t('Nouvelle demande'))),
        micro,
        bouton,
      );
  const cadre = el(
    'div',
    { class: `saisie${nouvelle ? ' nouvelle' : ''}${prerempli || garderLeFocus ? ' ouverte' : ''}`, 'data-saisie': nouvelle ? 'nouvelle' : 'repondre', 'data-sorte': sorte },
    nouvelle
      ? el(
          'div',
          { class: 'mode' },
          sorte === 'fini' ? t('Travail terminé : nouvel agent sur cette page') : t('Nouvelle demande sur cette page'),
          sorte === 'nouvelle' && etat.choisi && !travailFini(agent) ? el('button', { class: 'puce', style: 'margin-left:auto', onclick: () => ((etat.mode = 'repondre'), rendreLaSaisie()) }, t('Répondre à l’agent')) : null,
        )
      : null,
    champ,
    rendreLesPiecesDuChamp(),
    pied,
  );
  /* COLLER OU DÉPOSER UN FICHIER L'AJOUTE SOUS LE CHAMP, comme dans Beluga ; un collage de texte suit son chemin. */
  champ.addEventListener('paste', (e) => {
    const fichiers = fichiersDuTransfert(e.clipboardData);
    if (!fichiers.length) return;
    if (!e.clipboardData.types.includes('text/plain')) e.preventDefault();
    void ajouterDesFichiers(fichiers);
  });
  cadre.addEventListener('dragover', (e) => {
    if (![...(e.dataTransfer?.types ?? [])].includes('Files')) return;
    e.preventDefault();
    cadre.classList.add('depot');
  });
  cadre.addEventListener('dragleave', (e) => {
    if (!cadre.contains(e.relatedTarget)) cadre.classList.remove('depot');
  });
  cadre.addEventListener('drop', (e) => {
    cadre.classList.remove('depot');
    const fichiers = fichiersDuTransfert(e.dataTransfer);
    if (!fichiers.length) return;
    e.preventDefault();
    void ajouterDesFichiers(fichiers);
  });
  /* LE CHAMP GRANDIT AU CLIC, pour qu'on voie tout son message ; vide, il reprend sa taille compacte en sortant. */
  champ.addEventListener('focus', () => cadre.classList.add('ouverte'));
  champ.addEventListener('blur', () => {
    if (!champ.value.trim()) cadre.classList.remove('ouverte');
  });
  zones.saisie.replaceChildren(cadre);
  if (prerempli || garderLeFocus) champ.focus();
}

/* ------------------------------------------------------------------ */
/* Les fichiers collés dans le champ                                    */
/* ------------------------------------------------------------------ */

function cleDesPieces() {
  return etat.choisi ?? 'nouvelle';
}
function piecesDuChamp() {
  return piecesEnAttente.get(cleDesPieces()) ?? [];
}

/** Les fichiers d'un collage ou d'un dépôt (les deux formes que Chrome remplit selon la source). */
function fichiersDuTransfert(transfert) {
  if (!transfert) return [];
  const fichiers = [...(transfert.files ?? [])];
  if (!fichiers.length) for (const item of transfert.items ?? []) if (item.kind === 'file') {
    const f = item.getAsFile();
    if (f) fichiers.push(f);
  }
  return fichiers;
}

/** Une capture d'écran collée arrive sans vrai nom (« image.png ») : elle en reçoit un, daté, comme dans Beluga. */
function nomDuFichierColle(f, index) {
  if (f.name && !/^image\.\w+$/i.test(f.name)) return f.name;
  const horodate = new Date().toISOString().replace(/[:.]/g, '-');
  return `collage-${horodate}${index ? `-${index + 1}` : ''}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`;
}

function lireEnDataUrl(f) {
  return new Promise((resolve, reject) => {
    const lecteur = new FileReader();
    lecteur.onload = () => resolve(String(lecteur.result));
    lecteur.onerror = () => reject(lecteur.error);
    lecteur.readAsDataURL(f);
  });
}

async function ajouterDesFichiers(fichiers) {
  const cle = cleDesPieces();
  const liste = [...(piecesEnAttente.get(cle) ?? [])];
  let poids = liste.reduce((n, p) => n + p.taille, 0);
  for (const [i, f] of fichiers.entries()) {
    if (liste.length >= PIECES_MAX) {
      poserUnAvis(t('{n} fichiers au plus par message.', { n: PIECES_MAX }));
      break;
    }
    if (poids + f.size > POIDS_MAX_DES_PIECES) {
      poserUnAvis(t('« {nom} » est trop lourd : 15 Mo au plus par message.', { nom: f.name || t('Fichier') }));
      continue;
    }
    try {
      const dataUrl = await lireEnDataUrl(f);
      poids += f.size;
      liste.push({ cle: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, nom: nomDuFichierColle(f, i), mime: f.type || 'application/octet-stream', taille: f.size, dataUrl });
    } catch {
      poserUnAvis(t('« {nom} » n’a pas pu être lu.', { nom: f.name || t('Fichier') }));
    }
  }
  piecesEnAttente.set(cle, liste);
  if (cle === cleDesPieces()) {
    redessinerLaSaisie();
    zones.saisie.querySelector('.saisie')?.classList.add('ouverte');
  }
}

function retirerLaPiece(cleDePiece) {
  const cle = cleDesPieces();
  piecesEnAttente.set(cle, piecesDuChamp().filter((p) => p.cle !== cleDePiece));
  redessinerLaSaisie();
}

/** LES APERÇUS SOUS LE CHAMP : une vignette par image, une pastille (trombone + nom) sinon, chacune avec sa croix. */
function rendreLesPiecesDuChamp() {
  const pieces = piecesDuChamp();
  if (!pieces.length) return null;
  return el(
    'div',
    { class: 'pieces-saisie', 'data-pieces-saisie': true },
    ...pieces.map((p) => {
      const retirer = el('button', { class: 'retirer', title: t('Retirer'), 'aria-label': t('Retirer'), 'data-retirer-piece': p.cle, onclick: () => retirerLaPiece(p.cle) }, icone('croix', 12));
      return p.mime.startsWith('image/')
        ? el('div', { class: 'piece-saisie vignette', title: p.nom, 'data-piece-saisie': p.nom }, el('img', { src: p.dataUrl, alt: p.nom }), retirer)
        : el('div', { class: 'piece-saisie fichier', title: p.nom, 'data-piece-saisie': p.nom }, icone('trombone', 12), el('span', { class: 'nom' }, p.nom), retirer);
    }),
  );
}

/* ------------------------------------------------------------------ */
/* « Ce que l'agent a vu » : le rond et son volet                       */
/* ------------------------------------------------------------------ */

/** Les images déjà regardées, par agent (mémoire de session du navigateur : elle se vide à sa fermeture). */
const vues = new Map();

async function chargerLesVues(agentId) {
  if (!agentId || vues.has(agentId)) return;
  try {
    const r = await chrome.storage.session.get(`vues:${agentId}`);
    vues.set(agentId, new Set(r[`vues:${agentId}`] ?? []));
  } catch {
    vues.set(agentId, new Set());
  }
}

function nouvellesImages() {
  const vu = vues.get(etat.choisi) ?? new Set();
  return etat.images.filter((p) => !vu.has(p.id)).length;
}

function marquerToutVu() {
  if (!etat.choisi) return;
  const ids = etat.images.map((p) => p.id);
  vues.set(etat.choisi, new Set(ids));
  void chrome.storage.session.set({ [`vues:${etat.choisi}`]: ids.slice(-200) }).catch(() => {});
}

/** Les images d'un message arrivé en direct rejoignent le volet sans recharger le fil. */
function fusionnerLesImages(message) {
  if (message.agentId !== etat.choisi || !Array.isArray(message.flux)) return;
  const connues = new Set(etat.images.map((p) => p.id));
  for (const e of message.flux) {
    if (e.sorte !== 'capture' || !e.piece?.mime?.startsWith('image/') || connues.has(e.piece.id)) continue;
    connues.add(e.piece.id);
    etat.images.push({ id: e.piece.id, nom: e.piece.nom, mime: e.piece.mime, creeLe: e.piece.creeLe });
  }
  if (etat.images.length > 60) etat.images = etat.images.slice(-60);
  if (document.querySelector('[data-volet-captures]')) {
    marquerToutVu();
    remplirLeVolet();
  }
}

/**
 * LE ROND EN BAS À DROITE, COMME DANS BELUGA : un bouton rond (appareil photo) posé au-dessus de la zone d'écriture,
 * avec la pastille violette des images pas encore regardées. Masqué tant que l'agent n'a aucune image.
 */
function rendreLeRond() {
  if (!zones.captures) return;
  const visible = !!etat.choisi && etat.images.length > 0;
  zones.fil.classList.toggle('avec-rond', visible);
  if (!visible) return zones.captures.replaceChildren();
  const n = nouvellesImages();
  const ouvert = !!document.querySelector('[data-volet-captures]');
  zones.captures.replaceChildren(
    el(
      'button',
      {
        class: `rond-captures${ouvert ? ' ouvert' : ''}`,
        title: t('Ce que l’agent a vu'),
        'aria-label': t('Ce que l’agent a vu'),
        'data-captures-bouton': true,
        'aria-expanded': ouvert ? 'true' : 'false',
        onclick: (e) => {
          e.stopPropagation();
          if (document.querySelector('[data-volet-captures]')) fermerLeVolet();
          else ouvrirLeVolet();
        },
      },
      icone('camera', 18),
      n > 0 ? el('span', { class: 'pastille-nouvelles', 'data-captures-nouvelles': n }, n > 99 ? '99+' : String(n)) : null,
    ),
  );
}

/** LE VOLET : il monte du bas et couvre le fil ; une grille des images de l'agent, la plus récente en premier. */
function ouvrirLeVolet() {
  fermerLesFeuilles();
  const volet = el('div', { class: 'volet-captures', role: 'dialog', 'aria-label': t('Ce que l’agent a vu'), 'data-volet-captures': true });
  document.body.append(volet);
  marquerToutVu();
  remplirLeVolet();
  rendreLeRond();
}

function remplirLeVolet() {
  const volet = document.querySelector('[data-volet-captures]');
  if (!volet) return;
  const liste = [...etat.images].reverse();
  volet.replaceChildren(
    el(
      'div',
      { class: 'tete-volet' },
      icone('camera', 14),
      el('span', { class: 'titre' }, t('Ce que l’agent a vu')),
      el('span', { class: 'compte' }, String(liste.length)),
      el('button', { class: 'icone-bouton', title: t('Fermer'), 'aria-label': t('Fermer'), 'data-fermer-volet': true, onclick: fermerLeVolet }, icone('croix', 14)),
    ),
    el(
      'div',
      { class: 'grille-captures' },
      ...liste.map((p) => {
        const case_ = el('button', { class: 'case-capture', title: p.nom, 'data-capture-volet': p.id, onclick: () => ouvrirLaVisionneuse(p) });
        chargerLImage(p.id)
          .then((src) => case_.prepend(el('img', { src, alt: p.nom })))
          .catch(() => case_.replaceChildren(icone('image', 16)));
        return el('div', { class: 'cellule-capture' }, case_, rendreLaDate(p.creeLe, 'gauche'));
      }),
    ),
  );
}

function fermerLeVolet() {
  document.querySelector('[data-volet-captures]')?.remove();
  document.querySelector('[data-visionneuse]')?.remove();
  rendreLeRond();
}

/** Un aperçu du fil en grand : l'image est chargée d'abord, jamais une visionneuse vide. */
function ouvrirEnGrand(p) {
  if (images.has(p.id)) return ouvrirLaVisionneuse(p);
  chargerLImage(p.id).then(() => ouvrirLaVisionneuse(p), () => {});
}

/** Une image en grand, par-dessus le fil ou le volet : un clic ou Échap la referme. */
function ouvrirLaVisionneuse(p) {
  const src = images.get(p.id);
  if (!src) return;
  document.querySelector('[data-visionneuse]')?.remove();
  const vue = el('div', { class: 'visionneuse', role: 'dialog', 'aria-label': p.nom, 'data-visionneuse': p.id, onclick: () => vue.remove() }, el('img', { src, alt: p.nom }));
  document.body.append(vue);
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const vue = document.querySelector('[data-visionneuse]');
  if (vue) return vue.remove();
  if (document.querySelector('[data-volet-captures]')) fermerLeVolet();
});
document.addEventListener('click', (e) => {
  const volet = document.querySelector('[data-volet-captures]');
  /* La visionneuse se retire à son propre clic : sa cible est alors détachée, d'où `closest` plutôt que `contains`. */
  if (!volet || volet.contains(e.target) || !e.target.isConnected || e.target.closest?.('[data-visionneuse], [data-captures-bouton]')) return;
  fermerLeVolet();
});

function choisirLeProjet() {
  fermerLesFeuilles();
  const feuille = el(
    'div',
    { class: 'feuille', 'data-feuille-projets': true },
    el('div', { class: 'titre' }, t('Choisir le projet')),
    ...etat.projets.map((p) =>
      el('button', {
        class: p.id === etat.projet ? 'choisi' : '',
        onclick: () => {
          etat.projet = p.id;
          feuille.remove();
          const texte = document.querySelector('[data-champ]')?.value ?? '';
          rendreLaSaisie(texte);
        },
      }, p.nom),
    ),
  );
  document.body.append(feuille);
}

async function chargerLesProjets() {
  try {
    const r = await cmd({ type: 'projets.lister', url: etat.onglet?.url ?? '' });
    etat.projets = r.projets ?? [];
    etat.reconnu = r.reconnu ?? null;
    if (etat.reconnu) etat.projet = etat.reconnu;
    else if (!etat.projet || !etat.projets.some((p) => p.id === etat.projet)) etat.projet = r.dernier && etat.projets.some((p) => p.id === r.dernier) ? r.dernier : (etat.projets[0]?.id ?? null);
  } catch {
    /* hors ligne : la liste reviendra */
  }
  redessinerLaSaisie();
}

/** La zone d'écriture redessinée sans rien perdre : texte, curseur, et sa hauteur ouverte. */
function redessinerLaSaisie() {
  const champ = zones.saisie?.querySelector('[data-champ]');
  const focus = !!champ && document.activeElement === champ;
  rendreLaSaisie(champ?.value ?? '', focus);
}

/* LA DICTÉE : le micro de ce Chrome, transcrit par Beluga. Le premier accès se donne dans un onglet. */
let enregistreur = null;
async function dicter(bouton, champ) {
  if (enregistreur) {
    enregistreur.stop();
    return;
  }
  let flux;
  try {
    flux = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    chrome.tabs.create({ url: chrome.runtime.getURL('micro.html') });
    return poserUnAvis(t('Micro refusé : autorisez-le dans l’onglet qui vient de s’ouvrir, puis réessayez.'));
  }
  const morceaux = [];
  enregistreur = new MediaRecorder(flux, { mimeType: 'audio/webm' });
  enregistreur.ondataavailable = (e) => morceaux.push(e.data);
  enregistreur.onstop = async () => {
    flux.getTracks().forEach((p) => p.stop());
    enregistreur = null;
    bouton.classList.remove('ecoute');
    bouton.replaceChildren(icone('micro'));
    const octets = new Uint8Array(await new Blob(morceaux, { type: 'audio/webm' }).arrayBuffer());
    let binaire = '';
    for (let i = 0; i < octets.length; i += 0x8000) binaire += String.fromCharCode(...octets.subarray(i, i + 0x8000));
    try {
      const r = await cmd({ type: 'transcrire', audio: btoa(binaire), ext: 'webm' });
      champ.value = champ.value ? `${champ.value} ${r.texte}` : r.texte;
      champ.focus();
    } catch (err) {
      montrerErreur(err);
    }
  };
  enregistreur.start();
  bouton.classList.add('ecoute');
  bouton.replaceChildren(icone('arreter', 14));
}

/* ------------------------------------------------------------------ */
/* Avis et erreurs                                                      */
/* ------------------------------------------------------------------ */

let minuterieAvis = null;
function poserUnAvis(texte) {
  zones.avis.replaceChildren(el('div', { class: 'avis', 'data-avis': true }, texte));
  clearTimeout(minuterieAvis);
  minuterieAvis = setTimeout(() => zones.avis.replaceChildren(), 6000);
}
function montrerErreur(err) {
  poserUnAvis(String(err?.message ?? err));
}

/* ------------------------------------------------------------------ */
/* L'onglet affiché                                                     */
/* ------------------------------------------------------------------ */

async function suivreLOnglet() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) return;
  const change = tab.url !== etat.onglet?.url;
  etat.onglet = tab;
  const r = await appeler('agent-de-l-onglet', { tabId: tab.id });
  /* La personne est revenue dans le groupe de l'agent qu'on signalait : la ligne de suivi n'a plus lieu d'être. */
  if (etat.suivi && (etat.suivi.tabId === tab.id || (r.agentId && r.agentId === etat.suivi.agentId))) {
    etat.suivi = null;
    rendreLeSuivi();
  }
  if (r.agentId && r.agentId !== etat.choisi) {
    if (!etat.agents.some((a) => a.agentId === r.agentId)) await chargerLesAgents();
    if (etat.agents.some((a) => a.agentId === r.agentId)) await choisir(r.agentId);
  }
  if (change) await chargerLesProjets();
}

port.onMessage.addListener(async (m) => {
  if (m.type === 'reponse') {
    const r = reponses.get(m.id);
    reponses.delete(m.id);
    return r?.(m);
  }
  if (m.type === 'liaison') {
    if (m.langue) poserLaLangue(m.langue);
    const etaitRelie = etat.relie;
    etat.relie = m.relie;
    etat.enLigne = !!m.enLigne;
    if (!m.relie) return rendreLaLiaison();
    if (!etaitRelie) return demarrer();
    rendreLEntete();
    if (m.enLigne) void chargerLesAgents();
    return;
  }
  if (m.type === 'onglet') return void suivreLOnglet();
  if (m.type === 'demande') {
    etat.demande = m.demande;
    etat.mode = 'nouvelle';
    return rendreLaSaisie();
  }
  if (m.type !== 'evenement') return;
  if (m.genre === 'agents') return void chargerLesAgents();
  if (m.genre === 'file') {
    if (m.agentId !== etat.choisi) return;
    etat.file = m.file ?? [];
    return rendreLaFile();
  }
  if (m.genre === 'routine') return poserUnAvis(m.texte);
  if (m.genre === 'agit') {
    etat.suivi = { agentId: m.agentId, tabId: m.tabId, titre: m.titre };
    return rendreLeSuivi();
  }
  if (m.genre === 'message' && m.message) {
    const agent = etat.agents.find((a) => a.agentId === etat.choisi);
    const memeCarte = agent && etat.messages.length && etat.messages.some((x) => x.agentId === m.message.agentId);
    if (m.message.agentId !== etat.choisi && !memeCarte) return void chargerLesAgents();
    const i = etat.messages.findIndex((x) => x.id === m.message.id);
    if (i >= 0) etat.messages[i] = m.message;
    else etat.messages.push(m.message);
    fusionnerLesImages(m.message);
    rendreLeFil();
  }
});

chrome.tabs.onActivated.addListener(() => void suivreLOnglet());
chrome.windows.onFocusChanged.addListener(() => void suivreLOnglet());

/*
 * LE PANNEAU SUIT LA PERSONNE DANS LE GROUPE (1.0.6). Chaque onglet d'un groupe porte son propre panneau, qui ne
 * s'ouvre que dans un geste : à chaque clic ou touche ici, on l'ouvre sur les onglets permis qui ne l'ont pas encore
 * (liste publiée par le service worker en session, lue d'avance pour ne rien attendre dans le geste).
 */
const panneauxDuGroupe = { permis: [], ouverts: [] };
let dernierEtendu = 0;
function lireLesPanneaux(v) {
  if (Array.isArray(v.panneauxPermis)) panneauxDuGroupe.permis = v.panneauxPermis;
  if (Array.isArray(v.panneauxOuverts)) panneauxDuGroupe.ouverts = v.panneauxOuverts;
}
void chrome.storage.session.get(['panneauxPermis', 'panneauxOuverts']).then(lireLesPanneaux, () => {});
chrome.storage.onChanged.addListener((changes, aire) => {
  if (aire !== 'session') return;
  lireLesPanneaux(Object.fromEntries(Object.entries(changes).map(([k, c]) => [k, c.newValue])));
});
function etendreLePanneau() {
  if (!chrome.sidePanel?.open || Date.now() - dernierEtendu < 1500) return;
  dernierEtendu = Date.now();
  const ouverts = new Set(panneauxDuGroupe.ouverts);
  for (const id of panneauxDuGroupe.permis) if (!ouverts.has(id)) chrome.sidePanel.open({ tabId: id }).catch(() => {});
}
document.addEventListener('pointerdown', etendreLePanneau, true);
document.addEventListener('keydown', etendreLePanneau, true);

async function demarrer() {
  const r = await appeler('etat-liaison');
  poserLaLangue(r.langue || 'fr');
  etat.relie = r.relie;
  etat.enLigne = r.enLigne;
  etat.nom = r.nom;
  if (!r.relie) return rendreLaLiaison();
  rendreLeSquelette();
  const d = await appeler('demande-en-attente');
  if (d.demande) etat.demande = d.demande;
  await chargerLesAgents();
  await suivreLOnglet();
  if (!etat.choisi) rendreLeFil();
}

void demarrer();

/* Pour les contrôles automatiques : l'état lisible, sans rien changer. */
globalThis.belugaPanneau = { etat, cmd, rendreLeTexte, rafraichirLesDates };
