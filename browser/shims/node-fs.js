// node:fs – im Browser gibt es keine Dateien; nur die Demo-Daten werden vorab geladen
export const existsSync = () => false;
export const renameSync = () => {};
export const mkdirSync = () => {};
export const rmSync = () => {};
export function readFileSync(p) { const name = String(p).split('/').pop(); if (globalThis.__wosFiles?.[name] != null) return globalThis.__wosFiles[name]; throw new Error('Datei nicht verfügbar: ' + name); }
export default { existsSync, renameSync, mkdirSync, rmSync, readFileSync };
