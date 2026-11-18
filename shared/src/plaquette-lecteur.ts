/**
 * LA PAGE DU CLIENT — un LECTEUR façon PDF (carte « Refonte du service Charte graphique », 05/11/2026, demande de
 * l'utilisateur : « une page web sur fond anthracite, des pages qui ressemblent à un PDF au format choisi, avec une
 * ombre diffuse et une petite marge entre elles ; les miniatures à gauche, la page en cours entourée ; un bouton qui
 * suit le bord droit de la page pour commenter un endroit précis ; chaque commentaire ouvre une petite fenêtre de
 * discussion, comme Figma »).
 *
 * UNE PAGE LÉGÈRE : du HTML et un script écrit à la main, servis d'un bloc par le démon — le client ne télécharge rien
 * de l'application. Les feuilles sont celles de l'éditeur et du PDF (`paginerLeDocument`, recopiée dans le script).
 *
 * SÛRETÉ : tout texte venu du client ou de l'équipe est posé par `textContent`, jamais interprété ; les libellés et les
 * réglages entrent dans le script en JSON (`<` échappé). Le prénom est retenu par le navigateur (`localStorage`), sans
 * compte ni cookie (décision de l'utilisateur).
 *
 * Les libellés suivent la LANGUE du document et son ADRESSE (tu ou vous, décidée à la rédaction) : ce sont des textes
 * lus par le client final, pas ceux de l'interface de Beluga.
 */

import type { LangueId } from './langues.js';
import { documentDeLaPlaquette, formatDeLaPlaquette, iconeDeSignatureValable, PAGES_DE_PLAQUETTE, PLAFONDS_DE_PLAQUETTE, signatureDeLaMarque, type PlaquetteARendre } from './plaquette.js';
import { ancrerUnFil, attendreLesImages, paginerLeDocument } from './plaquette-pages.js';
import { cssDuLecteur, monterLeLecteur } from './plaquette-lecteur-commun.js';

type CleDeLibelle =
  | 'pdf'
  | 'commenter'
  | 'nouveau'
  | 'repondre'
  | 'envoyer'
  | 'prenom'
  | 'prenomAide'
  | 'erreur'
  | 'trop'
  | 'resoudre'
  | 'rouvrir'
  | 'resolu'
  | 'fermer'
  | 'page'
  | 'aide'
  | 'aideTactile'
  | 'pages'
  | 'client'
  | 'equipe'
  | 'supprime'
  | 'supprimer'
  | 'commentaire'
  | 'zoom'
  | 'zoomMoins'
  | 'zoomPlus'
  | 'ajuster';

type Libelles = Record<CleDeLibelle, string>;

const FR_VOUS: Libelles = {
  pdf: 'Télécharger le PDF',
  commenter: 'Commenter ici',
  nouveau: 'Nouveau commentaire',
  repondre: 'Répondre…',
  envoyer: 'Envoyer',
  prenom: 'Votre prénom',
  prenomAide: 'Il accompagne vos commentaires. Votre navigateur s’en souviendra.',
  erreur: 'Le commentaire n’a pas pu partir. Réessayez dans un instant.',
  trop: 'Beaucoup de commentaires d’un coup : réessayez dans un moment.',
  resoudre: 'Marquer comme résolu',
  rouvrir: 'Rouvrir',
  resolu: 'Résolu',
  fermer: 'Fermer',
  page: 'Page',
  aide: 'Pour commenter un endroit précis, passez la souris sur la page : le bouton suit son bord droit.',
  aideTactile: 'Touchez la page pour commenter un endroit précis.',
  pages: 'Pages',
  client: 'Client',
  equipe: 'L’équipe',
  supprime: 'Message supprimé',
  supprimer: 'Supprimer',
  commentaire: 'Commentaire de',
  zoom: 'Zoom',
  zoomMoins: 'Réduire',
  zoomPlus: 'Agrandir',
  ajuster: 'Ajuster à la largeur',
};
const FR_TU: Libelles = {
  ...FR_VOUS,
  prenom: 'Ton prénom',
  prenomAide: 'Il accompagne tes commentaires. Ton navigateur s’en souviendra.',
  erreur: 'Le commentaire n’a pas pu partir. Réessaie dans un instant.',
  trop: 'Beaucoup de commentaires d’un coup : réessaie dans un moment.',
  aide: 'Pour commenter un endroit précis, passe la souris sur la page : le bouton suit son bord droit.',
  aideTactile: 'Touche la page pour commenter un endroit précis.',
};
const EN: Libelles = {
  pdf: 'Download the PDF',
  commenter: 'Comment here',
  nouveau: 'New comment',
  repondre: 'Reply…',
  envoyer: 'Send',
  prenom: 'Your first name',
  prenomAide: 'It goes with your comments. Your browser will remember it.',
  erreur: 'The comment could not be sent. Please try again shortly.',
  trop: 'Many comments at once: please try again in a moment.',
  resoudre: 'Mark as resolved',
  rouvrir: 'Reopen',
  resolu: 'Resolved',
  fermer: 'Close',
  page: 'Page',
  aide: 'To comment on a precise spot, move your mouse over the page: the button follows its right edge.',
  aideTactile: 'Tap the page to comment on a precise spot.',
  pages: 'Pages',
  client: 'Client',
  equipe: 'The team',
  supprime: 'Message deleted',
  supprimer: 'Delete',
  commentaire: 'Comment by',
  zoom: 'Zoom',
  zoomMoins: 'Zoom out',
  zoomPlus: 'Zoom in',
  ajuster: 'Fit to width',
};
const ES_USTED: Libelles = {
  pdf: 'Descargar el PDF',
  commenter: 'Comentar aquí',
  nouveau: 'Nuevo comentario',
  repondre: 'Responder…',
  envoyer: 'Enviar',
  prenom: 'Su nombre',
  prenomAide: 'Acompaña sus comentarios. Su navegador lo recordará.',
  erreur: 'No se pudo enviar el comentario. Inténtelo de nuevo en un momento.',
  trop: 'Muchos comentarios a la vez: inténtelo de nuevo en un momento.',
  resoudre: 'Marcar como resuelto',
  rouvrir: 'Reabrir',
  resolu: 'Resuelto',
  fermer: 'Cerrar',
  page: 'Página',
  aide: 'Para comentar un punto preciso, pase el ratón por la página: el botón sigue su borde derecho.',
  aideTactile: 'Toque la página para comentar un punto preciso.',
  pages: 'Páginas',
  client: 'Cliente',
  equipe: 'El equipo',
  supprime: 'Mensaje eliminado',
  supprimer: 'Eliminar',
  commentaire: 'Comentario de',
  zoom: 'Zoom',
  zoomMoins: 'Reducir',
  zoomPlus: 'Ampliar',
  ajuster: 'Ajustar al ancho',
};
const ES_TU: Libelles = {
  ...ES_USTED,
  prenom: 'Tu nombre',
  prenomAide: 'Acompaña tus comentarios. Tu navegador lo recordará.',
  erreur: 'No se pudo enviar el comentario. Inténtalo de nuevo en un momento.',
  trop: 'Muchos comentarios a la vez: inténtalo de nuevo en un momento.',
  aide: 'Para comentar un punto preciso, pasa el ratón por la página: el botón sigue su borde derecho.',
  aideTactile: 'Toca la página para comentar un punto preciso.',
};
const DE_SIE: Libelles = {
  pdf: 'PDF herunterladen',
  commenter: 'Hier kommentieren',
  nouveau: 'Neuer Kommentar',
  repondre: 'Antworten…',
  envoyer: 'Senden',
  prenom: 'Ihr Vorname',
  prenomAide: 'Er begleitet Ihre Kommentare. Ihr Browser merkt ihn sich.',
  erreur: 'Der Kommentar konnte nicht gesendet werden. Bitte gleich noch einmal versuchen.',
  trop: 'Viele Kommentare auf einmal: bitte gleich noch einmal versuchen.',
  resoudre: 'Als erledigt markieren',
  rouvrir: 'Wieder öffnen',
  resolu: 'Erledigt',
  fermer: 'Schließen',
  page: 'Seite',
  aide: 'Um eine genaue Stelle zu kommentieren, fahren Sie mit der Maus über die Seite: die Schaltfläche folgt ihrem rechten Rand.',
  aideTactile: 'Tippen Sie auf die Seite, um eine genaue Stelle zu kommentieren.',
  pages: 'Seiten',
  client: 'Kunde',
  equipe: 'Das Team',
  supprime: 'Nachricht gelöscht',
  supprimer: 'Löschen',
  commentaire: 'Kommentar von',
  zoom: 'Zoom',
  zoomMoins: 'Verkleinern',
  zoomPlus: 'Vergrößern',
  ajuster: 'An Breite anpassen',
};
const DE_DU: Libelles = {
  ...DE_SIE,
  prenom: 'Dein Vorname',
  prenomAide: 'Er begleitet deine Kommentare. Dein Browser merkt ihn sich.',
  erreur: 'Der Kommentar konnte nicht gesendet werden. Versuch es gleich noch einmal.',
  trop: 'Viele Kommentare auf einmal: versuch es gleich noch einmal.',
  aide: 'Um eine genaue Stelle zu kommentieren, fahr mit der Maus über die Seite: die Schaltfläche folgt ihrem rechten Rand.',
  aideTactile: 'Tippe auf die Seite, um eine genaue Stelle zu kommentieren.',
};
const ZH_NIN: Libelles = {
  pdf: '下载 PDF',
  commenter: '在此评论',
  nouveau: '新评论',
  repondre: '回复…',
  envoyer: '发送',
  prenom: '您的名字',
  prenomAide: '它会显示在您的评论旁。浏览器会记住它。',
  erreur: '评论未能发送，请稍后再试。',
  trop: '评论过多，请稍后再试。',
  resoudre: '标记为已解决',
  rouvrir: '重新打开',
  resolu: '已解决',
  fermer: '关闭',
  page: '页',
  aide: '如需评论某个具体位置，请将鼠标移到页面上：按钮会沿页面右边缘移动。',
  aideTactile: '轻触页面即可评论具体位置。',
  pages: '页面',
  client: '客户',
  equipe: '团队',
  supprime: '消息已删除',
  supprimer: '删除',
  commentaire: '评论人',
  zoom: '缩放',
  zoomMoins: '缩小',
  zoomPlus: '放大',
  ajuster: '适应宽度',
};
const ZH_NI: Libelles = { ...ZH_NIN, prenom: '你的名字', prenomAide: '它会显示在你的评论旁。浏览器会记住它。', aide: '如需评论某个具体位置，把鼠标移到页面上：按钮会沿页面右边缘移动。', aideTactile: '轻触页面即可评论具体位置。' };

const LIBELLES_DU_LECTEUR: Record<LangueId, { vous: Libelles; tu: Libelles }> = {
  fr: { vous: FR_VOUS, tu: FR_TU },
  en: { vous: EN, tu: EN },
  es: { vous: ES_USTED, tu: ES_TU },
  de: { vous: DE_SIE, tu: DE_DU },
  zh: { vous: ZH_NIN, tu: ZH_NI },
};

export function libellesDuLecteur(langue: unknown, adresse: unknown): Libelles {
  const l = (LIBELLES_DU_LECTEUR as Record<string, { vous: Libelles; tu: Libelles }>)[String(langue)] ?? LIBELLES_DU_LECTEUR.fr;
  return adresse === 'tu' ? l.tu : l.vous;
}

/** Une valeur posée dans un script : du JSON où `<` ne peut jamais fermer la balise. */
function json(v: unknown): string {
  return JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** Blanc ou presque noir, selon ce qui se lit sur la couleur de la marque. */
function lisibleSur(fond: string): string {
  const n = parseInt(fond.slice(1), 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 160 ? '#111111' : '#ffffff';
}

function echapper(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export interface OptionsDuLecteur {
  /** « /plaquette/<jeton> » : le PDF, les images, les fils et le signal d'ouverture en dépendent. */
  base: string;
  /** La personne qui regarde a une session Beluga : son ouverture ne compte pas, ses messages sont ceux de l'équipe. */
  auteur: boolean;
  langue?: string;
  image: (id: string) => string | null;
  /** Le nom et le type d'une ressource, et l'adresse qui la télécharge. */
  infoDePiece?: (id: string) => { nom: string; mime?: string } | null;
  telechargement?: (id: string) => string | null;
  /**
   * LA VERSION SERVIE (carte « Finitions du lecteur de charte ») : la page la compare à celle que le serveur annonce
   * avec les fils, et se remet à jour SANS SE RECHARGER quand l'équipe enregistre une nouvelle version.
   */
  version?: number;
}

const ICONE_PDF =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>';

/**
 * LA PAGE ENTIÈRE du lien privé : la barre (titre, aide, PDF), puis LE LECTEUR COMMUN (`monterLeLecteur`, le même que
 * l'écran de l'équipe dans Beluga) monté sur les feuilles, avec ses fils lus et écrits par `fetch`. Le visiteur porte un
 * repère tiré au hasard et gardé par son navigateur (`beluga.plaquette.visiteur`) : c'est lui qui désigne SES messages,
 * les seuls qu'il peut supprimer.
 */
/*
 * LE SITE QUI DÉFILE SEUL (bloc à cadre navigateur « défilant ») : il monte à l'arrivée sur une vingtaine de secondes,
 * s'arrête au survol, et s'arrête pour de bon dès que le client défile lui-même (molette, doigt, clic) : sa barre de
 * défilement reste visible. Rien ne bouge pour qui préfère moins de mouvement. AUTONOME : recopié par String() dans la
 * page du client, aucun import ni variable de module.
 */
function defilerLesCadres(): void {
  var G: any = globalThis;
  if (G.matchMedia && G.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  G.document.querySelectorAll('.vue.defile').forEach(function (vue: any) {
    /* Les miniatures des pages sont des copies : elles restent fixes. */
    if (vue.closest('.lx-miniatures')) return;
    var survol = false, fini = false, dernier = 0, position = vue.scrollTop, debut = 0;
    function pas(t: number) {
      if (fini || !vue.isConnected) return;
      if (!dernier) dernier = t;
      /* Tant que le cadre n'est pas mis en page (pagination pas encore faite), on attend : il n'a pas encore de hauteur. */
      if (vue.clientHeight && !survol && t > debut) {
        /* La vitesse se lit à chaque image : les images chargées après coup allongent le site, pas la durée. */
        position += Math.max(10, (vue.scrollHeight - vue.clientHeight) / 20) * (t - dernier) / 1000;
        vue.scrollTop = position;
        if (vue.scrollTop + vue.clientHeight >= vue.scrollHeight - 1) { fini = true; return; }
      }
      dernier = t;
      G.requestAnimationFrame(pas);
    }
    var arreter = function () { fini = true; };
    vue.addEventListener('pointerenter', function () { survol = true; });
    vue.addEventListener('pointerleave', function () { survol = false; });
    vue.addEventListener('wheel', arreter, { passive: true });
    vue.addEventListener('touchstart', arreter, { passive: true });
    vue.addEventListener('pointerdown', arreter);
    vue.addEventListener('keydown', arreter);
    debut = G.performance.now() + 1500;
    G.requestAnimationFrame(pas);
  });
}

export function htmlDuLecteur(plaquette: PlaquetteARendre, options: OptionsDuLecteur): string {
  const langue = options.langue ?? 'fr';
  const L = libellesDuLecteur(langue, plaquette.adresse);
  const d = documentDeLaPlaquette(plaquette, {
    mode: 'document',
    sortie: 'client',
    langue,
    image: options.image,
    ...(options.infoDePiece ? { infoDePiece: options.infoDePiece } : {}),
    ...(options.telechargement ? { telechargement: options.telechargement } : {}),
  });
  /* L'ONGLET DU CLIENT (carte « Plaquette client : images, icône et titre ») : « <studio> — <titre> » et l'icône du
   * studio signataire (déjà en `data:`, la page n'a pas de session pour /api/favicon). Sans signature : le titre seul. */
  const signataire = signatureDeLaMarque(plaquette.marque);
  const titreDOnglet = signataire ? `${signataire} — ${plaquette.titre}` : plaquette.titre;
  const favicon = signataire ? iconeDeSignatureValable(plaquette.marque.signatureIcone) : undefined;
  const page = PAGES_DE_PLAQUETTE[formatDeLaPlaquette(plaquette.format)];
  const reglages = {
    base: options.base,
    auteur: options.auteur,
    langue,
    largeur: page.largeurPx,
    hauteur: page.hauteurPx,
    max: PLAFONDS_DE_PLAQUETTE.remarque,
    maxNom: PLAFONDS_DE_PLAQUETTE.nomRemarque,
    prenom: !options.auteur,
    mini: 150,
    zoomAuto: true,
    margeZoom: 152,
    margePetit: 20,
    plafond: 1,
    version: options.version ?? 0,
  };
  const couleur = plaquette.marque.couleur;
  const css = `
  html,body{margin:0;height:100%;background:var(--lx-fond);color:var(--lx-texte);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%}
  *{box-sizing:border-box}
  button{font:inherit;color:inherit}
  .lx{display:grid;grid-template-columns:188px minmax(0,1fr);grid-template-rows:54px minmax(0,1fr);height:100vh;height:100dvh}
  .lx-barre{grid-column:1/3;display:flex;align-items:center;gap:14px;padding:0 16px 0 20px;background:var(--lx-barre);min-width:0}
  .lx-titre{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
  .lx-aide{flex:1;min-width:0;font-size:12.5px;color:var(--lx-doux);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right}
  .lx-pdf{display:inline-flex;align-items:center;gap:8px;flex:0 0 auto;padding:8px 14px;border-radius:999px;background:#3a3b41;color:#fff;text-decoration:none;font-size:13.5px;font-weight:500}
  .lx-pdf:hover{background:#45464d}
  .lx-miniatures{overflow-y:auto;padding:18px 0 28px;display:flex;flex-direction:column;align-items:center;gap:16px;background:var(--lx-minis);scrollbar-width:thin}
  .lx-zone{position:relative;display:flex;min-width:0;min-height:0}
  .lx-zoom-hote{position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:25}
  .lx-defile{flex:1;min-width:0;overflow:auto;position:relative;-webkit-overflow-scrolling:touch;touch-action:pan-x pan-y}
  .lx-pages{position:relative;min-height:100%;min-width:100%;width:max-content;padding:60px 76px 96px;display:flex;justify-content:center}
  .lx-pages .pages{display:flex;flex-direction:column;align-items:center;gap:24px}
  .lx-tampon{position:absolute;left:-100000px;top:0;visibility:hidden;pointer-events:none}
  .lx-pages .feuille{box-shadow:0 22px 60px rgba(0,0,0,.42),0 4px 14px rgba(0,0,0,.32)}
  @media (max-width:760px){
    .lx{grid-template-columns:minmax(0,1fr)}
    .lx-miniatures,.lx-aide{display:none}
    .lx-barre{padding:0 10px 0 14px}
    .lx-pdf{padding:8px 12px}
    .lx-pdf span{display:none}
    .lx-pages{padding:56px 10px 120px}
    .lx-pages .pages{gap:12px}
  }`;

  const script = `(function(){
var R=${json(reglages)},L=${json(L)};
${String(paginerLeDocument)}
${String(attendreLesImages)}
${String(ancrerUnFil)}
${String(monterLeLecteur)}
${String(defilerLesCadres)}
var racine=document.querySelector('.pages'),aide=document.querySelector('.lx-aide'),tactile=window.matchMedia&&matchMedia('(pointer: coarse)').matches;
if(aide)aide.textContent=tactile?L.aideTactile:L.aide;
var visiteur='';try{visiteur=localStorage.getItem('beluga.plaquette.visiteur')||'';if(!visiteur){visiteur=(crypto.randomUUID?crypto.randomUUID():String(Math.random()).slice(2)+String(Date.now()));localStorage.setItem('beluga.plaquette.visiteur',visiteur)}}catch(e){}
${options.auteur ? '' : "if(!window.__ouvert){window.__ouvert=1;try{fetch(R.base+'/ouverte',{method:'POST',keepalive:true}).catch(function(){})}catch(e){}}"}
function appel(url,methode,corps){return fetch(url,{method:methode,headers:{'content-type':'application/json','x-visiteur':visiteur},body:corps?JSON.stringify(corps):undefined}).then(function(r){if(!r.ok)return{ok:false,statut:r.status};return r.json().then(function(j){return{ok:true,fil:j.fil}})})}
var api={
charger:function(){return fetch(R.base+'/fils',{headers:{accept:'application/json','x-visiteur':visiteur}}).then(function(r){return r.ok?r.json():null}).then(function(j){return j?j.fils:null})},
creer:function(c){return appel(R.base+'/fils','POST',c)},
repondre:function(id,c){return appel(R.base+'/fils/'+encodeURIComponent(id),'POST',c)},
resoudre:function(id,v){return appel(R.base+'/fils/'+encodeURIComponent(id)+'/resolu','POST',{resolu:v})},
supprimer:function(id,mid){return appel(R.base+'/fils/'+encodeURIComponent(id)+'/messages/'+encodeURIComponent(mid),'DELETE')}
};
var lecteur=null,enCours=false;
/* LA NOUVELLE VERSION, SANS RECHARGER LA PAGE : rendue hors écran, mise en pages, puis échangée avec l'ancienne ; la lecture reste où elle était. */
function nouvelleVersion(){if(enCours||!lecteur||lecteur.enSaisie())return;enCours=true;
fetch(R.base+'/document',{headers:{accept:'application/json'}}).then(function(r){return r.ok?r.json():null}).then(function(j){
if(!j||!j.corps)return;var tampon=document.querySelector('.lx-tampon'),st=document.getElementById('lx-doc');tampon.innerHTML=j.corps;var neuve=tampon.firstElementChild;if(!neuve||!st)return;st.textContent=j.css;
return attendreLesImages(neuve).then(function(){paginerLeDocument(neuve);var defile=document.querySelector('.lx-defile'),haut=defile.scrollTop,vieille=document.querySelector('.lx-pages > .pages');vieille.parentNode.replaceChild(neuve,vieille);racine=neuve;R.version=j.version;lecteur.rafraichir(neuve);defilerLesCadres();defile.scrollTop=haut;tampon.textContent=''})
}).catch(function(){}).then(function(){enCours=false})}
function sonder(){if(document.visibilityState!=='visible'||!lecteur||lecteur.enSaisie())return;fetch(R.base+'/fils',{headers:{accept:'application/json','x-visiteur':visiteur}}).then(function(r){return r.ok?r.json():null}).then(function(j){if(!j)return;if(j.fils)lecteur.maj(j.fils);if(j.version&&j.version!==R.version)nouvelleVersion()}).catch(function(){})}
attendreLesImages(racine).then(function(){paginerLeDocument(racine);
lecteur=monterLeLecteur({racine:racine,defile:document.querySelector('.lx-defile'),conteneur:document.querySelector('.lx-pages'),calque:document.querySelector('.lx-calque'),minis:document.querySelector('.lx-miniatures'),zoomHote:document.querySelector('.lx-zoom-hote'),R:R,L:L,ancrer:ancrerUnFil,api:api});
setInterval(sonder,10000);document.addEventListener('visibilitychange',sonder);defilerLesCadres()});
})();`;

  return `<!doctype html><html lang="${echapper(langue)}" class="lx-theme"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><meta name="color-scheme" content="dark"><title>${echapper(titreDOnglet)}</title>${favicon ? `<link rel="icon" href="${echapper(favicon)}">` : ''}<style>${cssDuLecteur(couleur, lisibleSur(couleur))}</style><style>${css}</style><style id="lx-doc">${d.css}</style></head><body class="lx-theme"><div class="lx"><header class="lx-barre"><span class="lx-titre">${echapper(plaquette.titre)}</span><span class="lx-aide"></span><a class="lx-pdf" href="${echapper(options.base)}/pdf" download>${ICONE_PDF}<span>${echapper(L.pdf)}</span></a></header><nav class="lx-miniatures" aria-label="${echapper(L.pages)}"></nav><div class="lx-zone"><div class="lx-zoom-hote"></div><main class="lx-defile"><div class="lx-pages">${d.corps}<div class="lx-tampon" aria-hidden="true"></div><div class="lx-calque"></div></div></main></div></div><script>${script}</script></body></html>`;
}
