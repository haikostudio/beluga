/**
 * LA LISTE DÉROULANTE DE L'APPLICATION, PILOTÉE PAR UN CONTRÔLE.
 *
 * Elle remplace toute liste native (`<select>`) : `selectOption` n'a plus
 * rien à viser. On ouvre la liste par son déclencheur, puis on clique l'option
 * voulue — posée dans un panneau flottant ancré (ordinateur) ou dans un tiroir
 * qui monte du bas (téléphone), toujours dans `body`, hors du déclencheur.
 * Les options portent `data-liste-option` (ou `data-selecteur-option` pour les
 * écrans qui passaient par l'ancien sélecteur en tiroir).
 */

const OPTION = (valeur) => `[data-liste-option="${valeur}"], [data-selecteur-option="${valeur}"]`;

/** Ouvre la liste et choisit `valeur`. */
export async function choisirDansLaListe(declencheur, valeur) {
  const page = declencheur.page();
  await declencheur.click();
  const option = page.locator(OPTION(valeur)).last();
  await option.waitFor({ state: 'visible', timeout: 8000 });
  await option.click();
  await page.locator(OPTION(valeur)).last().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
}

/** La valeur retenue, lue sur le déclencheur. */
export async function valeurDeLaListe(declencheur) {
  return (await declencheur.getAttribute('data-liste-valeur')) ?? (await declencheur.getAttribute('data-selecteur-valeur')) ?? '';
}

/** Les options de la liste (ouverte puis refermée) : valeur, texte, parent d'arbre, éteinte. */
export async function optionsDeLaListe(declencheur) {
  const page = declencheur.page();
  await declencheur.click();
  const options = page.locator('[data-liste-option], [data-selecteur-option]');
  await options.first().waitFor({ state: 'visible', timeout: 8000 });
  const lues = await options.evaluateAll((noeuds) =>
    noeuds.map((o) => ({
      id: o.getAttribute('data-liste-option') ?? o.getAttribute('data-selecteur-option') ?? '',
      texte: (o.querySelector('span span')?.textContent ?? o.textContent ?? '').replace(/\s+$/, ''),
      parent: o.getAttribute('data-membre-de'),
      eteinte: o.getAttribute('aria-disabled') === 'true',
    })),
  );
  await page.keyboard.press('Escape');
  await options.first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  return lues;
}

/**
 * Liste à CHOIX MULTIPLE : ouvre, filtre éventuellement par `recherche`, coche
 * chaque valeur (la liste reste ouverte entre deux coches), puis referme.
 */
export async function cocherDansLaListe(declencheur, valeurs, { recherche } = {}) {
  const page = declencheur.page();
  await declencheur.click();
  const champ = page.locator('[data-liste-recherche]').last();
  for (const valeur of valeurs) {
    if (recherche !== undefined && (await champ.count())) await champ.fill(recherche);
    const option = page.locator(OPTION(valeur)).last();
    await option.waitFor({ state: 'visible', timeout: 8000 });
    await option.click();
  }
  await page.keyboard.press('Escape');
  await page.locator('[data-liste-option], [data-selecteur-option]').first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
}
