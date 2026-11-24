/**
 * LES CHAMPS DES RÉGLAGES SE VOIENT-ILS ? (carte « Retrouver la gestion des accès clients », 24/11/2026 — champs
 * creusés à la couleur de la page, piste A #696a).
 *
 * À passer tel quel à `page.evaluate(contrasteDesChamps, selecteur)` : la fonction ne capture rien de son module.
 * Pour chaque champ VISIBLE (`.bg-champ`, non désactivé) posé dans un bloc (`[data-bloc-reglages]`, ou un bloc
 * `bg-surface` / `bg-raised`) sous `selecteur`, elle compose le fond du champ et celui du bloc qui le porte (voiles
 * translucides empilés sur le fond opaque le plus proche) et rend leur rapport de luminance — le même calcul que
 * `scripts/verif-contraste-des-blocs.mjs`, seuil 1,07. Elle rend aussi le rapport entre le champ de recherche de la
 * colonne et le fond de la fenêtre : posé à nu, il doit garder son propre gris.
 */
export function contrasteDesChamps(selecteur) {
  const lire = (valeur) => {
    const t = /rgba?\(([^)]+)\)/.exec(valeur || '');
    if (!t) return null;
    const [r, g, b, a = '1'] = t[1].split(/[,/ ]+/).filter(Boolean);
    return { r: +r, g: +g, b: +b, a: +a };
  };
  const poser = (dessus, dessous) => ({
    r: dessus.r * dessus.a + dessous.r * (1 - dessus.a),
    g: dessus.g * dessus.a + dessous.g * (1 - dessus.a),
    b: dessus.b * dessus.a + dessous.b * (1 - dessus.a),
    a: 1,
  });
  const lum = (c) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const rapport = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
    return Math.round(((x + 0.05) / (y + 0.05)) * 1000) / 1000;
  };
  const fondCompose = (element) => {
    const pile = [];
    for (let el = element; el; el = el.parentElement) {
      const c = lire(getComputedStyle(el).backgroundColor);
      if (c && c.a > 0) {
        pile.push(c);
        if (c.a >= 1) break;
      }
    }
    let fond = document.documentElement.classList.contains('dark') ? { r: 0, g: 0, b: 0, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
    for (const c of pile.reverse()) fond = poser(c, fond);
    return fond;
  };
  const visible = (el) => {
    const b = el.getBoundingClientRect();
    if (b.width < 1 || b.height < 1 || b.bottom < 0 || b.top > innerHeight) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
  };
  const racine = document.querySelector(selecteur);
  const champs = [];
  for (const champ of racine ? racine.querySelectorAll('.bg-champ') : []) {
    if (!visible(champ) || champ.disabled || champ.closest('[disabled]')) continue;
    const bloc = champ.parentElement?.closest('[data-bloc-reglages], .bg-surface, .bg-raised');
    if (!bloc || !racine.contains(bloc)) continue;
    const reperes = [...champ.attributes].filter((a) => a.name.startsWith('data-')).map((a) => a.name);
    champs.push({
      champ: `<${champ.tagName.toLowerCase()}${reperes.length ? ' ' + reperes.slice(0, 2).join(' ') : ''}>`,
      rapport: rapport(fondCompose(champ), fondCompose(bloc)),
    });
  }
  const recherche = document.querySelector('[data-modale-reglages] [data-menu-reglages] .bg-champ');
  const fenetre = document.querySelector('[data-modale-reglages]');
  return {
    champs,
    plusFaible: champs.length ? Math.min(...champs.map((c) => c.rapport)) : null,
    recherche: recherche && visible(recherche) && fenetre ? rapport(fondCompose(recherche), fondCompose(fenetre)) : null,
  };
}
