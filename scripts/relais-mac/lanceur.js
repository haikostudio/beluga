// LE LANCEUR DE « Beluga Relais » (20/11/2026, carte « Extension à jour et Jarvis tout en voix »).
//
// C'est LUI que l'installateur compile en application (osacompile, signée ad hoc), et lui seul : il lit `relais.js`
// dans le dossier du relais et le joue. macOS attache les autorisations (Accessibilité, Enregistrement de l'écran) à la
// SIGNATURE de l'application ; comme ce lanceur ne change jamais, le relais peut se remplacer (`se_mettre_a_jour`) sans
// que macOS les oublie. Ne modifier ce fichier qu'en dernier recours : chaque changement les fait redemander.
ObjC.import('Foundation');

function run() {
  const env = $.NSProcessInfo.processInfo.environment.objectForKey('BELUGA_RELAIS_DOSSIER');
  const dossier = (env && !env.isNil() ? env.js : '') || `${$.NSHomeDirectory().js}/Library/Application Support/BelugaRelais`;
  const texte = $.NSString.stringWithContentsOfFileEncodingError(`${dossier}/relais.js`, $.NSUTF8StringEncoding, null);
  if (!texte || texte.isNil()) {
    delay(30);
    return;
  }
  const relais = new Function('LANCEUR', `${texte.js}\n;return run;`)(true);
  return relais();
}
