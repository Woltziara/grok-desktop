/**
 * Native storage identity is the resolved spelling supplied to Grok, not realpath.
 * /var and /private/var (or a project symlink) may identify the same directory but
 * have different existing CLI buckets. Never rewrite those keys globally.
 */
import fs from 'node:fs';
import path from 'node:path';

export function sameProjectDirectory(a, b) {
  if (path.resolve(a) === path.resolve(b)) return true;
  try {
    const x = fs.statSync(a), y = fs.statSync(b);
    return x.isDirectory() && y.isDirectory() && x.dev === y.dev && x.ino === y.ino;
  } catch { return false; } // Missing projects retain their lexical identity.
}

export function storedAliasSessions(home, cwd, sessionId) {
  const root = path.join(home, 'sessions');
  if (!fs.existsSync(root)) return [];
  const rows = [];
  for (const entry of fs.readdirSync(root, {withFileTypes:true})) {
    if (!entry.isDirectory()) continue;
    let storedCwd;
    try { storedCwd = decodeURIComponent(entry.name); } catch { continue; }
    if (!path.isAbsolute(storedCwd) || !sameProjectDirectory(storedCwd, cwd)) continue;
    const file = path.join(root, entry.name, sessionId);
    let stat;
    try { stat = fs.lstatSync(file); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    rows.push({cwd: path.resolve(storedCwd), file, alias: stat.isSymbolicLink(), directory: stat.isDirectory()});
  }
  return rows;
}

export function sourceSessionCwd(home, cwd, sessionId) {
  const native = storedAliasSessions(home, cwd, sessionId).filter(r => !r.alias);
  if (native.length > 1) throw new Error('同一项目的不同路径下有同标识对话，均已保留；请先核对，不能自动选择。');
  return native[0]?.cwd || path.resolve(cwd);
}

/** Check *all* stored aliases before moving, including broken links and empty dirs. */
export function assertNoAliasCollision(home, cwd, sessionId, from) {
  const source = fs.realpathSync(from);
  for (const row of storedAliasSessions(home, cwd, sessionId)) {
    if (row.file === from) continue;
    if (row.alias) {
      try { if (fs.realpathSync(row.file) === source) continue; } catch { /* broken is occupied */ }
    }
    throw new Error('目标已有同标识对话（包括项目路径别名），未覆盖。');
  }
}
