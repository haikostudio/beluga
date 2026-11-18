import * as React from 'react';
import { Settings2 } from '@/components/ui/icones';
import { type CompteSocial, type ReseauSocial } from '@beluga/shared';
import { Button, CLASSE_GROUPE_DE_LIGNES } from '@/components/ui';
import { CaseACocher } from '@/components/ui/elements-maison';
import { LogoReseau } from '@/components/logos-reseaux';
import { SilhouetteMarketing } from '@/components/silhouettes';
import { PageV2 as PageEnPlace } from './page-v2';
import { Badge2, jouerUnGeste, useLecture } from '@/components/communication-v2/socle/pieces';
import { t } from '@/lib/langue';
import { cn } from '@/lib/utils';
import { useV2 } from './contexte';
import { ChampDeDemande, MotDuChef } from './pieces';

export interface LigneDeCanal {
  reseau: ReseauSocial;
  libelle: string;
  publier: boolean;
  comptes: CompteSocial[];
  choisi: boolean;
  avis: { pertinence: string; raison: string } | null;
  chiffres30j?: { abonnes: number | null; vues: number | null; reactions: number | null } | null;
}

export interface Canaux {
  principal: string | null;
  reseaux: LigneDeCanal[];
}

const rangDuConseil = (l: LigneDeCanal) => (l.avis?.pertinence === 'haute' ? 0 : l.avis?.pertinence === 'moyenne' ? 1 : l.comptes.length ? 2 : l.avis?.pertinence === 'faible' ? 4 : 3);

/**
 * ÉTAPE 1 — LES RÉSEAUX (carte « Réseaux sociaux reliés par Chrome », 09/11/2026) : on CHOISIT, rien de plus. Une case
 * par réseau, les conseillés en tête ; plus aucun bouton « Relier » ni « Créer le compte » ici — la connexion est
 * l'étape 3, après les campagnes, et c'est un agent qui la fait dans Chrome. Un réseau déjà connecté reste coché
 * (son compte porte le choix) ; ses réglages fins s'ouvrent dans « Réglages avancés » (`page-reglages-canaux.tsx`).
 */
export function PageCanaux() {
  const { marque, aller } = useV2();
  const { donnees, erreur } = useLecture<Canaux>({ type: 'communication.canaux', marqueId: marque.id }, [marque.id]);
  /* Le choix se voit DANS le clic ; la relecture qui suit la diffusion le confirme ou le défait. */
  const [poses, setPoses] = React.useState<Record<string, boolean>>({});
  React.useEffect(() => setPoses({}), [donnees]);
  const champ = <ChampDeDemande invite={t('Demander au chef quels réseaux choisir…')} genre="canaux" preparation={t('Le chef étudie vos réseaux…')} repere="canaux" />;
  if (erreur && !donnees) {
    return (
      <PageEnPlace titre={t('Réseaux')} invite={null}>
        <p className="text-[13px] text-danger">{erreur}</p>
      </PageEnPlace>
    );
  }
  if (!donnees) {
    return (
      <PageEnPlace titre={t('Réseaux')} invite={null}>
        <SilhouetteMarketing />
      </PageEnPlace>
    );
  }
  const principal = donnees.principal;
  const choisir = (reseau: ReseauSocial, choisi: boolean) => {
    if (!principal) return;
    setPoses((p) => ({ ...p, [reseau]: choisi }));
    void jouerUnGeste('canal.choisir', `${principal}/${reseau}`, { choisi });
  };
  const lignes = [...donnees.reseaux].filter((r) => r.publier).sort((a, b) => rangDuConseil(a) - rangDuConseil(b));
  const estChoisi = (r: LigneDeCanal) => poses[r.reseau] ?? r.choisi;
  const choisis = lignes.filter(estChoisi).length;
  return (
    <PageEnPlace
      titre={t('Réseaux')}
      sousTitre={choisis ? t('{n} réseau(x) choisi(s)', { n: choisis }) : t('Étape 1 sur 4 · choisissez vos réseaux')}
      droite={
        <Button size="sm" variant="ghost" className="text-muted" onClick={() => aller('canaux', 'reglages')} data-v2-reglages-canaux>
          <Settings2 className="h-3.5 w-3.5" />
          {t('Réglages avancés')}
        </Button>
      }
      pied={champ}
      data-v2-canaux={lignes.length}
    >
      <MotDuChef genres={['canaux']} />
      <p className="text-[13px] text-muted">{t('Cochez les réseaux où la marque doit publier. Rien n’est relié ici : un agent les connectera après vos campagnes.')}</p>
      <ul className={cn(CLASSE_GROUPE_DE_LIGNES, 'min-w-0')} data-v2-liste-canaux>
        {lignes.map((r) => {
          const connecte = r.comptes.some((c) => c.etat === 'relie');
          const choisi = connecte || estChoisi(r);
          const conseille = r.avis?.pertinence === 'haute' || r.avis?.pertinence === 'moyenne';
          return (
            <li key={r.reseau} data-v2-canal={r.reseau} data-etat={connecte ? 'relie' : choisi ? 'choisi' : 'libre'}>
              <label
                className={cn('flex min-w-0 items-center gap-3 rounded-xl px-3.5 py-3 transition-colors', connecte ? 'cursor-default' : 'cursor-pointer hover:bg-raised')}
                title={connecte ? t('Déjà connecté : le réseau reste choisi.') : undefined}
              >
                <CaseACocher checked={choisi} disabled={connecte || !principal} onCheckedChange={(oui) => choisir(r.reseau, oui === true)} aria-label={r.libelle} data-v2-choisir={r.reseau} />
                <LogoReseau reseau={r.reseau} className="h-5 w-5 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <b className="truncate text-[13.5px] font-semibold text-text">{r.libelle}</b>
                    {connecte ? <Badge2 ton="vert">{t('Connecté')}</Badge2> : conseille ? <Badge2 ton="neutre">{r.avis?.pertinence === 'haute' ? t('Conseillé') : t('Utile')}</Badge2> : null}
                  </span>
                  <span className="line-clamp-2 block text-[12px] leading-snug text-muted">{r.avis?.raison ?? t('Publication possible depuis Beluga')}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </PageEnPlace>
  );
}
