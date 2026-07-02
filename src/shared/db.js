// Galerie partagée (IndexedDB 'studio3d', store 'models').
// Module commun à game.html, studio.html et app.html — ne plus copier ces fonctions dans les pages.

export function idb(){ return new Promise((res,rej)=>{ const r=indexedDB.open('studio3d',1);
  r.onupgradeneeded=()=>{ if(!r.result.objectStoreNames.contains('models')) r.result.createObjectStore('models',{keyPath:'id'}); };
  r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
export function dbAll(){ return idb().then(db=>new Promise((res,rej)=>{ const rq=db.transaction('models','readonly').objectStore('models').getAll(); rq.onsuccess=()=>res(rq.result||[]); rq.onerror=()=>rej(rq.error); })); }
export function dbGet(id){ return idb().then(db=>new Promise((res,rej)=>{ const rq=db.transaction('models','readonly').objectStore('models').get(id); rq.onsuccess=()=>res(rq.result||null); rq.onerror=()=>rej(rq.error); })); }
export function dbPut(rec){ return idb().then(db=>new Promise((res,rej)=>{ const tx=db.transaction('models','readwrite'); tx.objectStore('models').put(rec); tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); })); }
export function dbDel(id){ return idb().then(db=>new Promise((res,rej)=>{ const tx=db.transaction('models','readwrite'); tx.objectStore('models').delete(id); tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error); })); }
