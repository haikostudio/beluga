/**
 * L'UTILISATEUR A-T-IL FAIT UN GESTE DEPUIS LE CHARGEMENT DE LA PAGE ? (15/11/2026, carte « Retouches colonne, fil et
 * questions »)
 *
 * Une tâche DÉPLOYÉE reste en gras dans la zone « En cours » de la colonne tant qu'on ne l'a pas OUVERTE
 * (`deployeeNonVue`, shared). Or une publication de Beluga recharge la page : la tâche dont l'adresse était ouverte se
 * remontait seule, et ce remontage valait lecture — elle quittait la zone sans que personne l'ait rouverte. Un écran
 * reposé par le chargement n'est pas une ouverture : tant qu'aucun clic ni aucune touche n'a eu lieu, l'écran ne lit
 * pas une tâche déployée non vue.
 */
let geste = false;

if (typeof window !== 'undefined') {
  const marquer = () => {
    geste = true;
  };
  window.addEventListener('pointerdown', marquer, { once: true, capture: true });
  window.addEventListener('keydown', marquer, { once: true, capture: true });
}

export function unGesteDepuisLeChargement(): boolean {
  return geste;
}
