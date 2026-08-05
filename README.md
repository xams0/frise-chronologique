# Frise Musicale — serveur Node

Jeu multijoueur de devinette musicale (façon "pose la chanson sur la bonne
année"), avec un vrai serveur Node/Express/Socket.io. Tourne en local sur ton
iPhone pour tester, prêt à déployer plus tard sur ton propre serveur web.

## Pourquoi un serveur, et pas juste une page ?

- **Temps réel** via WebSockets (Socket.io) — plus de délai de rafraîchissement.
- **Extraits audio Deezer** (30 secondes, sans pub, sans rien à cacher à l'écran
  puisque c'est juste du son) — bien mieux adapté que YouTube pour un jeu où il
  ne faut surtout pas voir le titre avant la révélation.
- **Bibliothèque de chansons partagée**, stockée dans `songs.json` sur le
  serveur — tu peux l'éditer, l'exporter, la sauvegarder comme un fichier normal.
- Aucune dépendance externe côté compte (pas de Firebase, pas de clé API à
  créer) : la recherche Deezer se fait sans authentification, et tout l'état
  des salons vit en mémoire côté serveur, avec une sauvegarde simple dans
  `rooms.json`.

## À propos de Deezer

Le serveur associe chaque chanson de la bibliothèque à un morceau Deezer
automatiquement (recherche par titre + artiste), **au démarrage** et à chaque
ajout de chanson — il te faut une connexion internet à ce moment-là. Les liens
d'extrait audio de Deezer expirent au bout d'un moment, donc le serveur ne les
stocke jamais : il ne garde que l'identifiant Deezer (permanent) et va
rechercher un lien frais à chaque fois qu'une carte est piochée en partie.

Au premier lancement, regarde la console : elle affiche `Deezer ✓ ...` pour
chaque chanson associée avec succès, et un avertissement pour celles qui n'ont
pas été trouvées (rare, mais possible si le titre est mal orthographié ou trop
peu connu). Une chanson sans correspondance reste jouable — elle apparaît
juste sans extrait audio, avec un message "aperçu indisponible" dans le jeu.

## Bibliothèque et filtres (depuis la v1.3)

Le catalogue de départ contient **309 chansons**, de 1900 à 2026, réparties en
7 tranches de 20 ans. Chaque chanson est taguée avec un genre et un pays quand
c'est connu de façon fiable — certaines (surtout celles ajoutées en gros lot
pour monter en volume) n'ont pas ces tags, ce qui est normal : elles restent
jouables et filtrables par période et par artiste, juste pas par genre/pays.

Dans le salon d'attente, **⚙️ Options de partie** permet de choisir une ou
plusieurs tranches, genres, pays et/ou artistes avant de lancer la partie —
rien de coché = tout le catalogue est utilisé. Le nombre de chansons
correspondant aux filtres actifs s'affiche en direct.

## Tester en local sur ton iPhone (via iSH)

1. Installe **iSH** depuis l'App Store (gratuit).
2. Ouvre iSH et installe Node :
   ```
   apk update
   apk add nodejs npm
   ```
3. Récupère ce dossier sur ton iPhone (par ex. dépose-le dans l'app **Fichiers**,
   dans un dossier accessible à iSH — iSH voit `~/` comme son propre espace ;
   le plus simple est d'utiliser `Fichiers > Sur mon iPhone > iSH` si le
   partage est activé, ou de passer par `git clone` si tu mets le projet sur
   GitHub/un Gist).
4. Dans iSH :
   ```
   cd frise-musicale-node
   npm install
   npm start
   ```
5. Le terminal affiche deux adresses :
   - `http://localhost:3000` — utilisable **uniquement sur cet iPhone** (dans
     Safari, sur le même appareil qu'iSH).
   - `http://<IP de ce téléphone>:3000` — pour que tes amis te rejoignent
     depuis leur propre téléphone, **sur le même Wi-Fi**. Pour trouver ton IP :
     Réglages > Wi-Fi > (i) à côté du réseau connecté > "Adresse IP".

**Limites à connaître :**
- Le serveur ne tourne que pendant qu'iSH est **au premier plan** — iOS coupe
  l'exécution en arrière-plan après quelques secondes. Parfait pour une
  session de test, pas pour un serveur permanent.
- Tout le monde doit être sur le **même réseau Wi-Fi** (pas d'accès depuis
  l'extérieur sans configuration réseau supplémentaire, volontairement pas
  couverte ici puisque c'est juste pour tester).
- iSH émule un processeur x86 sur ARM : c'est plus lent qu'un vrai serveur,
  largement suffisant pour quelques joueurs en local.

## Tester sur ordinateur (plus rapide, pour vérifier que tout marche)

```
npm install
npm start
```
Puis ouvre `http://localhost:3000` dans le navigateur.

## Vérifier que le serveur fonctionne correctement

Un test automatisé est fourni (`test-e2e.js`) : il lance le serveur, simule
deux joueurs et un bot à travers une partie complète (créer un salon,
rejoindre, piocher, placer, défier, révéler, DJ, reprise de partie par
prénom...) et vérifie que tout se comporte comme prévu.

```
npm install
node test-e2e.js
```
Tu dois voir uniquement des lignes `✅` et se terminer par
`✅ ALL TESTS COMPLETED`.

## Déployer plus tard sur ton propre serveur web

Ce projet est un serveur Node standard — il tourne tel quel sur n'importe quel
hébergement qui exécute Node.js (VPS, Render, Railway, un Raspberry Pi chez
toi, etc.) :
```
npm install --production
PORT=3000 npm start
```
`rooms.json` et `songs.json` sont de simples fichiers JSON à côté du code —
sauvegarde-les si tu changes de serveur, pour ne pas perdre les salons et la
bibliothèque de chansons.

## Structure du projet

```
frise-musicale-node/
  server.js       -> logique de jeu (autoritaire), API REST, Socket.io
  songs.json       -> bibliothèque de chansons (titre/artiste/année/YouTube)
  rooms.json       -> état des salons (créé automatiquement au 1er lancement)
  package.json
  test-e2e.js      -> test automatisé de bout en bout
  public/
    index.html
    style.css
    app.js         -> tout l'affichage + connexion Socket.io
```

## Ajouter des chansons

Dans le salon d'attente → **📚 Bibliothèque** → ajoute titre/artiste/année.
Le serveur cherche automatiquement la correspondance sur Deezer — pas de lien
à coller. Tu peux aussi exporter/importer un fichier JSON depuis cet écran,
ou éditer `songs.json` directement (redémarre le serveur après, pour qu'il
associe les nouvelles entrées à Deezer).
