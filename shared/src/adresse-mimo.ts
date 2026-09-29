/**
 * L'ADRESSE XIAOMI MIMO D'UNE CLÉ.
 *
 * Xiaomi sert deux sortes de clés, sur deux adresses qui ne se reconnaissent
 * pas l'une l'autre (éprouvé le 28/09/2026) :
 * - la clé payée À L'USAGE, « sk-… », répond sur `api.xiaomimimo.com` ;
 * - la clé d'ABONNEMENT mensuel (« Token Plan »), « tp-… », ne répond QUE sur
 *   `token-plan-sgp.xiaomimimo.com` — 401 « Invalid API Key » partout ailleurs
 *   (api, token-plan-cn, token-plan-ams).
 * Viser la mauvaise adresse fait dire « clé refusée par Xiaomi » à une clé
 * parfaitement valable.
 */

export const API_MIMO_USAGE = 'https://api.xiaomimimo.com';
export const API_MIMO_ABONNEMENT = 'https://token-plan-sgp.xiaomimimo.com';

/** Les adresses Xiaomi connues : un tour MiMo ne part que vers l'une d'elles. */
export const ADRESSES_MIMO = [API_MIMO_USAGE, API_MIMO_ABONNEMENT] as const;

/** Une clé d'abonnement « Token Plan » (préfixe `tp-`). */
export function estUneCleMimoAbonnement(cle: string): boolean {
  return /^tp-/i.test(cle.trim());
}

/** L'adresse que la FORME de la clé désigne. */
export function adresseMimoPourCle(cle: string): string {
  return estUneCleMimoAbonnement(cle) ? API_MIMO_ABONNEMENT : API_MIMO_USAGE;
}

/**
 * Les adresses à essayer, dans l'ordre : celle que la clé désigne, puis
 * l'autre — le repli couvre une clé dont Xiaomi changerait la forme.
 */
export function adressesMimoAEssayer(cle: string): string[] {
  const premiere = adresseMimoPourCle(cle);
  return [premiere, ...ADRESSES_MIMO.filter((a) => a !== premiere)];
}

/** Une adresse de tour (`ANTHROPIC_BASE_URL`) qui vise bien Xiaomi. */
export function estUneAdresseMimo(adresse: string): boolean {
  return ADRESSES_MIMO.some((base) => adresse === base || adresse.startsWith(`${base}/`));
}

/** Le forfait affiché d'un compte MiMo, selon sa clé. */
export function forfaitMimo(cle: string): string {
  return estUneCleMimoAbonnement(cle) ? 'Abonnement (Token Plan)' : "À l'usage";
}
