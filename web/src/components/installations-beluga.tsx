import * as React from 'react';
import { CreditCard, Globe, UsersRound } from '@/components/ui/icones';
import {
  usageDUneInstallation,
  type FiltreDePaiement,
  type InstallationRecue,
  type ResumeDesInstallations,
  type TelechargementsDuJour,
  type UsageDUneInstallation,
} from '@beluga/shared';
import { CourbeParJour, Repartition, drapeau, nomDuPays } from '@/components/graphiques-statistiques';
import { usePref } from '@/lib/prefs';
import { Tableau } from '@/components/ui/tableau';
import { formatRegional, t } from '@/lib/langue';
import { cn } from '@/lib/utils';

interface Releve {
  lignes: InstallationRecue[];
  resume: ResumeDesInstallations;
  telechargements: TelechargementsDuJour[];
}

/**
 * LES INSTALLATIONS DE BELUGA BUILD, VUES PAR SON AUTEUR (décision du 20/10/2026).
 *
 * Chaque copie installée depuis le dépôt public se signale une fois par jour
 * (`server/src/relais-installations.ts`) : combien il y en a, d'où, en quelle
 * version, à quelle fréquence elles servent, et l'adresse de qui l'a acceptée.
 * Les téléchargements viennent de GitHub, qui n'en dit ni l'auteur ni le pays.
 * Un filtre sépare les installations payantes (offre hébergée) des open source.
 */
export function InstallationsDeBeluga() {
  const [filtre, setFiltre] = usePref<FiltreDePaiement>('statistiques.installations.paiement', 'tous');
  const [releve, setReleve] = React.useState<Releve | null>(null);
  const [panne, setPanne] = React.useState(false);

  React.useEffect(() => {
    let vivant = true;
    setReleve(null);
    setPanne(false);
    fetch(`/api/relais/installations?filtre=${filtre}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((corps: Releve) => vivant && setReleve(corps))
      .catch(() => vivant && setPanne(true));
    return () => {
      vivant = false;
    };
  }, [filtre]);

  const nomDeLUsage: Record<UsageDUneInstallation, string> = {
    quotidien: t('Chaque jour'),
    hebdomadaire: t('Chaque semaine'),
    occasionnel: t('De temps en temps'),
    eteint: t('Éteintes'),
  };
  const maintenant = Date.now();

  return (
    <div className="space-y-3" data-stats-installations>
      <div role="radiogroup" className="flex flex-wrap gap-1.5" data-installations-filtre={filtre}>
        {(
          [
            { id: 'tous', libelle: t('Toutes'), icone: <UsersRound className="h-3.5 w-3.5" /> },
            { id: 'payants', libelle: t('Payantes'), icone: <CreditCard className="h-3.5 w-3.5" /> },
            { id: 'open-source', libelle: t('Open source'), icone: <Globe className="h-3.5 w-3.5" /> },
          ] as const
        ).map((choix) => (
          <button
            key={choix.id}
            type="button"
            role="radio"
            aria-checked={filtre === choix.id}
            data-installations-filtre-choix={choix.id}
            onClick={() => setFiltre(choix.id)}
            className={cn(
              'flex h-[38px] sm:h-8 items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors',
              filtre === choix.id ? 'bg-raised text-teinte' : 'text-muted hover:bg-raised',
            )}
          >
            {choix.icone}
            {choix.libelle}
          </button>
        ))}
      </div>

      {panne ? (
        <p className="text-[13.5px] text-faint" data-installations-panne>
          {t('Les installations ne se lisent pas pour l’instant.')}
        </p>
      ) : releve === null ? (
        <div className="space-y-3" data-installations-silhouette>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-md bg-bloc" />
            ))}
          </div>
          <div className="h-40 animate-pulse rounded-md bg-bloc" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {(
              [
                ['total', t('Installations'), releve.resume.total],
                ['actives7', t('Actives sur 7 jours'), releve.resume.actives7],
                ['actives30', t('Actives sur 30 jours'), releve.resume.actives30],
                ['nouvelles30', t('Nouvelles sur 30 jours'), releve.resume.nouvelles30],
                ['courriels', t('Adresses partagées'), releve.resume.courriels],
              ] as const
            ).map(([cle, libelle, valeur]) => (
              <div key={cle} className="flex flex-col gap-0.5 rounded-md bg-bloc px-3 py-2.5" data-installations-tuile={cle}>
                <span className="text-[12px] text-faint">{libelle}</span>
                <span className="text-[20px] font-medium text-text">{valeur.toLocaleString(formatRegional())}</span>
              </div>
            ))}
          </div>

          <CourbeParJour
            cle="telechargements"
            titre={t('Téléchargements du dépôt public (GitHub)')}
            barres
            points={releve.telechargements.map((j) => ({ jour: j.jour, valeur: j.clones }))}
          />

          <div className="grid gap-2 sm:grid-cols-3">
            <Repartition
              cle="installations-usage"
              titre={t('Fréquence d’usage')}
              lignes={(Object.keys(nomDeLUsage) as UsageDUneInstallation[]).map((u) => [nomDeLUsage[u], releve.resume.usage[u]])}
            />
            <Repartition
              cle="installations-pays"
              titre={t('Pays')}
              lignes={releve.resume.pays.slice(0, 10).map(({ code, n }) => [`${drapeau(code)} ${nomDuPays(code)}`.trim(), n])}
            />
            <Repartition
              cle="installations-versions"
              titre={t('Versions')}
              lignes={releve.resume.versions.slice(0, 10).map(({ version, n }) => [version, n])}
            />
          </div>

          {releve.lignes.length ? (
            /* LE TABLEAU COMMUN (03/11/2026) : en-tête contrasté, tri et filtre par colonne, pagination. */
            <div className="min-w-0" data-installations-liste>
              <Tableau
                repere="installations"
                lignes={releve.lignes}
                cle={(l) => l.id}
                disposition="auto"
                recherche={t('Filtrer les installations…')}
                attributsLigne={(l) => ({ 'data-installation': l.id, 'data-installation-payante': l.payant ? 'oui' : 'non' })}
                colonnes={[
                  {
                    cle: 'installation',
                    libelle: t('Installation'),
                    valeur: (l) => l.id,
                    rendu: (l) => (
                      <span className="font-mono text-[12px]">
                        {l.id.slice(0, 8)}
                        {l.payant ? <span className="ml-1.5 font-sans text-[11.5px] text-faint">{t('payante')}</span> : null}
                      </span>
                    ),
                  },
                  { cle: 'pays', libelle: t('Pays'), valeur: (l) => (l.pays ? nomDuPays(l.pays) : null), filtre: 'choix', rendu: (l) => (l.pays ? `${drapeau(l.pays)} ${nomDuPays(l.pays)}` : '—') },
                  { cle: 'version', libelle: t('Version'), valeur: (l) => l.version || null, filtre: 'choix', rendu: (l) => <span className="text-muted">{l.version || '—'}</span> },
                  {
                    cle: 'usage',
                    libelle: t('Usage'),
                    valeur: (l) => l.joursActifs30,
                    filtre: 'choix',
                    lireFiltre: (l) => nomDeLUsage[usageDUneInstallation(l, maintenant)],
                    rendu: (l) => (
                      <span className="text-muted">
                        {nomDeLUsage[usageDUneInstallation(l, maintenant)]} · {t('{n} j / 30', { n: String(l.joursActifs30) })}
                      </span>
                    ),
                  },
                  { cle: 'derniere', libelle: t('Dernier signe'), valeur: (l) => l.derniereVue, sensNaturel: 'desc', rendu: (l) => <span className="text-muted">{new Date(l.derniereVue).toLocaleDateString(formatRegional())}</span> },
                  {
                    cle: 'adresse',
                    libelle: t('Adresse'),
                    valeur: (l) => l.courriel ?? null,
                    filtre: 'texte',
                    rendu: (l) => <span data-installation-courriel>{l.courriel ?? <span className="text-faint">{t('non partagée')}</span>}</span>,
                  },
                  { cle: 'tickets', libelle: t('Tickets'), valeur: (l) => l.tickets, droite: true },
                ]}
              />
            </div>
          ) : (
            <p className="text-[13.5px] text-faint" data-installations-vide>
              {t('Aucune installation ne s’est encore signalée.')}
            </p>
          )}
        </>
      )}
    </div>
  );
}
