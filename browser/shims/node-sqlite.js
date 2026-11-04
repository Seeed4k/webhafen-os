// node:sqlite (DatabaseSync) auf Basis von sql.js – gleiche Schnittstelle, läuft im Browser
const norm = (a) => a.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
export class DatabaseSync {
  constructor() {
    const SQL = globalThis.__SQL;
    this.db = globalThis.__wosBytes ? new SQL.Database(globalThis.__wosBytes) : new SQL.Database();
    globalThis.__wosDbWrap = this;
  }
  exec(sql) { this.db.exec(sql); }
  prepare(sql) {
    const self = this;
    const each = (args, fn) => { const s = self.db.prepare(sql); try { s.bind(norm(args)); return fn(s); } finally { s.free(); } };
    return {
      run: (...a) => { self.db.run(sql, norm(a)); const r = self.db.exec('SELECT last_insert_rowid(), changes()')[0].values[0]; return { lastInsertRowid: r[0], changes: r[1] }; },
      get: (...a) => each(a, (s) => (s.step() ? s.getAsObject() : undefined)),
      all: (...a) => each(a, (s) => { const out = []; while (s.step()) out.push(s.getAsObject()); return out; }),
    };
  }
  exportBytes() { const b = this.db.export(); this.db.exec('PRAGMA foreign_keys = ON'); return b; }
}
