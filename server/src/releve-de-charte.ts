/**
 * LE RELEVÉ DE CHARTE D'UN SITE (carte « Aperçu, chat, Agentik et vraie charte », 06/11/2026) : avant de rédiger la
 * partie « Charte graphique » d'un document, l'agent lit les VRAIES couleurs et polices du site du client — styles
 * calculés par Chrome, jamais devinés. Il en tire les blocs `couleurs` et `typographies` (rôle, HEX ; les codes RGB et
 * CMJN sont calculés au rendu).
 *
 * Le navigateur du serveur est partagé : on le prend (`prendreLeNavigateur`) et on le rend, comme le PDF.
 */
import { log } from './logger.js';

export interface ReleveDeCharte {
  url: string;
  titre: string;
  /** Les couleurs, de la plus présente à la moins présente, avec où elles servent. */
  couleurs: { hex: string; usages: string[]; poids: number }[];
  /** Les polices par rôle (titres, texte, boutons). */
  polices: { famille: string; role: string; graisse: string; taille: string }[];
}

const DELAI_MS = 45_000;

export async function releverLaCharte(url: string): Promise<{ ok: true; releve: ReleveDeCharte } | { ok: false; raison: string }> {
  if (!/^https?:\/\/[^\s<>"']+$/i.test(url)) return { ok: false, raison: 'Une adresse http(s) complète est attendue.' };
  const { prendreLeNavigateur, rendreLeNavigateur } = await import('./navigateur-du-serveur.js');
  const qui = `releve-de-charte:${Date.now()}`;
  let pris = false;
  for (let i = 0; i < 60 && !(pris = prendreLeNavigateur(qui)); i++) await new Promise((r) => setTimeout(r, 1000));
  if (!pris) return { ok: false, raison: 'Le navigateur du serveur est occupé : réessaie dans un instant.' };
  try {
    const { chromium } = await import('playwright');
    const navigateur = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await navigateur.newPage({ viewport: { width: 1440, height: 1000 } });
      await page.goto(url, { waitUntil: 'networkidle', timeout: DELAI_MS }).catch(() => page.waitForTimeout(3000));
      await page.waitForTimeout(800);
      const brut = (await page.evaluate(`(function(){
        function hex(c){var m=/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/.exec(c||'');if(!m)return null;if(m[4]!==undefined&&Number(m[4])<0.5)return null;return '#'+[m[1],m[2],m[3]].map(function(x){return Number(x).toString(16).padStart(2,'0')}).join('')}
        var compte={};function noter(c,usage,poids){var h=hex(c);if(!h)return;var e=compte[h]||(compte[h]={hex:h,usages:[],poids:0});e.poids+=poids;if(e.usages.indexOf(usage)<0)e.usages.push(usage)}
        var els=Array.prototype.slice.call(document.querySelectorAll('body, body *')).slice(0,4000);
        els.forEach(function(el){var r=el.getBoundingClientRect();if(!r.width||!r.height)return;var s=getComputedStyle(el);if(s.visibility==='hidden'||s.display==='none')return;var aire=Math.min(r.width*r.height,1440*1000)/10000;
          var tag=el.tagName.toLowerCase(),bouton=tag==='button'||(tag==='a'&&/btn|button|bouton|cta/i.test(el.className||''))||el.getAttribute('role')==='button';
          noter(s.backgroundColor,bouton?'fond de bouton':tag==='body'?'fond de page':'fond',bouton?aire*6:aire);
          if(el.childNodes.length&&Array.prototype.some.call(el.childNodes,function(n){return n.nodeType===3&&n.textContent.trim()})){noter(s.color,/^h[1-3]$/.test(tag)?'titres':tag==='a'?'liens':bouton?'texte de bouton':'texte',3)}
        });
        function police(sel,role){var el=document.querySelector(sel);if(!el)return null;var s=getComputedStyle(el);return{famille:s.fontFamily.split(',')[0].replace(/["']/g,'').trim(),role:role,graisse:s.fontWeight,taille:s.fontSize}}
        var polices=[police('h1','titres principaux'),police('h2','titres de section'),police('p','texte courant'),police('button, a[class*=btn], a[class*=button]','boutons')].filter(Boolean);
        return{titre:document.title,couleurs:Object.keys(compte).map(function(k){return compte[k]}).sort(function(a,b){return b.poids-a.poids}).slice(0,12),polices:polices};
      })()`)) as Omit<ReleveDeCharte, 'url'>;
      return { ok: true, releve: { url, ...brut, couleurs: brut.couleurs.map((c) => ({ ...c, poids: Math.round(c.poids) })) } };
    } finally {
      await navigateur.close().catch(() => {});
    }
  } catch (err) {
    log.warn(`relevé de charte ${url} : ${(err as Error).message.split('\n')[0]}`);
    return { ok: false, raison: `Le site n’a pas pu être lu (${(err as Error).message.split('\n')[0]}).` };
  } finally {
    rendreLeNavigateur(qui);
  }
}
