// Sauvegarde locale (localStorage 'cod-save-v1') — socle monnaie/record/perso (tranches 12→16).
// `save` est un binding vivant : les autres modules le lisent/mutent en place ;
// seule resetSave() peut le RÉASSIGNER (les imports ESM sont en lecture seule).
export const SAVE_KEY = 'cod-save-v1';

export function defaultSave(){ return { v:1, money:0, bestWave:0, bestScore:0, bestCombo:0, xp:0, daily:null, selectedCharacterId:null,
  ownedWeapons:['default','knife'], selectedWeapon:'default', weaponUpgrades:{}, playerUpgrades:{},   // knife gratuit possédé par défaut (#50)
  ownedCharacters:['perso:blue-soldier'],
  ownedAccessories:['helm:none','cost:none'], equipped:{ helmet:'helm:none', costume:'cost:none' },
  ownedDances:['dance:all_night','dance:boom','dance:groove'], selectedDances:['dance:all_night','dance:boom','dance:groove'],
  ownedBoosts:[], equippedBoosts:{}, unlockedAchievements:[],
  settings:{ sensitivity:1.0, volume:0.3, defaultView:'third', difficulty:'normal', hardcore:false, rain:false },
  lifetime:{ kills:0, headshots:0, moneyEarned:0, playtime:0 },
  consumables:{ frag:12, flashbang:8, smoke:6, sticky:4, molotov:4, emp:3, medkit:3 },   // #155/#178 : stock persistant, migration auto via Object.assign(defaultSave(), p)
  selectedLoadout:['turret','mine','airstrike'],   // #156 : killstreak loadout, migration auto
  leaderboard:[],   // #157 : classement local top 5, migration auto
  prestige:0 }; }   // #159 : compteur de prestige, migration auto

function loadSave(){
  try { const raw = localStorage.getItem(SAVE_KEY); if(!raw) return defaultSave();
    const p = JSON.parse(raw); if(!(p && typeof p === 'object')) return defaultSave();
    const s = Object.assign(defaultSave(), p);
    s.settings = Object.assign(defaultSave().settings, p.settings || {});
    if(!s.ownedWeapons.includes('knife')) s.ownedWeapons.push('knife');   // #50 : migration — knife gratuit
    if(s.consumables.medkit === undefined) s.consumables.medkit = 3;     // #178 : migration — nouvelle cle dans un objet consumables deja existant
    return s;
  } catch(e){ return defaultSave(); }
}

export let save = loadSave();
export function persist(){ try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch(e){} }
export function resetSave(){ save = defaultSave(); persist(); }
