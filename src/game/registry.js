// Registre de features (étape 4 du refactoring).
// Chaque feature s'enregistre avec des hooks optionnels :
//   update(dt)  — appelé chaque frame pendant la partie (ordre = ordre d'enregistrement)
//   resetRun()  — appelé par resetRunState() à chaque (re)départ de partie (startGame ET restartGame)
//   onLobby()   — appelé par backToHome() au retour menu (masquer HUD, nettoyer la scène)
// Objectif : plus AUCUN reset dispersé dans startGame/restartGame/backToHome pour les nouvelles
// features — la classe de bugs « état résiduel par asymétrie des resets » (audits 2026-06-30)
// devient structurellement impossible.
export const features = [];
export function registerFeature(f){ features.push(f); return f; }

export function updateFeatures(dt){ for(const f of features) f.update?.(dt); }
export function resetRunFeatures(){ for(const f of features) f.resetRun?.(); }
export function lobbyFeatures(){ for(const f of features) f.onLobby?.(); }
