// Aide commune aux scripts de vérification : note le résultat d'un essai (OK ou ÉCHEC).
export function creerResultats() {
  const results = [];
  function record(name, ok, detail = '') {
    results.push({ name, ok, detail });
    console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${name}${detail ? ` — ${detail}` : ''}`);
  }
  return { results, record };
}
