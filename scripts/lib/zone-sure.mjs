/**
 * LE RELEVÉ DE ZONE SÛRE, ÉCRIT UNE FOIS POUR TOUS LES TIROIRS.
 *
 * Sur un iPhone, le système se réserve deux bandes : en haut la barre d'état
 * (heure, réseau, batterie — 47 à 59 px selon le modèle), en bas la barre
 * d'accueil (34 px). Un panneau qui ignore ces bandes passe DESSOUS : son
 * entête devient illisible, son pied inatteignable. Le navigateur les donne
 * par `env(safe-area-inset-top / -bottom)`.
 *
 * PROBLÈME DU CONTRÔLE : `env()` ne se SIMULE pas. Aucun navigateur de bureau
 * ne permet de poser une zone sûre, et Playwright pas davantage. L'application
 * lit donc ces bandes par DEUX VARIABLES — `--zone-sure-haut` et
 * `--zone-sure-bas` (`web/src/styles.css`) — qui valent `env(…)` en vrai et
 * que le contrôle POSE pour rejouer un iPhone sur un Chrome de serveur.
 *
 * Ce module fait les trois gestes du relevé, au lieu de les recopier script
 * par script :
 *
 *   import { poserZonesSures, relever, formaterReleve } from './lib/zone-sure.mjs';
 *   await poserZonesSures(page, { haut: 59, bas: 34 });
 *   const releve = await relever(page, { reperes: { poignée: '[data-poignee-tiroir]' } });
 *   console.log(formaterReleve(releve));
 *
 * `relever` rend, pour CHAQUE repère nommé, ce qui dépasse en haut et en bas,
 * en pixels : 0 quand le repère tient dans la zone sûre, un nombre positif
 * quand il passe dessous. `debordements(releve)` ne garde que les fautifs.
 */

/** Les deux variables que l'application lit, et que le contrôle pose. */
export const VARIABLE_HAUT = '--zone-sure-haut';
export const VARIABLE_BAS = '--zone-sure-bas';
/** L'encart du système SEUL, sans la marge sous le flou d'iOS : c'est lui que lit la hauteur d'application. */
export const VARIABLE_HAUT_SYSTEME = '--zone-sure-haut-systeme';

/** Les zones sûres des iPhone qu'on rejoue : sans encoche, encoche, Dynamic Island. */
export const ZONES_SURES_TYPES = [
  { nom: 'sans encoche', haut: 0, bas: 0 },
  { nom: 'encoche', haut: 47, bas: 34 },
  { nom: 'Dynamic Island', haut: 59, bas: 34 },
];

/**
 * POSER LES DEUX ZONES SÛRES SUR LA PAGE. Le geste tient après un rechargement
 * (`addInitScript`) : un contrôle qui navigue ne perd pas son décor.
 */
export async function poserZonesSures(page, { haut = 0, bas = 0 } = {}) {
  const poser = ([variableHaut, variableBas, variableSysteme, h, b]) => {
    const racine = document.documentElement;
    /* Un script d'init peut passer avant que le document ait sa racine. */
    if (!racine) return;
    racine.style.setProperty(variableHaut, `${h}px`);
    racine.style.setProperty(variableSysteme, `${h}px`);
    racine.style.setProperty(variableBas, `${b}px`);
    racine.dataset.zoneSureEssai = `${h}/${b}`;
  };
  const arguments_ = [VARIABLE_HAUT, VARIABLE_BAS, VARIABLE_HAUT_SYSTEME, haut, bas];
  await page.addInitScript(poser, arguments_);
  await page.evaluate(poser, arguments_);
  return { haut, bas };
}

/** Retirer le décor : l'application retombe sur `env(…)`, comme en vrai. */
export async function retirerZonesSures(page) {
  await page.evaluate(
    ([variableHaut, variableBas, variableSysteme]) => {
      document.documentElement.style.removeProperty(variableHaut);
      document.documentElement.style.removeProperty(variableSysteme);
      document.documentElement.style.removeProperty(variableBas);
      delete document.documentElement.dataset.zoneSureEssai;
    },
    [VARIABLE_HAUT, VARIABLE_BAS, VARIABLE_HAUT_SYSTEME],
  );
}

/**
 * LE RELEVÉ : où se trouve chaque repère, et de combien il passe sous chaque
 * bord. Un repère absent de la page est rendu `present: false` — c'est au
 * script appelant de dire si son absence est une faute.
 *
 * `reperes` est un objet `{ nom lisible: sélecteur CSS }`.
 */
export async function relever(page, { reperes = {}, haut, bas } = {}) {
  return page.evaluate(
    ([reperes, hautImpose, basImpose, variableHaut, variableBas]) => {
      const lu = (variable, impose) => {
        if (typeof impose === 'number') return impose;
        const valeur = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
        return Number.parseFloat(valeur) || 0;
      };
      const zoneHaut = lu(variableHaut, hautImpose);
      const zoneBas = lu(variableBas, basImpose);
      const hauteur = window.innerHeight;
      const bordBas = hauteur - zoneBas;
      const mesures = {};
      for (const [nom, selecteur] of Object.entries(reperes)) {
        const element = document.querySelector(selecteur);
        if (!element) {
          mesures[nom] = { present: false, selecteur };
          continue;
        }
        const rect = element.getBoundingClientRect();
        /* Un repère invisible (replié, hauteur nulle) ne déborde de rien. */
        const visible = rect.width > 0 && rect.height > 0;
        mesures[nom] = {
          present: true,
          visible,
          selecteur,
          haut: Math.round(rect.top),
          bas: Math.round(rect.bottom),
          hauteur: Math.round(rect.height),
          /* Ce qui passe SOUS la barre d'état : la part du repère au-dessus du bord sûr. */
          debordementHaut: visible ? Math.max(0, Math.round(zoneHaut - rect.top)) : 0,
          /* Ce qui passe SOUS la barre d'accueil : la part sous le bord sûr du bas. */
          debordementBas: visible ? Math.max(0, Math.round(rect.bottom - bordBas)) : 0,
        };
      }
      /* LA HAUTEUR QUE LE TIROIR S'AUTORISE, indépendamment de ce qu'il porte :
         un tiroir au contenu court ne déborde de rien, mais son PLAFOND dit
         s'il passerait sous la barre d'état une fois rempli. */
      const cadre = document.querySelector('[data-tiroir]');
      const plafond = cadre ? Number.parseFloat(getComputedStyle(cadre).maxHeight) || 0 : 0;
      return {
        zoneHaut,
        zoneBas,
        hauteurEcran: hauteur,
        bordBas,
        mesures,
        plafondDuTiroir: Math.round(plafond),
        /* Ce que le plafond laisserait passer sous la barre d'état. */
        plafondDeTrop: Math.max(0, Math.round(plafond - (hauteur - zoneHaut))),
      };
    },
    [reperes, haut, bas, VARIABLE_HAUT, VARIABLE_BAS],
  );
}

/**
 * LES SEULS REPÈRES QUI DÉBORDENT, avec de combien. Vide = tout tient.
 *
 * `cadres` nomme les repères dont seul le BORD DU HAUT compte : le tiroir
 * lui-même est ancré au bas de l'écran et son fond couvre volontiers la barre
 * d'accueil — c'est son CONTENU qui doit s'arrêter au-dessus, pas sa peinture.
 */
export function debordements(releve, { tolerance = 0, cadres = ['tiroir'] } = {}) {
  const fautifs = [];
  for (const [nom, mesure] of Object.entries(releve.mesures)) {
    if (!mesure.present || !mesure.visible) continue;
    if (mesure.debordementHaut > tolerance) fautifs.push({ nom, bord: 'haut', pixels: mesure.debordementHaut });
    if (cadres.includes(nom)) continue;
    if (mesure.debordementBas > tolerance) fautifs.push({ nom, bord: 'bas', pixels: mesure.debordementBas });
  }
  return fautifs;
}

/** Le relevé en une phrase par repère, pour le journal du contrôle. */
export function formaterReleve(releve, titre = '') {
  const lignes = [];
  if (titre) lignes.push(titre);
  lignes.push(
    `    zone sûre : ${releve.zoneHaut} px en haut, ${releve.zoneBas} px en bas — écran ${releve.hauteurEcran} px`,
  );
  lignes.push(
    `    plafond du tiroir : ${releve.plafondDuTiroir} px${releve.plafondDeTrop ? ` — ${releve.plafondDeTrop} px DE TROP` : ''}`,
  );
  for (const [nom, mesure] of Object.entries(releve.mesures)) {
    if (!mesure.present) {
      lignes.push(`    ${nom} : absent (${mesure.selecteur})`);
      continue;
    }
    if (!mesure.visible) {
      lignes.push(`    ${nom} : présent mais replié`);
      continue;
    }
    const dessus = mesure.debordementHaut ? `SOUS LA BARRE D’ÉTAT de ${mesure.debordementHaut} px` : 'sous le bord haut : rien';
    const dessous = mesure.debordementBas ? `SOUS LA BARRE D’ACCUEIL de ${mesure.debordementBas} px` : 'sous le bord bas : rien';
    lignes.push(`    ${nom} : y ${mesure.haut} → ${mesure.bas} — ${dessus}, ${dessous}`);
  }
  return lignes.join('\n');
}

/**
 * LE RELEVÉ D'UN TIROIR, avec les repères communs à TOUS les tiroirs de
 * l'application (`Drawer`, `web/src/components/ui/index.tsx`). Un script y
 * ajoute les siens : `{ ...REPERES_DU_TIROIR, 'barre des étapes': '[data-barre-etapes]' }`.
 */
export const REPERES_DU_TIROIR = {
  tiroir: '[data-tiroir]',
  poignée: '[data-poignee-tiroir]',
};

/**
 * LE CONTRÔLE COMPLET D'UN TIROIR SUR LES DEUX BORDS : on pose la zone sûre,
 * on relève, on note un résultat par bord. `record` est la fonction des
 * scripts (`scripts/lib/verif-resultats.mjs`).
 */
export async function verifierLesDeuxBords(page, { record, reperes, haut, bas, etiquette }) {
  await poserZonesSures(page, { haut, bas });
  await page.waitForTimeout(350);
  const releve = await relever(page, { reperes: { ...REPERES_DU_TIROIR, ...reperes } });
  const fautifs = debordements(releve);
  const enHaut = fautifs.filter((f) => f.bord === 'haut');
  const enBas = fautifs.filter((f) => f.bord === 'bas');
  const dire = (liste) => liste.map((f) => `${f.nom} de ${f.pixels} px`).join(', ');
  record(`${etiquette} : rien ne passe sous la barre d’état`, enHaut.length === 0, dire(enHaut));
  record(`${etiquette} : rien ne passe sous la barre d’accueil`, enBas.length === 0, dire(enBas));
  /* LE PLAFOND COMPTE AUTANT QUE CE QUI EST À L'ÉCRAN : un tiroir au contenu
     court ne déborde de rien aujourd'hui, mais passerait sous la barre d'état
     dès qu'il se remplit. */
  record(
    `${etiquette} : le tiroir ne peut pas monter sous la barre d’état`,
    releve.plafondDeTrop === 0,
    releve.plafondDeTrop ? `plafond de ${releve.plafondDuTiroir} px, soit ${releve.plafondDeTrop} px de trop` : '',
  );
  return releve;
}
