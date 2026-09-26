/**
 * LE BURGER DE L'ESPACE ET SON TIROIR.
 *
 * L'entête ne garde que le nom et ce burger : tout le reste vit dans ce tiroir.
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
 * LES COMPTES NE SONT PAS IMPORTÉS ICI. Cet écran sert aussi la porte client,
 * qui n'a rien à charger de la gestion des accès : c'est la vue Haiko qui passe
 * le contenu du tiroir (`comptesDuClient`), et le client n'en voit jamais la
 * ligne. Le serveur, lui, refuse de toute façon toute commande `comptes.*` à un
 * client.
 */
import * as React from 'react';
import { HardDriveDownload, KeyRound, LogOut, Menu, UserRound, UsersRound, X } from 'lucide-react';
import { ActionTiroir, Button, DialogTitle, Drawer, GroupeTiroir, MenuActions, ZoneDefilement } from '@/components/ui';
import { t } from '@/lib/langue';

export function MenuEspace({
  onBackups,
  onAcces,
  onProfil,
  onDeconnexion,
  comptesDuClient,
}: {
  /** Les archives du projet, à télécharger. */
  onBackups?: () => void;
  /** L'espace « Accès » du projet, verrouillé par une prise de responsabilité. */
  onAcces?: () => void;
  /** La porte client seulement : son profil, puis sa déconnexion. */
  onProfil?: () => void;
  /** La porte client seulement : une NAVIGATION vers `/auth/logout`. */
  onDeconnexion?: () => void;
  /** Vu comme Haiko : le contenu du tiroir « Comptes du client ». */
  comptesDuClient?: React.ReactNode;
}) {
  const [comptesOuverts, setComptesOuverts] = React.useState(false);
  return (
    <>
      <MenuActions titre={t('Menu')} repere="espace-menu" icone={<Menu className="h-4 w-4" />}>
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
              {comptesDuClient ? (
                <ActionTiroir
                  icone={<UsersRound className="h-3.5 w-3.5" />}
                  onClick={() => {
                    fermer();
                    setComptesOuverts(true);
                  }}
                  data-ouvrir-comptes-client
                >
                  {t('Comptes du client')}
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

      {comptesDuClient ? (
        <Drawer open={comptesOuverts} onClose={() => setComptesOuverts(false)} className="max-h-[85dvh]">
          <div className="flex min-h-0 flex-1 flex-col" data-tiroir-comptes-client>
            <header className="flex shrink-0 items-center gap-1.5 px-3 pb-2">
              <DialogTitle className="min-w-0 flex-1 truncate">{t('Comptes du client')}</DialogTitle>
              <Button size="icon-sm" variant="ghost" onClick={() => setComptesOuverts(false)} title={t('Fermer')}>
                <X className="h-4 w-4" />
              </Button>
            </header>
            <ZoneDefilement fond="hsl(var(--surface))" className="min-h-0 flex-1 px-3 pb-3">
              {comptesOuverts ? comptesDuClient : null}
            </ZoneDefilement>
          </div>
        </Drawer>
      ) : null}
    </>
  );
}
