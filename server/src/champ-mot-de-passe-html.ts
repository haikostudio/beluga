import { FAMILLES_DU_MOT_DE_PASSE, LONGUEUR_DU_MOT_DE_PASSE, echapperHtml } from '@beluga/shared';

/**
 * LE CHAMP DE MOT DE PASSE DES PAGES SERVIES PAR LE DÉMON.
 *
 * La page de bienvenue et les deux pages de connexion s'affichent AVANT
 * l'interface construite : elles ne peuvent pas emprunter `ChampMotDePasse`
 * (`web/src/components/ui/index.tsx`). Ce module en donne la même chose en HTML
 * simple — un œil posé DANS le champ, à droite, et, là où l'on CRÉE un mot de
 * passe, un bouton qui en tire un solide, le remplit dans la saisie et la
 * confirmation et les montre en clair.
 *
 * Le tirage se fait DANS LE NAVIGATEUR (`crypto.getRandomValues`, disponible
 * même hors HTTPS) : le mot de passe ne passe jamais par le démon avant
 * l'envoi du formulaire. Les familles de signes viennent de la règle partagée
 * (`shared/src/mot-de-passe.ts`), pour qu'il n'y en ait qu'une.
 */

export interface TextesDuChamp {
  afficher: string;
  masquer: string;
  generer: string;
}

export const TEXTES_DU_CHAMP_FR: TextesDuChamp = {
  afficher: 'Afficher le mot de passe',
  masquer: 'Masquer le mot de passe',
  generer: 'Générer un mot de passe solide',
};

const SVG = (corps: string) =>
  `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${corps}</svg>`;
const OEIL = SVG('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>');
const OEIL_BARRE = SVG(
  '<path d="M10.7 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.2 3.2"/><path d="M6.6 6.6A17.4 17.4 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="m2 2 20 20"/>',
);
const BAGUETTE = SVG(
  '<path d="m21.6 2.4-1.2-1.2"/><path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/><path d="M17.8 11.8 19 13"/><path d="M15 9h.01"/><path d="M17.8 6.2 19 5"/><path d="m3 21 9-9"/><path d="M12.2 6.2 11 5"/>',
);

/** Le style du champ, à poser une fois dans le `<style>` de la page. */
export const STYLE_DU_CHAMP = `
  .champ-mdp { position:relative; }
  .champ-mdp input { padding-right:44px; }
  .champ-mdp.avec-generateur input { padding-right:78px; }
  .champ-mdp .actions { position:absolute; top:0; bottom:0; right:6px; display:flex; align-items:center; gap:2px; }
  .champ-mdp .actions button { width:30px; height:30px; padding:0; display:grid; place-items:center; border:0; border-radius:6px;
           background:transparent; color:#a1a1aa; cursor:pointer; font-weight:400; }
  .champ-mdp .actions button:hover { background:#27272a; color:#fafafa; }
`;

/**
 * Un champ de mot de passe avec son œil. `attributs` est la suite d'attributs
 * de l'`<input>` (déjà échappée par l'appelant) ; `remplir` — les identifiants
 * des champs que le générateur remplit — fait paraître le bouton « générer ».
 */
export function champMotDePasseHtml(options: {
  id: string;
  attributs: string;
  textes: TextesDuChamp;
  remplir?: string[];
}): string {
  const e = echapperHtml;
  const generateur = options.remplir?.length
    ? `<button type="button" data-generer-mot-de-passe="1" data-remplir="${e(options.remplir.join(','))}" title="${e(options.textes.generer)}" aria-label="${e(options.textes.generer)}">${BAGUETTE}</button>`
    : '';
  return `<div class="champ-mdp${generateur ? ' avec-generateur' : ''}">
      <input id="${e(options.id)}" type="password" ${options.attributs}>
      <span class="actions">${generateur}<button type="button" data-oeil-mot-de-passe="masque" data-cible="${e(options.id)}" aria-pressed="false" title="${e(options.textes.afficher)}" aria-label="${e(options.textes.afficher)}">${OEIL}</button></span>
    </div>`;
}

/**
 * Le script de la page : l'œil bascule son champ, le générateur tire un mot de
 * passe, le pose dans chaque champ nommé et les montre. Un seul écouteur, posé
 * sur le document.
 */
export function scriptDuChamp(textes: TextesDuChamp): string {
  const j = (valeur: unknown) => JSON.stringify(valeur).replace(/</g, '\\u003c');
  return `<script>(function(){
var F=${j(FAMILLES_DU_MOT_DE_PASSE)},L=${LONGUEUR_DU_MOT_DE_PASSE},A=${j(textes.afficher)},M=${j(textes.masquer)},O=${j(OEIL)},B=${j(OEIL_BARRE)};
function n(b){var p=Math.floor(4294967296/b)*b,a=new Uint32Array(1);for(;;){crypto.getRandomValues(a);if(a[0]<p)return a[0]%b}}
function g(){var t=F.join(''),s=F.map(function(f){return f[n(f.length)]});while(s.length<L)s.push(t[n(t.length)]);for(var i=s.length-1;i>0;i--){var k=n(i+1),x=s[i];s[i]=s[k];s[k]=x}return s.join('')}
function voir(c,v){c.type=v?'text':'password';var b=document.querySelector('[data-oeil-mot-de-passe][data-cible="'+c.id+'"]');if(!b)return;b.setAttribute('data-oeil-mot-de-passe',v?'visible':'masque');b.setAttribute('aria-pressed',String(v));b.title=v?M:A;b.setAttribute('aria-label',v?M:A);b.innerHTML=v?B:O}
document.addEventListener('click',function(e){var b=e.target&&e.target.closest?e.target.closest('[data-oeil-mot-de-passe],[data-generer-mot-de-passe]'):null;if(!b)return;e.preventDefault();
if(b.hasAttribute('data-generer-mot-de-passe')){var m=g();(b.getAttribute('data-remplir')||'').split(',').forEach(function(id){var c=document.getElementById(id);if(c){c.value=m;voir(c,true)}})}
else{var c=document.getElementById(b.getAttribute('data-cible'));if(c)voir(c,c.type==='password')}});
})();</script>`;
}
