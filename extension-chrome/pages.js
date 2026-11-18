/**
 * LES SEULS SCRIPTS QUI S'EXÉCUTENT DANS LES PAGES (`chrome.scripting.executeScript`).
 *
 * Chaque fonction est AUTONOME : Chrome la recopie telle quelle dans la page, sans rien de ce fichier autour. Aucun
 * agent n'envoie jamais de code — c'est ce qui rend la lecture seule infranchissable.
 */

/** Le texte de la page et ses éléments cliquables, numérotés (`data-beluga-repere`). */
export function lireUnePage() {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const nomDe = (el) =>
    (
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      (el.labels && el.labels[0] && el.labels[0].innerText) ||
      el.getAttribute('placeholder') ||
      el.innerText ||
      el.value ||
      el.getAttribute('alt') ||
      el.getAttribute('name') ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
  const roleDe = (el) => {
    const t = el.tagName.toLowerCase();
    if (t === 'a') return 'lien';
    if (t === 'button' || el.getAttribute('role') === 'button') return 'bouton';
    if (t === 'select') return 'liste';
    if (t === 'textarea') return 'zone de texte';
    if (t === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'checkbox') return 'case';
      if (type === 'radio') return 'choix';
      if (type === 'submit' || type === 'button') return 'bouton';
      if (type === 'password') return 'mot de passe';
      if (type === 'file') return 'champ de fichier';
      return 'champ';
    }
    return el.getAttribute('role') || t;
  };
  document.querySelectorAll('[data-beluga-repere]').forEach((el) => el.removeAttribute('data-beluga-repere'));
  const elements = [
    ...document.querySelectorAll('a[href], button, input:not([type=hidden]), textarea, select, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [contenteditable=true], summary'),
  ].filter(visible);
  const reperes = [];
  let n = 1;
  for (const el of elements.slice(0, 250)) {
    el.setAttribute('data-beluga-repere', String(n));
    const role = roleDe(el);
    const nom = role === 'mot de passe' ? (el.getAttribute('aria-label') || el.getAttribute('name') || 'mot de passe') : nomDe(el);
    reperes.push({ n, role, nom });
    n++;
  }
  const texte = (document.body ? document.body.innerText : '').replace(/\n{3,}/g, '\n\n').slice(0, 12000);
  return { texte, reperes };
}

/**
 * LA SOURIS VIRTUELLE DE L'AGENT (décision du 09/11/2026) : une flèche dessinée par-dessus la page, qui glisse
 * jusqu'à chaque cible avant le clic. Elle vit dans un hôte `#beluga-souris` (position fixe, aucun clic reçu,
 * shadow root FERMÉ) : ni la lecture de la page ni `elementFromPoint` ne la voient. Le trajet est calculé par le
 * service worker, qui envoie EN MÊME TEMPS les vrais `mouseMoved` du débogueur sur la même courbe ; ici, on ne fait
 * que le dessiner, image par image (`requestAnimationFrame`). Phases : « montrer » (rend la taille de l'écran),
 * « poser » (x, y), « trajet » (points, durée en ms), « appuyer », « cacher » (le temps d'une capture).
 */
export function poserLaSouris(phase, a, b) {
  const ID = 'beluga-souris';
  let hote = document.getElementById(ID);
  if (!hote) {
    hote = document.createElement('div');
    hote.id = ID;
    hote.setAttribute('aria-hidden', 'true');
    hote.style.cssText =
      'all:initial;position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;display:block;contain:layout style;';
    const ombre = hote.attachShadow({ mode: 'closed' });
    ombre.innerHTML =
      '<style>' +
      '.f{position:absolute;left:0;top:0;width:22px;height:22px;pointer-events:none;will-change:transform;transform-origin:2px 2px;transition:scale .09s ease-out}' +
      '.f.bas{scale:.85}' +
      '.h{position:absolute;left:-14px;top:-14px;width:28px;height:28px;border-radius:50%;background:hsl(262 68% 56% / .45);opacity:0;scale:.3;pointer-events:none}' +
      '.h.on{animation:o .26s ease-out}' +
      '@keyframes o{0%{opacity:1;scale:.3}100%{opacity:0;scale:1.25}}' +
      '</style>' +
      '<div class="f"><div class="h"></div>' +
      '<svg width="22" height="22" viewBox="0 0 22 22" style="filter:drop-shadow(0 1px 1.5px rgb(0 0 0 / .45))">' +
      '<path d="M2 2 L2 18.2 L6.3 14.3 L9.1 20.4 L12 19.1 L9.3 13.1 L15 13.1 Z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/>' +
      '</svg></div>';
    (document.documentElement || document.body).appendChild(hote);
    hote.__f = ombre.querySelector('.f');
    hote.__h = ombre.querySelector('.h');
    hote.__x = Math.round(innerWidth / 2);
    hote.__y = Math.round(innerHeight / 2);
    hote.__f.style.transform = `translate(${hote.__x}px, ${hote.__y}px)`;
  }
  /* Une page qui réécrit son <html> peut nous avoir détaché : on se repose. */
  if (!hote.isConnected) (document.documentElement || document.body).appendChild(hote);
  const f = hote.__f;
  const placer = (x, y) => {
    hote.__x = x;
    hote.__y = y;
    if (f) f.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  };
  if (phase === 'poser' && Number.isFinite(a) && Number.isFinite(b)) placer(a, b);
  else if (phase === 'trajet' && Array.isArray(a) && a.length) {
    const points = a;
    const duree = Math.max(1, Number(b) || 1);
    const debut = performance.now();
    const jeton = (hote.__jeton = (hote.__jeton || 0) + 1);
    const pas = (t) => {
      if (hote.__jeton !== jeton) return;
      const k = Math.min(1, (t - debut) / duree);
      const i = Math.min(points.length - 1, Math.floor(k * (points.length - 1)));
      const j = Math.min(points.length - 1, i + 1);
      const r = k * (points.length - 1) - i;
      placer(points[i][0] + (points[j][0] - points[i][0]) * r, points[i][1] + (points[j][1] - points[i][1]) * r);
      if (k < 1) requestAnimationFrame(pas);
    };
    requestAnimationFrame(pas);
  } else if (phase === 'appuyer') {
    f?.classList.add('bas');
    const h = hote.__h;
    if (h) {
      h.classList.remove('on');
      void h.offsetWidth;
      h.classList.add('on');
    }
    setTimeout(() => f?.classList.remove('bas'), 140);
  } else if (phase === 'cacher') hote.style.display = 'none';
  else if (phase === 'montrer') hote.style.display = 'block';
  return { x: hote.__x, y: hote.__y, w: innerWidth, h: innerHeight, sx: scrollX, sy: scrollY };
}

/**
 * LE DÉPÔT D'UN FICHIER, 1/3 : ce que vise l'agent. Un champ de fichier (ou une étiquette, une zone qui en contient
 * un) → « champ » ; un bouton, un lien, un élément cliquable → « bouton » (il ouvrira la sélection, interceptée) ;
 * le reste → « zone » de dépôt. La cible est marquée `data-beluga-depot` = jeton, pour être retrouvée par le
 * débogueur dans le monde de la page.
 */
export function natureDuDepot(repere, x, y, jeton) {
  document.querySelectorAll('[data-beluga-depot]').forEach((el) => el.removeAttribute('data-beluga-depot'));
  let el = null;
  if (repere !== null && repere !== undefined) el = document.querySelector(`[data-beluga-repere="${repere}"]`);
  else if (x !== null && y !== null) el = document.elementFromPoint(x, y);
  if (!el) return null;
  const estUnChamp = (n) => n && n.tagName === 'INPUT' && (n.getAttribute('type') || '').toLowerCase() === 'file';
  let nature = 'zone';
  let cible = el;
  if (estUnChamp(el)) nature = 'champ';
  else if (el.tagName === 'LABEL' && estUnChamp(el.control)) {
    nature = 'champ';
    cible = el.control;
  } else {
    const dedans = el.querySelectorAll('input[type=file]');
    if (dedans.length === 1) {
      nature = 'champ';
      cible = dedans[0];
    } else if (el.closest('button, a, label, summary, [role=button], [role=menuitem], [role=link], input[type=button], input[type=submit]')) nature = 'bouton';
  }
  cible.setAttribute('data-beluga-depot', jeton);
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect();
  const nom = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return { nature, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), l: Math.round(r.width), h: Math.round(r.height), nom };
}

/**
 * LE DÉPÔT, 2/3 : pose le fichier dans un champ `<input type=file>` (`this`), comme une vraie sélection, puis
 * déclenche input et change. Jouée par le débogueur (`Runtime.callFunctionOn`) dans le MONDE DE LA PAGE : les pages
 * React voient l'événement comme le leur.
 */
export function poserDesFichiers(f) {
  const bin = atob(f.base64);
  const octets = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) octets[i] = bin.charCodeAt(i);
  const fichier = new File([octets], f.nom, { type: f.mime, lastModified: Date.now() });
  const dt = new DataTransfer();
  dt.items.add(fichier);
  this.files = dt.files;
  this.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  this.dispatchEvent(new Event('change', { bubbles: true }));
  return { recu: this.files ? this.files.length : 0, taille: fichier.size };
}

/**
 * LE DÉPÔT, 3/3 : une ZONE de dépôt (`this`) reçoit dragenter, dragover puis drop avec le fichier. Une zone qui
 * n'accepte pas le dépôt (aucun preventDefault) se rabat, si `chercherUnChamp`, sur le SEUL champ de fichier
 * qu'elle ou un proche parent contient.
 */
export function deposerSurUneZone(f, chercherUnChamp) {
  const bin = atob(f.base64);
  const octets = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) octets[i] = bin.charCodeAt(i);
  const fichier = new File([octets], f.nom, { type: f.mime, lastModified: Date.now() });
  const dt = new DataTransfer();
  dt.items.add(fichier);
  const r = this.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const lancer = (type) => {
    const e = new DragEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy, dataTransfer: dt });
    this.dispatchEvent(e);
    return e.defaultPrevented;
  };
  lancer('dragenter');
  lancer('dragover');
  if (lancer('drop')) return { accepte: true, taille: fichier.size };
  /* Jamais plus haut que le corps de la page : un champ de fichier sans rapport ne doit pas recevoir le fichier. */
  let n = chercherUnChamp ? this : null;
  for (let i = 0; i < 3 && n && n !== document.body && n !== document.documentElement; i++, n = n.parentElement) {
    const champs = n.querySelectorAll('input[type=file]');
    const champ = champs.length === 1 ? champs[0] : null;
    if (champ) {
      champ.files = dt.files;
      champ.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      champ.dispatchEvent(new Event('change', { bubbles: true }));
      return { accepte: true, champ: true, taille: fichier.size };
    }
  }
  return { accepte: false, taille: fichier.size };
}

/** Ce qu'un clic ou une touche viserait : son libellé, et s'il soumet un formulaire. */
export function sonderUnElement(repere, x, y, touche) {
  let el = null;
  if (repere !== null && repere !== undefined) el = document.querySelector(`[data-beluga-repere="${repere}"]`);
  else if (x !== null && y !== null) el = document.elementFromPoint(x, y);
  else el = document.activeElement;
  if (!el) return { libelle: '', soumission: false };
  const cible = el.closest('button, a, input, [role=button]') || el;
  const libelle = (cible.getAttribute('aria-label') || cible.innerText || cible.value || cible.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const tag = cible.tagName.toLowerCase();
  const type = (cible.getAttribute('type') || '').toLowerCase();
  const dansUnFormulaire = !!cible.closest('form');
  let soumission = false;
  if (touche === 'Enter') soumission = dansUnFormulaire && !['textarea'].includes(tag);
  else if (tag === 'button') soumission = dansUnFormulaire && (type === '' || type === 'submit');
  else if (tag === 'input') soumission = type === 'submit' || type === 'image';
  return { libelle, soumission };
}

/** Le centre d'un repère, l'élément ramené à l'écran d'abord. */
export function centreDUnRepere(repere) {
  const el = document.querySelector(`[data-beluga-repere="${repere}"]`);
  if (!el) return null;
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect();
  const nom = (el.getAttribute('aria-label') || el.innerText || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  /* l, h : la taille de la cible — la souris vise plus vite une grande cible, et jamais hors de ses bords. */
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), l: Math.round(r.width), h: Math.round(r.height), nom };
}

/** Le curseur dans un champ, vidé si demandé. */
export function focaliserUnRepere(repere, effacer) {
  const el = typeof repere === 'number' ? document.querySelector(`[data-beluga-repere="${repere}"]`) : null;
  if (!el) return false;
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  el.focus();
  if (effacer) {
    if ('value' in el) {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (el.isContentEditable) el.textContent = '';
  }
  return document.activeElement === el || el.contains(document.activeElement);
}

/** Les champs d'une connexion : le mot de passe visible, et l'identifiant qui le précède. */
export function reperesDeConnexion() {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== 'hidden';
  };
  const motDePasse = [...document.querySelectorAll('input[type=password]')].find(visible);
  if (!motDePasse) return null;
  const portee = motDePasse.closest('form') || document;
  const candidats = [...portee.querySelectorAll('input[type=email], input[type=text], input[autocomplete=username], input:not([type])')].filter(visible);
  const identifiant = candidats.filter((el) => el.compareDocumentPosition(motDePasse) & Node.DOCUMENT_POSITION_FOLLOWING).pop() || candidats[0] || null;
  let n = 9000;
  motDePasse.setAttribute('data-beluga-repere', String(n));
  const r = { motDePasse: n };
  if (identifiant) {
    identifiant.setAttribute('data-beluga-repere', String(++n));
    r.identifiant = n;
  }
  return r;
}

/** Un texte est-il affiché ? */
export function texteVisible(cherche) {
  return !!document.body && document.body.innerText.toLowerCase().includes(String(cherche).toLowerCase());
}

/**
 * Retire de la page les cadres posés par un AUTRE module de Chrome (menu de 1Password, LastPass, Bitwarden…).
 * Chrome refuse d'attacher le débogueur à un onglet qui contient une page `chrome-extension://` d'une autre
 * extension (« Cannot access a chrome-extension:// URL of different extension ») : sans ce ménage, un simple
 * menu de remplissage automatique bloque tout clic, toute saisie et toute touche de l'agent. Rend le nombre retiré.
 */
export function retirerLesCadresDAutresExtensions() {
  let retires = 0;
  const etranger = (src) => /^(chrome|moz|safari-web)-extension:\/\//i.test(src || '');
  const parcourir = (racine) => {
    for (const el of racine.querySelectorAll('*')) {
      const nom = el.tagName.toLowerCase();
      if (nom.startsWith('com-1password') || nom.startsWith('onepassword-') || el.hasAttribute('data-lastpass-root') || nom.startsWith('bit-')) {
        el.remove();
        retires += 1;
        continue;
      }
      if ((nom === 'iframe' || nom === 'embed' || nom === 'object') && etranger(el.getAttribute('src') || el.getAttribute('data'))) {
        el.remove();
        retires += 1;
        continue;
      }
      if (el.shadowRoot) parcourir(el.shadowRoot);
    }
  };
  parcourir(document);
  return retires;
}

/**
 * UNE SAISIE SANS LE DÉBOGUEUR, en secours de `Input.insertText`. Quand un gestionnaire de mots de passe (1Password…)
 * pose son menu au moment où le champ prend le focus, Chrome DÉTACHE le débogueur (« Detached while handling
 * command ») : le texte s'écrit alors directement dans le champ, par le setter natif de sa valeur suivi des
 * événements `input` et `change` — ce que React, Vue et les formulaires ordinaires écoutent. Rend vrai si le champ
 * porte bien le texte.
 */
export function saisirSansDebogueur(repere, texte, effacer) {
  const el = typeof repere === 'number' ? document.querySelector(`[data-beluga-repere="${repere}"]`) : document.activeElement;
  if (!el) return false;
  el.focus();
  if (el.isContentEditable) {
    if (effacer) el.textContent = '';
    document.execCommand('insertText', false, texte);
    return true;
  }
  if (!('value' in el)) return false;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  const valeur = (effacer ? '' : el.value) + texte;
  if (setter) setter.call(el, valeur);
  else el.value = valeur;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return el.value === valeur;
}

/**
 * LE DÉPÔT SANS DÉBOGUEUR — repli du geste « deposer » quand le débogueur est lâché ou refusé (menu de 1Password) :
 * pose un fichier dans un champ « fichier », sans boîte de dialogue du système. Les octets viennent du démon (base64) : jamais d'adresse à aller chercher depuis la page, que la politique
 * de contenu d'un site comme facebook.com bloquerait. Jouée dans le monde PRINCIPAL de la page, pour intercepter le
 * sélecteur de fichiers qu'un bouton ouvrirait.
 *
 * Dans l'ordre : le repère EST un champ fichier, ou en contient un ; c'est l'étiquette d'un champ fichier ; c'est un
 * bouton qui ouvre un sélecteur (son `click()` / `showPicker()` est intercepté, la boîte du système ne s'ouvre pas).
 * En dernier recours, le fichier est LÂCHÉ sur l'élément (glisser-déposer), compté seulement si la page l'accepte.
 * Jamais un autre champ de la page. Rend `{ ok, mode, taille }` ou `{ ok: false, raison }`.
 */
export function deposerUneImage(repere, base64, nom, type) {
  const binaire = atob(base64);
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
  const fichier = new File([octets], nom, { type, lastModified: Date.now() });
  const lot = () => {
    const dt = new DataTransfer();
    dt.items.add(fichier);
    return dt;
  };
  const remplir = (champ) => {
    champ.files = lot().files;
    champ.dispatchEvent(new Event('input', { bubbles: true }));
    champ.dispatchEvent(new Event('change', { bubbles: true }));
    return champ.files && champ.files.length === 1;
  };
  const estUnChampFichier = (x) => x instanceof HTMLInputElement && x.type === 'file';
  const el = repere === null || repere === undefined ? null : document.querySelector(`[data-beluga-repere="${repere}"]`);
  if (repere !== null && repere !== undefined && !el) return { ok: false, raison: 'repere' };

  if (el) {
    const direct = estUnChampFichier(el) ? el : el.querySelector('input[type=file]');
    if (direct) return { ok: remplir(direct), mode: 'champ', taille: fichier.size };
    const etiquette = el.closest('label');
    if (etiquette && estUnChampFichier(etiquette.control)) return { ok: remplir(etiquette.control), mode: 'champ', taille: fichier.size };

    /* Le bouton ouvre un sélecteur : on le capte au lieu d'ouvrir la boîte du système. */
    let capte = null;
    const proto = HTMLInputElement.prototype;
    const cliquer = proto.click;
    const montrer = proto.showPicker;
    proto.click = function () {
      if (this.type === 'file') {
        capte = this;
        return;
      }
      return cliquer.call(this);
    };
    if (montrer) {
      proto.showPicker = function () {
        if (this.type === 'file') {
          capte = this;
          return;
        }
        return montrer.call(this);
      };
    }
    try {
      el.click();
    } finally {
      proto.click = cliquer;
      if (montrer) proto.showPicker = montrer;
    }
    if (capte) return { ok: remplir(capte), mode: 'selecteur', taille: fichier.size };
  }

  if (el) {
    const dt = lot();
    let accepte = false;
    for (const genre of ['dragenter', 'dragover', 'drop']) {
      const e = new DragEvent(genre, { bubbles: true, cancelable: true, dataTransfer: dt });
      el.dispatchEvent(e);
      if (genre === 'drop') accepte = e.defaultPrevented;
    }
    if (accepte) return { ok: true, mode: 'glisser', taille: fichier.size };
  }
  return { ok: false, raison: 'aucun-champ' };
}

/**
 * LE CLIC SANS DÉBOGUEUR (Safari, 15/11/2026) : la suite d'événements d'une vraie souris sur l'élément au point donné
 * (pointeur, souris, puis `click()`), le champ visé reçoit le focus. Simulé (`isTrusted` faux) : certains sites
 * l'ignorent, et le démon le dit à l'agent. Rend le nom de l'élément touché, ou `null` si rien n'est là.
 */
export function cliquerSansDebogueur(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const options = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, view: window };
  const pointeur = { ...options, pointerId: 1, pointerType: 'mouse', isPrimary: true };
  el.dispatchEvent(new PointerEvent('pointerover', pointeur));
  el.dispatchEvent(new MouseEvent('mouseover', options));
  el.dispatchEvent(new PointerEvent('pointerdown', { ...pointeur, buttons: 1 }));
  el.dispatchEvent(new MouseEvent('mousedown', { ...options, buttons: 1 }));
  const focalisable = el.closest('input, textarea, select, button, a, [tabindex], [contenteditable=""], [contenteditable="true"]');
  if (focalisable && typeof focalisable.focus === 'function') focalisable.focus();
  el.dispatchEvent(new PointerEvent('pointerup', pointeur));
  el.dispatchEvent(new MouseEvent('mouseup', options));
  if (typeof el.click === 'function') el.click();
  else el.dispatchEvent(new MouseEvent('click', options));
  return (el.getAttribute('aria-label') || el.innerText || el.value || el.tagName || '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

/**
 * LA TOUCHE SANS DÉBOGUEUR (Safari) : `keydown` / `keyup` sur l'élément qui a le focus ; Entrée envoie le formulaire
 * du champ (`requestSubmit`), Tab passe au champ suivant, Retour arrière efface le dernier signe d'un champ. Rend
 * `true` quand la touche a eu un effet connu.
 */
export function frapperSansDebogueur(touche) {
  const NOMS = { Enter: 'Enter', Tab: 'Tab', 'Shift+Tab': 'Tab', Escape: 'Escape', Backspace: 'Backspace', Delete: 'Delete', ArrowDown: 'ArrowDown', ArrowUp: 'ArrowUp', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', PageDown: 'PageDown', PageUp: 'PageUp', Home: 'Home', End: 'End', Space: ' ' };
  const key = NOMS[touche];
  if (!key) return false;
  const el = document.activeElement || document.body;
  const options = { key, code: touche === 'Space' ? 'Space' : key, bubbles: true, cancelable: true, composed: true, shiftKey: touche === 'Shift+Tab' };
  const garde = el.dispatchEvent(new KeyboardEvent('keydown', options));
  el.dispatchEvent(new KeyboardEvent('keyup', options));
  if (!garde) return true;
  if (key === 'Enter') {
    const formulaire = el.closest && el.closest('form');
    if (formulaire && el.tagName !== 'TEXTAREA') {
      if (typeof formulaire.requestSubmit === 'function') formulaire.requestSubmit();
      else formulaire.submit();
      return true;
    }
    if (el.tagName === 'BUTTON' || el.tagName === 'A') {
      el.click();
      return true;
    }
    return false;
  }
  if (key === 'Tab') {
    const champs = [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((n) => !n.disabled && n.offsetParent !== null);
    const i = champs.indexOf(el);
    const suivant = champs[(i + (touche === 'Shift+Tab' ? -1 : 1) + champs.length) % champs.length];
    if (suivant) suivant.focus();
    return !!suivant;
  }
  if (key === 'Backspace' && 'value' in el && typeof el.value === 'string' && el.value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, el.value.slice(0, -1));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  if (key === 'PageDown' || key === 'PageUp' || key === 'Home' || key === 'End') {
    const h = window.innerHeight * 0.85;
    if (key === 'PageDown') window.scrollBy(0, h);
    else if (key === 'PageUp') window.scrollBy(0, -h);
    else window.scrollTo(0, key === 'Home' ? 0 : document.documentElement.scrollHeight);
    return true;
  }
  return true;
}
