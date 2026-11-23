---
name: annonces-freelance-lues-sans-compte
description: À utiliser dès qu'il faut relever automatiquement des annonces de clients sur des plateformes de freelances (Codeur.com, Freelancer.com, Free-Work, freelancermap, Malt, Upwork, Fiverr…) depuis un serveur, sans se faire bannir, ou décider si une nouvelle source vaut d'être lue : « trouve-moi des leads toutes les heures », « surveille les nouvelles missions », « combien d'offres concurrentes », « ajoute tel site aux sources », « des annonces en anglais arrivent dans la liste ».
etat: active
themes: freelance, relevé, scraping, prospection
symptomes: compte freelance marqué ou suspendu, captcha à la lecture, 400 sur l'API Free-Work, description Codeur tronquée, aucun budget lisible, annonces anglaises gardées malgré le filtre de langue, mêmes fiches relues à chaque relevé, site d'emploi pris pour une source de missions
---

# annonces-freelance-lues-sans-compte

## Cause

Un relevé connecté à un compte toutes les heures est le plus sûr moyen de le faire marquer. Or les flux utiles se lisent SANS compte depuis un serveur (Codeur, Freelancer.com, Free-Work vérifiés le 25/10/2026, freelancermap le 27-28/10/2026). Les autres plateformes n'ont rien de public, refusent le serveur, ou ne publient que de l'emploi salarié.

## Procédure

1. Codeur.com : GET https://www.codeur.com/projects (HTML, ~35 annonces) ; chaque carte est un `<a aria-label=… href="/projects/<id>-…">` avec h3 (titre), âge (« Il y a 15 heures »), `title="Budget"` (tranche « 1 000 € à 10 000 € », « Moins de 500 € », « 10 000 € et plus »), `title="Offres"` (« 121 Offres »), extrait `line-clamp-3`. La fiche donne « Montant moyen des devis proposés », `title="Nombre d'offres"`, l'état et la description (div `project-description` puis div `content …`). Répondre exige l'abonnement payant (dès 31,90 €/mois).
2. Freelancer.com : GET https://www.freelancer.com/api/projects/0.1/projects/active/?query=<mots>&limit=20&full_description=true&job_details=true&sort_field=time_updated — `bid_stats.bid_count` et `bid_avg`, `budget.minimum/maximum` dans la devise du projet (`currency.exchange_rate` vers le dollar), `type` fixed/hourly, `seo_url`.
3. Free-Work : GET https://www.free-work.com/api/job_postings?contracts=contractor&searchKeywords=<mots>&itemsPerPage=20 (JSON) — `minDailySalary`/`maxDailySalary`, `location.locality`, `durationValue`/`durationPeriod`, lien /fr/tech-it/job-mission/<job.slug>/<slug>.
4. freelancermap : GET https://www.freelancermap.com/projects?query=<mots> (HTML, ~22 cartes par page) ; chaque carte commence par `<div class="project-card">`, lien `data-id="project-card-title" href="/project/<slug>"`, société `project-card-company`, champs `data-testid` city / type / duration / remoteInPercent / created (jj.mm.aaaa). La fiche /project/<slug> porte la description entière dans un bloc `application/ld+json` (`description`). Le site est surtout ANGLAIS (et publie souvent la même offre une fois par ville) : ne juger la langue qu'après la fiche lue (voir Pièges) ; attendre au mieux de rares annonces françaises.
5. Rien de public ou rien d'utile — ne pas relever : Malt (les clients écrivent au profil), Collective et Crème de la crème (missions dans l'application), ComeUp/5euros et Fiverr (services au forfait), Upwork (refuse les adresses de centre de données), LinkedIn et X.com (mur de connexion : lecture seulement par une session de navigateur durable, une fois le compte créé par l'humain), Leboncoin (403 même avec un vrai Chrome), Anibis (service de sécurité, 403), Ricardo (captcha), Twago (devenu Talent-Pool, rien sans compte), Hopwork (absorbé par Malt), Cadremploi (offres d'emploi seulement), Jobup et Jobs.ch (sites d'emploi : sur ~140 `JobPosting` lus le 28/10/2026, un seul `employmentType` « Indépendant », et c'était un recrutement à la commission).
6. Juger un site d'emploi avant de l'ajouter : compter les `employmentType` de ses données structurées sur quelques recherches ; si « Indépendant/Freelance » est quasi absent, l'écarter avec sa raison plutôt que d'écrire un filtre.
7. Rythme : une heure ± dix minutes, une plateforme après l'autre, 4 à 11 s entre deux pages, au plus une douzaine de fiches par passage ; dédoublonner par plateforme + identifiant ; au premier 401/403/429, captcha ou page « blocked », arrêter la plateforme jusqu'à un geste humain. Jamais de proxy, de résolveur de captcha ni de contournement.
8. Mémoriser comme VUES les annonces écartées par un filtre (langue…), pas seulement les annonces gardées : sinon elles redeviennent « nouvelles » à chaque relevé et consomment les mêmes lectures de fiche.
9. Préfiltrer gratuitement (mots exclus dans le titre, budget maximal sous le plancher, aucun mot d'offre) avant toute note par un modèle ; une note + une proposition coûtent environ 0,002 $ avec un modèle « flash ».

Preuves : carte service-leads-40fb6a ; carte finir-les-sources-freelance-des-leads-11b2fc (commit dd816b74 du dépôt Beluga, compte rendu docs/leads/2026-10-27-nouvelles-sources.md).

## Vérification

Une lecture d'essai rend des annonces avec titre, budget et nombre d'offres sur chaque source lue ; aucune requête n'emporte de témoin de connexion ; une seconde lecture n'ajoute que les annonces nouvelles ; un faux 429 met la plateforme en pause. Pour une source surtout anglaise : un relevé d'essai sur les vraies pages (fiches lues) ne garde AUCUNE annonce anglaise — freelancermap le 28/10/2026 : 70 annonces, 12 fiches lues, 0 gardée, contre 48 gardées quand on jugeait la carte de liste.

## Pièges

- Free-Work refuse `order[publishedAt]=desc` (400 « non-scalar value ») : appeler sans tri.
- La classe du bloc de description Codeur contient « [&>p:last-child] » : un retrait de balises par <[^>]+> s'y coupe ; sauter la classe par ses guillemets.
- Freelancer mélange les devises (INR, USD…) : convertir avant de comparer à un budget en euros, et ne pas comparer un projet payé à l'heure.
- Un filtre de langue qui garde le texte « trop court pour trancher » laisse passer TOUTE carte de liste réduite à un titre et « société · lieu · type » : sur freelancermap, le premier relevé a gardé 40 annonces, toutes anglaises. Ne rendre au filtre que les annonces dont la fiche est lue ; les autres attendent le relevé suivant.
- Le choix d'une plateforme par l'état en base prend effet tout de suite, mais le code du relevé n'est celui d'une correction qu'après mise en ligne : décocher une source qui pollue la liste en attendant.

## Ce qui ne marche pas

Lire Upwork, Leboncoin, Anibis ou Ricardo depuis le serveur, même avec le vrai Chrome : refus d'adresse ou captcha. Se connecter aux comptes pour lire : inutile et risqué. Filtrer Jobup/Jobs.ch sur « Indépendant » : ne laisse passer que des recrutements à la commission.
