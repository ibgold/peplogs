# Installer PepLogs API v2 dans chaque Sheet

Cette version est préparée pour un code identique recopié manuellement dans plusieurs projets Apps Script, chacun rattaché à son propre Sheet. Aucun déploiement ni aucune modification de Sheet réel n'a été effectué par cette proposition GitHub.

## Tester d'abord sur une copie

1. Dupliquer un Sheet avec sa structure et conserver une sauvegarde du code actuellement déployé. Utiliser uniquement cette copie pour le premier essai.
2. Dans la copie, ouvrir **Extensions > Apps Script**. Remplacer l'ancien code de l'API par le contenu intégral de [Code.gs](Code.gs), sans conserver une seconde définition de `doGet`, `doPost` ou des fonctions de lecture. Conserver les éventuels scripts indépendants qui n'utilisent pas ces noms.
3. Dans l'éditeur, sélectionner **setupPepLogs**, puis **Exécuter** et autoriser l'accès demandé par Google. Cette fonction doit être exécutée dans le projet lié au Sheet concerné.
4. Vérifier dans le Sheet que les colonnes de données existantes sont conservées et que les colonnes techniques `_pep_*` ont été ajoutées à droite des colonnes existantes. Les anciennes lignes reçoivent un identifiant et une version. La fonction peut être relancée sans renouveler ces identifiants.
5. Créer un déploiement de test **Application Web**. Conserver le modèle d'exécution et d'accès voulu pour l'application ; cette version ne remplace pas le contrôle d'accès du déploiement.
6. Ouvrir l'URL de ce déploiement avec `?action=ping` : attendre `success: true`, `apiVersion: 2` et `configured: true`. Vérifier aussi `?action=getAllData`, puis connecter une version locale du front de cette branche à cette URL de test.
7. Vérifier les écrans et les écritures : ajouter une saisie fictive, modifier un preset, ajouter puis fermer une reconstitution, supprimer une saisie, tester une coupure réseau et le retour en ligne. Vérifier qu'une suppression disparaît du site et reste dans le Sheet avec `_pep_deleted` à `true`. Vérifier les cycles, le calendrier, l'installation PWA et un rechargement hors ligne.

Le test automatique couvre aussi la réponse perdue après enregistrement, le déplacement des lignes, le refus d'une modification périmée et l'enchaînement de deux modifications hors ligne. Il utilise un simulateur de Google Sheets ; il ne remplace pas l'essai réel de la copie.

## Reporter une version validée dans les autres Sheets

Pour chaque Sheet, reprendre les étapes 2 à 4 dans **son propre** projet Apps Script. `setupPepLogs` enregistre l'identifiant du Sheet courant dans les propriétés de ce projet. Il faut l'exécuter aussi après duplication d'un Sheet : ne pas conserver une propriété qui désignerait l'original.

Après validation, mettre à jour le déploiement existant via **Déployer > Gérer les déploiements > Modifier > Nouvelle version > Déployer**. Utiliser le déploiement existant pour conserver son URL. Le simple collage/enregistrement du code ne met pas à jour un déploiement versionné.

Avant de basculer une base réelle, synchroniser et vérifier les anciennes opérations en attente sur les appareils qui l'utilisent. Une ancienne requête déjà envoyée sans `requestId` ne peut pas devenir rétroactivement dédoublonnable. Le front conserve la compatibilité avec l'ancienne API, mais la protection complète exige le front et le serveur v2.

## Ce que la migration change

Les colonnes métier gardent leur ordre. La migration ajoute ces colonnes après les colonnes existantes, y compris les éventuelles colonnes personnalisées :

| Colonne | Rôle |
| --- | --- |
| `_pep_id` | Identifiant permanent de la ligne, indépendant de sa position |
| `_pep_version` | Version utilisée pour refuser une modification périmée |
| `_pep_last_request` | Identifiant de la dernière requête appliquée |
| `_pep_last_fingerprint` | Empreinte du contenu de cette requête |
| `_pep_create_fingerprint` | Empreinte de la requête de création, conservée après modification |
| `_pep_deleted` | Marqueur de suppression : la ligne est exclue des réponses de l'application |

Ne pas recopier les identifiants techniques pour créer une nouvelle entrée manuellement, ni supprimer les lignes marquées comme supprimées tant que d'anciennes requêtes peuvent être rejouées. Copier une ligne avec son identifiant crée un doublon de clé ; la migration et les écritures le refusent plutôt que de choisir arbitrairement une ligne.

Les modifications manuelles dans Sheets ne mettent pas automatiquement à jour `_pep_version`. Les protections de version couvrent les modifications faites via l'API ; un changement manuel de contenu pendant une synchronisation reste un cas à traiter séparément.

## Compatibilité et limites

- Les anciens noms d'actions, champs et numéros de lignes sont conservés. Une requête qui fournit un `id` utilise exclusivement cet identifiant ; elle ne se rabat jamais sur un numéro de ligne devenu faux.
- Une création envoyée avec le même `requestId` est retrouvée dans sa ligne et n'est pas ajoutée une seconde fois, même après sa suppression logique. Une réutilisation de cet identifiant avec un contenu différent est refusée.
- Une modification rejouée immédiatement est reconnue. Si une autre modification a été appliquée entre-temps, l'ancienne version est refusée au lieu d'écraser la nouvelle. Le front conserve le conflit dans sa file ; l'interface de résolution des conflits n'est pas encore implémentée.
- Les lectures ne prennent pas le verrou d'écriture. Elles ne constituent pas pour autant une transaction/snapshot atomique de tous les onglets. Les écritures de cette API sont verrouillées par projet ; les éditions manuelles et les autres scripts ne participent pas automatiquement à ce verrou.
- Les protections serveur ne rendent pas le stockage local transactionnel entre plusieurs onglets du navigateur. La coordination entre onglets reste à ajouter.
- Les paramètres de cycles restent ceux du premier lot : début déduit de la première injection du peptide, sans date de départ personnalisable ni planning de plusieurs prises quotidiennes.

## Retour arrière

Ne pas simplement redéployer l'ancien script après des suppressions v2 : il ignore `_pep_deleted` et ferait réapparaître ces entrées. Avant les essais, conserver la copie du Sheet et l'ancien code. Si un retour arrière devient nécessaire, arrêter les écritures et réconcilier les nouvelles opérations avant de restaurer la sauvegarde ; ne pas écraser des saisies récentes.

## Références Google utilisées

- [Scripts liés à un fichier](https://developers.google.com/apps-script/guides/bound) : le contexte de l'éditeur permet de retrouver le fichier parent ; les mêmes méthodes ne sont pas disponibles dans le contexte web app. L'API utilise donc `openById` avec la propriété enregistrée par l'installation.
- [Verrous Apps Script](https://developers.google.com/apps-script/reference/lock/lock) : les écritures sont vidées par `SpreadsheetApp.flush()` avant la libération du verrou.
- [Gestion des déploiements](https://developers.google.com/apps-script/concepts/deployments) : une version déployée doit être mise à jour explicitement.
