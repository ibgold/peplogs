/** PepLogs API v2. Copy into each Sheet's bound project; run setupPepLogs in the editor. */
var PEP_DB_PROPERTY = 'PEPLOGS_SPREADSHEET_ID';
var PEP_META = ['_pep_id', '_pep_version', '_pep_last_request', '_pep_last_fingerprint', '_pep_create_fingerprint', '_pep_deleted'];
var PEP_TABLES = {
  history: { name: 'Logs Injections Peptides', headers: ['Date', 'Peptide', 'Dosage', 'Site', 'Notes'] },
  presets: { name: 'QuickLogs Config', headers: ['label', 'peptide', 'value', 'unit', 'site', 'frequency', 'ui', 'cycle'] },
  peptides: { name: 'Peptides List', headers: ['Peptide Name', 'Half-Life', 'Unit', 'UI'] },
  bacWater: { name: 'Bac Water', headers: ['opened_at'] },
  reconstitutions: { name: 'Reconstitutions', headers: ['date', 'peptide', 'vialMg', 'bacWaterMl', 'notes', 'closedAt'] }
};
var PEP_ACTIONS = {
  logInjection: 'history', saveConfig: 'presets', updateConfig: 'presets', deleteConfig: 'presets',
  savePeptide: 'peptides', deletePeptide: 'peptides', deleteLog: 'history',
  saveBacWater: 'bacWater', saveReconstitution: 'reconstitutions', closeReconstitution: 'reconstitutions'
};

function safeCell(v) {
  if (v === null || v === undefined) return '';
  var s = String(v);
  return s.length && '=+-@\t\r\n'.indexOf(s.charAt(0)) !== -1 ? "'" + s : s;
}
function rowDateIso(cell) { return cell instanceof Date ? cell.toISOString() : (cell ? String(cell) : ''); }
function pepError(message, code) { var e = new Error(message); e.code = code || 'invalid'; throw e; }
function pepJson(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function pepDatabase() {
  var id = PropertiesService.getScriptProperties().getProperty(PEP_DB_PROPERTY);
  if (!id) pepError('Exécuter setupPepLogs dans l’éditeur Apps Script de ce Sheet.', 'setup_required');
  return SpreadsheetApp.openById(id);
}
function pepWithLock(work) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) pepError('Base de données occupée', 'busy');
  try { return work(); }
  finally {
    // Commit pending writes even after an error, before allowing another mutation.
    try { SpreadsheetApp.flush(); } finally { lock.releaseLock(); }
  }
}

/** Editor-only setup, safe to rerun. No setup/migration action is exposed by the web API. */
function setupPepLogs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) pepError('Ouvrir ce projet depuis Extensions > Apps Script du Sheet concerné.');
  return pepWithLock(function () {
    Object.keys(PEP_TABLES).forEach(function (key) { pepEnsureTable(ss, key); });
    SpreadsheetApp.flush();
    PropertiesService.getScriptProperties().setProperty(PEP_DB_PROPERTY, ss.getId());
    return { success: true, apiVersion: 2, spreadsheetName: ss.getName() };
  });
}
function pepReadTable(ss, key) {
  var spec = PEP_TABLES[key], sheet = ss.getSheetByName(spec.name);
  if (!sheet || !sheet.getLastRow()) return { spec: spec, sheet: sheet, headers: [], rows: [], meta: {} };
  var width = sheet.getLastColumn();
  var all = sheet.getRange(1, 1, sheet.getLastRow(), width).getValues();
  all.forEach(function (row) { while (row.length < spec.headers.length) row.push(''); });
  var headers = all.shift(), meta = {};
  PEP_META.forEach(function (name) {
    var first = headers.indexOf(name);
    if (first !== headers.lastIndexOf(name)) pepError('Colonne technique dupliquée : ' + name, 'schema');
    if (first !== -1 && first < spec.headers.length) pepError('Colonne technique dans les données existantes', 'schema');
    meta[name] = first;
  });
  return { spec: spec, sheet: sheet, headers: headers, rows: all, meta: meta };
}
function pepHasData(row, spec) { return row.slice(0, spec.headers.length).some(function (v) { return v !== '' && v !== null && v !== undefined; }); }
function pepEnsureTable(ss, key) {
  var spec = PEP_TABLES[key], sheet = ss.getSheetByName(spec.name) || ss.insertSheet(spec.name);
  if (!sheet.getLastRow()) sheet.getRange(1, 1, 1, spec.headers.length).setValues([spec.headers]);
  var t = pepReadTable(ss, key), headers = t.headers.slice();
  PEP_META.forEach(function (name) { if (headers.indexOf(name) === -1) headers.push(name); });
  if (headers.length > sheet.getMaxColumns()) sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  if (headers.length !== t.headers.length) sheet.getRange(1, t.headers.length + 1, 1, headers.length - t.headers.length).setValues([headers.slice(t.headers.length)]);
  t = pepReadTable(ss, key);
  var idCol = t.meta._pep_id, versionCol = t.meta._pep_version, seen = {};
  t.rows.forEach(function (row) {
    var id = row[idCol];
    if (id && seen[id]) pepError('Identifiant dupliqué ; corriger la copie de ligne avant de continuer.', 'schema');
    if (id) seen[id] = true;
  });
  var idsChanged = false, versionsChanged = false;
  t.rows.forEach(function (row) {
    if (!pepHasData(row, spec)) return;
    if (!row[idCol]) { row[idCol] = Utilities.getUuid(); idsChanged = true; }
    if (!row[versionCol]) { row[versionCol] = 1; versionsChanged = true; }
  });
  if (idsChanged) sheet.getRange(2, idCol + 1, t.rows.length, 1).setValues(t.rows.map(function (r) { return [r[idCol]]; }));
  if (versionsChanged) sheet.getRange(2, versionCol + 1, t.rows.length, 1).setValues(t.rows.map(function (r) { return [r[versionCol]]; }));
  return t;
}
function pepDeleted(t, row) { return row[t.meta._pep_deleted] === true || row[t.meta._pep_deleted] === 'true'; }
function pepIdentity(t, row, i) { return { row: i + 2, id: row[t.meta._pep_id] || '', version: Number(row[t.meta._pep_version]) || 1, lastRequestId: row[t.meta._pep_last_request] || '' }; }
function pepReadRecords(ss, key, map) {
  var t = pepReadTable(ss, key), out = [];
  t.rows.forEach(function (row, i) {
    if (pepHasData(row, t.spec) && !pepDeleted(t, row)) out.push(Object.assign(pepIdentity(t, row, i), map(row)));
  });
  return out;
}
function getHistoryData(ss) {
  return pepReadRecords(ss, 'history', function (r) { return { date: rowDateIso(r[0]), peptide: r[1], dosage: r[2], site: r[3], notes: r[4] || '' }; });
}
function getPresetsData(ss) {
  return pepReadRecords(ss, 'presets', function (r) { return { label: r[0], peptide: r[1], value: r[2], unit: r[3], site: r[4], frequency: r[5] || 0, ui: r[6] || '', cycle: r[7] || '' }; });
}
function getPeptidesData(ss) {
  return pepReadRecords(ss, 'peptides', function (r) { return { name: r[0], halfLife: r[1], hlUnit: r[2], ui: r[3] || '' }; });
}
function getReconstitutionsData(ss) {
  return pepReadRecords(ss, 'reconstitutions', function (r) { return { date: rowDateIso(r[0]), peptide: r[1], vialMg: r[2], bacWaterMl: r[3], notes: r[4] || '', closedAt: rowDateIso(r[5]) }; });
}
function getBacWaterData(ss) {
  var rows = pepReadRecords(ss, 'bacWater', function (r) { return { date: rowDateIso(r[0]) }; });
  return rows.length ? rows[rows.length - 1].date : null;
}
function doGet(e) { return handleRequest(e, false); }
function doPost(e) { return handleRequest(e, true); }
function handleRequest(e, isPost) {
  try {
    e = e || {};
    var data = isPost ? JSON.parse(e.postData && e.postData.contents || '{}') : (e.parameter || {});
    if (!data || typeof data !== 'object' || Array.isArray(data)) pepError('Requête invalide');
    var action = data.action;
    if (!isPost) {
      if (action === 'ping') return pepJson({ success: true, apiVersion: 2, configured: !!PropertiesService.getScriptProperties().getProperty(PEP_DB_PROPERTY) });
      if (action !== 'getAllData') pepError('Action de lecture inconnue');
      var ss = pepDatabase();
      return pepJson({ success: true, apiVersion: 2, history: getHistoryData(ss), presets: getPresetsData(ss), peptides: getPeptidesData(ss), bacWater: getBacWaterData(ss), reconstitutions: getReconstitutionsData(ss) });
    }
    if (!Object.prototype.hasOwnProperty.call(PEP_ACTIONS, action)) pepError('Action d’écriture inconnue');
    return pepJson(pepWithLock(function () { return pepWrite(pepDatabase(), data); }));
  } catch (err) {
    return pepJson({ success: false, apiVersion: 2, error: String(err.message || err), code: err.code || 'server_error', stale: err.code === 'stale' });
  }
}
function pepRequired(v, label) { if (typeof v !== 'string' || !v.trim()) pepError(label + ' requis'); return v.trim(); }
function pepNumber(v, label, allowZero) {
  if (v === '' || v === null || v === undefined || !isFinite(Number(v)) || (allowZero ? Number(v) < 0 : Number(v) <= 0)) pepError(label + ' invalide');
  return Number(v);
}
function pepDate(v) { var d = new Date(v); if (!isFinite(d.getTime())) pepError('Date invalide'); return d.toISOString(); }
function pepRequestId(v) {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(v)) pepError('requestId invalide');
  return v;
}
function pepFingerprint(data) {
  var clean = {};
  Object.keys(data).sort().forEach(function (key) { if (key !== 'requestId' && key !== 'row') clean[key] = data[key]; });
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(clean), Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}
function pepCheckSchedule(data) {
  var cycle = String(data.cycle || '').trim(), frequency = Number(data.frequency || 0);
  if (cycle) {
    var parts = cycle.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (!parts || Number(parts[1]) < 1 || !Number.isSafeInteger(Number(parts[1]) + Number(parts[2]))) pepError('Cycle invalide');
  } else if (!Number.isSafeInteger(frequency) || frequency < 0) pepError('Fréquence invalide');
}
function pepCreateValues(data) {
  switch (data.action) {
    case 'logInjection':
      return [data.timestampMs !== undefined ? new Date(pepDate(Number(data.timestampMs))) : new Date(), safeCell(pepRequired(data.peptide, 'Peptide')), safeCell(pepRequired(data.dosage, 'Dosage')), safeCell(pepRequired(data.site, 'Site')), safeCell(data.notes || '')];
    case 'saveConfig':
      pepCheckSchedule(data);
      return [safeCell(pepRequired(data.label, 'Label')), safeCell(pepRequired(data.peptide, 'Peptide')), pepNumber(data.value, 'Dose', false), safeCell(pepRequired(data.unit, 'Unité')), safeCell(data.site || 'Ask'), Number(data.frequency || 0), safeCell(data.ui || ''), safeCell(data.cycle || '')];
    case 'savePeptide':
      return [safeCell(pepRequired(data.name, 'Nom')), pepNumber(data.halfLife || 0, 'Demi-vie', true), safeCell(data.hlUnit || 'hours'), safeCell(data.ui || '')];
    case 'saveBacWater': return [pepDate(data.openedAt)];
    case 'saveReconstitution':
      return [data.date ? pepDate(data.date) : new Date().toISOString(), safeCell(pepRequired(data.peptide, 'Peptide')), pepNumber(data.vialMg, 'Fiole', false), pepNumber(data.bacWaterMl, 'Volume', false), safeCell(data.notes || ''), ''];
  }
  return null;
}
function pepLocate(t, data) {
  if (data.id) {
    var matches = [];
    t.rows.forEach(function (r, i) { if (r[t.meta._pep_id] === data.id) matches.push(i); });
    if (matches.length !== 1) pepError('Entrée introuvable ou identifiant dupliqué', 'stale');
    return matches[0]; // Never fall back to the caller's row when an ID was supplied.
  }
  var row = Number(data.row);
  if (!Number.isSafeInteger(row) || row < 2 || row > t.rows.length + 1) pepError('Ligne invalide', 'stale');
  return row - 2;
}
function pepVerify(row, data, key) {
  var checks = [];
  if (key === 'presets') checks = [[0, data.verifyLabel], [1, data.verifyPeptide]];
  if (key === 'peptides') checks = [[0, data.verifyName]];
  if (key === 'history' || key === 'reconstitutions') checks = [[0, data.verifyDate, true], [1, data.verifyPeptide]];
  checks.forEach(function (c) {
    if (c[1] === undefined || c[1] === null || c[1] === '') return;
    var actual = c[2] ? rowDateIso(row[c[0]]) : String(row[c[0]] === undefined ? '' : row[c[0]]);
    var expected = c[2] ? pepDate(c[1]) : String(c[1]);
    if (c[2]) actual = pepDate(actual);
    if (actual !== expected) pepError('Données modifiées ailleurs', 'stale');
  });
}
function pepStoreRow(t, index, values) {
  var rowNumber = index + 2;
  if (rowNumber > t.sheet.getMaxRows()) t.sheet.insertRowsAfter(t.sheet.getMaxRows(), rowNumber - t.sheet.getMaxRows());
  t.sheet.getRange(rowNumber, 1, 1, t.headers.length).setValues([values]);
}
function pepWrite(ss, data) {
  var key = PEP_ACTIONS[data.action], request = pepRequestId(data.requestId), fingerprint = pepFingerprint(data);
  var created = pepCreateValues(data), t = pepEnsureTable(ss, key), idCol = t.meta._pep_id;
  if (created) {
    var id = request || Utilities.getUuid(), existing = t.rows.findIndex(function (r) { return r[idCol] === id; });
    if (existing !== -1) {
      if (t.rows[existing][t.meta._pep_create_fingerprint] !== fingerprint) pepError('requestId réutilisé pour une autre saisie', 'request_conflict');
      return Object.assign({ success: true, duplicate: true }, pepIdentity(t, t.rows[existing], existing));
    }
    var row = new Array(t.headers.length).fill('');
    created.forEach(function (v, i) { row[i] = v; });
    row[idCol] = id; row[t.meta._pep_version] = 1;
    row[t.meta._pep_last_request] = request; row[t.meta._pep_last_fingerprint] = fingerprint;
    row[t.meta._pep_create_fingerprint] = fingerprint; row[t.meta._pep_deleted] = false;
    pepStoreRow(t, t.rows.length, row);
    return Object.assign({ success: true }, pepIdentity(t, row, t.rows.length));
  }
  var index = pepLocate(t, data), old = t.rows[index];
  if (request && old[t.meta._pep_last_request] === request) {
    if (old[t.meta._pep_last_fingerprint] !== fingerprint) pepError('requestId réutilisé', 'request_conflict');
    return Object.assign({ success: true, duplicate: true }, pepIdentity(t, old, index));
  }
  if (pepDeleted(t, old)) pepError('Entrée supprimée', 'stale');
  if (data.id && (!Number.isSafeInteger(Number(data.expectedVersion)) || Number(data.expectedVersion) !== Number(old[t.meta._pep_version]))) pepError('Version modifiée ailleurs', 'stale');
  pepVerify(old, data, key);
  // Preserve formulas in untouched business and custom columns during a full-row write.
  var formulas = t.sheet.getRange(index + 2, 1, 1, t.headers.length).getFormulas()[0];
  var updated = old.map(function (v, i) { return formulas[i] || (typeof v === 'string' ? safeCell(v) : v); });
  if (data.action === 'updateConfig') {
    var schedule = { cycle: data.cycle !== undefined ? data.cycle : old[7], frequency: data.frequency !== undefined ? data.frequency : old[5] };
    pepCheckSchedule(schedule);
    if (data.label !== undefined) updated[0] = safeCell(pepRequired(data.label, 'Label'));
    if (data.value !== undefined) updated[2] = pepNumber(data.value, 'Dose', false);
    if (data.unit !== undefined) updated[3] = safeCell(pepRequired(data.unit, 'Unité'));
    if (data.frequency !== undefined) updated[5] = Number(data.frequency || 0);
    if (data.ui !== undefined) updated[6] = safeCell(data.ui);
    if (data.cycle !== undefined) updated[7] = safeCell(data.cycle);
  } else if (data.action === 'closeReconstitution') {
    updated[5] = data.closedAt ? pepDate(data.closedAt) : new Date().toISOString();
  } else if (data.action.indexOf('delete') === 0) {
    // Retain the row as a tombstone: a delayed create retry must never resurrect it.
    updated[t.meta._pep_deleted] = true;
  } else pepError('Action inconnue');
  updated[t.meta._pep_version] = Number(old[t.meta._pep_version]) + 1;
  updated[t.meta._pep_last_request] = request; updated[t.meta._pep_last_fingerprint] = fingerprint;
  pepStoreRow(t, index, updated);
  return Object.assign({ success: true }, pepIdentity(t, updated, index));
}
