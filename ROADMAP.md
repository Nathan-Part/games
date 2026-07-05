# 🗺️ Roadmap — Jeu de combat navigateur

Détail de toutes les tranches du projet (voir [`CLAUDE.md`](CLAUDE.md) pour le contexte général, l'architecture, les conventions et l'API debug). Chaque ligne = une tranche livrée avec sa description et ses fonctions debug associées. Mettre à jour ce fichier (description + statut) quand une tranche est finie.

**Statut global** : tranches 1→19, 21, 23→202 terminées. Reste : 20 (mains FPS), 22 (multijoueur).

| # | Tranche | Statut |
|---|---------|--------|
| 1 | **Déplacement** — ZQSD/flèches, course, saut, caméra 1re/3e personne | ✅ Fait |
| 2 | **Tir & armes** — tir hitscan, cadence, munitions/recharge, cibles | ✅ Fait |
| 3 | **Ennemis (IA)** — patrouille/poursuite/tir, ligne de vue | ✅ Fait |
| 4 | **Vie/dégâts/score** — PV, régén, dégâts localisés tête/torse/jambes, Game Over | ✅ Fait |
| 5 | **Drapeau « validé pour le jeu »** — Studio → lobby (`gameReady`) | ✅ Fait |
| 6 | **Son** — Web Audio (synthèse), mute | ✅ Fait |
| 7 | **Arme visible** — AR‑15 + viewmodel FPS | ✅ Fait |
| 8 | **Visée ADS** — viseur + assistance douce (axe X) | ✅ Fait |
| 9 | **Ennemis armés** — arme visible + flash bouche + traceur depuis le canon | ✅ Fait |
| 10 | **Vagues + survie** — vagues croissantes, HUD compteur/bannière, record meilleure vague | ✅ Fait |
| 11 | **Types d'ennemis + meilleure IA** — rusher/shooter/tank, contournement, mise à couvert | ✅ Fait |
| 12 | **Monnaie + sauvegarde** — argent par kill/vague, localStorage `cod-save-v1` | ✅ Fait |
| 13 | **Boutique — armes** — catalogue, acheter/équiper, vitrine 3D turntable, carrousel | ✅ Fait |
| 14 | **Améliorations d'arme** — niveaux achetables : +dégâts/+cadence/−recul/+chargeur | ✅ Fait |
| 15 | **Améliorations du perso** — +Vie/+Régén/+Vitesse achetables et persistants | ✅ Fait |
| 16 | **Personnalisation du perso** — shop persos et skins (skins remplacés en #26) | ✅ Fait |
| 17 | **Page d'accueil** — perso 3D + argent/record + boutons Jouer/Boutique/Réglages | ✅ Fait |
| 18 | **Réglages** — sensibilité souris, volume, vue par défaut ; panneau sliders + bascule | ✅ Fait |
| 19 | **Vraie map** — arène urbaine : murs, bâtiments, cover, sol bitume, lampes | ✅ Fait |
| 20 | **Changer les mains FPS** — modèle de bras FPS dédié pour remplacer les bras low‑poly | ⬜ À faire |
| 21 | **Mini-carte / radar** — radar circulaire, blips ennemis orientés, couleurs par type | ✅ Fait |
| 22 | **Multijoueur** — co‑op vagues à plusieurs ou versus en réseau (gros morceau) | ⬜ À faire |
| 23 | **Cadavres + loot d'arme** — corps allongé au sol, armes ennemies variées, ramassage **G** | ✅ Fait |
| 24 | **Système de rareté** — `RARITIES` Commun/Rare/Épique/Légendaire, badges, champ sur tous les catalogues | ✅ Fait |
| 25 | **Personnages en vitrine 3D** — carrousel onglet Personnage, Acheter/Équiper/Améliorer | ✅ Fait |
| 26 | **Accessoires** — casque + costume 3D sur os (remplace skins), sous-onglets boutique | ✅ Fait |
| 27 | **Danses / emotes** — catalogue, sélectionner 3, touches 1/2/3 en partie | ✅ Fait |
| 28 | **Boost / équipement à stats** — gilet/bottes/médaille → +Vie/+Vitesse/+Régén, persistant | ✅ Fait |
| 29 | **Combo / killstreak** — multiplicateur ×1→×5 argent+score, `#combo-hud` | ✅ Fait |
| 30 | **Nombres de dégâts flottants** — sprite 3D au point d'impact, crit doré en tête | ✅ Fait |
| 31 | **Vagues de boss** — tous les 5 niveaux, PV×8, barre de vie `#boss-hud`, bannière | ✅ Fait |
| 32 | **Packs de soin** — drop ennemis (boss garanti), ramassage proximité → +30 PV | ✅ Fait |
| 33 | **Grenades** — touche **B**, jet en arc, explosion AoE, stock 3 rechargé par vague | ✅ Fait |
| 34 | **Power-ups temporaires** — ×2 dégâts / tir rapide, 8 s, `#power-hud` | ✅ Fait |
| 35 | **Dash / esquive** — touche **C**, burst distance, cooldown 1.4 s, `#dash-hud` | ✅ Fait |
| 36 | **Fusil à pompe** — arme `shotgun`, gerbe 8 plombs en cône | ✅ Fait |
| 37 | **Kamikaze (bomber)** — type ennemi rapide, explose à la mort/contact, AoE joueur | ✅ Fait |
| 38 | **Annonces de kill** — HEADSHOT / DOUBLE/TRIPLE KILL / BOSS DOWN, `#kill-callout` | ✅ Fait |
| 39 | **Aperçu d'article extensible** — chaîne `assetDir`/GLB → `build` → image → placeholder | ✅ Fait |
| 40 | **Menu pause** — Échap → gel boucle + menu Reprendre/Recommencer/Menu | ✅ Fait |
| 41 | **Barils explosifs** — barils rouges tirables → explosion AoE ennemis | ✅ Fait |
| 42 | **Power-up slow-mo** — orbe violet, ennemis ×0.4, joueur normal | ✅ Fait |
| 43 | **Stats de partie** — Game Over enrichi : Kills/Headshots/Précision | ✅ Fait |
| 44 | **Succès / achievements** — 4 succès persistés + toast | ✅ Fait |
| 45 | **Corps-à-corps (couteau)** — touche **X**, dégâts devant, portée 2.6 m, cooldown | ✅ Fait |
| 46 | **Modes de difficulté** — Facile/Normal/Difficile, sélecteur Réglages, persisté | ✅ Fait |
| 47 | **[BUG] Ennemi flotte en l'air à la mort** — clamp bidirectionnel (anti-float + anti-sink) sur position.y du cadavre | ✅ Fait |
| 48 | **[BUG] Vague 2 spawn dans obstacles** — `randomSpawn()` retry ×10 avec `pointInObstacle()` | ✅ Fait |
| 49 | **Boutique — sous-catégories filtrées + 15 armes nommées** — `filteredWeapons()`, catégories Assaut/SMG/Sniper/Pompe/Pistol/LMG/Mêlée, noms originaux (Viper-AR, Raptor X5, Cyclone MK3, Hornet PDW, Storm-9, Eclipse SR, Phantom L115, Devastator 870, Breacher MK2, Specter-P, Jackal-45, Thunderer LMG) | ✅ Fait |
| 50 | **3 couteaux (Lame franche gratuit, Bowie sanglante, Lame Fantôme) + viewmodel flash touche X** — `buildKnifeMesh(variant)`, `showKnifeFlash()` sur caméra 300ms | ✅ Fait |
| 51 | **Badges de rareté plus visibles** — glow renforcé sur `.rb`, halo couleur-rareté `box-shadow` sous chaque `.icard` | ✅ Fait |
| 52 | **Perso accueil & shop en idle looping** — `playLobbyIdle()` joue `Casual_Walk` en loop (plus de pose figée) ; `buildCharDisplay()` crée mixer + animate | ✅ Fait |
| 53 | **Boosts déséquipables par partie (run-based)** — `runBoostOverrides`, `unequipBoostRun(slot)`, bouton "✕ Run" dans le shop Boost, reset au restart | ✅ Fait |
| 54 | **Kill feed** — log HUD top-right, 1 entrée/kill (type + HEADSHOT/BOSS DOWN), max 5, fade 4 s, reset au restart ; `killFeedCount()`, `lastKillFeedText()`, `setEnemyLastHitHead()` | ✅ Fait |
| 55 | **Challenges de session** — 3 mini-objectifs aléatoires/partie (kills/headshots/vague/couteau/sans-dégâts), barre progression, toast + récompense $ ; `challengeCount()`, `forceCompleteChallenge()` | ✅ Fait |
| 56 | **Stamina de sprint** — jauge 0-100 (drain 25/s en sprint, regen 15/s), `staminaDepleted` coupe la course jusqu'à 20, barre HUD bas-gauche ; `stamina()`, `staminaDepleted()`, `setStamina()` | ✅ Fait |
| 57 | **Flashbang** — grenade aveuglante touche **N**, 2 stocks/vague, aveugle ennemis 2 s dans R=9m, flash blanc joueur si R<10m, IA freeze ; `flashbangCount()`, `explodeFlashbangAt()`, `enemyBlinded()` | ✅ Fait |
| 58 | **Killstreak rewards** — 3/5/7 kills en 8 s → rechargement auto / bouclier 5 s (-50% dégâts) / ×2 argent 10 s, banner HUD animé ; `registerKsKill()`, `ksCount()`, `ksShieldActive()`, `ksMoneyMult()` | ✅ Fait |
| 59 | **Hit-marker** — croix centrale 120 ms : blanc corps, rouge headshot ; `showHitMarker(hs)` | ✅ Fait |
| 60 | **XP + niveaux** — 25 XP/kill (+25 headshot), 100×vague/vague, niveaux 1-50, 10 titres Recrue→Légende, barre HUD violette, persisté save ; `xpTotal()`, `playerLevel()`, `playerTitle()`, `addXp(n)` | ✅ Fait |
| 61 | **Sniper scope** — overlay lunette circulaire FOV 20°, viewmodel masqué en ADS sniper (Eclipse SR, Phantom L115) ; `sniperScopeActive()`, `forceEquipWeapon(id)` | ✅ Fait |
| 62 | **Contrats quotidiens** — 3 contrats/jour (seed date), 8 types kills/headshots/vague/mêlée, récompenses 500-2000$, persistés save ; `dailyContracts()`, `forceDailyComplete(i)`, `dailyContractsDone()` | ✅ Fait |
| 63 | **Indicateur direction dégâts** — 4 flèches CSS bord écran (haut/bas/gauche/droite), rouge 0.8 s, calcul yaw relatif joueur→ennemi ; `showDamageDir(deg)` | ✅ Fait |
| 64 | **Mode tir burst/auto** — touche **T** bascule auto↔burst (3 coups) sur armes assaut, indicateur HUD jaune `AUTO`/`BURST` ; `fireMode()`, `fireModeToggle()` | ✅ Fait |
| 65 | **Claymore / mine de proximité** — touche **Y**, max 2, détection R=2 m (armée 1 s après pose), explosion AoE R=4 m 200 dmg, disque rouge scène ; `mineStock()`, `mineCount()`, `placeMine()`, `explodeMineAt()` | ✅ Fait |
| 66 | **Barres de vie ennemis** — projection 3D→2D CSS, vert/orange/rouge, masquée si mort ou >20 m ; `enemyHpBarFrac(i)` | ✅ Fait |
| 67 | **Bouclier rechargeable** — 50 PV absorbant les dégâts, regen 15/s après 4 s sans dégâts, barre HUD bleue ; `shieldHp()`, `maxShield()`, `setShield(v)` | ✅ Fait |
| 68 | **Toast level-up** — annonce violette animée 3 s au passage de niveau, déclenchée automatiquement par `addXp` ; `showLevelUpToast(n)` | ✅ Fait |
| 69 | **Grenade fumigène** — touche H, 2 stocks/vague, nuage 5 s R=4 m, précision ennemis 5% dans fumée, HUD ; `smokeStock()`, `smokeCount()`, `throwSmoke()`, `explodeSmokeAt(x,z)`, `enemyInSmoke(i)` | ✅ Fait |
| 70 | **Marqueurs de spawn** — cercles rouges pulsants 3 s aux positions de spawn ennemi, auto-clear ; `showSpawnMarker(x,z)`, `spawnMarkerCount()` | ✅ Fait |
| 71 | **Barre de rechargement** — arc SVG orange sous le réticule pendant reload, `reloadProgress()`, `setAmmo(n)` | ✅ Fait |
| 72 | **Compteur streak kills** — HUD orange 🔥 N KILLS, reset sur tout hit reçu, visible dès 2 kills ; `streakKills()` | ✅ Fait |
| 73 | **Étincelles d'impact** — particules jaunes 3D sur tir ennemi manqué, physique gravité 0.4 s ; `spawnImpactSparks(x,y,z)`, `impactSparkCount()` | ✅ Fait |
| 74 | **Blood screen** — vignette rouge radiale bords écran sur dégâts ≥20, fade 1 s ; `showBloodScreen(intensity)` | ✅ Fait |
| 75 | **Banner de vague amélioré** — slide-in titre VAGUE N + sous-titre (BOSS/bonne chance), 2.5 s ; `showWaveBanner(n, isBoss)` | ✅ Fait |
| 76 | **Countdown inter-vague** — compte à rebours bas écran bleu entre vagues, masqué en vague active ; `waveCountdown()` | ✅ Fait |
| 77 | **Camera kick au tir** — pitch +1.5° dissipé 80 ms, réduit ×0.5 en ADS ; `cameraKick()`, `lastCameraKickT()` | ✅ Fait |
| 78 | **Mode semi-auto** — touche P bascule, rising-edge fire, pistolets/snipers semi-auto par défaut ; `semiAutoMode()`, `setSemiAuto(b)` | ✅ Fait |
| 79 | **Orbes d'argent** — sphère dorée à la mort ennemi, flottement sinusoïdal, auto-collecte R<1.5 m ; `moneyOrbCount()`, `spawnMoneyOrb(x,z,amount)` | ✅ Fait |
| 80 | **Stats globales persistantes** — kills/headshots/playtime cumulés dans save `lifetime`, `lifetimeStats()`, `addLifetimeStat(k,n)` | ✅ Fait |
| 81 | **Low ammo warning** — clignotement rouge `.hud-ammo` quand ≤25% chargeur ; `isLowAmmo()`, `curMag()` | ✅ Fait |
| 82 | **Shockwave ring** — anneau orange expandant 0.3 s sur chaque explosion (grenade/baril/claymore/bomber) ; `shockwaveCount()`, `spawnShockwave(x,y,z)` | ✅ Fait |
| 83 | **Rebond grenade** — réflexion sur les AABB de la map, max 2 rebonds, friction 0.65 ; `grenadeBouncedCount()`, `grenadeFirstBounces()` | ✅ Fait |
| 84 | **Renforts ennemis** — shooter/tank appelle 1 renfort après 12 s (1 seul/ennemi), annonce RENFORTS! ; `enemyCalledReinforcement(i)`, `forceCallReinforcement(i)` | ✅ Fait |
| 85 | **Ennemi ramasse arme** — rusher sans arme ramasse l'arme d'un cadavre proche (R<2 m), weaponId mis à jour ; `enemyPickedUpWeapon(i)`, `forceEnemyPickup(i)` | ✅ Fait |
| 86 | **Footsteps sonores** — tone 80 Hz toutes les 0.38 s (marche) / 0.22 s (course), silence si immobile/en l'air ; `lastFootstepT()`, `footstepInterval()` | ✅ Fait |
| 87 | **Backstab** — ×1.5 dégâts si l'ennemi tourne le dos (dot product < −0.5) ; `isBackstab(i)`, `backstabMult()`, `forceEnemyBackstab(i)` | ✅ Fait |
| 88 | **Cover dynamique** — ennemi blessé <50% HP cherche obstacle R<6 m, état `cover` 2 s (ne tire pas) ; `enemyInCover(i)`, `forceEnemyCover(i)` | ✅ Fait |
| 89 | **Laser sniper ADS** — rayon rouge `Line` 60 m du canon en ADS sniper, masqué hors ADS ; `sniperLaserVisible()`, `sniperLaserLength()` | ✅ Fait |
| 90 | **Rang de fin de partie** — S/A/B/C/D calculé sur kills+précision+vague, affiché Game Over en doré ; `runRank()`, `rankScore()`, `setRunStatsOverride(k,acc,w)` | ✅ Fait |
| 91 | **Zone de danger** — cercle rouge au sol shrinkant (20→14→9→5 m / 3 vagues), 5 dégâts/s hors zone ; `dangerZoneRadius()`, `playerInZone()`, `dangerZoneDamage()` | ✅ Fait |
| 92 | **Spread au mouvement** — déviation NDC ×2.5 en course, ×1.5 en marche, ×1 en ADS/immobile ; `currentSpread()`, `setSpreadOverride(v)` | ✅ Fait |
| 93 | **Pluie** — 200 particules Points tombantes, fog density augmentée, activable ; `rainActive()`, `setRain(b)`, `rainParticleCount()` | ✅ Fait |
| 94 | **Mode hardcore** — pas de régén ni de soins, indicateur HUD `☠ HARDCORE` rouge, reset au restart ; `hardcoreMode()`, `setHardcore(b)` | ✅ Fait |
| 95 | **Chargeur étendu (power-up)** — orbe vert, chargeur ×2 pendant 15 s, intégré système power-up ; `extMagActive()`, `extMagTimeLeft()`, `spawnExtMag(x,z)` | ✅ Fait |
| 96 | **Surchauffe LMG** — Thunderer LMG surchauffe après 20 tirs, pause 2 s, barre chaleur HUD orange ; `overheatLevel()`, `overheatPaused()`, `forceOverheat()`, `setOverheat(n)` | ✅ Fait |
| 97 | **Arc trajectoire grenade** — 10 points jaunes prévisualisés en maintenant B, masqué au lancer ; `grenadeArcVisible()`, `grenadeArcPointCount()`, `showGrenadeArc(b)` | ✅ Fait |
| 98 | **Munitions infinies (debug)** — mode `setInfiniteAmmo(b)` désactive consommation, reset au restart ; `infiniteAmmoActive()`, `setInfiniteAmmo(b)` | ✅ Fait |
| 99 | **Flank warning** — icône ◄/► bord écran rouge 1 s si ennemi à >100° de la visée (R<20 m) ; `flankWarning()`, `lastFlankDir()`, `triggerFlank(dir)`, `expireFlank()` | ✅ Fait |
| 100 | **Bonus argent fin de vague** — survie parfaite (0 dégât) → vague×50$ + toast orange ; `lastWaveBonus()`, `waveBonus()`, `forceWaveBonus(w)` | ✅ Fait |
| 101 | **Ricochet balle** — 20% chance sur mur AABB, dégâts ×0.4, max 1 rebond par tir ; `ricochetsTotal()`, `lastRicochetHit()`, `forceRicochetHit()` | ✅ Fait |
| 102 | **Long shot bonus** — kill à >30 m → LONG SHOT! doré +25$ +10 XP ; `longShotCount()`, `lastKillDist()`, `forceLongShot()` | ✅ Fait |
| 103 | **Screen shake explosion** — vibration caméra ×3 sur grenade/baril/claymore/bomber, dissipé 300 ms ; `screenShakeActive()`, `triggerScreenShake(i)` | ✅ Fait |
| 104 | **Ennemi berserker** — mêlée ×2, vitesse ×1.8, HP ×1.5, glow orange, spawn vague 6+ ; `spawnEnemyTypeAt(i,'berserker',x,z)` | ✅ Fait |
| 105 | **Precision shot bonus** — immobile+ADS → dégâts ×1.3 + HUD PRECISION cyan 1.5 s ; `precisionShotCount()`, `lastWasPrecision()`, `forcePrecisionShot()` | ✅ Fait |
| 106 | **Empty mag click feedback** — son click 3 kHz + flash rouge HUD ammo si tir à vide ; `emptyFireCount()`, `lastEmptyFire()`, `triggerEmptyFire()` | ✅ Fait |
| 107 | **Ennemi fantôme (ghost)** — semi-transparent 35%, absent du radar, vitesse ×1.3, vague 8+ ; `enemyIsGhost(i)` | ✅ Fait |
| 108 | **Tactical reload bonus** — recharger avec ammo>0 donne +1 munition bonus ; `tacticalReloadCount()`, `lastReloadWasTactical()` | ✅ Fait |
| 109 | **Orbe de bouclier** — power-up bleu instant, recharge bouclier à 50 PV max ; `spawnShieldOrb(x,z)`, `lastShieldOrbPickup()` | ✅ Fait |
| 110 | **Headshot streak** — streak kills en tête consécutifs, +10$/kill en streak≥3, "HEADSHOT STREAK N!", reset sur hit reçu ; `headStreakCount()`, `resetHeadStreak()` | ✅ Fait |
| 111 | **Ennemi sniper** — type `sniper`, dmg ×2.5, cadence 4s, glow rouge, vague 5+ ; `enemyIsSniper(i)`, `enemySniperShootCd(i)` | ✅ Fait |
| 112 | **Auto-reload** — rechargement automatique 1.5s après mag vide, désactivable ; `autoReloadEnabled()`, `setAutoReload(b)`, `autoReloadPending()` | ✅ Fait |
| 113 | **Perfect burst** — 3/3 balles rafale sur même ennemi → "PERFECT BURST" +20$ ; `perfectBurstCount()`, `lastBurstPerfect()`, `burstRoundsLeft()` | ✅ Fait |
| 114 | **Armor system** — tank/boss résistance torse ×0.7, tête/jambes normales ; `enemyArmorMult(i,zone)`, `armoredKillCount()` | ✅ Fait |
| 115 | **HUD compteur ennemis** — ✕ N bas-droite rouge, mis à jour chaque frame, masqué si vague terminée ; `hudEnemyCountVisible()` | ✅ Fait |
| 116 | **Tir de suppression** — miss à <2m d'un ennemi → `suppressed` 1.5s (ne tire pas) ; `enemySuppressed(i)`, `suppressEnemy(i)`, `lastSuppressCount()` | ✅ Fait |
| 117 | **Ammo pack drop** — 20% chance sur cadavre, orbe jaune flottant, ramassage auto <1.5m → +50% mag ; `ammoPackCount()`, `spawnAmmoPack(x,z)`, `forceAmmoDrop(b)` | ✅ Fait |
| 118 | **Grenade collante** — touche **J**, 1/vague, se colle ennemi/sol, explose 2s 180 dmg AoE R=3m ; `stickyStock()`, `stickyCount()`, `throwSticky()`, `stickyAttachedEnemy(i)` | ✅ Fait |
| 119 | **Ennemi shielder (bouclier)** — type `shielder`, mesh PlaneGeometry cyan frontal, tirs bloqués dans cône ±60° avant (dot>0.5), vulnérable dos/flancs, vague 4-5 (slot berserker pré-v6) ; `enemyIsShielded(i)`, `shieldBlockCount()`, `forceShieldBlock(i)`, `lastShieldBlockI()` | ✅ Fait |
| 120 | **Ennemi medic (guérisseur)** — type `medic`, soigne 4 HP/0.5s à un allié blessé dans R=5m, glow vert, vague 6+ ; `enemyIsMedic(i)`, `medicHealCount()`, `forceMedicHeal(i)`, `lastMedicHealTarget()` | ✅ Fait |
| 121 | **Ennemi stunner (électrique)** — type `stunner`, tir = ralentit joueur ×0.3 pendant 0.5s + "STUNNÉ!", glow jaune, vague 7+ ; `isStunned()`, `stunCount()`, `stunDuration()`, `forceStun()` | ✅ Fait |
| 122 | **XP boost (power-up)** — orbe violet, ×2 XP pendant 12s, intégré POWERUPS ; `xpBoostActive()`, `xpBoostTimeLeft()`, `spawnXpBoost(x,z)` | ✅ Fait |
| 123 | **Munitions explosives (power-up)** — orbe rouge-orangé, tirs explosent AoE R=2m 40 dmg + shockwave ring, 8s ; `explosiveAmmoActive()`, `explosiveAmmoTimeLeft()`, `spawnExplosiveAmmo(x,z)` | ✅ Fait |
| 124 | **Ennemi décoy (leurre)** — clone rouge-transparent spawné par shooter vague 9+, dure 4s, exclu décompte vague ; `enemyIsDecoy(i)`, `decoyCount()`, `forceSpawnDecoy(i)`, `forceExpireDecoys()` | ✅ Fait |
| 125 | **Rampage mode** — 10 kills sans dégâts → invincibilité 5s + vitesse ×1.5 + callout RAMPAGE! ; `rampageActive()`, `rampageTimeLeft()`, `rampageKillCount()`, `triggerRampage()` | ✅ Fait |
| 126 | **Multiplicateur score de vague** — ×1 + floor(vague/5)×0.5, badge orange HUD `×N.N` à côté du score vague≥5 ; `waveScoreMult()`, `lastKillScore()` | ✅ Fait |
| 127 | **Speed boost (power-up)** — orbe bleu-vert, vitesse joueur ×2 pendant 6s ; `speedBoostActive()`, `speedBoostTimeLeft()`, `spawnSpeedBoost(x,z)` | ✅ Fait |
| 128 | **Ennemi grenadier** — type `grenadier`, lance grenades sur joueur toutes les 5s, glow jaune-vert, vague 8+ (slot sniper) ; `enemyIsGrenadier(i)`, `enemyGrenadeCount()`, `forceEnemyThrowGrenade(i)` | ✅ Fait |
| 129 | **Berserker frenzy** — berserker <25% PV entre en frenzy 2s : invincible + vitesse ×2.5 + rouge vif, callout FRENZY! ; `enemyInFrenzy(i)`, `frenzyCount()`, `forceEnemyFrenzy(i)` | ✅ Fait |
| 130 | **Molotov cocktail** — touche K, 1 stock/vague, jet en arc, zone de feu persistante R=3m 5s (6dmg/0.5s) ; `molotovStock()`, `molotovCount()`, `throwMolotov()`, `fireZoneActive()`, `enemyInFire(i)`, `igniteFireZoneAt(x,z)` | ✅ Fait |
| 131 | **Ennemi Juggernaut** — élite blindé vague 11+ (remplace le tank, v10=boss), HP×5, vitesse×0.45, armure intégrale toutes zones ×0.6 ; `enemyIsJuggernaut(i)` | ✅ Fait |
| 132 | **Tourelle sentinelle déployable** — touche L, max 1 active, portée 15m, 12dmg/0.5s, dure 20s, cooldown 25s ; `turretActive()`, `turretCount()`, `deployTurret()`, `turretTimeLeft()`, `turretCooldownLeft()` | ✅ Fait |
| 133 | **Orbe vampire (lifesteal)** — power-up intégré à POWERUPS, soigne 20% des dégâts infligés pendant 10s, désactivé en hardcore ; `vampireActive()`, `vampireTimeLeft()`, `spawnVampireOrb(x,z)` | ✅ Fait |
| 134 | **Adrénaline** — PV≤25% → dégâts joueur ×1.2 + HUD pulse rouge ; `adrenalineActive()`, `adrenalineMult()` | ✅ Fait |
| 135 | **Double saut** — un 2e saut en l'air (une fois), réarmé à l'atterrissage ; `doubleJumpAvailable()`, `airJump()`, `velY()` | ✅ Fait |
| 136 | **Grenade EMP** — touche O, 1 stock/vague, désactive le tir à distance des ennemis non-mêlée 4s R=6m ; `empStock()`, `empCount()`, `throwEmp()`, `enemyEmpDisabled(i)`, `triggerEmpBlastAt(x,z)` | ✅ Fait |
| 137 | **Dernier souffle (second wind)** — 1x/partie, coup fatal → survit à 1 PV + invincibilité 2s, désactivé en hardcore ; `secondWindAvailable()`, `secondWindUsed()`, `secondWindInvulnActive()` | ✅ Fait |
| 138 | **Frappe aérienne** — palier killstreak 10 kills/8s, jusqu'à 3 ennemis aléatoires 150 dmg ; `triggerAirstrikeNow()`, `airstrikeHitCount()` | ✅ Fait |
| 139 | **Bonus overkill** — excédent de dégâts ≥50 PV au kill → +25$ + callout OVERKILL ; `overkillCount()`, `lastOverkill()`, `forceOverkill(i)` | ✅ Fait |
| 140 | **Ennemi VIP** — cible marquée (dorée) dès la vague 3, argent/XP ×2 à la mort ; `enemyIsVip(i)`, `forceVip(i)` | ✅ Fait |
| 141 | **Ennemi toxique** — nuage de poison à sa mort (R=3m 4s, dmg périodiques joueur), alterne avec bomber dès v6 ; `enemyIsToxic(i)`, `poisonZoneActive()`, `playerInPoisonZone()`, `spawnPoisonZoneAt(x,z)` | ✅ Fait |
| 142 | **Frames d'invincibilité du dash** — aucun dégât reçu tant que `dashRemaining>0` ; `dashInvulnActive()` | ✅ Fait |
| 143 | **Caisse de ravitaillement** — toutes les 4 vagues, récompense aléatoire argent/grenades/munitions ; `carePackageActive()`, `carePackagePos()`, `spawnCarePackageAt(x,z)`, `forceCarePackageReward(t)` | ✅ Fait |
| 144 | **Réaction en chaîne des barils** — l'explosion d'un baril déclenche récursivement les barils voisins dans son rayon ; `barrelChainCount()` | ✅ Fait |
| 145 | **Power-up Visée stable** — neutralise le malus de spread mouvement/course pendant 8s ; `steadyAimActive()`, `steadyAimTimeLeft()`, `spawnSteadyAim(x,z)` | ✅ Fait |
| 146 | **Ennemi cryo** — zone de gel à sa mort (R=3m 4s), ralentit le joueur ×0.5, alterne avec stunner dès v7 ; `enemyIsCryo(i)`, `frostZoneActive()`, `playerInFrostZone()`, `spawnFrostZoneAt(x,z)` | ✅ Fait |
| 147 | **Power-up Regen boost** — double le taux de régénération passive pendant 10s ; `regenBoostActive()`, `regenBoostTimeLeft()`, `spawnRegenBoost(x,z)` | ✅ Fait |
| 148 | **Soin d'exécution** — mêlée qui tue un ennemi déjà sous 20% PV soigne 5 PV ; `executionHealCount()`, `lastExecutionHeal()` | ✅ Fait |
| 149 | **Bonus vague éclair** — nettoyer une vague en moins de 15s → +100$ + callout ; `speedClearCount()`, `lastSpeedClear()`, `waveElapsed()`, `ageWaveStart(s)` | ✅ Fait |
| 150 | **Power-up Munitions perforantes** — le tir traverse et touche un 2e ennemi aligné pendant 8s ; `piercingRoundsActive()`, `piercedHitCount()`, `spawnPiercingRounds(x,z)` | ✅ Fait |
| 151 | **Ennemi commandant** — aura +20% dégâts alliés (tir+mêlée) tant qu'il est vivant, alterne avec berserker dès v9 ; `enemyIsCommander(i)`, `commanderAliveMult()` | ✅ Fait |
| 152 | **Power-up Munitions incendiaires** — chaque impact allume une zone de feu persistante pendant 8s ; `incendiaryAmmoActive()`, `spawnIncendiaryAmmo(x,z)` | ✅ Fait |
| 153 | **Power-up Tir chanceux** — 25% de chance par tir de dégâts ×2 pendant 10s ; `luckyShotActive()`, `luckyShotCount()`, `lastLuckyShot()`, `forceLuckyShot(b)` | ✅ Fait |
| 154 | **Power-up Full-auto** — neutralise le semi-auto (maintien = feu continu) pendant 10s ; `fullAutoActive()`, `spawnFullAuto(x,z)` | ✅ Fait |
| 155 | **Boutique — onglet Consommables** — achat à l'unité (frag/flashbang/fumigène/collante/molotov/EMP), stock persistant en save, plus de refill gratuit par vague ; `consumables()`, `shop.buyConsumable`, `shop.consumablesCatalog`, `setConsumableStock` | ✅ Fait |
| 156 | **Série de points (killstreak loadout)** — choix de 3 bonus/4 (Tourelle/Claymore/Frappe aérienne/Caisse) en lobby, 100 pts/kill par bonus choisi, palier atteint → touche dédiée (Y/I/L/U) déclenche en ignorant l'ancien système ; frappe aérienne à ciblage manuel (carte cliquable) ; `selectedLoadout()`, `toggleLoadoutBonus`, `loadoutPoints`, `loadoutThreshold`, `loadoutReady`, `triggerLoadoutBonus`, `registerLoadoutKill` | ✅ Fait |
| 157 | **Classement local (leaderboard top 5)** — top 5 scores persistés (`save.leaderboard`), soumis automatiquement à la mort, affiché au Game Over + aperçu meilleur score sur l'accueil ; `leaderboard()`, `submitScore(entry)`, `clearLeaderboard()` | ✅ Fait (tests non exécutés) |
| 158 | **Mode Entraînement** — accessible depuis l'accueil, réutilise `startGame()` puis neutralise les vagues (`trainingActive_`), munitions infinies, cibles statiques existantes servent de mannequins ; `trainingActive()`, `startTraining()` | ✅ Fait (tests non exécutés) |
| 159 | **Prestige** — au niveau 50 (plafond XP #60), reset du niveau contre un badge ★ persistant cumulable (`save.prestige`), bouton dédié affiché si éligible, accueil + titre XP mis à jour ; `prestigeLevel()`, `canPrestige()`, `doPrestige()` | ✅ Fait (tests non exécutés) |
| 160 | **Power-up Aimant à argent** — élargit ×4 le rayon de collecte des orbes d'argent (#79) pendant 8s ; `moneyMagnetActive()`, `moneyMagnetTimeLeft()`, `spawnMoneyMagnet(x,z)` | ✅ Fait (tests non exécutés) |
| 161 | **Bonus premier sang** — le 1er kill de chaque vague donne +15$/+20 XP + callout ; `firstBloodCount()`, `lastWasFirstBlood()` | ✅ Fait (tests non exécutés) |
| 162 | **Statistique Meilleur coup** — max dégâts infligés en un seul tir sur la partie, tuile Game Over ; `runBestHit()` | ✅ Fait (tests non exécutés) |
| 163 | **Statistique Distance parcourue** — mètres parcourus sur la partie, tuile Game Over ; `runDistance()` | ✅ Fait (tests non exécutés) |
| 164 | **Statistique Meilleure série** — record de kills consécutifs sans dégât sur la partie, tuile Game Over ; `runBestStreak()` | ✅ Fait (tests non exécutés) |
| 165 | **Série de vagues parfaites** — tous les 3 crans de vagues consécutives sans dégât → +100$ + callout, en plus du bonus par-vague (#100) ; `perfectWaveStreak()` | ✅ Fait (tests non exécutés) |
| 166 | **Bonus sans recharge** — nettoyer une vague sans avoir rechargé (manuel ou auto #112) → +30$ + callout ; `noReloadClearCount()`, `waveReloadCount()` | ✅ Fait (tests non exécutés) |
| 167 | **Power-up Kevlar** — réduit de 30% les dégâts reçus pendant 10s, s'empile avec les boucliers existants ; `kevlarActive()`, `kevlarTimeLeft()`, `spawnKevlar(x,z)` | ✅ Fait (tests non exécutés) |
| 168 | **Bonus Infiltration** — élimination au couteau sur un ennemi non-détecté (état `patrol`) → +20$/+15 XP + callout ; `stealthKillCount()`, `lastStealthKill()` | ✅ Fait (tests non exécutés) |
| 169 | **Nouveaux succès** — 3 succès ajoutés au système existant (#44) : Vétéran (vague 10), Fortune de guerre (5000$), Légende (niveau 50) | ✅ Fait (tests non exécutés) |
| 170 | **Date sur le classement local** — affiche la date (JJ/MM) de chaque entrée du classement (#157) au Game Over | ✅ Fait (tests non exécutés) |
| 171 | **Power-up Berserk** — double les dégâts au couteau pendant 10s ; `berserkActive()`, `berserkTimeLeft()`, `spawnBerserk(x,z)` | ✅ Fait (tests non exécutés) |
| 172 | **Power-up Trousse instantanée** — +40 PV immédiat au ramassage, désactivé en hardcore ; `spawnInstantHeal(x,z)` | ✅ Fait (tests non exécutés) |
| 173 | **Statistique Meilleure vague** — record de kills réalisés en une seule vague, tuile Game Over ; `waveKillCount()`, `runBestWaveKills()` | ✅ Fait (tests non exécutés) |
| 174 | **Statistique Vague la plus rapide** — record du temps de nettoyage d'une vague, tuile Game Over ; `runFastestWave()` | ✅ Fait (tests non exécutés) |
| 175 | **Succès Collectionneur** — posséder 10 armes | ✅ Fait (tests non exécutés) |
| 176 | **Bonus Clutch** — tuer le dernier ennemi d'une vague à <20% PV → +30$/+25 XP + callout ; `clutchCount()` | ✅ Fait (tests non exécutés) |
| 177 | **Succès Perfectionniste** — 5 vagues parfaites cumulées (lifetime) | ✅ Fait (tests non exécutés) |
| 178 | **Consommable Trousse de soin** — achetable, touche **Z**, +30 PV instantané, désactivée en hardcore ; `medkitStock()`, `useMedkit()` | ✅ Fait (tests non exécutés) |
| 179 | **Power-up Radar longue portée** — double la portée radar (#21) pendant 12s ; `radarBoostActive()`, `radarBoostTimeLeft()`, `spawnRadarBoost(x,z)` | ✅ Fait (tests non exécutés) |
| 180 | **Succès Millionnaire et Increvable** — posséder 10 000$ / atteindre la vague 20 | ✅ Fait (tests non exécutés) |
| 181 | **Power-up Second souffle ravivé** — réarme le dernier souffle (#137) au ramassage ; `spawnSecondWindRefill(x,z)` | ✅ Fait (tests non exécutés) |
| 182 | **Bonus Vague sans dash** — nettoyer une vague sans dasher → +25$ + callout ; `noDashClearCount()`, `waveDashCount()` | ✅ Fait (tests non exécutés) |
| 183 | **Succès Bourreau et Sniper d'élite** — 500 kills / 100 headshots cumulés (lifetime) | ✅ Fait (tests non exécutés) |
| 184 | **Bonus Précision totale** — 100% de précision sur une vague (≥5 tirs) → +40$ + callout ; `perfectAccuracyCount()`, `waveShots()`, `waveHits()` | ✅ Fait (tests non exécutés) |
| 185 | **Succès Marathonien** — 10 000m parcourus cumulés (lifetime, nouvelle stat `distance`) | ✅ Fait (tests non exécutés) |
| 186 | **Succès Speedrunner** — 3 vagues éclair (#149) dans la même partie | ✅ Fait (tests non exécutés) |
| 187 | **Bonus Revanche** — tuer un ennemi <1s après un dégât reçu → +20$ + callout ; `revengeCount()` | ✅ Fait (tests non exécutés) |
| 188 | **Power-up Loot Master** — double les chances de drop soin/munitions/power-up pendant 10s ; `lootMasterActive()`, `lootMasterTimeLeft()`, `spawnLootMaster(x,z)` | ✅ Fait (tests non exécutés) |
| 189 | **Power-up Ricochet amélioré** — double la chance de ricochet (#101) pendant 10s ; `ricochetBoostActive()`, `ricochetBoostTimeLeft()`, `spawnRicochetBoost(x,z)` | ✅ Fait (tests non exécutés) |
| 190 | **Bonus Vague sans grenade** — nettoyer une vague sans lancer de grenade frag → +25$ + callout ; `noGrenadeClearCount()`, `waveGrenadeCount()` | ✅ Fait (tests non exécutés) |
| 191 | **5 succès (lot 4)** — Intouchable (10 vagues parfaites consécutives), Sans faille (5 vagues sans recharger), Ombre (5 takedowns furtifs), Cible mouvante (50m parcourus), Intraitable (3 kills clutch) ; + correctif reset des compteurs par-partie manquants | ✅ Fait (tests non exécutés) |
| 192 | **Bonus Boucherie** — 3 kills mêlée consécutifs sans kill à distance intercalé → +35$ + callout ; `meleeKillStreak()`, `meleeComboCount()` | ✅ Fait (tests non exécutés) |
| 193 | **Succès Ingénieur** — 10 barils en réaction en chaîne (#144) | ✅ Fait (tests non exécutés) |
| 194 | **Succès Miraculé** — nettoyer une vague à exactement 1 PV (après dernier souffle #137 non soigné) | ✅ Fait (tests non exécutés) |
| 195 | **Succès Contractant et Arme légendaire** — terminer les 3 contrats du jour (#62) / équiper une arme légendaire (#24) | ✅ Fait (tests non exécutés) |
| 196 | **Compteur de succès sur l'accueil** — carte Intel affiche "X/Y débloqués" | ✅ Fait (tests non exécutés) |
| 197 | **Succès Silencieux** — nettoyer une vague sans tirer un seul coup (couteau X uniquement) | ✅ Fait (tests non exécutés) |
| 198 | **Caisse de ravitaillement — trousses de soin** — 7e récompense possible, +2 trousses de soin | ✅ Fait (tests non exécutés) |
| 199 | **Succès Stylisé** — casque + costume légendaires équipés simultanément | ✅ Fait (tests non exécutés) |
| 200 | **Power-up Vague de choc** — nova instantanée, 80 dégâts AoE dans un rayon de 8m au ramassage ; `spawnNovaBlast(x,z)` | ✅ Fait (tests non exécutés) |
| 201 | **Chien de guerre en loadout** — le pet (#153) quitte le mode compagnon permanent : 5e bonus du système « série de points » (#156), invocable via la touche **4** une fois le seuil (900 pts) atteint ; taille corrigée (normalisée par le squelette, moitié de la hauteur du joueur, pieds au sol), PV (150), riposte de la cible touchée (combat symétrique auto-contenu dans `pet.js`), timer de despawn (30s) si non tué avant ; `summon()`, `hp()`, `maxHp()`, `despawnTimeLeft()`, debug `petSummon/petHp/petMaxHp/petDamage/petDespawnTimeLeft/petForceDespawn/petHeight` | ✅ Fait |
| 202 | **Système multi-map** — registre `MAPS` (`map.js`) découplant la sélection de map de son code de construction ; sélecteur dans les Réglages (généré depuis le registre, pas de markup par map) permettant de revenir à l'ancienne arène urbaine ou de rebasculer sur le Portail des ruines, reconstruction à chaud (`clearArenaDecor` + `buildArena(scene, mapId)`, cache GLB conservé) ; persisté (`save.settings.mapId`) ; `mapId()`, `mapList()`, `setMapId(id)` | ✅ Fait |

**Boucle d'ajout autonome en cours** : à la demande de l'utilisateur, Claude continue d'ajouter des features en autonomie (brainstorm → spec → plan → TDD) à partir du #54.
