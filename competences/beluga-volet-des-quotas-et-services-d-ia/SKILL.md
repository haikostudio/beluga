---
name: beluga-volet-des-quotas-et-services-d-ia
description: À utiliser pour toucher au volet des quotas de Beluga (bouton « LLM en ligne » au pied de la colonne des projets) ou à sa section « Services d'IA » : ajouter un fournisseur d'IA, changer un lien de facturation ou un logo, un solde illisible ou faux, un bloc qui manque, le seuil d'alerte (« Solde bas », « À sec »), le portefeuille d'alerte du pied de colonne, la notification « service à sec », ou essayer le volet dans un vrai navigateur.
etat: active
themes: quotas, interface, integrations, notifications
symptomes: un service d'IA du coffre n'a pas de bloc, solde OpenRouter faux ou absent, bloc HeyGen en erreur, le volet montre « soldes indisponibles », ajouter un fournisseur d'IA au volet, logo d'un service d'IA manquant ou neutre, bloc « Solde bas » inattendu, portefeuille d'alerte au pied de colonne, notification « est à sec » en double ou absente, le seuil d'un service ne s'enregistre pas
projets: Beluga
---

# beluga-volet-des-quotas-et-services-d-ia

## Procédure

LE VOLET (web/src/components/quota-badge.tsx, QuotaBadge — un DropdownMenu Radix) : en tête « Quotas » + bouton Actualiser ; puis les comptes moteurs rangés par moteur (groupes repliables, choix retenu dans les réglages groupesQuotaReplies) ; puis la section « Services d'IA » (composant ServicesIa, repère data-services-ia ; un bloc BlocServiceIa data-service-ia=<id> data-etat=ok|non-communique|erreur data-niveau=normal|bas|vide) ; enfin le journal des amorces et la roue des réglages des comptes.

LA SECTION SERVICES D'IA :
1. Liste FERMÉE des fournisseurs dans shared/src/services-ia.ts (FOURNISSEURS_IA : id, nom, lien de facturation, unité usd|credits, motif cherché dans le nom ET le champ « service » de la fiche du coffre). Seules les fiches type cle-api non archivées avec une clé comptent. Cursor et MiMo n'y sont jamais (déjà moteurs).
2. Ajouter un fournisseur : sonder d'abord sa route de solde avec curl et la vraie clé (sans afficher la clé), puis ajouter l'entrée, son cas dans requeteDeSoldeIa et lireSoldeIa, son id dans l'enum de l'événement « servicesIa » (shared/src/protocol.ts), son LOGO dans web/src/components/icone-service-ia.tsx (PAR_SERVICE), et un test dans server/src/test/services-ia.test.ts. Sans route de solde : l'ajouter à SANS_SOLDE et sonder seulement la validité de la clé (/models).
3. Relevé côté serveur : server/src/services-ia-releve.ts. Commande ws « servicesIa.releve » (force facultatif, droit « moteurs/voir ») + TOURNÉE DE FOND (demarrerTourneeDesServicesIa, lancée dans main.ts : 90 s après le démarrage puis toutes les 30 min, minuteurs unref, arrêtée avec les autres). Un compte par fournisseur, première clé qui répond, 10 s par appel, Promise.allSettled, cache 5 min. Jamais sur le chemin d'un lancement.
4. Après chaque relevé NEUF (apresUnReleve) : bus.emit({ type: 'servicesIa', soldes, releveLe }) — laissé passer aux tiers par le service « moteurs » (EVENEMENTS_DES_SERVICES) — puis basculesASec : notification motif 'service-ia-a-sec' (famille systeme, genre erreur, aussi déclaré dans web/public/sw.js) pour chaque service qui VIENT de tomber à zéro. Les derniers niveaux sont gardés en base, meta « servicesIa.niveaux » : un redémarrage ne renotifie pas. Un écran qui se connecte reçoit le dernier relevé gardé (dernierReleveDesServicesIa, jamais un relevé neuf) ; le client le garde dans state.servicesIa.
5. LE SEUIL : SEUIL_PAR_DEFAUT_USD = 2 ; réglage partagé Settings.seuilsServicesIa (id → dollars ; absent = 2 $). niveauDuSolde → normal | bas (restant < seuil) | vide (restant ≤ 0) | null (solde illisible : jamais d'alerte). kie.ai compte en crédits : seuilDansLUnite divise par DOLLARS_PAR_CREDIT (2 $ = 400 crédits). Le menu à trois points d'un bloc lu (MenuDuSeuil, DropdownMenu imbriqué dans le volet) porte le champ du seuil en dollars, « Enregistrer » et « Revenir à 2 $ » ; enregistrement optimiste par settings.update { seuilsServicesIa } (un seuil égal à 2 $ est retiré du réglage).
6. L'ALERTE À L'ÉCRAN : la palette est MONOCHROME (--warning = texte fort, aucun orange) : un bloc bas ou vide dit « Solde bas » / « À sec » en mots (data-alerte-niveau) et son restant passe en text-warning ; au pied de colonne, une icône portefeuille (Wallet, data-alerte-services-ia="<ids>") après le point de liaison (variante pied), un point en bas à droite du logo (variante bande). Rien pour un solde bas côté notification.
7. Côté écran : le relevé est redemandé à l'ouverture du volet ; « Actualiser » le force ; le plus récent du relevé poussé et de la réponse s'affiche. Dollars écrits comme la dépense Cursor (montantCursorEnClair, « 4,48 $ ») ; jauge seulement si le total est connu (OpenRouter).
8. Tout texte en t('…') et ajouté en tête de shared/src/traductions.ts ; JAMAIS aria-label={t(…)} (refusé par verif-langues) : title={t(…)} ou aria-labelledby.

LES LOGOS (web/src/components/icone-service-ia.tsx, IconeServiceIa, repère data-logo-service-ia) : même règles que IconeMoteur (compétence logos-de-marque-dans-une-interface-a-themes), en grayscale. OpenRouter = simple-icons ; Groq et Agentik = leurs favicons SVG ; API Gemini = LogoGemini exporté d'icone-moteur.tsx (un seul dessin) ; kie.ai et HeyGen n'ont AUCUN tracé publié (Iconify, LobeHub : 404 ; favicons raster) → leur image officielle (kie.ai/logo-icon.webp, losange de heygen.com/images/heygen-logo.png) a été vectorisée : ffmpeg alphaextract,negate + potrace (paquet npm, dans un dossier jetable), coordonnées arrondies, viewBox recadré carré, une seule teinte currentColor. Repli neutre : Sparkles text-faint.

## Vérification

npm run build:server puis node --test server/dist/test/services-ia.test.js (7 essais : reconnaissance, un compte par service, réponses, relevé sans fuite de clé, niveau du solde avec kie en crédits, bascule « à sec » unique, diffusion + niveaux en base + une seule notification). Aussi notification-tri.test.js (le motif est dans la liste des alertes et dans le service worker) et scripts/exports-morts.test.mjs. Puis env -u BELUGA_TOKEN -u BELUGA_URL node scripts/verif-services-ia.mjs : démon jetable sur 7147 + interface sur 7149, 37 contrôles (un bloc et un logo par service, liens target=_blank, chiffres, « non communiqué », alerte dite en mots, champ du seuil qui garde la frappe, seuil de 10 000 $ enregistré et mis en alerte, « Revenir à 2 $ », portefeuille au pied de colonne volet fermé, aucune clé dans la page, aucun débordement à 390 px, aucune erreur), captures 1440/390 clair et sombre dans /tmp/verif-services-ia (« reel » = seuils par défaut). Preuve : carte « Quotas des services d'IA », commit 1b032eb8 puis le commit des logos et de l'alerte (Agentik à 1,49 $ dit « Solde bas » le 08/11/2026).

## Pièges

- OpenRouter : seule la clé de PROVISIONNEMENT lit /api/v1/credits du compte ; sans elle → « non communiqué », jamais le budget d'une clé présenté comme le compte.
- HeyGen : /v2/user/remaining_quota est déprécié (crédits API, autre chiffre) ; le solde du portefeuille est /v3/users/me data.wallet.remaining_balance.
- kie.ai répond en HTTP 200 même en erreur : seul le champ code fait foi.
- text-warning / bg-warning ne sont PAS orange dans cette charte (texte fort) : une alerte qui ne se dit que par la couleur ne se voit pas. Le dire en mots.
- Le champ du seuil vit dans un menu Radix imbriqué dans le volet (lui-même un menu) : stopPropagation sur toutes les touches sauf Échap, flèches et Tab, sinon la recherche par frappe des DEUX menus vole les lettres.
- notify() n'a pas d'adresse externe : le service worker n'ouvre que des adresses internes à l'application ; le lien de facturation reste dans le volet.
- Une panne de relevé (niveau null) garde le niveau d'avant : sinon un service à sec qui ne répond plus une fois renotifierait au retour.
- Sur téléphone, le volet s'ouvre depuis la feuille « Projets » (bouton aria-label="Projets" de l'en-tête), puis le bouton « Quotas des moteurs » ; le menu du seuil y est une seconde feuille du bas.
- Un démon d'essai a une base neuve : pour voir de vrais soldes, recopier les fiches d'IA du coffre dans sa table secrets (le script le fait).
