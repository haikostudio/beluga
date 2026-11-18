/**
 * LES FICHIERS CITÉS PAR L'AGENT S'OUVRENT DANS LA VISIONNEUSE.
 *
 * Décision de l'utilisateur (carte « Aperçu des PDF et des liens ») : un
 * chemin de fichier écrit par l'agent — `code` ou lien de sa réponse, champ
 * « Chemin » d'une étape — se clique et s'ouvre dans LA visionneuse des pièces
 * jointes (`AttachmentPreview`). Les liens vers des sites restent en nouvel
 * onglet.
 *
 * Le fil pose UN fournisseur (`FichiersCites`) qui connaît le projet et
 * l'agent ; chaque chemin reconnu (`cheminDeFichierCite`, règle partagée) se
 * rend par `CheminCliquable`. Sans fournisseur (un Markdown hors d'un fil),
 * rien ne devient cliquable.
 *
 * Le clic ne crée AUCUNE pièce jointe : la fiche du fichier (type, poids) est
 * demandée à la route en lecture seule, puis la visionneuse s'ouvre sur une
 * pièce de circonstance qui se lit par son adresse. Un fichier qui ne s'ouvre
 * pas ouvre la même fenêtre, qui dit la VRAIE raison (le motif de la route). Chaque
 * clic réinterroge : un fichier annoncé trop tôt peut être apparu entre-temps.
 *
 * C'est un VRAI lien : on peut l'ouvrir dans un autre onglet (clic du milieu,
 * Ctrl/Cmd + clic), le copier, ou s'en servir au clavier.
 */
import * as React from 'react';
import { adresseDeFichierCite, nomDuChemin, type Attachment, type MotifDeFichierAbsent } from '@beluga/shared';
import { AttachmentPreview } from '@/components/attachment-preview';
import { ContexteDesFichiersCites as Contexte } from '@/lib/chemin-cliquable';
import { formatRegional, t } from '@/lib/langue';

/** La phrase qui dit pourquoi ce fichier ne s'ouvre pas. */
function raisonDeLAbsence(chemin: string, motif?: MotifDeFichierAbsent, date?: number): string {
  switch (motif) {
    case 'pas-encore-cree':
      return t('Ce fichier n’existe pas, ou pas encore, et aucune copie n’en a été gardée. S’il vient d’être annoncé, réessayez dans un instant : {v0}', { v0: chemin });
    case 'expire':
      return t('La copie de ce fichier a été supprimée le {v1}, 3 mois après sa création : {v0}', { v0: chemin, v1: date ? new Date(date).toLocaleDateString(formatRegional()) : '?' });
    case 'hors-dossiers':
      return t('Ce fichier existe, mais il se trouve hors des dossiers autorisés : {v0}', { v0: chemin });
    case 'stockage-absent':
      return t('Ce fichier est gardé sur le disque de stockage, qui ne répond pas pour le moment. Réessayez plus tard : {v0}', { v0: chemin });
    default:
      return t('Le serveur n’a pas pu rendre ce fichier. Réessayez dans un instant : {v0}', { v0: chemin });
  }
}

interface Ouverture {
  piece: Attachment;
  source: string;
  erreur?: string;
}

export function FichiersCites({
  projectId,
  agentId,
  children,
}: {
  projectId: string;
  /** L'agent du fil : un chemin relatif se cherche d'abord dans SON dossier de travail. */
  agentId?: string | null;
  children: React.ReactNode;
}) {
  const [ouverture, setOuverture] = React.useState<Ouverture | null>(null);
  const adresse = React.useCallback(
    (chemin: string) => adresseDeFichierCite({ projectId, agentId, chemin }),
    [projectId, agentId],
  );
  const ouvrir = React.useCallback(
    (chemin: string) => {
      const circonstance = (nom: string, mime: string, taille: number, id: string): Attachment => ({
        id: `cite:${id}`,
        projectId,
        name: nom,
        mime,
        size: taille,
        sha: '',
        createdAt: 0,
      });
      void fetch(adresseDeFichierCite({ projectId, agentId, chemin, info: true }))
        .then(async (r) => {
          if (r.ok) return r.json();
          const refus = (await r.json().catch(() => null)) as { motif?: MotifDeFichierAbsent; date?: number } | null;
          throw refus ?? {};
        })
        .then((fiche: { nom: string; chemin: string; mime: string; taille: number }) =>
          setOuverture({
            piece: circonstance(fiche.nom, fiche.mime, fiche.taille, fiche.chemin),
            source: adresseDeFichierCite({ projectId, agentId, chemin: fiche.chemin }),
          }),
        )
        .catch((refus: { motif?: MotifDeFichierAbsent; date?: number }) =>
          setOuverture({
            piece: circonstance(nomDuChemin(chemin), '', 0, chemin),
            source: '',
            erreur: raisonDeLAbsence(chemin, refus?.motif, refus?.date),
          }),
        );
    },
    [projectId, agentId],
  );
  const valeur = React.useMemo(() => ({ adresse, ouvrir }), [adresse, ouvrir]);
  const source = ouverture?.source ?? '';
  const sourceDe = React.useCallback(() => source, [source]);
  return (
    <Contexte.Provider value={valeur}>
      {children}
      <AttachmentPreview
        item={ouverture?.piece ?? null}
        onClose={() => setOuverture(null)}
        sourceDe={sourceDe}
        erreur={ouverture?.erreur}
        adresse="fichier-cite"
      />
    </Contexte.Provider>
  );
}
