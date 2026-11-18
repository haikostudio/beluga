/**
 * LE NETTOYAGE DES SURCOUCHES AVANT UNE CAPTURE (carte « Captures de sites sans pop-ups », 08/11/2026).
 *
 * Une capture montre le site PROPRE : le bandeau de cookies, la fenêtre surgissante (newsletter, promotion) et son
 * voile, la bulle de discussion, le bouton WhatsApp, le « retour en haut » et le badge d'avis flottant ne doivent pas
 * se coller au milieu de l'image une fois la page dépliée. L'en-tête et un bandeau d'annonce collé en HAUT restent.
 *
 * DÉCISIONS DE L'UTILISATEUR (cadrage du 08/11/2026) :
 *  - face au bandeau de cookies, on ACCEPTE d'abord (vidéos, cartes et contenus intégrés s'affichent alors), puis on
 *    retire ce qui reste — jamais un refus, jamais un simple effacement qui laisserait les intégrations vides ;
 *  - les bulles de discussion et boutons flottants sont retirés AUSSI.
 *
 * DEUX SCRIPTS, évalués dans la page (JavaScript sans dépendance, comme ceux de `capture-ecran.ts`) :
 *  - SCRIPT_ACCEPTER : clique le bouton « tout accepter » d'un gestionnaire de consentement connu (OneTrust, Didomi,
 *    Axeptio, Cookiebot, tarteaucitron, Usercentrics en shadow DOM…), sinon un bouton au libellé d'acceptation posé
 *    dans un bloc qui parle de cookies. Il tourne dans CHAQUE cadre de la page (Sourcepoint, TrustArc vivent en iframe).
 *  - SCRIPT_NETTOYER : retire les bandeaux de consentement restants, les fenêtres et leur voile (grand élément fixe à
 *    z-index élevé qui n'est pas l'en-tête), les widgets flottants (petit fixe ancré dans un coin bas), puis rend le
 *    défilement que la fenêtre avait bloqué (overflow, position fixe, flou du fond).
 *
 * Il passe DEUX fois : avant le déroulé (une fenêtre qui bloque le défilement empêcherait le chargement différé), et
 * juste avant de déplier les collants (une fenêtre de sortie surgie pendant le déroulé serait sinon figée dans l'image).
 *
 * COPIE CONFORME dans l'outil de la compétence « capture pleine page sans éléments collés en double »
 * (`data/competences/…/scripts/nettoyer-surcouches.mjs`) : une correction d'ici s'y reporte.
 *
 * Rien ici ne fait échouer une capture : chaque étape est plafonnée et ses erreurs avalées.
 */

type Page = import('playwright').Page;

export const SCRIPT_ACCEPTER = `(() => {
  const COOKIE = /cookie|consent|rgpd|gdpr|confidentialit|privacy|vie priv|donn[ée]es personnelles|traceurs|datenschutz|privacidad/i;
  const LIBELLE = /^(tout accepter|accepter tout|accepter et (fermer|continuer)|accepter les cookies|accepter tous les cookies|accepter|j'accepte|j'accepte tout|je suis d'accord|d'accord|ok|ok pour moi|compris|continuer et accepter|accept|accept all|accept all cookies|accept cookies|accept and close|allow|allow all|allow all cookies|allow cookies|agree|i agree|agree and close|got it|alle akzeptieren|akzeptieren|alles akzeptieren|aceptar|aceptar todo|aceptar todas|accetta|accetta tutto|accetto)$/i;
  const CONNUS = [
    '#onetrust-accept-btn-handler', '#accept-recommended-btn-handler',
    '#didomi-notice-agree-button',
    '#axeptio_btn_acceptAll',
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll', '#CybotCookiebotDialogBodyButtonAccept',
    '#tarteaucitronPersonalize2', '#tarteaucitronAllAllowed', '.tarteaucitronAllow',
    '.cmplz-accept', '.qc-cmp2-summary-buttons button[mode="primary"]',
    '[data-testid="uc-accept-all-button"]', '#uc-btn-accept-banner',
    '.cky-btn-accept', '.iubenda-cs-accept-btn', '[data-tid="banner-accept"]', '.cm-btn-success',
    '.shopify-pc__banner__btn-accept', '#cookie_action_close_header', '.cc-allow', '.cc-dismiss',
    '#hs-eu-confirmation-button', '.osano-cm-accept-all', '.fc-cta-consent', '#truste-consent-button',
    '.sp_choice_type_11', '#CookieBoxSaveButton', '[data-cookieconsent="accept"]', '[data-cookie-accept]',
  ];
  const visible = (e) => {
    const r = e.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(e);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const racines = [document];
  const ombres = (racine, profondeur) => {
    for (const e of racine.querySelectorAll('*')) if (e.shadowRoot) { racines.push(e.shadowRoot); if (profondeur < 3) ombres(e.shadowRoot, profondeur + 1); }
  };
  ombres(document, 0);
  for (const racine of racines) {
    for (const sel of CONNUS) {
      let e = null;
      try { e = [...racine.querySelectorAll(sel)].find(visible) || null; } catch (err) { /* sélecteur refusé */ }
      if (e) { e.click(); return 'connu:' + sel; }
    }
  }
  const cadreDeConsentement = window !== window.top && /consent|cmp|privacy|sourcepoint|trustarc|truste|cookie/i.test(location.href);
  for (const racine of racines) {
    for (const b of racine.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]')) {
      const texte = ((b.innerText || b.value || b.getAttribute('aria-label') || '') + '').replace(/[’]/g, "'").replace(/\\s+/g, ' ').trim().replace(/[!.]$/, '');
      if (!texte || texte.length > 40 || !LIBELLE.test(texte)) continue;
      if (!visible(b)) continue;
      if (b.tagName === 'A') { const h = b.getAttribute('href') || ''; if (h && h !== '#' && !/^javascript:/i.test(h)) continue; }
      let dansUnBandeau = cadreDeConsentement;
      for (let p = b.parentElement, i = 0; p && i < 10 && !dansUnBandeau; p = p.parentElement, i++) {
        const t = p.innerText || '';
        if (t.length < 6000 && COOKIE.test(t)) dansUnBandeau = true;
      }
      const racineDuBouton = b.getRootNode();
      if (!dansUnBandeau && racineDuBouton !== document) dansUnBandeau = COOKIE.test((racineDuBouton.textContent || '').slice(0, 20000)) || COOKIE.test((racineDuBouton.host && racineDuBouton.host.id) || '');
      if (!dansUnBandeau) continue;
      b.click();
      return 'texte:' + texte;
    }
  }
  return '';
})()`;

export const SCRIPT_NETTOYER = `(() => {
  const COOKIE = /cookie|consentement|consent|rgpd|gdpr|traceurs|datenschutz/i;
  const CMP = [
    '#onetrust-consent-sdk', '#onetrust-banner-sdk', '#didomi-host', '#didomi-popup', '#axeptio_overlay', '.axeptio_mount',
    '#CybotCookiebotDialog', '#CybotCookiebotDialogBodyUnderlay', '#tarteaucitronRoot', '#tarteaucitronAlertBig',
    '#cmplz-cookiebanner-container', '.cmplz-cookiebanner', '#qc-cmp2-container', '.qc-cmp2-container', '#usercentrics-root',
    '#usercentrics-cmp-ui', '.cky-consent-container', '.cky-overlay', '#iubenda-cs-banner', '#termly-code-snippet-support',
    '.klaro', '#shopify-pc__banner', '[id^="sp_message_container"]', '#truste-consent-track', '.truste_overlay',
    '.truste_box_overlay', '#cookie-law-info-bar', '.cli-modal-backdrop', '#cookie-notice', '#cookieConsent',
    '#cookie-banner', '.cookie-banner', '#moove_gdpr_cookie_info_bar', '.cc-window', '.cc-banner', '#cc-main',
    '#gdpr-cookie-message', '#hs-eu-cookie-confirmation', '.osano-cm-window', '#BorlabsCookieBox', '.fc-consent-root',
    '#cookiebanner', '#cookie-consent', '.cookie-consent', '#consent-banner', '#cmpbox', '#cmpbox2', '.cmpboxBG',
  ];
  const WIDGETS = [
    '#intercom-container', '.intercom-lightweight-app', '#intercom-frame', '.crisp-client', '#crisp-chatbox',
    '#tawkchat-container', '#launcher', 'iframe#webWidget', '#hubspot-messages-iframe-container', '#drift-widget',
    '#drift-frame-controller', '#drift-frame-chat', '#tidio-chat', '#chat-widget-container', '#livechat-compact-container',
    '.fb_dialog', '.fb-customerchat', '#zsiq_float', '.zsiq_floatmain', '#smartsupp-widget-container', '#chatra',
    '.olark-launcher', '#beacon-container', '#freshworks-container', '#fc_frame', '#gorgias-chat-container',
    '#trengo-web-widget', '#brevo-conversations', '#sib-conversations', '.woot-widget-holder', '.woot--bubble-holder',
    '.jdgm-revs-tab-btn', '[id^="trustbadge-container"]', '.grecaptcha-badge', '#back-to-top', '#backtotop',
    '.back-to-top', '.scroll-to-top', '#scroll-to-top', '.scrollup', '#toTop', 'a[href*="wa.me/"]',
    'a[href*="api.whatsapp.com"]', 'iframe[title*="chat" i]',
  ];
  const FENETRE = /(^|[-_ ])(modal|popup|pop-up|newsletter|lightbox|overlay|backdrop|klaviyo-form|privy|optinmonster|sumo|mc-modal|elementor-popup-modal)([-_ ]|$)/i;
  const W = innerWidth, H = innerHeight;
  let retires = 0;
  const retirer = (e) => { if (e && e.isConnected && e !== document.body && e !== document.documentElement) { e.remove(); retires++; } };
  const style = (e) => getComputedStyle(e);
  const colle = (e) => {
    for (let p = e, i = 0; p && p !== document.body && i < 6; p = p.parentElement, i++) { const s = style(p).position; if (s === 'fixed' || s === 'sticky') return true; }
    let n = 0;
    for (const d of e.querySelectorAll('*')) { if (++n > 60) break; if (style(d).position === 'fixed') return true; }
    return false;
  };
  for (const sel of CMP) { try { document.querySelectorAll(sel).forEach(retirer); } catch (err) { /* sélecteur refusé */ } }
  for (const sel of WIDGETS) {
    try {
      document.querySelectorAll(sel).forEach((e) => {
        if (!e.isConnected || !colle(e)) return;
        let cible = e;
        for (let p = e.parentElement, i = 0; p && p !== document.body && i < 4; p = p.parentElement, i++) {
          const r = p.getBoundingClientRect();
          if (style(p).position === 'fixed' && r.width <= 480 && r.height <= 480) { cible = p; break; }
        }
        retirer(cible);
      });
    } catch (err) { /* sélecteur refusé */ }
  }
  const principal = document.querySelector('main') || window.__defileur || null;
  const texteTotal = (document.body.innerText || '').length || 1;
  for (const e of [...document.querySelectorAll('body *')]) {
    if (!e.isConnected) continue;
    const s = style(e);
    const pos = s.position;
    const dialogue = (e.tagName === 'DIALOG' && e.open) || e.getAttribute('aria-modal') === 'true' || /^(dialog|alertdialog)$/.test(e.getAttribute('role') || '');
    if (pos !== 'fixed' && pos !== 'sticky' && !(dialogue && pos === 'absolute')) continue;
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.05) continue;
    const r = e.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const vl = Math.max(0, Math.min(r.right, W) - Math.max(r.left, 0));
    const vh = Math.max(0, Math.min(r.bottom, H) - Math.max(r.top, 0));
    const part = (vl * vh) / (W * H);
    const z = parseInt(s.zIndex, 10);
    const texte = (e.innerText || '').slice(0, 6000);
    const enTete = pos === 'sticky' || (r.top <= 2 && r.height <= H * 0.3 && r.width >= W * 0.8);
    const contenu = (principal && e.contains(principal) && e !== principal) || texte.length > texteTotal * 0.6;
    if (contenu) continue;
    /* Un bandeau de cookies, où qu'il soit collé (en haut compris : ce n'est pas un en-tête). */
    if (texte.length < (enTete ? 800 : 3000) && COOKIE.test(texte) && r.height < H * 0.95) { retirer(e); continue; }
    if (enTete) continue;
    /* Une fenêtre, un voile : grand, au-dessus du reste, ou déclaré comme dialogue. */
    const classe = (typeof e.className === 'string' ? e.className : '') + ' ' + (e.id || '');
    if (pos === 'fixed' && s.pointerEvents !== 'none' && part >= 0.3 && (z >= 10 || dialogue || FENETRE.test(classe))) { retirer(e); continue; }
    if (dialogue && part >= 0.05) { retirer(e); continue; }
    if (pos === 'fixed' && FENETRE.test(classe) && part >= 0.05) { retirer(e); continue; }
    /* Un widget flottant : petit, ancré dans un coin bas (bulle, WhatsApp, retour en haut, badge d'avis). */
    if (pos === 'fixed' && r.width <= 420 && r.height <= 420 && r.bottom >= H - 220 && (r.left < W * 0.35 || r.right > W * 0.65) && r.width < W * 0.6) { retirer(e); continue; }
  }
  /* Le défilement rendu : une fenêtre bloque souvent html/body (overflow caché, position fixe) et floute le fond. */
  const bloque = /(^|[-_ ])(modal-open|no-scroll|noscroll|overflow-hidden|scroll-lock|is-locked|lock-scroll|disable-scroll|has-modal|popup-open)([-_ ]|$)/i;
  const verrou = [document.documentElement, document.body].some((e) => bloque.test(e.className || '') || /overflow\\s*:\\s*hidden|position\\s*:\\s*fixed/i.test(e.getAttribute('style') || ''));
  if (retires > 0 || verrou) {
    for (const e of [document.documentElement, document.body]) {
      e.className = (e.className || '').split(/\\s+/).filter((c) => !bloque.test(c)).join(' ');
      const s = style(e);
      if (s.overflowY === 'hidden' && !window.__defileurInterne) { e.style.setProperty('overflow', 'visible', 'important'); e.style.setProperty('overflow-y', 'visible', 'important'); }
      if (s.position === 'fixed') {
        const haut = parseInt(e.style.top || '0', 10) || 0;
        e.style.setProperty('position', 'static', 'important');
        e.style.setProperty('top', 'auto', 'important');
        if (haut < 0) scrollTo(0, -haut);
      }
    }
    for (const e of [document.body, ...document.body.children]) {
      if (/blur/.test(style(e).filter || '')) e.style.setProperty('filter', 'none', 'important');
    }
  }
  return retires;
})()`;

/** Le défilement interne d'une application (SPA) se repère AVANT le déblocage : son body caché ne se rouvre pas. */
const SCRIPT_REPERER_SPA = `(() => {
  const doc = document.scrollingElement || document.documentElement;
  if (doc.scrollHeight > innerHeight + 4) return false;
  for (const e of document.querySelectorAll('body *')) {
    const s = getComputedStyle(e);
    if (/(auto|scroll|overlay)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 40 && e.clientHeight >= innerHeight * 0.4) { window.__defileurInterne = true; return true; }
  }
  return false;
})()`;

async function plafonne<T>(promesse: Promise<T>, ms: number, repli: T): Promise<T> {
  let minuteur: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promesse.catch(() => repli), new Promise<T>((r) => (minuteur = setTimeout(() => r(repli), ms)))]);
  } finally {
    clearTimeout(minuteur);
  }
}

/** Clique « tout accepter » dans le premier cadre qui en montre un. Rend ce qui a été cliqué, ou `''`. */
export async function accepterLesCookies(page: Page): Promise<string> {
  for (const cadre of [page.mainFrame(), ...page.frames().filter((f) => f !== page.mainFrame())]) {
    const clic = await plafonne(cadre.evaluate(SCRIPT_ACCEPTER) as Promise<string>, 3000, '');
    if (clic) return clic;
  }
  return '';
}

/** Retire ce qui reste collé par-dessus le site. Rend le nombre d'éléments retirés. */
export async function retirerLesSurcouches(page: Page): Promise<number> {
  await plafonne(page.evaluate(SCRIPT_REPERER_SPA), 3000, false);
  return Number(await plafonne(page.evaluate(SCRIPT_NETTOYER), 5000, 0)) || 0;
}

/**
 * LA PREMIÈRE PASSE : accepter, laisser charger ce que l'acceptation débloque, laisser surgir les fenêtres différées,
 * puis retirer. Si le clic recharge la page, `apresRechargement` remet ce que le rechargement a effacé (CSS figé,
 * masques). Jamais plus de ~12 s.
 */
export async function nettoyerAvantLaPrise(page: Page, apresRechargement: () => Promise<void>): Promise<{ clic: string; retires: number }> {
  await plafonne(page.evaluate('window.__captureMarque = 1'), 2000, undefined);
  const clic = await accepterLesCookies(page);
  if (clic) {
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    const rechargee = !(await plafonne(page.evaluate('window.__captureMarque === 1') as Promise<boolean>, 2000, true));
    if (rechargee) {
      await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => {});
      await apresRechargement().catch(() => {});
    }
  }
  await page.waitForTimeout(1500);
  const retires = await retirerLesSurcouches(page);
  return { clic, retires };
}
