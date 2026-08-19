/**
 * LE JOURNAL DES LIVRAISONS, LISIBLE PAR UN VISITEUR.
 *
 * `HISTORIQUE.md` tient déjà la liste, à la racine du dépôt — mais réservé au
 * code source. Cette page publique en rend une lecture soignée, sans jamais
 * toucher au disque : le serveur (`server/src/http.ts`) lit le fichier et
 * confie SON CONTENU à `pageChangelog`, qui ne fait que le mettre en forme.
 * Le fichier réel fait foi ; rien n'est dupliqué ni mis en cache ici.
 */

/** L'adresse publique du changelog. */
export const ROUTE_CHANGELOG = '/changelog';

export interface EntreeChangelog {
  date: string;
  texte: string;
}

/** Le texte qui part dans une page : les chevrons et l'esperluette ne doivent rien ouvrir. */
function echapper(texte: string): string {
  return texte
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Chaque ligne de `HISTORIQUE.md` commence par « - JJ.MM.AAAA : texte ». Une
 * ligne qui ne suit pas ce gabarit (titre, ligne vide, note de tête) est
 * simplement ignorée — le fichier reste écrit à la main, pas généré.
 */
export function parserChangelog(contenu: string): EntreeChangelog[] {
  const entrees: EntreeChangelog[] = [];
  for (const ligne of contenu.split('\n')) {
    const m = /^-\s*(\d{2}\.\d{2}\.\d{4})\s*:\s*(.+)$/.exec(ligne.trim());
    if (m) entrees.push({ date: m[1], texte: m[2].trim() });
  }
  // Le fichier est déjà écrit du plus récent au plus ancien ; on ne change pas l'ordre.
  return entrees;
}

/**
 * La page publique, servie telle quelle par le démon. Volontairement sans
 * script ni dépendance : elle doit rester lisible même dans un lecteur
 * minimal.
 */
export function pageChangelog(contenu: string): string {
  const entrees = parserChangelog(contenu);

  const lignes = entrees
    .map(
      (e) => `<li><time>${echapper(e.date)}</time><p>${echapper(e.texte)}</p></li>`,
    )
    .join('\n');

  const corps = entrees.length
    ? `<ul>\n${lignes}\n</ul>`
    : `<p class="vide">Aucune livraison enregistrée pour l'instant.</p>`;

  return `<!doctype html>
<html lang="fr" class="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#09090b">
<title>Changelog — HaikoDev</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; background:#09090b; color:#fafafa; padding:32px 20px 64px;
         font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; line-height:1.6; }
  main { max-width:720px; margin:0 auto; }
  h1 { font-size:22px; font-weight:600; margin:0 0 6px; letter-spacing:-0.01em; }
  p.sub { color:#a1a1aa; margin:0 0 28px; font-size:14px; }
  p.vide { color:#a1a1aa; font-size:14px; }
  ul { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:2px; }
  li { display:flex; gap:16px; padding:12px 0; border-bottom:1px solid #27272a; }
  li:last-child { border-bottom:0; }
  time { flex:0 0 96px; color:#71717a; font-size:12.5px; font-variant-numeric:tabular-nums; padding-top:2px; }
  li p { margin:0; font-size:14.5px; color:#e4e4e7; }
</style>
</head>
<body>
<main>
  <h1>Changelog</h1>
  <p class="sub">Ce qui a été livré, dans l'ordre — mis à jour à chaque nouvelle entrée.</p>
  ${corps}
</main>
</body>
</html>`;
}
