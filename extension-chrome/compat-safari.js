/**
 * BELUGA DANS SAFARI — la couche « navigateur » (carte « Choisir l'ordinateur visé depuis le téléphone », 15/11/2026).
 *
 * L'extension est LA MÊME pour Chrome et Safari : ce fichier, importé en PREMIER par le service worker, ne fait rien
 * dans Chrome. Dans Safari, qui n'a ni débogueur (`chrome.debugger`), ni groupes d'onglets (`chrome.tabGroups`), ni
 * panneau latéral (`chrome.sidePanel`) — vérifié dans les données de compatibilité MDN —, il pose :
 *  - un débogueur ABSENT qui refuse poliment : le service worker voit `BELUGA_SANS_DEBOGUEUR` et joue clic, frappe et
 *    saisie par les scripts FIXES de `pages.js` (événements simulés), capture par `tabs.captureVisibleTab` ;
 *  - des GROUPES D'ONGLETS TENUS PAR L'EXTENSION (onglet → groupe, gardés en `storage.session`) : chaque agent garde
 *    ses onglets à lui, comme dans Chrome, sans couleur dans la barre ;
 *  - un panneau latéral muet : dans Safari, le panneau s'ouvre en fenêtre de l'icône (`default_popup`).
 * Aucun JavaScript venu d'un agent ne s'exécute nulle part (MEM-7235) : seules les fonctions de `pages.js`.
 */
const api = globalThis.chrome;

export const SAFARI = !api?.debugger;
globalThis.BELUGA_NAVIGATEUR = SAFARI ? 'safari' : 'chrome';
globalThis.BELUGA_SANS_DEBOGUEUR = SAFARI;

if (SAFARI && api) {
  const refus = async () => {
    throw new Error('Safari n’a pas de débogueur : ce geste passe par la page.');
  };
  const ecouteMuette = { addListener() {}, removeListener() {}, hasListener: () => false };
  api.debugger = { attach: refus, detach: async () => {}, sendCommand: refus, onDetach: ecouteMuette, onEvent: ecouteMuette };
  api.sidePanel = { setOptions: async () => {}, open: async () => {}, setPanelBehavior: async () => {} };

  /* LES GROUPES : onglet → groupe, et chaque groupe son titre, sa couleur, sa fenêtre. */
  const CLE = 'groupesSafari';
  let memoire = null;
  const lire = async () => {
    if (memoire) return memoire;
    const { [CLE]: garde } = await api.storage.session.get(CLE).catch(() => ({}));
    memoire = garde ?? { suivant: 1, groupes: {}, onglets: {} };
    return memoire;
  };
  const garder = () => api.storage.session.set({ [CLE]: memoire }).catch(() => {});
  const groupeDe = (m, tabId) => (m.onglets[tabId] !== undefined ? Number(m.onglets[tabId]) : -1);
  const habiller = (m, tab) => (tab ? { ...tab, groupId: groupeDe(m, tab.id) } : tab);

  const getOriginal = api.tabs.get.bind(api.tabs);
  const queryOriginal = api.tabs.query.bind(api.tabs);
  api.tabs.get = async (id) => habiller(await lire(), await getOriginal(id));
  api.tabs.query = async (q = {}) => {
    const m = await lire();
    const { groupId, ...reste } = q;
    const tabs = (await queryOriginal(reste)).map((t) => habiller(m, t));
    return groupId === undefined ? tabs : tabs.filter((t) => t.groupId === groupId);
  };
  api.tabs.group = async ({ tabIds, groupId }) => {
    const m = await lire();
    const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
    let id = Number.isInteger(groupId) && m.groupes[groupId] ? groupId : null;
    if (id === null) {
      id = m.suivant++;
      const premier = await getOriginal(ids[0]).catch(() => null);
      m.groupes[id] = { title: '', color: 'grey', windowId: premier?.windowId ?? -1 };
    }
    for (const t of ids) m.onglets[t] = id;
    await garder();
    return id;
  };
  api.tabGroups = {
    async get(id) {
      const m = await lire();
      const g = m.groupes[id];
      const vivants = Object.entries(m.onglets).filter(([, gid]) => Number(gid) === Number(id));
      if (!g || !vivants.length) throw new Error(`Aucun groupe ${id}.`);
      return { id: Number(id), title: g.title, color: g.color, windowId: g.windowId, collapsed: false };
    },
    async update(id, props) {
      const m = await lire();
      if (!m.groupes[id]) throw new Error(`Aucun groupe ${id}.`);
      Object.assign(m.groupes[id], props ?? {});
      await garder();
      return this.get(id);
    },
    onRemoved: ecouteMuette,
    onUpdated: ecouteMuette,
  };
  api.tabs.onRemoved.addListener(async (tabId) => {
    const m = await lire();
    if (m.onglets[tabId] === undefined) return;
    delete m.onglets[tabId];
    await garder();
  });
}
