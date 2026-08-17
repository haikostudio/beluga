/* provisoire — rempli plus bas dans la tâche */
import type { LangueId } from './langues.js';
import type { Dictionnaire } from './traduire.js';
export const TRADUCTIONS: Readonly<Record<LangueId, Dictionnaire>> = { fr: {}, en: {}, es: {}, de: {}, zh: {} };
