---
name: ant-design
description: À utiliser dès qu'une application React a besoin d'un back-office, d'un tableau de bord ou d'un outil de gestion riche en données (tableaux triables, formulaires validés, arbres, calendriers, menus latéraux) sans dessiner chaque composant : « installe Ant Design », « fais-moi une interface d'administration complète », « antd ». Dit comment installer la version 6, poser le thème par jetons, utiliser formulaires et tableaux, brancher Next.js et éviter les pièges des messages et des fenêtres.
etat: active
themes: interface, composants, design, design-system
symptomes: back-office ou tableau de bord à monter vite, tableau de données triable et filtrable, formulaire avec validation, interface d'administration en React, message ou fenêtre antd qui ignore le thème, styles qui clignotent au chargement avec Next.js
---

# ant-design

## Symptôme

On doit livrer une interface de gestion (liste de clients, commandes, réglages) avec beaucoup de tableaux et de formulaires, et refaire chaque composant à la main prendrait des semaines ; ou une application antd affiche ses messages sans la couleur de la marque, ou clignote sans style au chargement.

## Cause

Ant Design (antd, licence MIT, développé par Ant Group) est un système de design complet pour applications d'entreprise : plus de soixante composants livrés en un seul paquet, un langage visuel documenté, et un thème réglé par JETONS dans un fournisseur React (`ConfigProvider`). Version actuelle : 6, qui demande React 18 ou plus et utilise des variables CSS.

Quand la choisir : back-office, tableau de bord, outil interne, tout écran dense en données où la complétude compte plus que l'originalité. Quand ne pas la choisir : site vitrine ou page d'accueil de marque (le style antd se reconnaît et se retouche lourdement) ; projet en Tailwind où l'on veut posséder ses composants (préférer coss ui ou HeroUI) ; site sans React (préférer daisyUI).

## Procédure

1. Prérequis : React 18 ou plus (19 accepté sans rustine en v6). Installer : `npm install antd`. Les icônes sont un paquet à part : `npm install @ant-design/icons` (version 6 avec antd 6, jamais mélangées).
2. Utiliser : `import { Button, DatePicker, Space } from 'antd';` — aucun fichier CSS à importer, les styles sont injectés par la bibliothèque.
3. Thème : envelopper l'application dans `<ConfigProvider theme={{ token: { colorPrimary: '#…', borderRadius: 6 } }}>`. Les jetons « graines » (`colorPrimary`, `borderRadius`, `fontFamily`…) recalculent toute la palette ; un réglage par composant passe par `theme.components.Button`, etc. Sombre ou compact : `algorithm: theme.darkAlgorithm` ou `theme.compactAlgorithm` (cumulables dans un tableau).
4. Langue : `ConfigProvider locale={frFR}` (import depuis `antd/locale/fr_FR`) traduit les textes intégrés (pagination, calendrier, « OK / Annuler »).
5. Messages, notifications, fenêtres de confirmation : envelopper aussi dans `<App>` et les obtenir par `const { message, modal, notification } = App.useApp();`. Les appels directs `message.success()` ou `Modal.confirm()` ignorent le thème et la langue du fournisseur.
6. Formulaire : `<Form onFinish={…}>` avec des `<Form.Item name="email" label="Courriel" rules={[{ required: true, message: '…' }]}>` autour de chaque champ ; `Form.useForm()` donne la main sur les valeurs. La validation, les messages d'erreur liés au champ et l'état « requis » sont gérés par la bibliothèque. Garder les libellés au-dessus des champs : `layout="vertical"`.
7. Tableau : `<Table columns={…} dataSource={…} rowKey="id" />` ; tri par `sorter`, filtres par `filters`, pagination intégrée. Toujours donner `rowKey` (identifiant stable), sinon avertissements et lignes mélangées.
8. Next.js (routeur App) : installer `@ant-design/nextjs-registry` et envelopper la mise en page racine dans `<AntdRegistry>` pour que les styles soient rendus côté serveur (sinon la page s'affiche un instant sans style).
9. Documentation lisible par un agent : https://ant.design/llms.txt ; chaque page s'obtient en texte brut en ajoutant `.md` (ex. https://ant.design/components/form.md). Le langage de design est décrit dans https://ant.design/design.md.
10. Passage de la v5 à la v6 : monter d'abord à la dernière v5 et corriger ses avertissements, puis suivre le guide officiel de migration (l'outil en ligne de commande d'Ant Design repère les API dépréciées).

## Vérification

La page d'essai affiche un formulaire et un tableau antd aux couleurs de la marque (jeton `colorPrimary` visible sur le bouton principal). Envoyer le formulaire vide affiche les erreurs sous chaque champ requis ; le tableau trie au clic sur l'en-tête. Un `message.success` obtenu par `App.useApp()` prend la couleur du thème. En basculant `theme.darkAlgorithm`, toute l'interface passe en sombre. Avec Next.js, recharger la page ne montre aucun instant sans style. Aucun avertissement antd dans la console.

## Pièges

- Messages et fenêtres appelés en direct (`message.info`, `Modal.confirm`) : hors du fournisseur, donc sans thème ni langue. Passer par `App.useApp()` ou `useMessage`/`useModal` avec leur `contextHolder`.
- `@ant-design/icons` v5 avec antd v6 (ou l'inverse) : incompatibles, mettre les deux à jour ensemble.
- La rustine `@ant-design/v5-patch-for-react-19` ne sert plus en v6 : la retirer.
- Écraser les styles par des classes `.ant-btn` dans une feuille globale : fragile d'une version à l'autre. Passer par les jetons.
- Mélanger antd et Tailwind sans précaution : la remise à zéro de Tailwind peut écraser des styles antd ; vérifier l'ordre des couches CSS (guide « compatible-style »).
- Le paquet est lourd : importer les composants nommément depuis `antd` (l'élagage fait le reste), ne jamais importer tout un dossier interne.

## Ce qui ne marche pas

Construire une page d'accueil de marque avec antd « parce qu'il a tout » : le rendu reste celui d'un outil d'administration. Réserver antd aux écrans de gestion.
