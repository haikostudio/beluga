/**
 * LE BURGER DE L'ESPACE ET SON MENU.
 *
 * L'entête ne garde que le nom et ce burger : tout le reste vit dans son menu —
 * un petit menu ancré sous le bouton (`MenuActions`), jamais une page.
 * Les deux écrans du projet — ses BACKUPS et son espace « ACCÈS » —, le PROFIL
 * et la DÉCONNEXION pour la porte client et — vu comme Haiko seulement — les
 * COMPTES DU CLIENT, pour ouvrir, borner, suspendre ou retirer un accès sans
 * passer par les réglages.
 *
 * LES DEMANDES ARCHIVÉES N'Y SONT PLUS : la bascule retournait le tableau
 * ENTIER, et c'est désormais un filtre de CHAQUE COLONNE, à côté du filtre
 * « non lues » (`colonne-demandes.tsx`).
 *
 * LE BURGER NE PORTE PLUS DE PASTILLE. Il comptait les demandes archivées et
 * le volet ouvert ; les archives sont parties dans le filtre des colonnes, et
 * « Accès » comme « Backups » sont maintenant des TIROIRS de l'application —
 * on ne peut plus voir le burger pendant qu'ils sont ouverts, donc plus rien à
 * y compter.
 *
 * LES COMPTES NE SE GÈRENT PLUS ICI (24/11/2026) : l'entrée « Comptes du
 * client » est partie avec toute la gestion des comptes, réunie dans Réglages ›
 * Accès. Le serveur refuse de toute façon toute commande `comptes.*` à un client.
 */
import { HardDriveDownload, KeyRound, LogOut, Menu, UserRound } from '@/components/ui/icones';
import { ActionTiroir, GroupeTiroir, MenuActions } from '@/components/ui';
import { t } from '@/lib/langue';

export function MenuEspace({
  onBackups,
  onAcces,
  onProfil,
  onDeconnexion,
  enPoints = false,
}: {
  /**
   * DANS L'APPLICATION, CE MENU EST UN MENU D'OPTIONS COMME LES AUTRES : trois
   * points verticaux. Le burger y doublait celui de la colonne des projets, à
   * l'autre bout de la même barre. La porte des clients, qui n'a pas d'autre
   * burger, garde le sien.
   */
  enPoints?: boolean;
  /** Les archives du projet, à télécharger. */
  onBackups?: () => void;
  /** L'espace « Accès » du projet, verrouillé par une prise de responsabilité. */
  onAcces?: () => void;
  /** La porte client seulement : son profil, puis sa déconnexion. */
  onProfil?: () => void;
  /** La porte client seulement : une NAVIGATION vers `/auth/logout`. */
  onDeconnexion?: () => void;
}) {
  return (
    <>
      <MenuActions titre={t('Menu')} repere="espace-menu" taille="icon-barre" icone={enPoints ? undefined : <Menu className="h-4 w-4" />}>
        {(fermer) => (
          <>
            <GroupeTiroir titre={t('Ouvrir')}>
              {/* LES REPÈRES DES DEUX ÉCRANS NE CHANGENT PAS : les contrôles les retrouvent ici. */}
              {onBackups ? (
                <ActionTiroir
                  icone={<HardDriveDownload className="h-3.5 w-3.5" />}
                  onClick={() => {
                    onBackups();
                    fermer();
                  }}
                  data-basculer-backups
                >
                  {t('Backups du projet')}
                </ActionTiroir>
              ) : null}
              {onAcces ? (
                <ActionTiroir
                  icone={<KeyRound className="h-3.5 w-3.5" />}
                  onClick={() => {
                    onAcces();
                    fermer();
                  }}
                  data-basculer-acces
                >
                  {t('Accès')}
                </ActionTiroir>
              ) : null}
            </GroupeTiroir>
            {onProfil || onDeconnexion ? (
              <GroupeTiroir titre={t('Session')}>
                {onProfil ? (
                  <ActionTiroir
                    icone={<UserRound className="h-3.5 w-3.5" />}
                    onClick={() => {
                      fermer();
                      onProfil();
                    }}
                    data-ouvrir-profil
                  >
                    {t('Mon profil')}
                  </ActionTiroir>
                ) : null}
                {onDeconnexion ? (
                <ActionTiroir
                  icone={<LogOut className="h-3.5 w-3.5" />}
                  onClick={() => {
                    fermer();
                    onDeconnexion();
                  }}
                  data-se-deconnecter
                >
                  {t('Se déconnecter')}
                </ActionTiroir>
                ) : null}
              </GroupeTiroir>
            ) : null}
          </>
        )}
      </MenuActions>
    </>
  );
}
