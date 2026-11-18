import * as React from 'react';
import {
  SEUIL_DU_CLAVIER_PX,
  champQuiFaitMonterLeClavier,
  cleDeLaHauteurRetenue,
  decisionDuClavier,
  hauteurDeLApplication,
} from '@beluga/shared';
import { EVENEMENT_MESURE_DU_CLAVIER } from '@/lib/ecriture-au-clavier';

/**
 * UNE ZONE SÛRE EN PIXELS. `--zone-sure-haut` / `--zone-sure-bas` valent
 * `env(safe-area-inset-…)` et ne se résolvent qu'une fois posées sur un
 * élément : on lit donc le remplissage d'un témoin invisible.
 */
let temoinZoneSure: HTMLElement | null = null;
/** L'œil sur le clavier tant qu'un champ a le curseur : assez vif sans peser sur la batterie. */
const INTERVALLE_DE_SURVEILLANCE_DU_CLAVIER_MS = 250;
const DUREE_DU_SUIVI_DU_CLAVIER_MS = 700;

function estEnPaysage(): boolean {
  const type = window.screen?.orientation?.type;
  if (type) return type.startsWith('landscape');
  return window.matchMedia('(orientation: landscape)').matches;
}

function poserSiDifferent(el: Element, nom: string, valeur: string) {
  if (el.getAttribute(nom) !== valeur) el.setAttribute(nom, valeur);
}

/* La dernière hauteur de clavier mesurée, par orientation, gardée d'une session à l'autre. */
function lireHauteurRetenue(cle: string): number | null {
  try {
    const v = Number(window.localStorage.getItem(cle));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
function ecrireHauteurRetenue(cle: string, valeur: number) {
  try {
    if (window.localStorage.getItem(cle) !== String(valeur)) window.localStorage.setItem(cle, String(valeur));
  } catch {
    /* stockage plein ou interdit : le secours attendra une autre fois */
  }
}

function mesurerZoneSure(variable: '--zone-sure-haut-systeme' | '--zone-sure-bas'): number {
  if (!temoinZoneSure) {
    temoinZoneSure = document.createElement('div');
    temoinZoneSure.setAttribute('aria-hidden', 'true');
    temoinZoneSure.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none';
    document.body.appendChild(temoinZoneSure);
  }
  temoinZoneSure.style.paddingTop = `var(${variable}, 0px)`;
  return parseFloat(getComputedStyle(temoinZoneSure).paddingTop) || 0;
}

/**
 * LA SEULE MESURE DU CLAVIER ET DE LA HAUTEUR D'ÉCRAN (MEM-5918). Montée par
 * l'application ET par l'écran caché des mesures, qui la remplace : on y lit
 * ainsi, sur l'appareil, ce que la mesure voit vraiment.
 */
export function useMesureDuClavier() {
  /*
   * LA BANDE VIDE EN BAS (recette éprouvée sur ProjetE et ProjetA).
   *
   * Deux mesures, et deux seulement :
   * — la hauteur d'écran, prise sur l'écran physique quand l'application est
   *   installée sur le téléphone : les autres mesures sous-estiment l'écran au
   *   démarrage à froid, et le manque se reporte en bande vide en bas ;
   * — le clavier, réservé UNIQUEMENT s'il est vraiment ouvert (un champ a le
   *   curseur et l'écart dépasse cent points). Sans cette condition, la barre
   *   d'adresse du navigateur passait pour un clavier et creusait une marge
   *   permanente en bas.
   */
  React.useEffect(() => {
    const vue = window.visualViewport;
    const racine = document.documentElement;
    /* La fenêtre hors saisie, en portrait puis en paysage. */
    const reposParOrientation: [number | null, number | null] = [null, null];
    /* Fin du suivi image par image qui suit l'entrée dans un champ. */
    let finDuSuivi = 0;
    /* Un clavier a-t-il été mesuré depuis l'entrée dans le champ ? Alors la zone visible n'est pas bloquée. */
    let mesureDepuisLEntree = false;

    const appliquer = () => {
      const hauteurEcran = hauteurDeLApplication({
        installee:
          (window.navigator as any).standalone === true ||
          window.matchMedia('(display-mode: standalone)').matches,
        ecranLargeur: window.screen?.width || 0,
        ecranHauteur: window.screen?.height || 0,
        fenetreLargeur: window.innerWidth,
        fenetreHauteur: window.innerHeight,
        zoneSureHaut: mesurerZoneSure('--zone-sure-haut-systeme'),
        zoneSureBas: mesurerZoneSure('--zone-sure-bas'),
      });
      if (hauteurEcran) racine.style.setProperty('--hauteur-app', `${hauteurEcran}px`);
      else racine.style.removeProperty('--hauteur-app');

      const actif = document.activeElement;
      const saisieActive =
        !!actif &&
        (actif.tagName === 'INPUT' || actif.tagName === 'TEXTAREA' || (actif as HTMLElement).isContentEditable);
      const ecart = vue ? window.innerHeight - vue.height - vue.offsetTop : 0;
      const clavierOuvert = saisieActive && ecart > SEUIL_DU_CLAVIER_PX;
      /*
       * LA PAGE NE GLISSE JAMAIS SOUS LE CLAVIER (#deca). L'application lève
       * elle-même ce qui doit rester visible (`--clavier`) ; si l'iPhone fait
       * en plus glisser toute la page (document défilé, `offsetTop` > 0), le
       * dessin et les touchers ne parlent plus du même endroit : le curseur du
       * champ d'écriture se posait ailleurs que sous le doigt. On la ramène —
       * pour CE champ seulement, que `--clavier` lève déjà : les champs des
       * autres écrans comptent encore sur ce glissement pour rester visibles.
       */
      const champDEcriture = !!actif?.closest?.('[data-champ-d-ecriture]');
      if (champDEcriture && (window.scrollY > 0 || (vue?.offsetTop ?? 0) > 0)) window.scrollTo(0, 0);
      const ecartRecale = vue ? window.innerHeight - vue.height - vue.offsetTop : 0;
      const ecartRetenu = saisieActive && ecartRecale > SEUIL_DU_CLAVIER_PX ? ecartRecale : clavierOuvert ? ecart : ecartRecale;
      /*
       * QUAND L'IPHONE NE DONNE PAS LE CLAVIER (captures #2da6 / #866f) : iOS
       * 26, application installée, la zone visible reste parfois bloquée à
       * pleine hauteur clavier ouvert, jusqu'à une rotation. La règle
       * `decisionDuClavier` reprend alors la dernière hauteur mesurée dans la
       * même orientation — gardée d'une session à l'autre. La hauteur de repos
       * (fenêtre hors saisie) l'empêche de lever une page que le système a
       * déjà rétrécie.
       */
      const paysage = estEnPaysage();
      const cleRetenue = cleDeLaHauteurRetenue(paysage);
      if (!saisieActive) reposParOrientation[paysage ? 1 : 0] = window.innerHeight;
      const precedent = parseFloat(racine.style.getPropertyValue('--clavier')) || 0;
      const decision = decisionDuClavier({
        ecart: ecartRetenu,
        saisieActive,
        champTexte:
          !!actif &&
          champQuiFaitMonterLeClavier({
            tag: actif.tagName,
            type: (actif as HTMLInputElement).type ?? null,
            lectureSeule: (actif as HTMLInputElement).readOnly === true,
            inputMode: actif.getAttribute('inputmode'),
            editable: (actif as HTMLElement).isContentEditable,
          }),
        pointeurGrossier: window.matchMedia('(pointer: coarse)').matches,
        suiviFini: performance.now() >= finDuSuivi,
        mesureDepuisLEntree,
        clavierPrecedent: precedent,
        hauteurRetenue: lireHauteurRetenue(cleRetenue),
        fenetreHauteur: window.innerHeight,
        hauteurDeRepos: reposParOrientation[paysage ? 1 : 0],
      });
      if (decision.source === 'mesuree') mesureDepuisLEntree = true;
      if (decision.aRetenir) ecrireHauteurRetenue(cleRetenue, decision.aRetenir);
      const clavier = decision.clavier;
      /* Ce que l'application a vu, lisible sur l'appareil (écran des mesures). */
      poserSiDifferent(racine, 'data-clavier-source', decision.source);
      poserSiDifferent(racine, 'data-clavier-ecart', String(Math.round(ecartRetenu)));
      poserSiDifferent(racine, 'data-clavier-retenu', String(lireHauteurRetenue(cleRetenue) ?? 0));
      poserSiDifferent(racine, 'data-hauteur-de-repos', String(reposParOrientation[paysage ? 1 : 0] ?? 0));
      const clavierAChange = `${clavier}px` !== racine.style.getPropertyValue('--clavier');
      if (clavierAChange) racine.style.setProperty('--clavier', `${clavier}px`);
      /*
       * L'APPLICATION PREND LA HAUTEUR VISIBLE, CLAVIER OUVERT (30/10/2026,
       * capture #8dff) : sa hauteur EST la zone au-dessus du clavier, comme
       * dans une messagerie — la barre d'écriture, au bout de la colonne, s'y
       * pose sans recouvrir ni laisser de vide. Clavier fermé, la variable
       * tombe et la racine reprend toute la page.
       */
      if (clavier > 0 && vue) {
        /* En secours, la zone visible ment (pleine hauteur) : on la déduit du clavier retenu. */
        const visible = decision.source === 'secours' ? window.innerHeight - clavier : vue.height;
        racine.style.setProperty('--hauteur-visible', `${Math.round(visible)}px`);
        racine.setAttribute('data-clavier-ouvert', '');
      } else {
        racine.style.removeProperty('--hauteur-visible');
        racine.removeAttribute('data-clavier-ouvert');
      }
      if (clavierAChange) window.dispatchEvent(new Event(EVENEMENT_MESURE_DU_CLAVIER));
    };

    appliquer();
    const retarde = () => {
      window.setTimeout(appliquer, 60);
      window.setTimeout(appliquer, 350);
    };
    /*
     * LA MONTÉE DU CLAVIER SE SUIT IMAGE PAR IMAGE, sans attendre sa fin : le
     * premier `resize` de l'iPhone n'arrive parfois qu'une fois le clavier
     * posé, et la barre sautait d'un coup. Pendant 700 ms après l'entrée dans
     * un champ, la mesure se refait à chaque image (elle n'écrit que ce qui
     * change).
     */
    let suivi = 0;
    /* Le suivi fini, une dernière mesure : c'est elle qui peut poser le secours. */
    let apresLeSuivi = 0;
    const suivre = () => {
      appliquer();
      if (performance.now() < finDuSuivi) suivi = window.requestAnimationFrame(suivre);
    };
    /*
     * TANT QU'UN CHAMP A LE CURSEUR, ON GARDE UN ŒIL SUR LE CLAVIER (captures
     * #93638 et #e155) : l'iPhone ne prévient pas toujours, et le clavier remonté
     * sans `resize` — probablement au retour du sélecteur de photos, cas non
     * reproduit sur l'appareil — laissait `--clavier` à 0 et la barre d'écriture
     * dessous. Quatre fois par seconde, on compare une empreinte sans toucher à la
     * mise en page ; seule une différence relance la vraie mesure. Plus de champ
     * actif ou page cachée : la surveillance s'arrête d'elle-même.
     */
    const empreinte = () => {
      const actif = document.activeElement;
      const saisie =
        !!actif &&
        (actif.tagName === 'INPUT' || actif.tagName === 'TEXTAREA' || (actif as HTMLElement).isContentEditable);
      return { saisie, valeur: `${saisie}|${window.innerHeight}|${vue?.height}|${vue?.offsetTop}` };
    };
    let surveillance = 0;
    let derniere = '';
    const arreterLaSurveillance = () => {
      window.clearInterval(surveillance);
      surveillance = 0;
    };
    const surveiller = () => {
      const { saisie, valeur } = empreinte();
      if (valeur !== derniere) {
        derniere = valeur;
        appliquer();
      }
      if (!saisie || document.hidden) arreterLaSurveillance();
    };
    const lancerLaSurveillance = () => {
      if (surveillance || document.hidden || !empreinte().saisie) return;
      derniere = empreinte().valeur;
      surveillance = window.setInterval(surveiller, INTERVALLE_DE_SURVEILLANCE_DU_CLAVIER_MS);
    };
    const entree = () => {
      finDuSuivi = performance.now() + DUREE_DU_SUIVI_DU_CLAVIER_MS;
      window.cancelAnimationFrame(suivi);
      window.clearTimeout(apresLeSuivi);
      apresLeSuivi = window.setTimeout(appliquer, DUREE_DU_SUIVI_DU_CLAVIER_MS + 30);
      suivre();
      lancerLaSurveillance();
    };
    /* Au retour dans l'application, tout se remesure : le champ a pu garder le
       curseur pendant l'absence sans qu'aucun `focusin` ne reparte. */
    const auRetour = () => {
      if (document.hidden) return arreterLaSurveillance();
      retarde();
      if (empreinte().saisie) entree();
    };
    vue?.addEventListener('resize', appliquer);
    vue?.addEventListener('scroll', appliquer);
    window.addEventListener('resize', appliquer);
    const entreeDansUnChamp = () => {
      mesureDepuisLEntree = false;
      entree();
    };
    window.addEventListener('focusin', entreeDansUnChamp);
    window.addEventListener('focusout', retarde);
    window.addEventListener('orientationchange', retarde);
    document.addEventListener('visibilitychange', auRetour);
    window.addEventListener('pageshow', auRetour);
    window.addEventListener('focus', auRetour);
    return () => {
      window.cancelAnimationFrame(suivi);
      window.clearTimeout(apresLeSuivi);
      arreterLaSurveillance();
      vue?.removeEventListener('resize', appliquer);
      vue?.removeEventListener('scroll', appliquer);
      window.removeEventListener('resize', appliquer);
      window.removeEventListener('focusin', entreeDansUnChamp);
      window.removeEventListener('focusout', retarde);
      window.removeEventListener('orientationchange', retarde);
      document.removeEventListener('visibilitychange', auRetour);
      window.removeEventListener('pageshow', auRetour);
      window.removeEventListener('focus', auRetour);
    };
  }, []);
}
