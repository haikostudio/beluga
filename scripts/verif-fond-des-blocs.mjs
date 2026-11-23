#!/usr/bin/env node
/**
 * LES BLOCS DU FIL PRENNENT LE FOND DE L'ONGLET OUVERT, DANS LES DOUZE PALETTES.
 *
 * Le volet d'une carte porte une barre d'onglets (Conversation, Commentaires,
 * Facturation, GitHub) et, dessous, les blocs du fil : cadrage, analyse,
 * questions. Ces blocs posaient leur propre teinte (`--bloc-etapes`) et se
 * lisaient comme un corps étranger au milieu du volet. Ils suivent désormais la
 * couleur de l'ONGLET ACTIF, refaite à partir des trois fonds réellement
 * empilés — `--surface` (le volet), `--raised` à 35 % (la piste des onglets),
 * `--bg` à 55 % (la pilule de l'onglet retenu).
 *
 * Le contrôle rejoue cet empilement dans un vrai navigateur, palette par
 * palette, et compare la couleur CALCULÉE du bloc à celle de l'onglet actif.
 * Il vérifie aussi le repli : hors du volet (la conversation du chef, qui n'a
 * pas d'onglets), un bloc garde bien `--bloc-etapes`.
 *
 *   HAIKO_BLOCS_URL=http://localhost:7099 node scripts/verif-fond-des-blocs.mjs
 */
const ADRESSE = process.env.HAIKO_BLOCS_URL || 'http://localhost:7099';

/* Les douze palettes : le sombre n'a pas de `data-theme` à lui, le clair se
   reconnaît au retrait de la classe `dark`. */
const PALETTES = [
  { id: 'sombre', sombre: true },
  { id: 'clair', sombre: false },
  { id: 'sable', sombre: false },
  { id: 'ardoise', sombre: true },
  { id: 'givre', sombre: false },
  { id: 'sapin', sombre: true },
  { id: 'contraste', sombre: false },
  { id: 'sable-sombre', sombre: true },
  { id: 'ardoise-clair', sombre: false },
  { id: 'givre-sombre', sombre: true },
  { id: 'sapin-clair', sombre: false },
  { id: 'contraste-sombre', sombre: true },
];

const echecs = [];
const constats = [];

/**
 * Une couleur CSS calculée, ramenée à trois nombres sur 255.
 *
 * Le navigateur rend `rgb(…)` pour une couleur ordinaire, mais
 * `color(srgb 0.04 0.04 0.04)` — en fractions de 1 — dès qu'un `color-mix`
 * est en jeu. Les deux écritures se lisent ici, sinon un mélange passerait
 * pour un noir.
 */
function lire(couleur) {
  const nombres = couleur.match(/[\d.]+/g)?.map(Number) ?? [];
  const fraction = couleur.startsWith('color(');
  const echelle = fraction ? 255 : 1;
  return {
    r: (nombres[0] ?? 0) * echelle,
    v: (nombres[1] ?? 0) * echelle,
    b: (nombres[2] ?? 0) * echelle,
    a: nombres[3] ?? 1,
  };
}

/** Poser une couleur translucide sur un fond déjà peint. */
function poser(dessus, dessous) {
  const a = dessus.a;
  return {
    r: dessus.r * a + dessous.r * (1 - a),
    v: dessus.v * a + dessous.v * (1 - a),
    b: dessus.b * a + dessous.b * (1 - a),
    a: 1,
  };
}

const ecart = (x, y) => Math.max(Math.abs(x.r - y.r), Math.abs(x.v - y.v), Math.abs(x.b - y.b));
const dire = (c) => `rgb(${Math.round(c.r)}, ${Math.round(c.v)}, ${Math.round(c.b)})`;

async function main() {
  const { chromium } = await import('playwright');
  const navigateur = await chromium.launch({ channel: 'chrome' });
  const page = await navigateur.newPage();
  try {
    await page.goto(ADRESSE, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  } catch (err) {
    await navigateur.close();
    console.error(`serveur de développement injoignable sur ${ADRESSE} — ${err.message.split('\n')[0]}`);
    process.exit(1);
  }
  await page.waitForTimeout(2000);

  /* LE TÉMOIN REJOUE LE VOLET, avec les classes exactes de `card-panel.tsx` :
     le fond du volet, la piste de la barre d'onglets, la pilule de l'onglet
     actif, puis un bloc du fil sous la barre. Le dernier témoin est le même
     bloc HORS volet. */
  await page.evaluate(() => {
    const temoin = document.createElement('div');
    temoin.id = 'temoin-blocs';
    temoin.innerHTML =
      '<div data-t="volet" class="bg-surface blocs-au-fond-de-l-onglet">' +
      '  <div data-t="piste" class="bg-raised/35">' +
      /* La pilule de l'onglet retenu s'écrit `data-[state=active]:bg-bg/55` dans
         le volet : c'est CETTE classe-là que Tailwind fabrique, une variante
         écrite autrement n'existerait tout simplement pas dans la feuille. */
      '    <div data-t="onglet" data-state="active" class="data-[state=active]:bg-bg/55">Conversation</div>' +
      '  </div>' +
      '  <div data-t="bloc" class="bg-bloc-fil">Reprise du cadrage</div>' +
      '  <div data-t="voile" class="bg-bloc-fil-voile">Répondre</div>' +
      '</div>' +
      '<div data-t="hors-volet" class="bg-bloc-fil">Cadrage dans la conversation</div>' +
      '<div data-t="etapes" class="bg-bloc-etapes"></div>';
    document.body.append(temoin);
  });

  for (const palette of PALETTES) {
    const mesures = await page.evaluate(
      ({ id, sombre }) => {
        document.documentElement.dataset.theme = id;
        document.documentElement.classList.toggle('dark', sombre);
        const lu = {};
        for (const noeud of document.querySelectorAll('#temoin-blocs [data-t]')) {
          lu[noeud.dataset.t] = getComputedStyle(noeud).backgroundColor;
        }
        return lu;
      },
      palette,
    );

    const volet = lire(mesures.volet);
    const piste = poser(lire(mesures.piste), volet);
    const onglet = poser(lire(mesures.onglet), piste);
    const bloc = lire(mesures.bloc);
    const voile = poser(lire(mesures.voile), volet);

    if (bloc.a < 1) {
      echecs.push(`palette « ${palette.id} » : le bloc du fil n'est pas peint (${mesures.bloc})`);
    } else if (ecart(bloc, onglet) > 1) {
      echecs.push(
        `palette « ${palette.id} » : le bloc du fil (${dire(bloc)}) ne reprend pas le fond de l'onglet actif (${dire(onglet)})`,
      );
    }

    /* La barre d'actions d'une question est à peine translucide : elle doit
       rester à un cheveu de l'onglet, jamais retomber sur le fond du volet. */
    if (ecart(voile, onglet) > 2) {
      echecs.push(
        `palette « ${palette.id} » : la barre d'actions d'une question (${dire(voile)}) s'écarte de l'onglet actif (${dire(onglet)})`,
      );
    }

    /* HORS VOLET, RIEN NE CHANGE : la conversation du chef n'a pas d'onglets,
       le bloc y garde la teinte dédiée des douze palettes. */
    const horsVolet = lire(mesures['hors-volet']);
    const etapes = lire(mesures.etapes);
    if (ecart(horsVolet, etapes) > 1) {
      echecs.push(
        `palette « ${palette.id} » : hors du volet, le bloc (${dire(horsVolet)}) ne garde pas la teinte dédiée (${dire(etapes)})`,
      );
    }
  }

  await navigateur.close();

  if (!echecs.length) {
    constats.push(`les blocs du fil reprennent le fond de l'onglet actif dans les ${PALETTES.length} palettes`);
    constats.push('hors du volet, ces mêmes blocs gardent la teinte dédiée `--bloc-etapes`');
  }
  for (const constat of constats) console.log(`  ✓ ${constat}`);
  for (const echec of echecs) console.log(`  ✗ ${echec}`);
  if (echecs.length) {
    console.log(`\n${echecs.length} refus.`);
    process.exit(1);
  }
  console.log('\nTout est en ordre.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
