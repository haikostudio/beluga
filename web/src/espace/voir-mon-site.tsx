/**
 * « VOIR MON SITE » — LES DEUX VERSIONS DU PROJET, DEPUIS L'ESPACE.
 *
 * Décision de l'utilisateur (cadrage du 24/11/2026, maquettes #bc6c et #f5140) : le client ne doit retenir qu'UNE
 * adresse, celle de son espace. Un seul bouton dans l'entête, qui déroule les deux versions :
 *
 *   - « Site en ligne »      — ce que voient ses visiteurs (`adresseProduction`) ;
 *   - « Version de travail » — les changements à vérifier avant leur mise en ligne (`devUrl`).
 *
 * La version de travail est gardée, mais sa garde reconnaît un client connecté à son espace : le lien suffit, aucun
 * second mot de passe (`server/src/garde-acces.ts`, `/auth/garde/connexion`).
 *
 * UNE SEULE ADRESSE : le bouton l'ouvre directement, sans menu. AUCUNE : rien ne se dessine. Sur téléphone, le bouton
 * se réduit à son icône, et le même menu s'ouvre. Le menu est le `MenuActions` commun (charte, règle 10) : ancré sous
 * son bouton sur ordinateur, panneau du bas sur téléphone.
 */
import * as React from 'react';
import { ArrowUpRight, ChevronDown, FlaskConical, Globe } from '@/components/ui/icones';
import { ActionTiroir, MenuActions, buttonVariants } from '@/components/ui';
import { cn } from '@/lib/utils';
import { t } from '@/lib/langue';
import { useTelephone } from '@/lib/telephone';
import { hoteDuSite, type SitesDuProjet } from '@beluga/shared';

interface EntreeDeSite {
  cle: 'en-ligne' | 'travail';
  adresse: string;
  libelle: string;
  usage: string;
  Icone: typeof Globe;
  repere: Record<string, string>;
}

function entreesDesSites(sites: SitesDuProjet): EntreeDeSite[] {
  const entrees: EntreeDeSite[] = [];
  if (sites.enLigne) {
    entrees.push({
      cle: 'en-ligne',
      adresse: sites.enLigne,
      libelle: t('Site en ligne'),
      usage: t('Ce que voient vos visiteurs.'),
      Icone: Globe,
      repere: { 'data-site-en-ligne': sites.enLigne },
    });
  }
  if (sites.travail) {
    entrees.push({
      cle: 'travail',
      adresse: sites.travail,
      libelle: t('Version de travail'),
      usage: t('À vérifier avant la mise en ligne.'),
      Icone: FlaskConical,
      repere: { 'data-site-de-travail': sites.travail },
    });
  }
  return entrees;
}

export function VoirMonSite({ sites }: { sites: SitesDuProjet }) {
  const telephone = useTelephone();
  const entrees = entreesDesSites(sites);
  if (!entrees.length) return null;
  const libelle = t('Voir mon site');

  /* UNE SEULE VERSION : un lien, rien à choisir. */
  if (entrees.length === 1) {
    const seule = entrees[0]!;
    return (
      <a
        href={seule.adresse}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          buttonVariants({ variant: telephone ? 'ghost' : 'subtle', size: telephone ? 'icon-barre' : 'sm' }),
          'shrink-0 gap-1.5',
        )}
        title={`${seule.libelle} · ${hoteDuSite(seule.adresse)}`}
        aria-label="Voir mon site"
        data-voir-mon-site="lien"
        {...seule.repere}
      >
        <Globe className="h-4 w-4 shrink-0" aria-hidden />
        {telephone ? null : (
          <>
            <span className="whitespace-nowrap">{libelle}</span>
            <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
          </>
        )}
      </a>
    );
  }

  return (
    <span className="inline-flex shrink-0" data-voir-mon-site="menu">
      <MenuActions
        titre={libelle}
        repere="voir-mon-site"
        taille={telephone ? 'icon-barre' : 'sm'}
        /* Sur ordinateur, le bouton porte son nom : un fond plein, sans bordure (charte, règle 15). */
        className={telephone ? undefined : 'gap-1.5 bg-raised text-text hover:bg-fond-survol'}
        icone={
          telephone ? (
            <Globe className="h-4 w-4" />
          ) : (
            <>
              <Globe className="h-4 w-4 shrink-0" aria-hidden />
              <span className="whitespace-nowrap">{libelle}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
            </>
          )
        }
      >
        {(fermer) =>
          entrees.map(({ cle, adresse, libelle: nom, usage, Icone, repere }) => (
            <ActionTiroir
              key={cle}
              icone={<Icone className="mt-0.5 h-4 w-4 shrink-0" />}
              onClick={() => {
                window.open(adresse, '_blank', 'noopener,noreferrer');
                fermer();
              }}
              className="items-start"
              {...repere}
            >
              {/* Trois lignes : le nom, ce qu'on y trouve, puis l'adresse. L'entrée de menu tient chaque ligne sur une
                  seule ligne (`truncate`) : l'usage reste donc COURT, comme sur la maquette #f5140. */}
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-center gap-1 text-text">
                  {nom}
                  <ArrowUpRight className="h-3 w-3 shrink-0 text-faint" aria-hidden />
                </span>
                <span className="text-[12.5px] leading-snug text-muted">{usage}</span>
                <span className="min-w-0 truncate text-[12px] text-faint">{hoteDuSite(adresse)}</span>
              </span>
            </ActionTiroir>
          ))
        }
      </MenuActions>
    </span>
  );
}
