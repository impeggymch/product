/**
 * 專案時程管理 — Google 試算表後端（Google Apps Script）
 *
 * 資料存在這份試算表的分頁：專案、模組、功能、任務、成員、設定、修改紀錄。
 * 網頁有兩種開法，用的是同一組 api* 函式：
 *   1. 直接開 Apps Script 部署網址（Index.html 由這裡提供，透過 google.script.run 呼叫）
 *   2. 網頁放在別處（例如 GitHub），把部署網址貼到網頁的 API_URL，透過 fetch 呼叫 doPost
 *
 * 權限刻意只用「讀寫試算表」：不使用試算表選單、對話框、觸發條件，
 * 這些需要額外權限，在部分帳號會出現「系統已封鎖這個應用程式」。
 * 安裝步驟見同資料夾的 README.md。
 */

const APP_TITLE = '專案時程管理';

// 每個資料表：key 是程式內的欄位名稱，label 是試算表第一列的欄名（可調整欄位順序，靠欄名對應）
// ref: 系統自動填入的參考欄（方便在試算表閱讀，網頁不會讀它）
const TABLES = {
  projects: { sheet: '專案', label: '專案', nameKey: 'name', cols: [
    ['name', '專案名稱'], ['baselineAt', '基準線建立時間'], ['sort', '排序'],
  ]},
  modules: { sheet: '模組', label: '模組', nameKey: 'name', cols: [
    ['_proj', '專案（參考）', 'ref'], ['code', '編號'], ['name', '模組名稱'], ['sort', '排序'],
    ['projectId', '專案ID'],
  ]},
  features: { sheet: '功能', label: '功能', nameKey: 'name', cols: [
    ['_proj', '專案（參考）', 'ref'], ['_mod', '模組（參考）', 'ref'], ['name', '功能名稱'], ['sort', '排序'],
    ['projectId', '專案ID'], ['moduleId', '模組ID'],
  ]},
  tasks: { sheet: '任務', label: '任務', nameKey: 'name', cols: [
    ['_proj', '專案（參考）', 'ref'], ['_mod', '模組（參考）', 'ref'], ['_feat', '功能（參考）', 'ref'],
    ['name', '任務名稱'], ['phase', '階段'], ['role', '角色'], ['owner', '負責人'],
    ['start', '開始'], ['end', '結束'], ['status', '狀態'], ['progress', '進度%'], ['tentative', '暫定'],
    ['note', '備註 / 交付連結'], ['segs', '執行區段'], ['bStart', '基準開始'], ['bEnd', '基準結束'], ['doneAt', '完成日'],
    ['projectId', '專案ID'], ['featureId', '功能ID'], ['dep', '前置任務ID'], ['order', '階段內序'], ['seq', '自訂排序'],
  ]},
  people: { sheet: '成員', label: '成員', nameKey: 'id', cols: [
    ['role', '角色'], ['note', '備註'],
  ]},
};
// 每張表共同的欄位
const META_COLS = [['updatedBy', '最後更新者'], ['updatedAt', '最後更新時間'], ['id', 'ID']];
const ID_LABEL = { people: '姓名' };           // 成員表的 ID 欄就是姓名
const QUIET_KEYS = { sort: 1, seq: 1, order: 1 }; // 只改這些欄位（拖曳排序）時不寫修改紀錄
const SETTINGS_SHEET = '設定';
const LOG_SHEET = '修改紀錄';
const CODE_KEY = '團隊通行碼';                                  // 在「設定」分頁填這一列的「內容」即可啟用
const SETTING_KEYS = ['phaseRole', 'defDur', 'template', 'holidays']; // 網頁可以修改的設定
const SETTING_NOTES = {
  phaseRole: '各階段預設角色（JSON，請從網頁「設定」修改）',
  defDur: '各階段預設工作天（JSON）',
  template: '新功能自動建立的預設任務（JSON）',
  holidays: '國定假日，一行一個：YYYY-MM-DD 名稱',
};
SETTING_NOTES[CODE_KEY] = '選填。填了之後，第一次開啟工具的人要輸入這組通行碼；留空＝不需要';

/* ================= 網頁進入點 ================= */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.fn) { // GET 版 API（備用）
    let args = [];
    try { args = JSON.parse(p.args || '[]'); } catch (err) { /* 參數錯誤 */ }
    return json_(dispatch_(p.fn, args));
  }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// 網頁放在其他地方（GitHub 等）時，用 POST 呼叫：body = {"fn":"apiLoad","args":[...]}
function doPost(e) {
  let req = {};
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, err: 'BAD_REQUEST' }); }
  return json_(dispatch_(req.fn, req.args || []));
}

function dispatch_(fn, args) {
  const api = { apiRev: apiRev, apiLoad: apiLoad, apiPush: apiPush };
  if (!api[fn]) return { ok: false, err: 'UNKNOWN_FUNCTION' };
  try { return { ok: true, r: api[fn].apply(null, Array.isArray(args) ? args : []) }; }
  catch (err) { return { ok: false, err: String(err && err.message || err) }; }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ================= 初始化（在 Apps Script 編輯器選 setup 按「執行」） ================= */
function setup() {
  setup_();
  console.log('完成：工作表已建立。接著請「部署 → 新增部署作業 → 網頁應用程式」。');
}

function setup_() {
  Object.keys(TABLES).forEach(tb => sheetOf_(tb));
  const sh = settingsSheet_();
  if (!(CODE_KEY in readSettings_())) {
    const r = sh.getLastRow() + 1;
    ensureRows_(sh, r + 1);
    sh.getRange(r, 1, 1, 3).setNumberFormat('@').setValues([[CODE_KEY, '', SETTING_NOTES[CODE_KEY]]]);
  }
  logSheet_();
}

// 簡單觸發條件（不需另外授權）：有人直接在試算表修改時遞增版本號，網頁約 15 秒內會重新載入
function onEdit() {
  try { setRev_(getRev_() + 1); } catch (e) { /* 忽略：最差情況是網頁下次有人修改時才更新 */ }
}

/* ================= API（網頁呼叫） ================= */
function apiRev(code) {
  check_(code);
  return getRev_();
}

function apiLoad(code) {
  check_(code);
  const out = { rev: getRev_(), tables: {}, settings: readSettings_() };
  delete out.settings[CODE_KEY]; // 通行碼不送給網頁
  Object.keys(TABLES).forEach(tb => {
    const t = table_(tb);
    const keys = Object.keys(t.idx).filter(k => k.charAt(0) !== '_');
    out.tables[tb] = t.rows.filter(r => r[t.idx.id]).map(r => {
      const o = {};
      keys.forEach(k => { o[k] = r[t.idx[k]]; });
      return o;
    });
  });
  return out;
}

/**
 * ops: [{t:'tasks'|'features'|'modules'|'projects'|'people', op:'up'|'del', id, f:{欄位:值}}, {t:'settings', op:'set', f:{...}}]
 * 'up' 只會寫入有變動的欄位，所以兩個人同時改同一筆的不同欄位不會互相覆蓋。
 */
function apiPush(code, who, ops) {
  check_(code);
  who = String(who || '未具名').slice(0, 40);
  if (!Array.isArray(ops) || !ops.length) return { rev: getRev_(), prevRev: getRev_() };
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const prev = getRev_();
    const now = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss');
    const logs = [];
    const by = {};
    ops.forEach(o => { (by[o.t] = by[o.t] || []).push(o); });
    const cache = {};
    ['projects', 'modules', 'features', 'people', 'tasks'].forEach(tb => {
      if (by[tb]) cache[tb] = applyTable_(tb, by[tb], who, now, logs);
    });
    if (by.settings) applySettings_(by.settings, who, now, logs);
    if (by.projects || by.modules || by.features || by.tasks) refreshRefs_(cache);
    writeLog_(logs);
    const rev = prev + 1;
    setRev_(rev);
    return { rev: rev, prevRev: prev };
  } finally {
    lock.releaseLock();
  }
}

/* ================= 內部：資料表讀寫 ================= */
function check_(code) {
  const c = String(readSettings_()[CODE_KEY] || '').trim();
  if (c && String(code || '').trim() !== c) throw new Error('NEED_CODE');
}
function getRev_() { return Number(PropertiesService.getScriptProperties().getProperty('REV') || 0); }
function setRev_(n) { PropertiesService.getScriptProperties().setProperty('REV', String(n)); }
function tz_() { return SpreadsheetApp.getActive().getSpreadsheetTimeZone() || 'Asia/Taipei'; }
// 試算表列數不夠時先加列（寫到超過最大列數會出錯）
function ensureRows_(sh, need) {
  const max = sh.getMaxRows();
  if (need > max) sh.insertRowsAfter(max, need - max + 200);
}

function colsOf_(tb) {
  return TABLES[tb].cols.concat(META_COLS.map(c => c[0] === 'id' && ID_LABEL[tb] ? ['id', ID_LABEL[tb]] : c));
}

function sheetOf_(tb) {
  const ss = SpreadsheetApp.getActive();
  const def = colsOf_(tb);
  let sh = ss.getSheetByName(TABLES[tb].sheet);
  if (!sh) sh = ss.insertSheet(TABLES[tb].sheet);
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const head = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  if (!head.some(String)) {
    const order = tb === 'people' ? [def[def.length - 1]].concat(def.slice(0, -1)) : def;
    sh.getRange(1, 1, 1, order.length).setValues([order.map(c => c[1])]).setFontWeight('bold').setBackground('#eef1f6');
    sh.getRange(1, 1, Math.max(sh.getMaxRows(), 2), order.length).setNumberFormat('@');
    sh.setFrozenRows(1);
  } else {
    const missing = def.filter(c => head.indexOf(c[1]) < 0);
    if (missing.length) {
      const start = head.length + 1;
      sh.getRange(1, start, 1, missing.length).setValues([missing.map(c => c[1])]).setFontWeight('bold').setBackground('#eef1f6');
      sh.getRange(1, start, Math.max(sh.getMaxRows(), 2), missing.length).setNumberFormat('@');
    }
  }
  return sh;
}

function table_(tb) {
  const sh = sheetOf_(tb);
  const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  const head = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const idx = {};
  colsOf_(tb).forEach(c => { const i = head.indexOf(c[1]); if (i >= 0) idx[c[0]] = i; });
  const rows = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues() : [];
  return { tb: tb, sh: sh, idx: idx, width: lastCol, rows: rows };
}

function applyTable_(tb, ops, who, now, logs) {
  const t = table_(tb), I = t.idx, rows = t.rows, origCount = rows.length;
  const pos = {};
  rows.forEach((r, i) => { if (r[I.id]) pos[r[I.id]] = i; });
  const del = {}, dirty = {};
  const nameOf = r => r[I[TABLES[tb].nameKey]] || r[I.id];
  const labelOf = k => (colsOf_(tb).filter(c => c[0] === k)[0] || [k, k])[1];
  ops.forEach(o => {
    const id = String(o.id || '');
    if (!id) return;
    if (o.op === 'del') {
      if (pos[id] != null && !del[pos[id]]) { del[pos[id]] = 1; logs.push([now, who, '刪除', TABLES[tb].label, nameOf(rows[pos[id]]), '']); }
      return;
    }
    let i = pos[id], isNew = false;
    if (i == null || del[i]) {
      i = rows.length; rows.push(new Array(t.width).fill('')); rows[i][I.id] = id; pos[id] = i; isNew = true;
      dirty[I.id] = 1;
    }
    const r = rows[i], changed = [];
    Object.keys(o.f || {}).forEach(k => {
      if (I[k] == null || k === 'id' || k.charAt(0) === '_' || k === 'updatedBy' || k === 'updatedAt') return;
      const v = o.f[k] == null ? '' : String(o.f[k]);
      if (r[I[k]] !== v) { r[I[k]] = v; changed.push(k); dirty[I[k]] = 1; }
    });
    if (isNew || changed.length) {
      if (I.updatedBy != null) { r[I.updatedBy] = who; dirty[I.updatedBy] = 1; }
      if (I.updatedAt != null) { r[I.updatedAt] = now; dirty[I.updatedAt] = 1; }
      const loud = changed.filter(k => !QUIET_KEYS[k]);
      if (isNew) logs.push([now, who, '新增', TABLES[tb].label, nameOf(r), '']);
      else if (loud.length) logs.push([now, who, '修改', TABLES[tb].label, nameOf(r),
        loud.map(k => labelOf(k) + '：' + (r[I[k]] || '（空白）')).join('、').slice(0, 300)]);
    }
  });
  // 1) 實際刪除試算表的列（連續的一起刪），使用者自行加在右邊的欄位才不會錯位
  const onSheet = Object.keys(del).map(Number).filter(i => i < origCount).sort((a, b) => b - a);
  ensureRows_(t.sh, rows.length + 3); // 不能把非凍結列全部刪光，也要留空間給新增的列
  for (let k = 0; k < onSheet.length;) {
    let start = onSheet[k], n = 1;
    while (k + n < onSheet.length && onSheet[k + n] === start - 1) { start--; n++; }
    t.sh.deleteRows(start + 2, n);
    k += n;
  }
  // 2) 只寫回有變動的欄（新增的列接在最後）
  const kept = rows.filter((_, i) => !del[i]);
  if (kept.length) Object.keys(dirty).map(Number).forEach(c => {
    t.sh.getRange(2, c + 1, kept.length, 1).setNumberFormat('@').setValues(kept.map(r => [r[c]]));
  });
  t.rows = kept;
  return t;
}

/* 參考欄：在任務表顯示所屬專案 / 模組 / 功能名稱 */
function refreshRefs_(cache) {
  const get = tb => cache[tb] || (cache[tb] = table_(tb));
  const nameMap = tb => {
    const t = get(tb), m = {};
    t.rows.forEach(r => { m[r[t.idx.id]] = r; });
    return { t: t, m: m };
  };
  const P = nameMap('projects'), M = nameMap('modules'), F = nameMap('features');
  const pn = id => (P.m[id] ? P.m[id][P.t.idx.name] : '');
  const mn = id => { const r = M.m[id]; if (!r) return ''; const c = r[M.t.idx.code]; return (c ? c + ' ' : '') + r[M.t.idx.name]; };
  const fr = id => F.m[id];
  const fill = (t, key, fn) => {
    const c = t.idx[key];
    if (c == null || !t.rows.length) return;
    const vals = t.rows.map(r => [fn(r)]);
    if (vals.some((v, i) => v[0] !== t.rows[i][c])) {
      t.sh.getRange(2, c + 1, vals.length, 1).setNumberFormat('@').setValues(vals);
      vals.forEach((v, i) => { t.rows[i][c] = v[0]; });
    }
  };
  fill(M.t, '_proj', r => pn(r[M.t.idx.projectId]));
  fill(F.t, '_proj', r => pn(r[F.t.idx.projectId]));
  fill(F.t, '_mod', r => mn(r[F.t.idx.moduleId]));
  const T = get('tasks');
  fill(T, '_proj', r => pn(r[T.idx.projectId]));
  fill(T, '_feat', r => { const f = fr(r[T.idx.featureId]); return f ? f[F.t.idx.name] : ''; });
  fill(T, '_mod', r => { const f = fr(r[T.idx.featureId]); return f ? mn(f[F.t.idx.moduleId]) : ''; });
}

/* ================= 設定 / 修改紀錄 ================= */
function settingsSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SETTINGS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SETTINGS_SHEET);
    sh.getRange(1, 1, 1, 3).setValues([['項目', '內容', '說明']]).setFontWeight('bold').setBackground('#eef1f6');
    sh.getRange(1, 1, Math.min(50, sh.getMaxRows()), 3).setNumberFormat('@');
    sh.setFrozenRows(1);
  }
  return sh;
}
function readSettings_() {
  const sh = settingsSheet_();
  const n = sh.getLastRow();
  const o = {};
  if (n > 1) sh.getRange(2, 1, n - 1, 2).getDisplayValues().forEach(r => { if (r[0]) o[r[0]] = r[1]; });
  return o;
}
function applySettings_(ops, who, now, logs) {
  const sh = settingsSheet_();
  const n = sh.getLastRow();
  const rows = n > 1 ? sh.getRange(2, 1, n - 1, 2).getDisplayValues() : [];
  ops.forEach(o => Object.keys(o.f || {}).forEach(k => {
    if (SETTING_KEYS.indexOf(k) < 0) return; // 通行碼等其他項目只能在試算表修改
    const v = String(o.f[k] == null ? '' : o.f[k]);
    let i = rows.findIndex(r => r[0] === k);
    if (i < 0) {
      rows.push([k, v]); i = rows.length - 1;
      ensureRows_(sh, i + 3);
      sh.getRange(i + 2, 1, 1, 3).setNumberFormat('@').setValues([[k, v, SETTING_NOTES[k] || '']]);
    } else if (rows[i][1] !== v) {
      rows[i][1] = v;
      sh.getRange(i + 2, 2).setNumberFormat('@').setValue(v);
    } else return;
    logs.push([now, who, '修改', '設定', k, v.slice(0, 200)]);
  }));
}
function logSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(LOG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(LOG_SHEET);
    sh.getRange(1, 1, 1, 6).setValues([['時間', '人員', '動作', '類型', '項目', '內容']]).setFontWeight('bold').setBackground('#eef1f6');
    sh.setFrozenRows(1);
  }
  return sh;
}
function writeLog_(logs) {
  if (!logs.length) return;
  const sh = logSheet_();
  ensureRows_(sh, sh.getLastRow() + logs.length + 1);
  sh.getRange(sh.getLastRow() + 1, 1, logs.length, 6).setNumberFormat('@').setValues(logs);
}
