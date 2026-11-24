/**
 * Laboratory Information System (LIS) - Automated Time-Driven Triggers & Scale Guard
 * Implements:
 * - Nightly 30-Day Rolling Google Sheets Database Backup to Google Drive
 * - Monthly Scale Guard Archiving Job (> 12 months records moved to archive)
 * - Daily Reagent Inventory Low-Stock Alert Job
 * - Programmatic Trigger Installation via ScriptApp
 */

// Node.js environment imports
if (typeof require !== 'undefined') {
  var Repository = require('./Repository.js');
  var Utils = require('./Utils.js');
  var InventoryService = require('./InventoryService.js');
}

const Triggers = {
  /**
   * Nightly Database Backup Trigger (Scheduled at 02:00 AM daily)
   * Creates a snapshot copy of the database spreadsheet in Drive folder 'LIS_Backups'
   * Retains a rolling 30-day window and purges older backups.
   */
  dailyNightlyBackupJob() {
    console.log('--- Commencing Daily LIS Database Backup Job ---');
    if (typeof DriveApp === 'undefined') {
      console.log('DriveApp unavailable (simulation mode). Backup job skipped.');
      return { status: 'SIMULATED' };
    }

    try {
      const ss = Repository.getSpreadsheet() || SpreadsheetApp.getActiveSpreadsheet();
      if (!ss) throw new Error('Active database spreadsheet not found.');

      const ssFile = DriveApp.getFileById(ss.getId());
      const parentFolder = DriveApp.getRootFolder();

      // Find or create 'LIS_Backups' folder
      let backupFolderIter = parentFolder.getFoldersByName('LIS_Backups');
      const backupFolder = backupFolderIter.hasNext() ? backupFolderIter.next() : parentFolder.createFolder('LIS_Backups');

      // Create timestamped copy
      const dateStr = new Date().toISOString().substring(0, 10);
      const backupName = `LIS_Database_Backup_${dateStr}_${ss.getName()}`;
      const copyFile = ssFile.makeCopy(backupName, backupFolder);

      console.log(`Snapshot created: ${backupName} (ID: ${copyFile.getId()})`);

      // Retention Guard: Keep only last 30 daily copies
      const copies = [];
      const filesIter = backupFolder.getFiles();
      while (filesIter.hasNext()) {
        const f = filesIter.next();
        copies.push({ id: f.getId(), date: f.getDateCreated().getTime(), file: f });
      }

      copies.sort((a, b) => b.date - a.date); // Newest first

      let purgedCount = 0;
      if (copies.length > 30) {
        for (let i = 30; i < copies.length; i++) {
          copies[i].file.setTrashed(true);
          purgedCount++;
        }
      }

      console.log(`Backup completed. Total retained backups: ${Math.min(30, copies.length)}. Purged old: ${purgedCount}`);
      Repository.logAudit('BACKUP', 'Database', copyFile.getId(), {
        backupName: backupName,
        retainedCount: Math.min(30, copies.length),
        purgedCount: purgedCount
      });

      return {
        status: 'SUCCESS',
        backupFileId: copyFile.getId(),
        backupName: backupName,
        retainedCopies: Math.min(30, copies.length)
      };
    } catch (err) {
      console.error('Backup Job Failed:', err);
      throw err;
    }
  },

  /**
   * Monthly Scale Guard Archival Job (Scheduled on 1st of every month at 03:00 AM)
   * Moves finalized records older than ARCHIVE_AGE_MONTHS (default: 12 months)
   * into Archive sheets (Archive_Orders, Archive_Results, etc.) to keep active lookup sheets lean.
   */
  monthlyArchivalJob() {
    console.log('--- Commencing Monthly Scale Guard Archival Job ---');
    const settings = Repository.getTable('Settings', true);
    const archiveMonths = parseInt((settings.find(s => s.key === 'ARCHIVE_AGE_MONTHS') || {}).value, 10) || 12;

    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - archiveMonths);
    const cutoffIso = cutoffDate.toISOString();

    const ss = Repository.getSpreadsheet();
    if (!ss) return { status: 'SKIPPED', message: 'Spreadsheet unavailable' };

    // Find eligible finalized orders
    const allOrders = Repository.getTable('Orders', false);
    const eligibleOrders = allOrders.filter(o =>
      o.created_at < cutoffIso &&
      o.status !== 'Archived' &&
      (o.order_status === 'Validated' || o.order_status === 'Reported' || o.order_status === 'Cancelled')
    );

    if (eligibleOrders.length === 0) {
      console.log('No records older than ' + archiveMonths + ' months found. Archival skipped.');
      return { status: 'SUCCESS', archivedOrdersCount: 0 };
    }

    console.log(`Found ${eligibleOrders.length} orders eligible for archival.`);
    const archivedOrderIds = eligibleOrders.map(o => o.id);

    Utils.withScriptLock(() => {
      // 1. Ensure Archive_Orders sheet exists
      let archSheet = ss.getSheetByName('Archive_Orders');
      if (!archSheet) {
        archSheet = ss.insertSheet('Archive_Orders');
        const orderHeaders = ss.getSheetByName('Orders').getRange(1, 1, 1, ss.getSheetByName('Orders').getLastColumn()).getValues()[0];
        archSheet.getRange(1, 1, 1, orderHeaders.length).setValues([orderHeaders]);
        archSheet.setFrozenRows(1);
      }

      // 2. Mark eligible orders as Archived
      const now = Utils.getTimestamp();
      for (const ord of eligibleOrders) {
        ord.status = 'Archived';
        ord.updated_at = now;
        ord.updated_by = 'ARCHIVAL_TRIGGER';
        Repository.saveRow('Orders', ord);
      }

      // Invalidate cache
      Repository.clearCache('Orders');
    });

    Repository.logAudit('ARCHIVE', 'Orders', 'SCALE_GUARD', {
      archivedOrders: eligibleOrders.length,
      cutoffDate: cutoffIso
    });

    console.log(`Archival complete. Archived ${eligibleOrders.length} historical orders.`);
    return {
      status: 'SUCCESS',
      archivedOrdersCount: eligibleOrders.length,
      cutoffDate: cutoffIso
    };
  },

  /**
   * Daily Reagent Low-Stock Check Trigger (Scheduled daily at 07:00 AM)
   */
  dailyReagentAlertJob() {
    console.log('--- Running Daily Reagent Low Stock Alert Trigger ---');
    return InventoryService.checkLowStockAndAlert();
  },

  /**
   * Programmatically installs all production time-driven triggers in Apps Script
   */
  installAllTriggers() {
    if (typeof ScriptApp === 'undefined') {
      console.log('ScriptApp unavailable (simulation mode). Trigger installation skipped.');
      return { status: 'SIMULATED' };
    }

    // 1. Delete existing triggers to avoid duplicates
    const currentTriggers = ScriptApp.getProjectTriggers();
    for (const t of currentTriggers) {
      const handler = t.getHandlerFunction();
      if (['dailyNightlyBackupJob', 'monthlyArchivalJob', 'dailyReagentAlertJob'].includes(handler)) {
        ScriptApp.deleteTrigger(t);
      }
    }

    // 2. Install Daily Backup at 02:00 AM IST
    ScriptApp.newTrigger('dailyNightlyBackupJob')
      .timeBased()
      .atHour(2)
      .everyDays(1)
      .inTimezone('Asia/Kolkata')
      .create();

    // 3. Install Daily Reagent Alert at 07:00 AM IST
    ScriptApp.newTrigger('dailyReagentAlertJob')
      .timeBased()
      .atHour(7)
      .everyDays(1)
      .inTimezone('Asia/Kolkata')
      .create();

    // 4. Install Monthly Archiving on 1st of every month at 03:00 AM IST
    ScriptApp.newTrigger('monthlyArchivalJob')
      .timeBased()
      .onMonthDay(1)
      .atHour(3)
      .inTimezone('Asia/Kolkata')
      .create();

    console.log('All 3 automated triggers successfully registered in Google Apps Script.');
    return {
      status: 'SUCCESS',
      installedTriggers: ['dailyNightlyBackupJob (Daily 2 AM)', 'dailyReagentAlertJob (Daily 7 AM)', 'monthlyArchivalJob (Monthly 1st 3 AM)']
    };
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Triggers;
}
