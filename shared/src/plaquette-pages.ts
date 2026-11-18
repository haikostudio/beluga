/**
 * LA MISE EN PAGES DU DOCUMENT — dans le navigateur (carte « Refonte du service Charte graphique », 05/11/2026).
 *
 * `documentDeLaPlaquette` rend une SOURCE : des feuilles déjà à leur taille (`.fixe` : couverture, diapositives) et des
 * sections qui coulent. `paginerLeDocument` les range en FEUILLES AU FORMAT EXACT (`.feuille`), avec l'en-tête et le
 * pied courants et le numéro « n / total ». Le MÊME découpage sert trois fois :
 *   - l'éditeur de Beluga (importé tel quel) ;
 *   - la page du client (recopié dans son script par `String(paginerLeDocument)`) ;
 *   - le PDF (joué par le démon dans le navigateur du serveur avant l'impression).
 * Un commentaire posé « page 3 » chez le client est donc page 3 du PDF et de l'éditeur.
 *
 * CES FONCTIONS SONT AUTONOMES : aucune référence à ce module ni à un autre (elles sont recopiées en texte). Les
 * paramètres sont des nœuds du DOM, typés `any` : `shared` n'embarque pas les types du navigateur.
 *
 * LA COUPE : une section qui ne tient pas se coupe entre ses enfants (le titre ne reste jamais seul en bas de page),
 * un paragraphe trop long se coupe au mot (le blanc retiré est gardé dans `data-coupe`, pour que l'éditeur recolle le
 * texte exact), une capture pleine hauteur (`.tranchable`) se tranche en morceaux d'une feuille. Une section
 * `.insecable` passe entière à la feuille suivante.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Range la source de `racine` (`.pages`) en feuilles. Rend le nombre de feuilles. Rejouable : sans source, ne fait rien. */
export function paginerLeDocument(racine: any): number {
  const doc = racine.ownerDocument;
  const source = racine.querySelector(':scope > .source');
  if (!source) return racine.querySelectorAll(':scope > .feuille').length;
  const ds = racine.dataset || {};
  const feuilles: any[] = [];
  const elements: any[] = Array.from(source.children);
  let zone: any = null;

  const span = (classe: string, texte: string) => {
    const s = doc.createElement('span');
    if (classe) s.className = classe;
    s.textContent = texte;
    return s;
  };
  const nouvelleFeuille = () => {
    const f = doc.createElement('section');
    f.className = 'feuille flux';
    const tete = doc.createElement('header');
    tete.className = 'tete';
    tete.append(span('tete-marque', ds.marque || ''), span('tete-titre', ds.titre || ''));
    const z = doc.createElement('div');
    z.className = 'zone';
    const pied = doc.createElement('footer');
    pied.className = 'pied';
    const num = span('num', '');
    num.setAttribute('data-num', '');
    pied.append(span('', ds.contact || ''), num);
    f.append(tete, z, pied);
    racine.insertBefore(f, source);
    feuilles.push(f);
    return z;
  };
  const echelle = (z: any) => {
    const h = z.offsetHeight;
    return h ? z.getBoundingClientRect().height / h : 1;
  };
  /*
   * UNE RÉSERVE AU-DESSUS DU PIED (carte « Aperçu, chat, Agentik et vraie charte ») : le document se pagine à une
   * échelle, s'affiche à une autre (zoom de l'aperçu, impression) ; un texte peut y gagner une ligne. Douze pixels de
   * marge gardent la dernière ligne et la légende hors du pied de page, quelle que soit l'échelle d'affichage.
   */
  const RESERVE = 12;
  const tient = (z: any) => {
    const dernier = z.lastElementChild;
    if (!dernier) return true;
    return dernier.getBoundingClientRect().bottom <= z.getBoundingClientRect().bottom - RESERVE * echelle(z) + 0.5;
  };
  /** Un bloc plus haut qu'une feuille vide et impossible à couper : ses images rétrécissent (jamais rognées) jusqu'à tenir. */
  const retrecir = (el: any, z: any) => {
    for (let essai = 0; essai < 6 && !tient(z); essai++) {
      const k = echelle(z);
      const trop = (z.lastElementChild.getBoundingClientRect().bottom - z.getBoundingClientRect().bottom) / k + RESERVE + 2;
      const images: any[] = Array.from(el.querySelectorAll('img')).filter((i: any) => i.offsetHeight > 40);
      if (!images.length) return;
      const total = images.reduce((n: number, i: any) => n + i.offsetHeight, 0);
      for (const img of images) {
        const h = img.offsetHeight;
        img.style.maxHeight = `${Math.max(40, Math.floor(h - (trop * h) / total))}px`;
      }
    }
  };
  /* Une légende ne se coupe jamais : elle reste entière, avec ce qu'elle légende. */
  const estTexte = (el: any) => el.matches('p:not(.legende), li') && el.children.length === 0;
  const cassable = (el: any) => el.matches('.section:not(.insecable), .corps, .grille, .annexes-liste, .cote, .ressources-liste, .nuancier, .polices, .liste-sommaire');
  const utile = (el: any): boolean => {
    if (el.matches('.entete')) return false;
    if (el.matches('img, figure, .chiffre, .cadre')) return true;
    if (!el.children.length) return !!(el.textContent || '').trim();
    return Array.from(el.children).some(utile);
  };
  const ajusterLaTranche = (el: any) => {
    const dec = Number(el.dataset.decalage || 0);
    const vue = el.querySelector('.vue');
    const img = vue && vue.querySelector('img');
    if (!img || !dec) return;
    img.style.marginTop = `${-dec}px`;
    vue.style.height = `${Math.max(0, img.offsetHeight - dec)}px`;
  };

  /** Pose dans `parent` tout ce qui tient de `el` ; rend le reste (détaché), ou `null` si tout a tenu. */
  const remplir = (parent: any, el: any, z: any): any => {
    parent.appendChild(el);
    const tranchable = el.classList.contains('tranchable');
    if (tranchable) ajusterLaTranche(el);
    if (tient(z)) return null;
    if (tranchable) {
      const vue = el.querySelector('.vue');
      const img = vue && vue.querySelector('img');
      const k = echelle(z);
      const libre = vue ? (z.getBoundingClientRect().bottom - vue.getBoundingClientRect().top) / k - 4 : 0;
      const deja = Number(el.dataset.decalage || 0);
      if (!img || libre < 140 || img.offsetHeight - deja <= libre) {
        parent.removeChild(el);
        return el;
      }
      const morceau = el.cloneNode(true);
      parent.replaceChild(morceau, el);
      morceau.querySelector('.vue').style.height = `${Math.floor(libre)}px`;
      el.dataset.decalage = String(deja + Math.floor(libre));
      el.classList.add('tranche-suite');
      return el;
    }
    parent.removeChild(el);
    if (estTexte(el)) {
      const texte = el.textContent || '';
      const coupes: [number, number][] = [];
      const re = /\s+/g;
      let m: any;
      while ((m = re.exec(texte))) coupes.push([m.index, m.index + m[0].length]);
      if (!coupes.length) return el;
      const essai = el.cloneNode(false);
      parent.appendChild(essai);
      let bas = 0;
      let haut = coupes.length - 1;
      let meilleur = -1;
      while (bas <= haut) {
        const milieu = (bas + haut) >> 1;
        essai.textContent = texte.slice(0, coupes[milieu]![0]);
        if (tient(z)) {
          meilleur = milieu;
          bas = milieu + 1;
        } else haut = milieu - 1;
      }
      if (meilleur < 0) {
        parent.removeChild(essai);
        return el;
      }
      const [debut, fin] = coupes[meilleur]!;
      essai.textContent = texte.slice(0, debut);
      el.textContent = texte.slice(fin);
      el.setAttribute('data-coupe', texte.slice(debut, fin));
      return el;
    }
    if (!cassable(el)) return el;
    const coque = el.cloneNode(false);
    parent.appendChild(coque);
    let enfant: any;
    while ((enfant = el.firstElementChild)) {
      const reste = remplir(coque, enfant, z);
      if (reste === null) continue;
      el.insertBefore(reste, el.firstChild);
      /* UNE LÉGENDE N'EST JAMAIS ORPHELINE : si elle ne tient pas, ce qu'elle légende part avec elle à la feuille suivante. */
      if (reste.matches('.legende') && coque.lastElementChild && !coque.lastElementChild.matches('.entete')) el.insertBefore(coque.lastElementChild, el.firstChild);
      break;
    }
    if (!Array.from(coque.children).some(utile)) {
      /* Rien d'utile n'a tenu (au plus le titre) : la section passe entière à la feuille suivante. */
      while (coque.lastChild) el.insertBefore(coque.lastChild, el.firstChild);
      parent.removeChild(coque);
      return el;
    }
    if (!el.firstElementChild) return null;
    el.classList.add('suite');
    return el;
  };

  /**
   * UNE FEUILLE FIXE (diapositive) DONT LE CONTENU DÉBORDE de sa zone (au-dessus du pied) : ses images rétrécissent,
   * jamais rognées, jusqu'à ce que titre, image et légende tiennent.
   */
  const ajusterLaFeuilleFixe = (el: any) => {
    const contenu = el.querySelector(':scope > .contenu');
    if (!contenu) return;
    for (let essai = 0; essai < 6; essai++) {
      const enfants: any[] = Array.from(contenu.children);
      if (!enfants.length) return;
      const k = echelle(contenu);
      const haut = Math.min(...enfants.map((e) => e.getBoundingClientRect().top));
      const bas = Math.max(...enfants.map((e) => e.getBoundingClientRect().bottom));
      const trop = (bas - haut - contenu.getBoundingClientRect().height) / k + 6;
      if (trop <= 0) return;
      const images: any[] = Array.from(contenu.querySelectorAll('img')).filter((i: any) => i.offsetHeight > 40);
      if (!images.length) return;
      const plusHaute = Math.max(...images.map((i: any) => i.offsetHeight));
      for (const img of images) img.style.maxHeight = `${Math.max(40, Math.floor(img.offsetHeight - (trop * img.offsetHeight) / plusHaute))}px`;
    }
  };

  for (const el of elements) {
    if (el.classList.contains('fixe')) {
      racine.insertBefore(el, source);
      feuilles.push(el);
      ajusterLaFeuilleFixe(el);
      zone = null;
      continue;
    }
    /* `saut-avant` : la section commence une feuille ; `saut-apres` : rien ne la suit sur sa feuille (le sommaire). */
    if (zone && zone.children.length && el.classList.contains('saut-avant')) zone = null;
    if (!zone) zone = nouvelleFeuille();
    let reste = remplir(zone, el, zone);
    let garde = 0;
    while (reste && garde++ < 400) {
      if (!zone.children.length) {
        /* Plus grand qu'une feuille vide et impossible à couper : il reste là, ses images réduites jusqu'à tenir au-dessus du pied. */
        zone.appendChild(reste);
        retrecir(reste, zone);
        break;
      }
      zone = nouvelleFeuille();
      reste = remplir(zone, reste, zone);
    }
    if (el.classList.contains('saut-apres')) zone = null;
  }
  source.remove();
  feuilles.forEach((f, i) => {
    f.setAttribute('data-page', String(i + 1));
    f.querySelectorAll('[data-num]').forEach((n: any) => {
      n.textContent = `${i + 1} / ${feuilles.length}`;
    });
  });
  /* LA SIGNATURE DE L'AUTEUR (« Réalisé par … ») se pose une fois, en petit, dans le pied de la DERNIÈRE feuille. */
  const derniere = feuilles[feuilles.length - 1];
  const pied = derniere ? derniere.querySelector('footer.pied, .pied-diapo, .bas') : null;
  if (ds.signature && derniere && !derniere.querySelector('.signature-auteur')) {
    const sig = span('signature-auteur', ds.signature);
    /* L'icône du projet signataire, devant son nom (attribut `data-signature-icone` de `.pages`). */
    if (ds.signatureIcone) {
      const icone = doc.createElement('img');
      icone.className = 'icone-auteur';
      icone.setAttribute('src', ds.signatureIcone);
      icone.setAttribute('alt', '');
      sig.insertBefore(icone, sig.firstChild);
    }
    const num = pied ? pied.querySelector('[data-num]') : null;
    if (num) pied.insertBefore(sig, num);
    else if (pied) pied.append(sig);
    else {
      /* Une feuille sans pied (un ancien « appel ») : la signature seule, dans le coin bas. */
      const seule = doc.createElement('footer');
      seule.className = 'signature-seule';
      seule.append(sig);
      derniere.append(seule);
    }
  }
  /* LE SOMMAIRE : chaque ligne reçoit la page où commence sa section, dans CETTE sortie. */
  racine.querySelectorAll('[data-page-de]').forEach((n: any) => {
    const id = n.getAttribute('data-page-de');
    const i = feuilles.findIndex((f: any) => f.getAttribute('data-bloc') === id || !!f.querySelector(`[data-bloc="${String(id).replace(/"/g, '')}"]`));
    n.textContent = i >= 0 ? String(i + 1) : '';
  });
  racine.setAttribute('data-pages', String(feuilles.length));
  return feuilles.length;
}

/** Attend que chaque image du document soit chargée (ou tombée) : la mise en pages mesure leur hauteur. */
export function attendreLesImages(racine: any, delaiMs = 15000): Promise<void> {
  const images: any[] = Array.from(racine.querySelectorAll('img'));
  const une = (img: any) =>
    img.complete
      ? Promise.resolve()
      : new Promise<void>((ok) => {
          img.addEventListener('load', () => ok(), { once: true });
          img.addEventListener('error', () => ok(), { once: true });
        });
  return Promise.race([Promise.all(images.map(une)).then(() => undefined), new Promise<void>((ok) => setTimeout(ok, delaiMs))]);
}

/**
 * LE TEXTE D'UN CHAMP COUPÉ SUR PLUSIEURS FEUILLES, recollé : les morceaux d'un même paragraphe se rejoignent par le
 * blanc retiré à la coupe (`data-coupe`), deux paragraphes par une ligne vide. `morceaux` : les éléments du champ,
 * dans l'ordre du document, avec leur texte lu (`innerText`).
 */
export function recollerLeTexte(morceaux: readonly { para: string; coupe: string | null; texte: string }[]): string {
  let sortie = '';
  let paraPrecedent: string | null = null;
  for (const m of morceaux) {
    const texte = m.texte.replace(/\r\n?/g, '\n').replace(/ /g, ' ');
    if (paraPrecedent === null) sortie = texte;
    else if (m.coupe !== null && m.para === paraPrecedent) sortie += m.coupe + texte;
    else sortie += `\n\n${texte}`;
    paraPrecedent = m.para;
  }
  return sortie.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * OÙ POSER UN FIL DE COMMENTAIRES aujourd'hui, le document ayant pu bouger depuis : `pages[i]` = les sections
 * présentes sur la feuille i + 1. La section du fil fait foi — sur la feuille notée si elle y est encore, sinon sur sa
 * première feuille (`y` vaut alors -1 : « en haut de la section ») ; une section disparue laisse le fil à sa page.
 */
export function ancrerUnFil(fil: { page: number; y: number; bloc?: string | null }, pages: readonly (readonly string[])[]): { page: number; y: number } {
  const total = pages.length;
  if (!total) return { page: 1, y: 0 };
  const page = Math.min(total, Math.max(1, Math.round(fil.page) || 1));
  const y = Math.min(1, Math.max(0, Number(fil.y) || 0));
  if (fil.bloc) {
    if (pages[page - 1]!.includes(fil.bloc)) return { page, y };
    const i = pages.findIndex((b) => b.includes(fil.bloc!));
    if (i >= 0) return { page: i + 1, y: -1 };
  }
  return { page, y };
}
