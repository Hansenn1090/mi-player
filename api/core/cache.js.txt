const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', '.cache');
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

const TTL_FRESH    = 6 * 60 * 60 * 1000;
const TTL_SNAPSHOT = 48 * 60 * 60 * 1000;

const fname = (id, type, s, e) => `${type}_${id}_${s || 0}_${e || 0}.json`;

function get(id, type, s, e) {
  const f = path.join(DIR, fname(id, type, s, e));
  if (!fs.existsSync(f)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    const age = Date.now() - data._ts;
    if (age > TTL_SNAPSHOT) { fs.unlinkSync(f); return null; }
    return { ...data, _fresh: age < TTL_FRESH };
  } catch { return null; }
}

function set(id, type, s, e, payload) {
  const f = path.join(DIR, fname(id, type, s, e));
  fs.writeFileSync(f, JSON.stringify({ ...payload, _ts: Date.now() }));
}

module.exports = { get, set };