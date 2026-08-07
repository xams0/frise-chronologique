# Chronolozik — serveur Node

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
peu connu). Une chanson sans correspondance Deezer, ou dont l'aperçu audio
n'est pas disponible au moment de la piocher, est **automatiquement mise de
côté par le serveur** — les joueurs ne la voient jamais, une autre carte est
piochée à la place. Elle sera retentée plus tard (après un remélange de la
défausse), au cas où ce n'était qu'un problème passager.

**Pour être sûr que tout le catalogue est jouable :** dans le salon d'attente
→ 📚 Bibliothèque → **🔍 Vérifier la bibliothèque**. Ça interroge Deezer en
direct pour chaque chanson, avec un rythme volontairement lent (par petits
lots espacés) pour rester sous la limite de débit de Deezer — compte 1 à 2
minutes pour 300+ titres. Affiche celles sans correspondance ou sans extrait
audio, avec un bouton pour les retirer directement.

⚠️ Si la console affiche `Quota limit exceeded`, ce n'est **pas** un problème
avec la chanson elle-même — c'est Deezer qui demande de ralentir. Le serveur
réessaie automatiquement plusieurs fois avant d'abandonner une chanson, donc
ce message seul n'est pas une raison de la supprimer.

## Vérification obligatoire au démarrage (depuis la v1.10)

Personne ne peut créer ni rejoindre un salon tant que **toute la bibliothèque**
n'a pas été vérifiée contre Deezer pour ce cycle de démarrage — un écran de
chargement avec une barre de progression en temps réel (%, X/Y chansons)
s'affiche en attendant. Cette vérification tourne à chaque démarrage du
serveur (donc à chaque redéploiement, et à chaque réveil du tier gratuit
Render après une période d'inactivité).

**Contrepartie assumée :** comme le tier gratuit de Render s'endort après 15
minutes d'inactivité, ça veut dire qu'un premier visiteur après une pause
attendra 1 à 2 minutes avant de pouvoir jouer, à chaque fois. C'est le prix
de la garantie "aucune chanson muette ne peut arriver en jeu".

## Bibliothèque et filtres (depuis la v1.3)

Le catalogue de départ contient **309 chansons**, de 1900 à 2026, réparties en
7 tranches de 20 ans. Chaque chanson est taguée avec un genre et un pays quand
c'est connu de façon fiable — certaines (surtout celles ajoutées en gros lot
pour monter en volume) n'ont pas ces tags, ce qui est normal : elles restent
jouables et filtrables par période et par artiste, juste pas par genre/pays.

Dans le salon d'attente, **⚙️ Options de partie** permet de choisir une ou
plusieurs tranches de 20 ans et/ou des artistes précis avant de lancer la
partie — rien de coché = tout le catalogue est utilisé. Le nombre de
chansons correspondant aux filtres actifs s'affiche en direct.

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
   cd frise-chronologique
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
frise-chronologique/ (dépôt GitHub xams0/frise-chronologique)
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

## Où êtes-vous ? (depuis la v1.12)

Dans le salon d'attente, choisis entre deux modes d'écoute :
- **🎉 Tous ensemble** — un DJ unique diffuse la musique à voix haute pour
  toute la pièce, comme avant. Le rôle de DJ reste réassignable.
- **🏠 Chacun chez soi** — pas de DJ : chaque joueur entend l'extrait
  directement sur son propre téléphone, pratique si vous n'êtes pas dans la
  même pièce.

Le choix se fait avant de lancer la partie et peut être changé tant que le
salon est en attente.

## Hôte du salon et délai de révélation (depuis la v1.13)

Le créateur du salon (👑) est le seul à pouvoir lancer la partie, changer le
mode d'écoute, le DJ, les filtres et le délai de révélation — les autres
joueurs voient ces réglages mais ne peuvent pas les modifier.

Un délai (15 secondes par défaut, réglable de 5 à 60s dans le salon
d'attente) s'écoule entre le moment où une carte est posée et celui où le
bouton **Révéler** devient cliquable — une barre de progression se remplit
dans le bouton en attendant. Ça laisse toujours le temps aux autres de
défier avant que la carte ne soit révélée. Le délai est aussi vérifié côté
serveur, pas seulement affiché côté client.

## Renommage : Chronolozik (depuis la v1.14)

Le jeu s'appelle maintenant **Chronolozik**. Le dépôt GitHub reste
`xams0/frise-chronologique` (renommer le dépôt casserait le lien de
déploiement Render) — seul le nom affiché dans l'app a changé.

## Pourquoi je me déconnectais en changeant d'appli sur mon téléphone

Deux causes, maintenant corrigées :

1. Quand le téléphone met la page en arrière-plan, iOS coupe souvent la
   connexion WebSocket pour économiser la batterie. Le navigateur la
   rétablit à la réouverture, mais **le serveur voit ça comme une toute
   nouvelle connexion**, sans salon associé — donc plus aucune action ne
   partait, sans message d'erreur visible. Le client détecte maintenant une
   reconnexion et rejoint automatiquement le même salon avec le même nom.
2. Si le téléphone est resté en arrière-plan longtemps, iOS peut carrément
   **décharger la page de la mémoire** — au retour, c'est un rechargement
   complet, tout l'état JS est perdu. Le salon et le prénom sont maintenant
   sauvegardés dans le stockage local du téléphone, donc l'app retente de
   rejoindre automatiquement au rechargement, sans que tu aies besoin de
   retaper quoi que ce soit.

Une petite bannière ("🔄 Reconnexion..." ou "🔌 Connexion perdue...")
s'affiche pendant ces moments, pour que ce ne soit jamais silencieux.

## v1.15 — kick, révélation automatique, historique des ratés, mode audio

- **Exclure un joueur** : l'hôte voit un bouton 🚫 à côté de chaque joueur
  (sauf lui-même) dans le salon d'attente, avec confirmation avant d'agir.
  Le joueur exclu est notifié et renvoyé à l'écran d'accueil.
- **Révélation automatique** : la carte se révèle toute seule dès que le
  délai (réglable) s'écoule — plus besoin de cliquer sur "Révéler", même si
  le bouton reste utilisable pour révéler plus tôt une fois le délai passé.
- **Historique des cartes ratées** : sous la frise de chaque joueur, les 5
  dernières chansons mal placées par ce joueur s'affichent avec leur année.
- **Mode audio** : dans le salon, l'hôte choisit entre 🔁 en boucle (par
  défaut) et ⏹️ une seule fois (s'arrête après les 30 secondes de l'extrait).

## v1.16 — habillage premium + salons publics

- **Version affichée** sous le nom de l'app, en petite bulle, sur l'écran
  d'accueil (en plus du badge discret en bas à droite de toutes les pages).
- **Fond animé noir/bleu** sur l'écran d'accueil (dégradés flous en
  mouvement lent), et le titre **Chronolozik** a un léger effet de brillance
  qui balaie le texte.
- **Salons publics ou privés** : à la création, choisis 🔒 Privé (comme
  avant, uniquement par code) ou 🌐 Public. Les salons publics apparaissent
  dans une liste sur l'écran "Rejoindre", avec le nom de l'hôte et le nombre
  de joueurs, et un bouton pour rejoindre directement sans taper le code.
  L'hôte peut aussi changer la visibilité depuis le salon d'attente.

## v1.17 — nombre de joueurs maximum

Dans le salon d'attente, l'hôte peut limiter le nombre de joueurs : boutons
rapides 2/3/4/5/6, ou une valeur personnalisée (2 à 20) via le champ dédié.
"Illimité" retire la limite. Un joueur déjà présent peut toujours reprendre
sa place même si le salon est "complet" — la limite ne bloque que les
nouvelles arrivées. Impossible de fixer un maximum inférieur au nombre de
joueurs déjà présents.

## v1.18 — départ propre du salon + kick plus fiable

- Cliquer "quitter" (✕) **notifie maintenant vraiment le serveur** — avant,
  le client s'en allait localement sans jamais le dire, laissant un joueur
  fantôme dans le salon. Le départ ajuste le tour de jeu, le DJ, réattribue
  l'hôte si besoin, et **termine la partie si l'hôte se retrouve seul**
  (retour au salon d'attente). Si tout le monde part, le salon est supprimé.
- **Kick plus robuste** : en plus du message direct envoyé au joueur exclu,
  le client détecte maintenant lui-même s'il a disparu de la liste des
  joueurs (peu importe la cause exacte) et se déconnecte proprement — un
  filet de sécurité qui ne dépend plus d'un seul mécanisme.

## v1.19 — le prénom est mémorisé

Le champ "Ton prénom" se pré-remplit maintenant avec le dernier prénom
utilisé sur cet appareil (stocké dans le stockage local du navigateur, pas
un vrai cookie HTTP — plus simple et suffisant ici). Il reste 100%
modifiable : c'est juste une valeur par défaut, pas un verrouillage.

## v1.20 — habillage premium partout + salons publics quasi temps réel

- Le **fond animé noir/bleu** et le **titre brillant** sont maintenant sur
  toutes les pages : accueil, écran de chargement, salon d'attente, partie
  et écran de victoire — pas seulement l'accueil.
- L'animation de fond est synchronisée sur l'horloge (délai négatif calculé
  à chaque rendu) pour ne jamais "sauter"/redémarrer, même sur l'écran de
  partie qui se redessine plusieurs fois par seconde pendant le compte à
  rebours de révélation.
- La liste des **salons publics** se rafraîchit automatiquement toutes les
  2,5 secondes tant qu'elle est affichée (onglet "Rejoindre" de l'accueil) —
  quasi temps réel, sans avoir à appuyer sur ↻.

## v1.21 — vraie palette bleutée + badge de version retiré

- La vraie cause du "toujours noir" : la palette de base (`--bg`, `--surface`)
  était en fait **violette**, pas bleue — sur le salon et la partie, les
  panneaux opaques recouvrent presque tout l'écran et cachaient les halos
  animés. Corrigé à la racine : les couleurs de fond de toute l'app sont
  maintenant du bleu marine foncé, visible partout, pas seulement dans les
  espaces vides de l'accueil.
- Le badge de version discret en bas à droite de chaque écran est retiré —
  seule la bulle sous le titre "Chronolozik" sur l'accueil subsiste.

## v1.22 — écran d'accueil des règles, corrections de scintillement et de scroll

- **Écran de règles** premium, affiché **une seule fois** (mémorisé dans le
  stockage local) avant l'accueil, expliquant le jeu en 4 étapes illustrées.
- **Fix clignotement** : la bannière de résultat et le message "titre/artiste
  trouvé" rejouaient leur animation à chaque redessin de l'écran (plusieurs
  fois par seconde pendant le compte à rebours de révélation) au lieu de
  jouer une fois — corrigé en ne déclenchant l'animation qu'au premier
  affichage de chaque résultat.
- **Fix scroll bloqué** : la restriction de défilement (ajoutée plus tôt pour
  empêcher la page de bouger horizontalement) empêchait aussi de faire
  défiler les frises trop longues — les frises ont maintenant leur propre
  autorisation de scroll horizontal.
- **Frises sur plusieurs lignes** : les cartes d'une frise s'enroulent
  maintenant sur plusieurs lignes au lieu de s'étaler sur une seule bande à
  faire défiler — beaucoup moins besoin de scroller, y compris dans la
  fenêtre de placement/défi.

## v1.23 — vrai logo partout

Le logo (note de musique + onde sonore, dégradé bleu/rose) remplace l'icône
CSS générique sur l'accueil, l'écran de règles, l'écran de chargement et
l'écran de victoire. Il sert aussi de :
- **Favicon** (onglet du navigateur)
- **Icône iOS** quand on ajoute le site à l'écran d'accueil ("Sur l'écran
  d'accueil" dans Safari) — fond bleu marine assorti au thème, comme une
  vraie app
- **Icône Android/PWA** via `manifest.json` (192px et 512px)

## v1.24 — carte gagnée qui clignote, lecteur audio simplifié, notifs auto

- La carte qui vient d'être gagnée ou volée **clignote en doré** dans la
  frise pendant quelques secondes, pour bien la repérer.
- Lecteur audio simplifié : texte explicatif retiré, remplacé par une petite
  **animation d'égaliseur** (barres qui bougent) montrant que le son joue,
  et un **compteur "Xs / 30s"** en direct. Le bouton "🔊 Appuyer si pas de
  son" reste disponible en secours.
- Les notifications de résultat (bien placé / raté / volé) **disparaissent
  seules après 3,5 secondes** — plus besoin de cliquer "OK" — et sont
  maintenant affichées **sous les frises**, pas au-dessus.

## v1.25 — cinq corrections/ajouts

- **Fix compteur qui oscillait** : le compteur "Xs / 30s" repartait parfois
  brièvement à "0s" avant de se corriger — la valeur affichée survit
  maintenant aux redessins de l'écran au lieu de repartir d'un texte figé.
- **Écran de chargement simplifié** : "Chargement, veuillez patienter."
- **Révélation anticipée par les autres joueurs** : si tu ne joues pas ce
  tour-ci et que tu penses que le placement est correct, tu peux appuyer sur
  "Ça a l'air bon, révéler maintenant" pour révéler tout de suite, sans
  attendre le délai — qui continue de s'appliquer uniquement à celui qui
  vient de poser sa carte.
- **Tolérance aux fautes de frappe** sur les réponses titre/artiste
  (distance de Levenshtein, quelques lettres de différence acceptées).
- **Fix titre/artiste qui débordait** : structure plus robuste (deux lignes
  indépendantes, tronquées et centrées) au lieu d'un bloc multi-lignes qui
  pouvait déborder du cadre de la carte.

## v1.26 — filtres simplifiés, animations réparées

- **Filtres réduits aux périodes uniquement** — le filtre par artiste est
  retiré des options de partie.
- **Fix égaliseur audio** : même cause que les précédents bugs
  d'animation — les barres 3 et 4 avaient un délai trop long pour survivre
  aux redessins fréquents de l'écran et ne démarraient jamais. Corrigé avec
  la même technique de délai négatif synchronisé sur l'horloge que le fond
  animé.
- **Barre de progression du bouton Révéler** : remplacée par une vraie
  animation CSS fluide (calculée pour démarrer déjà au bon endroit selon le
  temps écoulé) au lieu d'une largeur recalculée par à-coups toutes les
  250ms — beaucoup plus premium.

## v1.29 — vrai fix : le champ "Artiste ?" débordait de l'écran

Les précédentes tentatives (v1.25/v1.27/v1.28) corrigeaient les cartes de la
frise, mais le vrai bug (confirmé par capture d'écran) était ailleurs : les
champs **"Titre ?" / "Artiste ?"** pour deviner la chanson étaient côte à
côte (`flex:1` sans `min-width:0`, un piège classique de flexbox où un
`<input>` refuse de rétrécir sous sa largeur naturelle) — "Artiste ?" sortait
de l'écran sur mobile. Les deux champs sont maintenant **empilés
verticalement**, chacun pleine largeur.

## v1.30 — démarrage plus rapide

Le blocage au démarrage venait de deux choses cumulées :
1. Chaque chanson était vérifiée en **2 appels Deezer** (recherche + test de
   l'extrait), doublant le nombre de requêtes.
2. Les pauses anti-quota étaient prudentes (lots de 5, pause de 1,2s).

Maintenant, le démarrage ne fait plus qu'**associer** chaque chanson à
Deezer (1 appel), avec des lots plus grands et des pauses plus courtes (lots
de 8, pause de 0,7s) — environ 2 à 2,5× plus rapide. La vérification
complète (extrait réellement audible) reste disponible à la demande via
**🔍 Vérifier la bibliothèque**, et le filet de sécurité qui empêche toute
carte muette d'arriver en jeu (`drawPlayableCard`) est inchangé — il agit
déjà en temps réel à chaque pioche, donc rien n'est perdu en sécurité.

**À savoir** : ce démarrage complet ne se reproduit vraiment que juste après
un redéploiement. Un simple réveil après la mise en veille du tier gratuit
Render (sans nouveau déploiement) garde normalement le même disque, donc les
associations déjà résolues restent en mémoire et le redémarrage est quasi
instantané.

**Pour aller plus loin** : une fois le serveur démarré et toutes les
chansons associées, tu peux exporter la bibliothèque (📚 Bibliothèque → ⬇
Exporter) et me la transmettre — je peux alors committer directement les
identifiants Deezer déjà résolus dans `songs.json`, ce qui rendrait même le
tout premier démarrage après un déploiement quasi instantané.

## v1.31 — six correctifs/ajouts

- **Fix vrai bug** : le champ de saisie titre/artiste perdait le focus
  toutes les 250ms pendant le compte à rebours de révélation (le redessin
  périodique détruisait et recréait le champ en pleine frappe) — c'était la
  cause probable à la fois du "insensible à la casse" perçu et de
  "impossible de taper après avoir placé une carte". La logique de
  comparaison elle-même était déjà insensible à la casse (vérifié
  directement). Le focus et la position du curseur sont maintenant
  préservés à travers les redessins.
- **Couleur distincte pour une carte volée** (rose) vs gagnée normalement
  (doré) dans la frise.
- **Artiste ajouté** à l'historique des chansons ratées (year + titre +
  artiste, au lieu de year + titre seulement).
- **Revoir les frises finales** : bouton sur l'écran de victoire pour
  afficher la frise complète de chaque joueur.
- **Audio qui ne démarre pas seul en "chacun chez soi"** : ce n'est pas un
  souci de synchronisation (carte et son arrivent bien en même temps pour
  tous) — c'est la politique de lecture automatique des navigateurs, qui
  bloque plus souvent quand l'appareil n'a pas eu d'interaction tactile
  très récente. Le bouton de secours pulse maintenant visuellement dès que
  le navigateur bloque la lecture automatique, pour ne jamais le manquer.
- Petit fix additionnel : les artistes à 2 caractères (ex. "U2") étaient
  auparavant impossibles à deviner correctement à cause d'un seuil de
  longueur trop strict.

## v1.32 — déblocage audio dès le premier tap

Il n'existe pas de vrai moyen de forcer un son sans aucune interaction —
c'est une restriction volontaire des navigateurs. Mais dès le tout premier
tap/clic/touche sur la page (même juste taper son prénom), l'app joue
maintenant brièvement un son silencieux inaudible. La plupart des
navigateurs considèrent ensuite que la page a "l'autorisation audio" pour le
reste de la session — donc les lectures automatiques déclenchées plus tard
par le jeu (via le serveur, pas un clic direct) ont beaucoup plus de chances
de fonctionner sans intervention, y compris en mode "chacun chez soi".

(Petit bonus : un test de bout en bout qui pouvait échouer au hasard selon
la chanson tirée a été rendu déterministe.)

## v1.33 — bouton "Prêt" dans le salon

Chaque joueur a maintenant un bouton **"✅ Je suis prêt·e"** dans le salon
d'attente. Ce tap explicite sert de déblocage audio fiable (bien plus
qu'une simple frappe au clavier), et le bouton "Lancer la partie" de l'hôte
affiche le nombre de joueurs prêts (ex. "3/4 prêts"). L'hôte garde le
contrôle final — il peut lancer la partie même si tout le monde n'a pas
encore confirmé, mais voit clairement qui est prêt.

## v1.34 — carte volée permanente + timer de décision

- **Carte volée** : reste marquée en **rose** pendant tout le reste de la
  partie (plus seulement quelques secondes), avec une mention **"Volée à
  [pseudo]"** affichée en bas de la carte, dans la frise et dans la fenêtre
  de placement/défi.
- **Temps pour répondre à une carte** : nouveau réglage (60s par défaut,
  15 à 180s, réglable par l'hôte dans le salon). Si le joueur actif ne place
  pas (et ne passe pas) sa carte à temps, elle est automatiquement
  défaussée et le tour passe au joueur suivant — avec une barre de
  progression du même style que celle du bouton Révéler, visible par tous
  pendant la phase d'écoute.

## v1.35 — détail de carte au tap

Taper sur n'importe quelle carte déjà posée dans une frise ouvre une petite
popup avec une animation de retournement ("flip"), affichant en grand la
pochette, l'année, le titre, l'artiste — et la mention "Volée à [pseudo]" si
la carte a été volée. Une croix ✕ referme la popup. Pour la toute première
carte de chaque joueur (distribuée au lancement de la partie, avant tout
tirage), aucune pochette n'a encore été récupérée sur Deezer — un espace
réservé musical s'affiche à la place.

## v1.36 — quatre corrections/ajouts

- **Fix scroll bloqué sur Chrome mobile** : le fond animé plein écran
  n'avait pas `pointer-events:none` — malgré un `z-index` négatif, il
  pouvait intercepter les gestes de défilement sur certains navigateurs.
- **Fix vraie cause de la saisie qui bug pendant le compte à rebours** : le
  focus était déjà restauré depuis la v1.31, mais le champ de texte était
  quand même détruit et recréé toutes les 250ms, ce qui pouvait faire
  perdre des lettres tapées via le clavier prédictif mobile (IME). Le tick
  périodique du chronomètre saute maintenant complètement le redessin tant
  qu'un champ de texte est activement utilisé — les barres de progression
  restent fluides (animation CSS pure), seul le chiffre affiché fait une
  pause le temps de la frappe.
- **Barre "Révéler" visible pour tout le monde** : les autres joueurs voient
  maintenant combien de temps il reste avant que le joueur actif puisse
  révéler, pas seulement lui.
- **Lancement automatique** : si tous les joueurs (bots inclus, toujours
  comptés prêts) appuient sur "Prêt", la partie démarre toute seule, sans
  que l'hôte ait besoin de cliquer sur "Lancer la partie".

## v1.37 — vraie tentative de fix du scroll bloqué sur Chrome

Ma précédente correction (`pointer-events:none` sur le fond animé, v1.36)
n'a pas suffi. Le suspect suivant : `touch-action:pan-y` sur `html,body` —
une restriction assez stricte ("uniquement le défilement vertical, rien
d'autre") ajoutée il y a longtemps contre un tout autre bug de glissement
horizontal parasite, et Chrome peut l'interpréter différemment de Safari.
Remplacée par `touch-action:manipulation`, la valeur standard pour ce genre
d'app (autorise le défilement dans toutes les directions, désactive juste le
délai de double-tap pour zoomer). La protection contre le glissement
horizontal reste assurée par `overflow-x:hidden`, qui ne dépend pas de
touch-action.

Si ça ne suffit toujours pas, dis-le — je creuserai plus profondément (test
sur un appareil réel serait idéal, que je ne peux pas faire moi-même).

## v1.38 — options réorganisées avec sous-onglets + nouveaux réglages

- **Cartes pour gagner** (4-20, 10 par défaut) et **jetons de départ**
  (0-10, 2 par défaut) sont maintenant réglables par l'hôte.
- **Gros ménage dans le salon d'attente** : tous les réglages (mode
  d'écoute, DJ, musique, délais, joueurs max, visibilité, périodes) sont
  regroupés derrière un seul bouton **"⚙️ Options de la partie"**, organisé
  en 4 sous-onglets (🎮 Partie, 🔊 Écoute, ⏱️ Temps, 🎵 Chansons) — fini le
  salon interminable à faire défiler.
- Ne reste directement visible dans le salon : la liste des joueurs, le
  bouton **"Prêt(e)"** (renommé), et une **rangée de pastilles-résumé**
  (🏆10 🪙2 👥∞ 🔒Privé 🎉Ensemble 🔁Boucle ⏱️15s ⏳60s) pour voir l'essentiel
  d'un coup d'œil sans ouvrir le menu.

## v1.39 — achat direct de carte devient une option (désactivée par défaut)

- **Échanger 3 jetons contre une carte posée directement** (sans l'écouter)
  est maintenant une option dans "⚙️ Options de la partie" → onglet 🎮
  Partie, **désactivée par défaut**. L'hôte peut l'activer.
- Sur le second point : après relecture complète du code client et serveur,
  aucune restriction liée au mode d'écoute ("Tous ensemble" vs "Chacun chez
  soi") n'a été trouvée — testé et confirmé de bout en bout que la
  fonctionnalité fonctionne identiquement dans les deux modes une fois
  activée. Si le souci persiste après ce déploiement, dis-le avec plus de
  détails (quel mode, à quel moment précis) pour qu'on creuse ensemble.

## v1.40 — clarté du défi avec 3+ joueurs

- Le bouton Défier était **déjà** correctement masqué pour tout le monde dès
  qu'un défi existe (vérifié, ça marchait déjà avec 3+ joueurs) — le
  serveur n'accepte qu'un seul défi par carte, testé explicitement avec 3
  joueurs pour confirmer qu'un second joueur ne peut pas écraser le défi du
  premier.
- **Vrai bug corrigé** : contre un Bot, le message affiché était codé en
  dur "**Tu** as déjà défié ce placement" — avec 3+ joueurs, si c'était
  quelqu'un d'autre qui avait défié, le message était faux. Affiche
  maintenant le vrai nom du joueur qui a défié.
- **Ajout** : le joueur actif voit maintenant lui aussi qui l'a défié
  ("🚨 [pseudo] a défié [pseudo] !"), ce qu'il ne voyait jamais avant.

## v1.41 — fix de la course entre deux "Défier" simultanés

Trouvé le vrai trou : quand deux joueurs appuyaient sur "Défier" presque en
même temps, le second (arrivé quelques millisecondes trop tard côté
serveur) était rejeté **en silence** — aucun message, rien. Et même quand
le serveur envoyait un message d'erreur, l'écran de partie ne l'affichait
nulle part.

Corrigé des deux côtés :
- Le serveur envoie maintenant un message explicite : *"Trop tard — [pseudo]
  a défié en premier."*
- L'écran de partie affiche maintenant les messages d'erreur (il ne le
  faisait qu'à l'accueil et dans le salon avant), et ils disparaissent
  seuls après 4 secondes.

## v2.0 — 🎉 catalogue élargi à 712 chansons

Ajout de **403 nouvelles chansons** (309 → 712), dédupliquées contre le
catalogue existant, avec une bonne répartition sur toutes les décennies :

| Période | Chansons |
|---|---|
| 1900s | 8 |
| 1910s | 16 |
| 1920s | 19 |
| 1930s | 25 |
| 1940s | 23 |
| 1950s | 50 |
| 1960s | 79 |
| 1970s | 88 |
| 1980s | 86 |
| 1990s | 94 |
| 2000s | 65 |
| 2010s | 98 |
| 2020s | 61 |

Nouveauté notable : plus de diversité musicale — chanson française
(Piaf, Brel, Aznavour, Stromae, Angèle...), musique latine, K-pop, afrobeats,
reggae, metal, punk, et davantage de country, en plus des classiques pop/rock
déjà présents.

Comme toujours, le démarrage du serveur doit associer chaque nouvelle
chanson à Deezer avant d'ouvrir le salon — avec 712 titres au lieu de 309,
le tout premier démarrage après ce déploiement prendra plus de temps que
d'habitude (les démarrages suivants restent rapides tant que le disque
persiste, voir la note v1.30 plus haut).

## v2.1 — modes spéciaux (presets)

Nouvel onglet **🎮 Modes** dans "Options de la partie" (premier onglet,
avant "Partie"), avec trois préréglages qui appliquent d'un coup une
combinaison des réglages existants :

- **🎵 Original** — 10 cartes pour gagner, 2 jetons de départ, 15s pour
  révéler, 60s pour répondre. Les réglages par défaut.
- **🩸 Hardcore** — 0 jeton de départ (donc pas moyen de passer au premier
  tour), 5s seulement pour révéler, 15s pour répondre.
- **😈 Fais-toi des ennemis** — 12 cartes pour gagner, 4 jetons de départ,
  délai de révélation allongé à 20s, pour pouvoir défier beaucoup plus
  souvent avant que la fenêtre ne se referme.

**Précision honnête** : ces modes sont de purs préréglages des réglages déjà
existants, comme demandé — pas de nouvelle mécanique de jeu. Ça veut dire
que "Fais-toi des ennemis" n'a pas de vraie cible-Némésis assignée en
secret comme pitché initialement — il encourage juste les défis fréquents
via plus de jetons et une fenêtre de révélation plus longue. Si l'envie
vient d'ajouter la mécanique de Némésis/Vengeance plus tard, c'est un
prochain pas naturel, distinct de ce préréglage.

Le mode actif s'affiche aussi en pastille (🎵/🩸/😈) sous "Joueurs" pour
info rapide sans ouvrir le menu.

## v2.2 — Hardcore fait vraiment mal maintenant

Ajout de la règle qui manquait au preset Hardcore (repérée après coup) :
**une erreur de placement fait perdre une carte au hasard de sa propre
frise**, en plus de défausser la chanson qui venait d'être piochée. La
carte perdue est remélangée dans la pioche — quelqu'un pourra la retirer
plus tard. Si le placement est volé par un adversaire via un défi réussi,
la pénalité s'applique aussi (l'actif s'est quand même trompé).

Visible dans la bannière de résultat : "🩸 Hardcore : [pseudo] perd aussi
'[titre]' de sa frise !" en plus du message habituel.

C'est la seule vraie mécanique de jeu (pas juste un préréglage de réglages
existants) parmi les modes spéciaux, et elle est strictement limitée au
mode Hardcore.

## v2.3 — la carte de départ est protégée en Hardcore

Confirmation utile : non, elle **pouvait** être perdue jusqu'ici (la v2.2
n'avait aucune protection). Corrigé : la toute première carte reçue au
lancement de la partie est maintenant **exemptée** de la pénalité Hardcore
— seules les cartes gagnées en cours de partie peuvent être reperdues au
hasard. Si un joueur n'a encore que sa carte de départ, une erreur ne lui
coûte plus rien de plus que la chanson piochée.

Testé de bout en bout dans les deux sens : la carte de départ survit seule
en main, et une carte gagnée peut toujours être perdue par la suite.

## v2.3.1 — le point à côté du prénom reflète le statut prêt

Le sablier ⏳/✅ à côté des prénoms dans le salon est retiré. Le petit point
déjà présent à gauche du prénom (auparavant toujours vert) change
maintenant vraiment de couleur : **rouge** si le joueur n'est pas prêt,
**vert** dès qu'il a appuyé sur "Prêt(e)".

## v2.3.2 — ajout de Percheye

6 titres de l'artiste indie pop français **Percheye** (Tristan Rolland),
2022-2025 : Will You Come Home, Mr. Conflict, Getting Occupied, Call Me,
Drained Out, Ballade. Catalogue à 718 chansons.
