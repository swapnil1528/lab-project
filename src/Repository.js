/**
 * Laboratory Information System (LIS) - Data Access Layer (Repository)
 * High-performance abstraction over Google Sheets:
 * - Single-pass getValues() reads mapped to typed objects
 * - Batch setValues() updates & inserts
 * - 2-tier CacheService caching for static catalog tables
 * - Transparent soft-delete management
 */

const Repository = {
  /**
   * In-memory cache for request lifecycle
   */
  _requestCache: {},

  /**
   * Active Spreadsheet reference
   */
  getSpreadsheet() {
    if (this._spreadsheet) return this._spreadsheet;
    try {
      this._spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
      if (this._spreadsheet) return this._spreadsheet;
    } catch (e) {
      // Running standalone or via webapp without container bound
    }

    try {
      const propId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
      if (propId) {
        this._spreadsheet = SpreadsheetApp.openById(propId);
        return this._spreadsheet;
      }
    } catch (e) {}

    return null;
  },

  /**
   * Returns a Sheet by name
   * @param {string} sheetName 
   * @return {Sheet|null}
   */
  getSheet(sheetName) {
    const ss = this.getSpreadsheet();
    if (!ss) return null;
    return ss.getSheetByName(sheetName);
  },

  /**
   * Reads an entire sheet into an array of JavaScript objects.
   * Maps Row 1 headers to object keys.
   * Attaches `_rowIndex` (1-based sheet row) to each object for fast targeted updates.
   * 
   * @param {string} sheetName 
   * @param {boolean} useCache - Use CacheService for reference sheets (Tests, Panels, Users, Settings)
   * @return {Array<Object>}
   */
  getTable(sheetName, useCache = false) {
    // 1. Check in-memory request cache first
    if (this._requestCache[sheetName]) {
      return this._requestCache[sheetName];
    }

    // 2. Check CacheService if caching requested
    if (useCache && typeof CacheService !== 'undefined') {
      try {
        const cached = CacheService.getScriptCache().get('TBL_' + sheetName);
        if (cached) {
          const parsed = JSON.parse(cached);
          this._requestCache[sheetName] = parsed;
          return parsed;
        }
      } catch (err) {
        // Cache miss or quota issue, fall through to sheet read
      }
    }

    const sheet = this.getSheet(sheetName);
    if (!sheet) return [];

    const dataRange = sheet.getDataRange();
    const values = dataRange.getValues();
    if (!values || values.length <= 1) return [];

    const headers = values[0].map(h => String(h).trim());
    const records = [];

    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      // Skip completely empty rows
      const hasContent = row.some(cell => cell !== '' && cell !== null && cell !== undefined);
      if (!hasContent) continue;

      const record = { _rowIndex: i + 1 };
      for (let j = 0; j < headers.length; j++) {
        const header = headers[j];
        if (header) {
          record[header] = row[j];
        }
      }
      records.push(record);
    }

    this._requestCache[sheetName] = records;

    // Cache in CacheService (1800 sec = 30 min)
    if (useCache && typeof CacheService !== 'undefined') {
      try {
        const payload = JSON.stringify(records);
        // CacheService value limit is 100KB per key
        if (payload.length < 100000) {
          CacheService.getScriptCache().put('TBL_' + sheetName, payload, 1800);
        }
      } catch (e) {}
    }

    return records;
  },

  /**
   * Finds a single record by primary key 'id'
   * @param {string} sheetName 
   * @param {string} id 
   * @param {boolean} useCache 
   * @return {Object|null}
   */
  findById(sheetName, id, useCache = false) {
    if (!id) return null;
    const table = this.getTable(sheetName, useCache);
    return table.find(r => String(r.id) === String(id)) || null;
  },

  /**
   * Finds all records matching a key-value condition
   * @param {string} sheetName 
   * @param {string} field 
   * @param {*} value 
   * @param {boolean} useCache 
   * @return {Array<Object>}
   */
  findByField(sheetName, field, value, useCache = false) {
    const table = this.getTable(sheetName, useCache);
    return table.filter(r => String(r[field]) === String(value));
  },

  /**
   * Finds the first record matching a field value
   * @param {string} sheetName 
   * @param {string} field 
   * @param {*} value 
   * @param {boolean} useCache 
   * @return {Object|null}
   */
  findOneByField(sheetName, field, value, useCache = false) {
    const table = this.getTable(sheetName, useCache);
    return table.find(r => String(r[field]) === String(value)) || null;
  },

  /**
   * Saves a single record.
   * If `record._rowIndex` exists, performs an in-place update using setValues().
   * Otherwise, appends the record as a new row.
   * Automatically invalidates cache for this sheet.
   * 
   * @param {string} sheetName 
   * @param {Object} record 
   * @return {Object} The saved record with populated _rowIndex
   */
  saveRow(sheetName, record) {
    const sheet = this.getSheet(sheetName);
    if (!sheet) throw new Error('Sheet not found: ' + sheetName);

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const rowArray = headers.map(header => {
      const val = record[header];
      return val !== undefined && val !== null ? val : '';
    });

    if (record._rowIndex && record._rowIndex > 1) {
      // Update existing row
      sheet.getRange(record._rowIndex, 1, 1, headers.length).setValues([rowArray]);
    } else {
      // Append new row
      sheet.appendRow(rowArray);
      record._rowIndex = sheet.getLastRow();
    }

    this.clearCache(sheetName);
    return record;
  },

  /**
   * Batch inserts multiple records in a single setValues() call
   * Never loops sheet.appendRow()!
   * 
   * @param {string} sheetName 
   * @param {Array<Object>} records 
   */
  batchInsert(sheetName, records) {
    if (!records || records.length === 0) return;
    const sheet = this.getSheet(sheetName);
    if (!sheet) throw new Error('Sheet not found: ' + sheetName);

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
    const rows = records.map(record => {
      return headers.map(header => {
        const val = record[header];
        return val !== undefined && val !== null ? val : '';
      });
    });

    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rows.length, headers.length).setValues(rows);

    this.clearCache(sheetName);
  },

  /**
   * Soft-deletes a record by setting status to 'Inactive' or 'Cancelled'
   * @param {string} sheetName 
   * @param {string} id 
   * @param {string} deletedStatus - 'Inactive', 'Cancelled', 'Archived' (default: 'Inactive')
   * @return {boolean}
   */
  softDelete(sheetName, id, deletedStatus = 'Inactive') {
    const record = this.findById(sheetName, id);
    if (!record) return false;

    record.status = deletedStatus;
    record.updated_at = new Date().toISOString();
    record.updated_by = SessionContext.getCurrentEmail();

    this.saveRow(sheetName, record);
    return true;
  },

  /**
   * Appends an immutable audit log entry
   * @param {string} action - 'CREATE', 'UPDATE', 'VALIDATE', 'PRINT', 'LOGIN'
   * @param {string} entityType - 'Patient', 'Order', 'Sample', 'Result', 'Invoice'
   * @param {string} entityId 
   * @param {Object} details 
   */
  logAudit(action, entityType, entityId, details = {}) {
    try {
      const email = SessionContext.getCurrentEmail();
      const role = SessionContext.getCurrentRole();
      const auditRecord = {
        id: Utils.generateId('AUD'),
        timestamp: Utils.getTimestamp(),
        user_email: email,
        role: role,
        action: action,
        entity_type: entityType,
        entity_id: entityId,
        details_json: typeof details === 'string' ? details : JSON.stringify(details),
        ip_address: 'AppsScript_Session'
      };

      // Direct fast append to AuditLog
      const sheet = this.getSheet('AuditLog');
      if (sheet) {
        const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
        const row = headers.map(h => auditRecord[h] !== undefined ? auditRecord[h] : '');
        sheet.appendRow(row);
      }
    } catch (e) {
      // Audit log must never break the main transaction flow
      console.error('AuditLog Failed:', e);
    }
  },

  /**
   * Clears in-memory and CacheService cache for a specific sheet or all sheets
   * @param {string} [sheetName] 
   */
  clearCache(sheetName) {
    if (sheetName) {
      delete this._requestCache[sheetName];
      if (typeof CacheService !== 'undefined') {
        try { CacheService.getScriptCache().remove('TBL_' + sheetName); } catch (e) {}
      }
    } else {
      this._requestCache = {};
      if (typeof CacheService !== 'undefined') {
        try { CacheService.getScriptCache().removeAll([
          'TBL_Tests', 'TBL_Panels', 'TBL_PanelTests', 'TBL_ReferenceRanges',
          'TBL_Users', 'TBL_Settings', 'TBL_Doctors', 'TBL_Centres'
        ]); } catch (e) {}
      }
    }
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Repository;
}
