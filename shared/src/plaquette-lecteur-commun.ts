/**
 * LE LECTEUR COMMUN DE LA CHARTE GRAPHIQUE (carte « Aperçu, chat, Agentik et vraie charte », 06/11/2026 — décision de
 * l'utilisateur : « la même interface que dans la partie web, un composant à entretenir, avec des options propres à
 * l'admin et d'autres au client »).
 *
 * UN SEUL CODE pour les deux lecteurs : la colonne de MINIATURES (page courante entourée), le bouton « + » qui suit le
 * bord droit de la feuille pour commenter un endroit précis, les BULLES ancrées au bord des feuilles, et la petite
 * fenêtre de discussion EN BULLES (les messages de la personne qui lit à DROITE, ceux de l'autre à GAUCHE ; chacun
 * supprime les siens, la bulle garde la mention « message supprimé »).
 *   - la page du CLIENT (`htmlDuLecteur`) le recopie dans son script par `String(monterLeLecteur)` ;
 *   - l'ÉDITEUR de Beluga l'importe et le monte sur son document (dans une ombre), avec ses propres gestes
 *     (enregistrement, barres de section) posés à côté.
 * Ce qui diffère passe par les OPTIONS : l'accès aux fils (`api` : `fetch` chez le client, le protocole dans Beluga),
 * le prénom demandé ou non, le zoom calculé ici ou par l'éditeur, la largeur des miniatures.
 *
 * CETTE FONCTION EST AUTONOME : aucune référence à un import ni à une variable de module (elle est recopiée en texte).
 * Ce dont elle a besoin d'ailleurs (`ancrerUnFil`) lui est PASSÉ dans ses options. Nœuds typés `any` : `shared`
 * n'embarque pas les types du navigateur. Tout texte venu d'une personne est posé par `textContent`.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** La feuille de style du lecteur : couleurs par variables (`--lx-…`), sombres par défaut, celles de l'application dans Beluga. */
export function cssDuLecteur(couleur: string, sur: string): string {
  return `
  .lx-theme{--lx-fond:#26272b;--lx-barre:#1f2023;--lx-minis:#202124;--lx-texte:#ececef;--lx-doux:#9b9ca4;--lx-fil:#ffffff;--lx-fil-texte:#1d1d21;--lx-fil-doux:#6b6c74;--lx-champ:#f2f2f5;--lx-survol:#f0f0f3;--lx-moi:#1d1d21;--lx-moi-texte:#ffffff;--lx-autre:#efeff2;--lx-autre-texte:#1d1d21;--lx-plus:#ffffff;--lx-plus-texte:#1d1d21;--lx-courante:#ffffff;--lx-danger:#b3261e;--lx-ombre:rgba(0,0,0,.4);--lx-avatar:#dcdce1;--lx-avatar-texte:#1d1d21}
  .lx-mini{display:flex;flex-direction:column;align-items:center;gap:6px;padding:0;border:0;background:none;cursor:pointer;font:inherit}
  .lx-mini-feuille{position:relative;overflow:hidden;border-radius:3px;outline:2px solid transparent;outline-offset:3px;box-shadow:0 4px 14px var(--lx-ombre);pointer-events:none;background:#fff}
  .lx-mini:hover .lx-mini-feuille{outline-color:color-mix(in srgb,var(--lx-courante) 35%,transparent)}
  .lx-mini.courante .lx-mini-feuille{outline-color:var(--lx-courante)}
  .lx-mini-n{font-size:11.5px;color:var(--lx-doux);font-variant-numeric:tabular-nums}
  .lx-mini.courante .lx-mini-n{color:var(--lx-texte)}
  .lx-calque{position:absolute;inset:0;pointer-events:none}
  .lx-plus{position:absolute;display:none;width:34px;height:34px;margin-top:-17px;border:0;border-radius:50%;background:var(--lx-plus);color:var(--lx-plus-texte);box-shadow:0 6px 18px var(--lx-ombre);cursor:pointer;pointer-events:auto;align-items:center;justify-content:center;transition:transform .12s}
  .lx-plus:hover{transform:scale(1.08)}
  .lx-plus.visible{display:flex}
  .lx-bulle{position:absolute;min-width:30px;height:30px;margin-top:-15px;padding:0 9px;border:2px solid #fff;border-radius:15px 15px 15px 3px;background:${couleur};color:${sur};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:4px;cursor:pointer;pointer-events:auto;box-shadow:0 5px 16px var(--lx-ombre)}
  .lx-bulle.resolue{opacity:.55}
  .lx-bulle.non-lue{box-shadow:0 0 0 3px color-mix(in srgb,${couleur} 35%,transparent),0 5px 16px var(--lx-ombre)}
  .lx-bulle.choisie{outline:3px solid color-mix(in srgb,var(--lx-courante) 45%,transparent)}
  .lx-fil{position:absolute;z-index:30;width:340px;max-width:calc(100vw - 24px);background:var(--lx-fil);color:var(--lx-fil-texte);border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.45);pointer-events:auto;display:flex;flex-direction:column;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;text-align:left}
  .lx-fil-tete{display:flex;align-items:center;gap:8px;padding:10px 10px 8px 14px;font-size:12.5px;color:var(--lx-fil-doux)}
  .lx-fil-tete span{flex:1}
  .lx-icone{border:0;background:none;padding:6px;border-radius:8px;cursor:pointer;color:var(--lx-fil-doux);display:inline-flex}
  .lx-icone:hover{background:var(--lx-survol);color:var(--lx-fil-texte)}
  .lx-messages{max-height:320px;overflow-y:auto;padding:2px 12px 4px;display:flex;flex-direction:column;gap:10px;scrollbar-width:thin}
  .lx-message{display:flex;align-items:flex-start;gap:8px;max-width:88%;align-self:flex-start}
  .lx-message.moi{align-self:flex-end}
  .lx-avatar{flex:0 0 26px;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:700;line-height:1;background:var(--lx-avatar,#dcdce1);color:var(--lx-avatar-texte,#1d1d21);user-select:none}
  .lx-avatar.equipe{background:${couleur};color:${sur}}
  .lx-message-corps{display:flex;flex-direction:column;align-items:flex-start;min-width:0}
  .lx-message-auteur{display:flex;gap:6px;align-items:center;min-height:22px;font-size:11.5px;color:var(--lx-fil-doux);padding:2px 4px 0;max-width:100%}
  .lx-message-auteur b{font-weight:600;color:var(--lx-fil-texte);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
  .lx-message-auteur span{flex:0 0 auto}
  .lx-message-texte{padding:8px 12px;border-radius:4px 16px 16px 16px;background:var(--lx-autre);color:var(--lx-autre-texte);white-space:pre-wrap;word-break:break-word;line-height:1.42;font-size:13.5px;min-width:0;max-width:100%}
  .lx-message.moi .lx-message-texte{background:var(--lx-moi);color:var(--lx-moi-texte)}
  .lx-message.supprime .lx-message-texte{background:transparent;color:var(--lx-fil-doux);font-style:italic;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--lx-fil-doux) 35%,transparent)}
  .lx-suppr{flex:0 0 auto;border:0;background:none;padding:3px;margin:-3px 0;border-radius:7px;cursor:pointer;color:var(--lx-fil-doux);display:inline-flex;opacity:0;transition:opacity .12s}
  .lx-message:hover .lx-suppr,.lx-suppr:focus-visible,.lx-suppr.confirmer{opacity:1}
  .lx-suppr:hover{background:var(--lx-survol);color:var(--lx-danger)}
  .lx-suppr.confirmer{color:var(--lx-danger);font-size:12px;font-weight:600;padding:3px 8px}
  @media (pointer:coarse){.lx-suppr{opacity:1}}
  .lx-saisie{padding:10px 12px 12px;display:flex;flex-direction:column;gap:8px}
  .lx-champ{width:100%;border:0;border-radius:10px;background:var(--lx-champ);padding:9px 11px;font:inherit;font-size:14px;color:var(--lx-fil-texte);outline:none;resize:none}
  .lx-champ::placeholder{color:var(--lx-fil-doux)}
  .lx-champ:focus{box-shadow:0 0 0 2px color-mix(in srgb,var(--lx-fil-texte) 20%,transparent)}
  .lx-champ-aide{font-size:11.5px;color:var(--lx-fil-doux);margin-top:-3px}
  .lx-actions{display:flex;align-items:center;gap:8px}
  .lx-actions .lx-lien{border:0;background:none;padding:4px 0;font-size:12.5px;color:var(--lx-fil-doux);cursor:pointer;text-decoration:underline;text-underline-offset:2px}
  .lx-envoyer{margin-left:auto;border:0;border-radius:999px;background:var(--lx-moi);color:var(--lx-moi-texte);padding:8px 16px;font-size:13.5px;font-weight:500;cursor:pointer}
  .lx-envoyer[disabled]{opacity:.45;cursor:default}
  .lx-etat{font-size:12.5px;color:var(--lx-danger)}
  .lx-zoom{position:relative;display:flex;align-items:center;gap:2px;padding:3px;border-radius:10px;background:var(--lx-zoom-fond,#1f2023);color:var(--lx-zoom-texte,#ececef);box-shadow:0 6px 20px var(--lx-ombre);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;pointer-events:auto;user-select:none}
  .lx-zoom-b{height:28px;min-width:28px;padding:0 6px;border:0;background:none;border-radius:7px;cursor:pointer;color:inherit;display:inline-flex;align-items:center;justify-content:center;gap:4px;font-size:12.5px;font-variant-numeric:tabular-nums}
  .lx-zoom-b:hover,.lx-zoom-b[aria-expanded="true"]{background:var(--lx-zoom-survol,rgba(255,255,255,.09))}
  .lx-zoom-b[disabled]{opacity:.4;cursor:default;background:none}
  .lx-zoom-valeur{min-width:68px}
  .lx-zoom-menu{position:absolute;top:calc(100% + 6px);left:50%;transform:translateX(-50%);z-index:40;display:none;flex-direction:column;min-width:170px;padding:4px;border-radius:10px;background:var(--lx-fil);color:var(--lx-fil-texte);box-shadow:0 14px 40px rgba(0,0,0,.35)}
  .lx-zoom-menu.ouvert{display:flex}
  .lx-zoom-option{border:0;background:none;text-align:left;padding:7px 10px;border-radius:7px;cursor:pointer;color:inherit;font-size:13px;font-variant-numeric:tabular-nums}
  .lx-zoom-option:hover{background:var(--lx-survol)}
  .lx-zoom-option.choisie{font-weight:600}
  @media (max-width:760px){.lx-fil{position:fixed;left:8px !important;right:8px;top:auto !important;bottom:8px;width:auto;max-width:none}}`;
}

/**
 * MONTE LE LECTEUR sur un document déjà paginé. Options :
 *  - `racine` (`.pages`), `defile` (la zone qui défile), `conteneur` (la boîte positionnée qui porte les feuilles et le
 *    calque), `calque` (où vivent le « + », les bulles et la fenêtre), `minis` (la colonne des miniatures, ou `null`) ;
 *  - `R` : `{ langue, largeur, hauteur, max, maxNom, prenom (demander le prénom), mini (largeur d'une miniature),
 *    zoomAuto (le lecteur règle lui-même le zoom des feuilles), margeZoom, margePetit, plafond (le zoom « Ajuster »
 *    ne dépasse pas ce plafond) }` ;
 *  - `zoomHote` : où poser la barre du zoom (−, liste, +), ou rien ; `surZoom(z)` : l'éditeur applique lui-même le
 *    zoom (ses écarts entre feuilles en dépendent), sinon le lecteur le pose sur `racine` ;
 *  - `L` : les libellés (langue et tutoiement du document) ;
 *  - `ancrer` : `ancrerUnFil` ; `api` : `charger`, `creer`, `repondre`, `resoudre`, `supprimer`, `lu` (facultatif) —
 *    chacune rend une promesse `{ ok, statut, fil }` (ou la liste des fils pour `charger`).
 * Rend `{ maj(fils), rafraichir(), placer(), ouvrir(id), allerAuFil(id), zoom(), dimensions(l, h), detruire() }`.
 */
export function monterLeLecteur(o: any): any {
  var G: any = globalThis,
    doc = G.document,
    win = G.window;
  var racine = o.racine,
    defile = o.defile,
    conteneur = o.conteneur,
    calque = o.calque,
    minis = o.minis,
    R = o.R,
    L = o.L,
    api = o.api,
    ancrer = o.ancrer;
  var feuilles: any[] = [],
    fils: any[] = [],
    ouvert: any = null,
    plus: any = null,
    courante = 0,
    vivant = true,
    voirResolus = !!R.voirResolus;
  var tactile = !!(win.matchMedia && win.matchMedia('(pointer: coarse)').matches);
  var cle = 'beluga.plaquette.prenom',
    prenom = '';
  try {
    prenom = G.localStorage.getItem(cle) || '';
  } catch (e) {
    /* navigateur sans stockage : le prénom se redemande */
  }
  var ecouteurs: any[] = [];
  function ecouter(cible: any, type: string, f: any, opt?: any) {
    cible.addEventListener(type, f, opt);
    ecouteurs.push([cible, type, f, opt]);
  }
  function el(t: string, c?: string, txt?: any) {
    var n = doc.createElement(t);
    if (c) n.className = c;
    if (txt != null) n.textContent = txt;
    return n;
  }
  function petit() {
    return win.innerWidth <= 760;
  }
  /* Les bulles et le « + » DANS le bord droit de la feuille : sur un petit écran, et dans l'éditeur (`R.dedans`), où
     la feuille prend toute la largeur sans marge (carte « Finitions du lecteur de charte »). */
  function dedans() {
    return petit() || !!R.dedans;
  }
  /*
   * LE ZOOM (carte « Lecteur de charte : commentaires et barre », décision de l'utilisateur : chez l'équipe ET chez le
   * client). « Ajuster » (le défaut) : la feuille prend la largeur de la zone, sous un plafond. Sinon un niveau libre,
   * de 25 % à 400 % : la liste, les boutons − et +, Ctrl/⌘ + molette (et le pincement du pavé tactile), le pincement à
   * deux doigts. Le point sous le pointeur reste sous le pointeur ; le niveau choisi survit à une nouvelle version.
   */
  var NIVEAUX = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4],
    LISTE_DU_ZOOM = [0.5, 0.75, 1, 1.25, 1.5, 2],
    niveau: any = 'ajuster',
    zoomCourant = 1,
    barreZoom: any = null,
    observateurDeTaille: any = null;
  function borner(z: number) {
    return Math.min(4, Math.max(0.25, Math.round(z * 1000) / 1000));
  }
  function ajuste() {
    var marge = petit() ? R.margePetit || 20 : R.margeZoom || 152;
    return Math.min(R.plafond || 1, Math.max(0.2, (defile.clientWidth - marge) / R.largeur));
  }
  function poserZoom(z: number) {
    zoomCourant = z;
    if (o.surZoom) o.surZoom(z);
    else racine.style.zoom = String(z);
  }
  function zoomer() {
    if (!R.zoomAuto) return;
    poserZoom(niveau === 'ajuster' ? ajuste() : niveau);
    placer();
    majBarreZoom();
  }
  /** Un nouveau niveau (`'ajuster'` ou un nombre), centré sur un point de l'écran (le milieu de la zone sinon). */
  function choisirZoom(n: any, px?: number, py?: number) {
    if (!R.zoomAuto) return;
    niveau = n === 'ajuster' ? 'ajuster' : borner(n);
    var z = niveau === 'ajuster' ? ajuste() : niveau;
    var d = defile.getBoundingClientRect(),
      ox = px == null ? defile.clientWidth / 2 : px - d.left,
      oy = py == null ? defile.clientHeight / 2 : py - d.top,
      cx = defile.scrollLeft + ox,
      cy = defile.scrollTop + oy,
      k = z / (zoomCourant || 1);
    poserZoom(z);
    defile.scrollLeft = Math.max(0, cx * k - ox);
    defile.scrollTop = Math.max(0, cy * k - oy);
    placer();
    majBarreZoom();
  }
  function pas(sens: number) {
    var z = zoomCourant,
      cible = sens > 0 ? NIVEAUX.find(function (x: number) { return x > z + 0.001; }) : NIVEAUX.slice().reverse().find(function (x: number) { return x < z - 0.001; });
    choisirZoom(cible == null ? (sens > 0 ? 4 : 0.25) : cible);
  }
  function pourcent(z: number) {
    return Math.round(z * 100) + ' %';
  }
  function majBarreZoom() {
    if (!barreZoom) return;
    barreZoom.__valeur.firstChild.textContent = pourcent(zoomCourant);
    barreZoom.__valeur.title = niveau === 'ajuster' ? L.ajuster : L.zoom;
    barreZoom.__moins.disabled = zoomCourant <= 0.25 + 0.001;
    barreZoom.__plus.disabled = zoomCourant >= 4 - 0.001;
    barreZoom.__menu.querySelectorAll('.lx-zoom-option').forEach(function (b: any) {
      var v = b.getAttribute('data-lx-zoom-option');
      b.classList.toggle('choisie', v === 'ajuster' ? niveau === 'ajuster' : niveau !== 'ajuster' && Math.abs(Number(v) - zoomCourant) < 0.001);
    });
  }
  function fermerMenuZoom() {
    if (!barreZoom) return;
    barreZoom.__menu.classList.remove('ouvert');
    barreZoom.__valeur.setAttribute('aria-expanded', 'false');
  }
  function monterBarreZoom() {
    if (!o.zoomHote || !R.zoomAuto) return;
    var b = el('div', 'lx-zoom');
    b.setAttribute('role', 'toolbar');
    b.setAttribute('aria-label', L.zoom);
    b.setAttribute('data-lx-zoom', '');
    function bouton(classe: string, libelle: string, html: string, f: any) {
      var x: any = el('button', 'lx-zoom-b ' + classe);
      x.type = 'button';
      x.title = libelle;
      x.setAttribute('aria-label', libelle);
      x.innerHTML = html;
      x.addEventListener('click', f);
      return x;
    }
    var moins = bouton('lx-zoom-moins', L.zoomMoins, icone('<path d="M5 12h14"/>', 15), function () {
      pas(-1);
    });
    moins.setAttribute('data-lx-zoom-moins', '');
    var valeur = bouton('lx-zoom-valeur', L.zoom, '<span></span>' + icone('<path d="m6 9 6 6 6-6"/>', 13), function () {
      var ouvert = menu.classList.toggle('ouvert');
      valeur.setAttribute('aria-expanded', ouvert ? 'true' : 'false');
    });
    valeur.setAttribute('aria-haspopup', 'menu');
    valeur.setAttribute('aria-expanded', 'false');
    valeur.setAttribute('data-lx-zoom-valeur', '');
    var plusZ = bouton('lx-zoom-plus', L.zoomPlus, icone('<path d="M12 5v14M5 12h14"/>', 15), function () {
      pas(1);
    });
    plusZ.setAttribute('data-lx-zoom-plus', '');
    var menu = el('div', 'lx-zoom-menu');
    menu.setAttribute('role', 'menu');
    LISTE_DU_ZOOM.map(String)
      .concat(['ajuster'])
      .forEach(function (v: string) {
        var x: any = el('button', 'lx-zoom-option', v === 'ajuster' ? L.ajuster : pourcent(Number(v)));
        x.type = 'button';
        x.setAttribute('role', 'menuitemradio');
        x.setAttribute('data-lx-zoom-option', v);
        x.addEventListener('click', function () {
          fermerMenuZoom();
          choisirZoom(v === 'ajuster' ? 'ajuster' : Number(v));
        });
        menu.appendChild(x);
      });
    b.appendChild(moins);
    b.appendChild(valeur);
    b.appendChild(plusZ);
    b.appendChild(menu);
    b.__valeur = valeur;
    b.__moins = moins;
    b.__plus = plusZ;
    b.__menu = menu;
    o.zoomHote.appendChild(b);
    barreZoom = b;
    ecouter(doc, 'pointerdown', function (ev: any) {
      if (!b.contains(ev.target)) fermerMenuZoom();
    });
  }
  function ecouterLeZoom() {
    if (!R.zoomAuto) return;
    /* Ctrl/⌘ + molette, et le pincement du pavé tactile (que le navigateur rend en molette + Ctrl). */
    ecouter(
      defile,
      'wheel',
      function (ev: any) {
        if (!(ev.ctrlKey || ev.metaKey)) return;
        ev.preventDefault();
        var d = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY;
        choisirZoom(zoomCourant * Math.exp(-Math.max(-60, Math.min(60, d)) * 0.01), ev.clientX, ev.clientY);
      },
      { passive: false },
    );
    /* Le pincement à deux doigts : le niveau suit l'écart des doigts, centré entre eux. */
    var depart: any = null;
    function ecart(t: any) {
      return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1;
    }
    ecouter(
      defile,
      'touchstart',
      function (ev: any) {
        if (ev.touches.length === 2) depart = { d: ecart(ev.touches), z: zoomCourant };
      },
      { passive: true },
    );
    ecouter(
      defile,
      'touchmove',
      function (ev: any) {
        if (!depart || ev.touches.length !== 2) return;
        ev.preventDefault();
        var t = ev.touches;
        choisirZoom((depart.z * ecart(t)) / depart.d, (t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2);
      },
      { passive: false },
    );
    ecouter(defile, 'touchend', function (ev: any) {
      if (ev.touches.length < 2) depart = null;
    });
    /* Safari : son propre zoom de page ne prend pas la main sur le document. */
    ecouter(defile, 'gesturestart', function (ev: any) {
      ev.preventDefault();
    });
  }
  function boite(n: any) {
    var r = n.getBoundingClientRect(),
      c = conteneur.getBoundingClientRect();
    return { top: r.top - c.top, left: r.left - c.left, right: r.right - c.left, bottom: r.bottom - c.top, height: r.height, width: r.width };
  }
  function quand(ms: number) {
    try {
      var s = Math.round((ms - Date.now()) / 1000),
        f = new Intl.RelativeTimeFormat(R.langue, { numeric: 'auto' });
      if (Math.abs(s) < 60) return f.format(0, 'second');
      if (Math.abs(s) < 3600) return f.format(Math.round(s / 60), 'minute');
      if (Math.abs(s) < 86400) return f.format(Math.round(s / 3600), 'hour');
      return new Intl.DateTimeFormat(R.langue, { day: 'numeric', month: 'short' }).format(new Date(ms));
    } catch (e) {
      return '';
    }
  }
  function icone(chemin: string, taille?: number) {
    var t = taille || 16;
    return '<svg width="' + t + '" height="' + t + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + chemin + '</svg>';
  }
  /* ---------------- les miniatures ---------------- */
  function miniatures() {
    if (!minis) return;
    minis.textContent = '';
    var largeurMini = R.mini || 150,
      e = largeurMini / R.largeur;
    feuilles.forEach(function (f: any, i: number) {
      var b = el('button', 'lx-mini');
      (b as any).type = 'button';
      /* LE TITRE DE LA PAGE AU SURVOL (décision de l'utilisateur) : celui de sa section, sinon « Page n ». */
      var titre = titreDeFeuille(f);
      b.setAttribute('aria-label', L.page + ' ' + (i + 1) + (titre ? ' — ' + titre : ''));
      b.title = titre || L.page + ' ' + (i + 1);
      b.setAttribute('data-lx-mini', String(i + 1));
      if (titre) b.setAttribute('data-lx-mini-titre', titre);
      var cadre = el('div', 'lx-mini-feuille');
      cadre.style.width = largeurMini + 'px';
      cadre.style.height = Math.round(R.hauteur * e) + 'px';
      var p = el('div', 'pages');
      (p.style as any).zoom = String(e);
      var copie = f.cloneNode(true);
      /* Une miniature n'est jamais modifiable ni ancrée : on retire repères et champs. */
      copie.querySelectorAll('[contenteditable]').forEach(function (n: any) {
        n.removeAttribute('contenteditable');
      });
      copie.querySelectorAll('[id]').forEach(function (n: any) {
        n.removeAttribute('id');
      });
      p.appendChild(copie);
      cadre.appendChild(p);
      b.appendChild(cadre);
      b.appendChild(el('span', 'lx-mini-n', String(i + 1)));
      b.addEventListener('click', function () {
        aller(f);
      });
      minis.appendChild(b);
    });
    marquer();
  }
  function titreDeFeuille(f: any) {
    var h = f.querySelector('h1,h2,h3');
    var t = h ? String(h.textContent || '').replace(/\s+/g, ' ').trim() : '';
    return t.length > 90 ? t.slice(0, 89) + '…' : t;
  }
  function aller(n: any) {
    if (!n) return;
    var r = n.getBoundingClientRect(),
      d = defile.getBoundingClientRect();
    defile.scrollTo({ top: defile.scrollTop + (r.top - d.top) - 16, behavior: 'smooth' });
  }
  function marquer() {
    if (!minis) return;
    Array.prototype.forEach.call(minis.children, function (b: any, i: number) {
      b.classList.toggle('courante', i === courante);
      if (i === courante && minis.scrollHeight > minis.clientHeight) {
        var r = b.getBoundingClientRect(),
          m = minis.getBoundingClientRect();
        if (r.top < m.top || r.bottom > m.bottom) b.scrollIntoView({ block: 'nearest' });
      }
    });
  }
  function suivre() {
    var milieu = defile.getBoundingClientRect().top + defile.clientHeight * 0.4,
      meilleure = 0;
    feuilles.forEach(function (f: any, i: number) {
      if (f.getBoundingClientRect().top <= milieu) meilleure = i;
    });
    if (meilleure !== courante) {
      courante = meilleure;
      marquer();
    }
  }
  /* ---------------- les bulles ---------------- */
  function blocsDesPages() {
    return feuilles.map(function (f: any) {
      var ids: string[] = [];
      if (f.getAttribute('data-bloc')) ids.push(f.getAttribute('data-bloc'));
      f.querySelectorAll('[data-bloc]').forEach(function (n: any) {
        var i = n.getAttribute('data-bloc');
        if (ids.indexOf(i) < 0) ids.push(i);
      });
      return ids;
    });
  }
  function position(fil: any) {
    var a = ancrer(fil, blocsDesPages()),
      f = feuilles[a.page - 1];
    if (!f) return null;
    var bf = boite(f),
      y;
    if (a.y < 0) {
      var n = f.getAttribute('data-bloc') === fil.bloc ? f : f.querySelector('[data-bloc="' + String(fil.bloc).replace(/"/g, '') + '"]');
      y = n ? boite(n).top + 14 : bf.top + 14;
    } else y = bf.top + a.y * bf.height;
    return { top: y, left: dedans() ? bf.right - 36 : bf.right + 14, page: a.page };
  }
  function initiale(fil: any) {
    var m = fil.messages && fil.messages[0];
    var n = (m && m.auteur) || L.client;
    return String(n).trim().charAt(0).toUpperCase() || '?';
  }
  function placer() {
    if (!vivant) return;
    calque.querySelectorAll('.lx-bulle').forEach(function (b: any) {
      b.remove();
    });
    fils.forEach(function (fil: any) {
      if (fil.resolu && !voirResolus && ouvert !== fil.id) return;
      var p = position(fil);
      if (!p) return;
      var nonLu = fil.messages.some(function (m: any) {
        return m.nonLu;
      });
      var b = el('button', 'lx-bulle' + (ouvert === fil.id ? ' choisie' : '') + (fil.resolu ? ' resolue' : '') + (nonLu ? ' non-lue' : ''));
      (b as any).type = 'button';
      b.style.top = p.top + 'px';
      b.style.left = p.left + 'px';
      b.setAttribute('data-fil', fil.id);
      b.setAttribute('data-plaquette-bulle', fil.id);
      b.setAttribute('aria-label', L.commentaire + ' ' + ((fil.messages[0] && fil.messages[0].auteur) || L.client));
      b.appendChild(el('span', '', initiale(fil)));
      var vivants = fil.messages.filter(function (m: any) {
        return !m.supprime;
      }).length;
      if (vivants > 1) b.appendChild(el('span', '', String(vivants)));
      b.addEventListener('click', function (ev: any) {
        ev.stopPropagation();
        if (ouvert === fil.id) fermer();
        else ouvrirFil(fil.id);
      });
      calque.appendChild(b);
    });
    var f = calque.querySelector('.lx-fil');
    if (f && f.__placer) f.__placer();
  }
  /* ---------------- la fenêtre d'un fil ---------------- */
  function fermer() {
    ouvert = null;
    var f = calque.querySelector('.lx-fil');
    if (f) f.remove();
    placer();
  }
  function poser(fenetre: any, top: number, left: number) {
    fenetre.__placer = function () {
      var w = fenetre.offsetWidth || 340,
        cw = conteneur.clientWidth,
        x = left - w - 12;
      if (x < 8) x = Math.min(cw - w - 8, left + 44);
      fenetre.style.left = Math.max(8, x) + 'px';
      fenetre.style.top = Math.max(8, top - 20) + 'px';
    };
    fenetre.__placer();
  }
  function saisie(enReponse: boolean, surEnvoi: any) {
    var bloc = el('div', 'lx-saisie'),
      nom: any = null;
    if (R.prenom && !prenom) {
      nom = el('input', 'lx-champ');
      nom.placeholder = L.prenom;
      nom.maxLength = R.maxNom;
      nom.setAttribute('aria-label', L.prenom);
      bloc.appendChild(nom);
      bloc.appendChild(el('div', 'lx-champ-aide', L.prenomAide));
    }
    var t: any = el('textarea', 'lx-champ');
    t.rows = enReponse ? 2 : 3;
    t.maxLength = R.max;
    t.placeholder = enReponse ? L.repondre : L.nouveau;
    t.setAttribute('aria-label', enReponse ? L.repondre : L.nouveau);
    t.setAttribute('data-lx-champ', '');
    bloc.appendChild(t);
    var etat = el('div', 'lx-etat');
    var actions = el('div', 'lx-actions'),
      envoyer: any = el('button', 'lx-envoyer', L.envoyer);
    envoyer.type = 'button';
    envoyer.disabled = true;
    envoyer.setAttribute('data-lx-envoyer', '');
    function pret() {
      envoyer.disabled = !t.value.trim() || (nom && !nom.value.trim());
    }
    t.addEventListener('input', function () {
      t.style.height = 'auto';
      t.style.height = Math.min(180, t.scrollHeight) + 'px';
      pret();
    });
    if (nom) nom.addEventListener('input', pret);
    function partir() {
      if (envoyer.disabled) return;
      envoyer.disabled = true;
      etat.textContent = '';
      if (nom) {
        prenom = nom.value.trim().slice(0, R.maxNom);
        try {
          G.localStorage.setItem(cle, prenom);
        } catch (e) {
          /* rien à retenir */
        }
      }
      surEnvoi(t.value.trim(), function (ok: boolean, statut?: number) {
        if (ok) {
          t.value = '';
          if (nom) {
            nom.remove();
            var a = bloc.querySelector('.lx-champ-aide');
            if (a) a.remove();
            nom = null;
          }
        } else etat.textContent = statut === 429 ? L.trop : L.erreur;
        pret();
      });
    }
    envoyer.addEventListener('click', partir);
    t.addEventListener('keydown', function (ev: any) {
      if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
        ev.preventDefault();
        partir();
      }
    });
    actions.appendChild(envoyer);
    bloc.appendChild(etat);
    bloc.appendChild(actions);
    setTimeout(function () {
      if (!tactile) (nom || t).focus();
    }, 0);
    return { noeud: bloc, actions: actions };
  }
  function suite(promesse: any, fin?: any) {
    promesse
      .then(function (r: any) {
        if (!r || !r.ok) {
          if (fin) fin(false, r && r.statut);
          return;
        }
        if (fin) fin(true);
        if (r.fil) majFil(r.fil);
      })
      .catch(function () {
        if (fin) fin(false, 0);
      });
  }
  function majFil(fil: any) {
    var i = fils.findIndex(function (f: any) {
      return f.id === fil.id;
    });
    if (i < 0) fils.push(fil);
    else fils[i] = fil;
    if (ouvert === fil.id || ouvert === 'nouveau') {
      ouvert = fil.id;
      dessinerFil(fil);
    }
    placer();
  }
  function tete(texte: string) {
    var h = el('div', 'lx-fil-tete');
    h.appendChild(el('span', '', texte));
    var x: any = el('button', 'lx-icone');
    x.type = 'button';
    x.setAttribute('aria-label', L.fermer);
    x.title = L.fermer;
    x.innerHTML = icone('<path d="M18 6 6 18M6 6l12 12"/>');
    x.addEventListener('click', fermer);
    h.appendChild(x);
    return h;
  }
  function fenetreVide() {
    var ancienne = calque.querySelector('.lx-fil');
    if (ancienne) ancienne.remove();
    var f = el('div', 'lx-fil');
    f.setAttribute('role', 'dialog');
    f.addEventListener('click', function (ev: any) {
      ev.stopPropagation();
    });
    f.addEventListener('pointerdown', function (ev: any) {
      ev.stopPropagation();
    });
    f.addEventListener('mousemove', function (ev: any) {
      ev.stopPropagation();
    });
    calque.appendChild(f);
    return f;
  }
  /*
   * UN MESSAGE, COMME DANS UNE MESSAGERIE (carte « Lecteur de charte : commentaires et barre », décision de
   * l'utilisateur) : ceux de la personne qui lit à DROITE, ceux des autres à GAUCHE ; pour TOUS, le rond à initiale à
   * gauche de la bulle, puis SOUS la bulle le nom et la date, alignés sur son bord gauche (et la corbeille des siens).
   */
  function message(fil: any, m: any) {
    var d = el('div', 'lx-message' + (m.moi ? ' moi' : '') + (m.supprime ? ' supprime' : ''));
    d.setAttribute('data-plaquette-message', m.role);
    d.setAttribute('data-message', m.id);
    var nom = String(m.auteur || (m.role === 'equipe' ? L.equipe : L.client)).trim();
    var rond = el('div', 'lx-avatar' + (m.role === 'equipe' ? ' equipe' : ''), nom.charAt(0).toUpperCase() || '?');
    rond.setAttribute('aria-hidden', 'true');
    rond.setAttribute('data-lx-avatar', '');
    d.appendChild(rond);
    var corps = el('div', 'lx-message-corps');
    corps.appendChild(el('div', 'lx-message-texte', m.supprime ? L.supprime : m.texte));
    var a = el('div', 'lx-message-auteur');
    a.setAttribute('data-lx-auteur', '');
    a.appendChild(el('b', '', nom));
    var date = el('span', '', quand(m.creeLe));
    try {
      date.title = new Intl.DateTimeFormat(R.langue, { dateStyle: 'long', timeStyle: 'short' }).format(new Date(m.creeLe));
    } catch (e) {
      /* sans date longue */
    }
    a.appendChild(date);
    corps.appendChild(a);
    d.appendChild(corps);
    var ligne = a;
    if (m.moi && !m.supprime) {
      var s: any = el('button', 'lx-suppr');
      s.type = 'button';
      s.title = L.supprimer;
      s.setAttribute('aria-label', L.supprimer);
      s.setAttribute('data-lx-supprimer', m.id);
      s.innerHTML = icone('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>', 14);
      s.addEventListener('click', function () {
        if (!s.classList.contains('confirmer')) {
          s.classList.add('confirmer');
          s.textContent = L.supprimer;
          setTimeout(function () {
            if (s.isConnected && s.classList.contains('confirmer')) {
              s.classList.remove('confirmer');
              s.innerHTML = icone('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>', 14);
            }
          }, 4000);
          return;
        }
        s.disabled = true;
        suite(api.supprimer(fil.id, m.id));
      });
      ligne.appendChild(s);
    }
    return d;
  }
  function dessinerFil(fil: any) {
    var f = fenetreVide(),
      p = position(fil);
    f.setAttribute('data-fil-ouvert', fil.id);
    f.setAttribute('data-plaquette-fil', fil.id);
    f.appendChild(tete(L.page + ' ' + (p ? p.page : ancrer(fil, blocsDesPages()).page) + (fil.resolu ? ' · ' + L.resolu : '')));
    var liste = el('div', 'lx-messages');
    fil.messages.forEach(function (m: any) {
      liste.appendChild(message(fil, m));
    });
    f.appendChild(liste);
    var s = saisie(true, function (texte: string, fin: any) {
      suite(api.repondre(fil.id, { texte: texte, nom: prenom }), fin);
    });
    var r: any = el('button', 'lx-lien', fil.resolu ? L.rouvrir : L.resoudre);
    r.type = 'button';
    r.setAttribute('data-plaquette-resoudre', fil.resolu ? 'rouvrir' : 'resoudre');
    r.addEventListener('click', function () {
      suite(api.resoudre(fil.id, !fil.resolu));
    });
    s.actions.insertBefore(r, s.actions.firstChild);
    f.appendChild(s.noeud);
    if (p) poser(f, p.top, p.left);
    liste.scrollTop = liste.scrollHeight;
    if (api.lu && fil.messages.some(function (m: any) { return m.nonLu; })) api.lu(fil.id);
  }
  function ouvrirFil(id: string) {
    var fil = fils.find(function (x: any) {
      return x.id === id;
    });
    if (!fil) return;
    ouvert = id;
    cacherPlus();
    dessinerFil(fil);
    placer();
  }
  /** Fait défiler jusqu'à la bulle d'un fil, puis l'ouvre (la liste des commentaires du haut de la page). */
  function allerAuFil(id: string) {
    var fil = fils.find(function (x: any) {
      return x.id === id;
    });
    if (!fil) return;
    ouvert = id;
    var p = position(fil);
    if (p) {
      var c = conteneur.getBoundingClientRect(),
        d = defile.getBoundingClientRect();
      defile.scrollTo({ top: Math.max(0, defile.scrollTop + (c.top - d.top) + p.top - defile.clientHeight * 0.3), behavior: 'auto' });
    }
    ouvrirFil(id);
  }
  function nouveau(a: any) {
    ouvert = 'nouveau';
    var f = fenetreVide();
    f.appendChild(tete(L.nouveau));
    var s = saisie(false, function (texte: string, fin: any) {
      suite(api.creer({ texte: texte, nom: prenom, page: a.page, y: a.y, bloc: a.bloc || '' }), fin);
    });
    f.appendChild(s.noeud);
    poser(f, a.top, a.left);
    placer();
  }
  /* ---------------- le « + » qui suit le bord ---------------- */
  function feuilleSous(x: number, y: number) {
    for (var i = 0; i < feuilles.length; i++) {
      var r = feuilles[i].getBoundingClientRect();
      if (y >= r.top && y <= r.bottom && x >= r.left && x <= r.right + (dedans() ? 0 : 70)) return i;
    }
    return -1;
  }
  function blocSous(f: any, y: number) {
    var r = f.getBoundingClientRect(),
      x = r.left + r.width / 2,
      rn = racine.getRootNode ? racine.getRootNode() : doc,
      n = (rn.elementFromPoint ? rn : doc).elementFromPoint(x, y);
    while (n && n !== f && !(n.getAttribute && n.getAttribute('data-bloc'))) n = n.parentNode;
    return n && n.getAttribute ? n.getAttribute('data-bloc') : null;
  }
  function montrerPlus(i: number, y: number) {
    var f = feuilles[i],
      bf = boite(f),
      c = conteneur.getBoundingClientRect(),
      top = Math.min(bf.bottom - 20, Math.max(bf.top + 20, y - c.top)),
      left = dedans() ? bf.right - 44 : bf.right + 12;
    plus.style.top = top + 'px';
    plus.style.left = left + 'px';
    plus.classList.add('visible');
    var r = f.getBoundingClientRect();
    plus.__ancre = { page: i + 1, y: Math.round(((top + c.top - r.top) / r.height) * 10000) / 10000, bloc: blocSous(f, top + c.top), top: top, left: left };
  }
  function cacherPlus() {
    if (plus) plus.classList.remove('visible');
  }
  function horsDuLecteur(t: any) {
    return t && t.closest && (t.closest('.lx-plus,.lx-bulle,.lx-fil') || (o.ignorer && o.ignorer(t)));
  }
  /* ---------------- les liens du sommaire ---------------- */
  function surLien(ev: any) {
    var a = ev.target && ev.target.closest ? ev.target.closest('a[href^="#"]') : null;
    if (!a) return;
    var id = a.getAttribute('href').slice(1),
      rn = racine.getRootNode ? racine.getRootNode() : doc,
      cible = (rn.getElementById ? rn : doc).getElementById(id);
    ev.preventDefault();
    if (cible) aller(cible);
  }
  function demarrer() {
    plus = el('button', 'lx-plus');
    plus.type = 'button';
    plus.setAttribute('aria-label', L.commenter);
    plus.setAttribute('data-lx-plus', '');
    plus.title = L.commenter;
    plus.innerHTML = icone('<path d="M12 5v14M5 12h14"/>', 18);
    plus.addEventListener('click', function (ev: any) {
      ev.stopPropagation();
      var a = plus.__ancre;
      if (a) nouveau(a);
    });
    calque.appendChild(plus);
    ecouter(conteneur, 'mousemove', function (ev: any) {
      if (tactile || ouvert) return;
      if (horsDuLecteur(ev.target)) return;
      var i = feuilleSous(ev.clientX, ev.clientY);
      if (i < 0) cacherPlus();
      else montrerPlus(i, ev.clientY);
    });
    ecouter(conteneur, 'mouseleave', function () {
      if (!ouvert) cacherPlus();
    });
    ecouter(conteneur, 'click', function (ev: any) {
      if (horsDuLecteur(ev.target)) return;
      if (ouvert) {
        fermer();
        return;
      }
      if (tactile && !R.toucherSansPlus) {
        var i = feuilleSous(ev.clientX, ev.clientY);
        if (i < 0) cacherPlus();
        else montrerPlus(i, ev.clientY);
      }
    });
    racine.addEventListener('click', surLien);
    ecouter(doc, 'keydown', function (ev: any) {
      if (ev.key === 'Escape' && ouvert) fermer();
    });
    ecouter(defile, 'scroll', suivre, { passive: true });
    ecouter(win, 'resize', zoomer);
    /* LA ZONE CHANGE DE LARGEUR SANS QUE LA FENÊTRE BOUGE (volet agrandi, volet tiré) : le zoom « Ajuster » suit aussi. */
    if (win.ResizeObserver) {
      observateurDeTaille = new win.ResizeObserver(function () {
        if (vivant) zoomer();
      });
      observateurDeTaille.observe(defile);
    }
    monterBarreZoom();
    ecouterLeZoom();
  }
  /** Relit les feuilles après une nouvelle mise en pages ; `nouvelle` : la racine redessinée (l'éditeur la remplace). */
  function rafraichir(nouvelle?: any) {
    if (nouvelle && nouvelle !== racine) {
      racine.removeEventListener('click', surLien);
      racine = nouvelle;
      racine.addEventListener('click', surLien);
    }
    feuilles = Array.prototype.slice.call(racine.querySelectorAll(':scope > .feuille'));
    miniatures();
    zoomer();
    suivre();
    placer();
    if (ouvert && ouvert !== 'nouveau') {
      var fil = fils.find(function (x: any) {
        return x.id === ouvert;
      });
      if (fil) dessinerFil(fil);
    }
  }
  demarrer();
  rafraichir();
  if (api.charger)
    api
      .charger()
      .then(function (liste: any) {
        if (liste) maj(liste);
      })
      .catch(function () {
        /* sans fils pour l'instant */
      });
  function maj(liste: any[]) {
    fils = liste || [];
    if (ouvert && ouvert !== 'nouveau') {
      var fil = fils.find(function (x: any) {
        return x.id === ouvert;
      });
      var f = calque.querySelector('.lx-fil');
      var enSaisie = f && f.querySelector('textarea') && f.querySelector('textarea').value;
      if (fil && !enSaisie) dessinerFil(fil);
    }
    placer();
  }
  return {
    maj: maj,
    rafraichir: rafraichir,
    placer: placer,
    ouvrir: ouvrirFil,
    allerAuFil: allerAuFil,
    zoom: function () {
      return R.zoomAuto ? (niveau === 'ajuster' ? ajuste() : niveau) : zoomCourant;
    },
    /**
     * LE FORMAT DES FEUILLES A CHANGÉ (A4 portrait, paysage, diapositives) : le zoom « Ajuster » et la hauteur des
     * miniatures se calculent sur la largeur d'UNE feuille — gardée du montage, elle laissait des diapositives
     * mesurées comme des A4 (18/11/2026, capture #6c39). À appeler avant `rafraichir`.
     */
    dimensions: function (largeur: number, hauteur: number) {
      R.largeur = largeur;
      R.hauteur = hauteur;
    },
    resolus: function (v: boolean) {
      voirResolus = v;
      placer();
    },
    enSaisie: function () {
      return ouvert === 'nouveau' || !!(doc.activeElement && doc.activeElement.hasAttribute && doc.activeElement.hasAttribute('data-lx-champ') && doc.activeElement.value);
    },
    detruire: function () {
      vivant = false;
      if (observateurDeTaille) observateurDeTaille.disconnect();
      racine.removeEventListener('click', surLien);
      ecouteurs.forEach(function (e: any) {
        e[0].removeEventListener(e[1], e[2], e[3]);
      });
      calque.querySelectorAll('.lx-bulle,.lx-plus,.lx-fil').forEach(function (n: any) {
        n.remove();
      });
      if (barreZoom) barreZoom.remove();
      if (minis) minis.textContent = '';
    },
  };
}
