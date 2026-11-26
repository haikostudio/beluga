/**
 * LE SIGNALEMENT D'UN ESPACE CLIENT QUI NE SE RELIE PAS.
 *
 * Après 30 s sans liaison, l'écran du client le dit et l'envoie ici, par HTTP
 * (`ROUTE_SIGNALEMENT_DE_BLOCAGE`) : le canal est justement mort. Le démon
 * l'écrit au journal et prévient les ADMINISTRATEURS — jamais le client —
 * d'une alerte du genre « erreur ».
 *
 * Anti-répétition CÔTÉ SERVEUR, pas seulement dans la page : une alerte par
 * compte et par heure (`alerteDeBlocageAutorisee`). Le plafond vit en mémoire :
 * un redémarrage du démon le remet à zéro, ce qui fait au pire une alerte de
 * plus. La route elle-même est derrière le mur d'accès (401 sans session) et
 * réservée au rôle client.
 */
import {
  alerteDeBlocageAutorisee,
  appareilDuNavigateur,
  construireFragment,
  type CompteUtilisateur,
  type SignalementDeBlocage,
} from '@beluga/shared';
import { log } from './logger.js';
import { notify } from './notify.js';
import { getProject } from './store.js';

const dernieresAlertes = new Map<string, number>();

/**
 * Range le signalement : toujours au journal, et une alerte si l'heure écoulée
 * le permet. Rend `true` quand une alerte est partie.
 */
export function signalerUnBlocageDEspace(
  compte: Pick<CompteUtilisateur, 'id' | 'identifiant' | 'nomAffiche' | 'projets'>,
  signalement: SignalementDeBlocage,
  maintenant = Date.now(),
): boolean {
  const { navigateur, systeme } = appareilDuNavigateur(signalement.userAgent);
  const projets = compte.projets.map((id) => getProject(id)?.name).filter(Boolean) as string[];
  const nom = compte.nomAffiche || compte.identifiant;
  const secondes = Math.round(signalement.dureeMs / 1000);
  const ou = signalement.etape === 'connexion' ? 'avant la première liaison' : 'en cours de session';
  log.warn(
    'espace',
    `espace client : liaison bloquée pour ${compte.identifiant} (${ou}, ${secondes} s) · ${navigateur} · ${systeme}`,
  );
  if (!alerteDeBlocageAutorisee(dernieresAlertes.get(compte.id), maintenant)) return false;
  dernieresAlertes.set(compte.id, maintenant);
  const heure = new Date(maintenant).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
  notify({
    motif: 'espace-connexion-bloquee',
    title: 'Espace client bloqué',
    body: `${nom}${projets.length ? ` (${projets.join(', ')})` : ''} n’arrive pas à se relier à son espace depuis ${secondes} s · ${navigateur} sur ${systeme} · ${heure}`,
    reference: `blocage:${compte.id}:${maintenant}`,
    element: nom,
    projectId: compte.projets.length === 1 ? compte.projets[0] : undefined,
    url: `/#${construireFragment({ vue: 'espace', clientId: compte.id })}`,
  });
  return true;
}
