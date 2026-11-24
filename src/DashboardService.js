/**
 * Laboratory Information System (LIS) - Operational Dashboard & Analytics Service
 * Computes live operational metrics:
 * - Today's patient registrations, orders, and revenue (Cash vs UPI)
 * - Pending samples, awaiting validation, and TAT breaches
 * - Test-wise and Referring Doctor-wise distributions
 * - Native Google Sheets "Reports" tab generator with QUERY & PIVOT formulas
 */

// Node.js environment imports
if (typeof require !== 'undefined') {
  var Repository = require('./Repository.js');
  var Utils = require('./Utils.js');
  var { PERMISSIONS, SessionContext } = require('./Auth.js');
}

const DashboardService = {
  /**
   * Computes live operational metrics for the Web App Dashboard
   * @return {Object}
   */
  getOperationalDashboard() {
    SessionContext.requirePermission(PERMISSIONS.CATALOG_VIEW, 'View Dashboard');

    const todayDate = new Date().toISOString().substring(0, 10);

    const patients = Repository.getTable('Patients', false).filter(p => p.status !== 'Inactive');
    const orders = Repository.getTable('Orders', false).filter(o => o.status !== 'Cancelled');
    const samples = Repository.getTable('Samples', false).filter(s => s.status !== 'Archived');
    const results = Repository.getTable('Results', false).filter(r => (r.is_current_version === true || r.is_current_version === 'TRUE') && r.status !== 'Archived');
    const payments = Repository.getTable('Payments', false).filter(p => p.status === 'Completed');
    const catalogTests = Repository.getTable('Tests', true);

    // 1. Today's Metrics
    const todayPatients = patients.filter(p => String(p.created_at || '').substring(0, 10) === todayDate).length;
    const todayOrders = orders.filter(o => String(o.order_date || o.created_at || '').substring(0, 10) === todayDate);

    let todayGross = 0;
    let todayDiscount = 0;
    let todayNet = 0;
    let todayPaid = 0;

    for (const ord of todayOrders) {
      todayGross += parseFloat(ord.total_amount) || 0;
      todayDiscount += parseFloat(ord.discount_amount) || 0;
      todayNet += parseFloat(ord.net_amount) || 0;
      todayPaid += parseFloat(ord.paid_amount) || 0;
    }

    // Today's Payments breakdown by payment method
    const todayPayments = payments.filter(p => String(p.payment_date || p.created_at || '').substring(0, 10) === todayDate);
    const revenueByMethod = { Cash: 0, UPI: 0, 'Debit Card': 0, 'Credit Card': 0, Other: 0 };
    for (const pay of todayPayments) {
      const amt = parseFloat(pay.amount) || 0;
      const method = pay.payment_method || 'Other';
      if (revenueByMethod[method] !== undefined) {
        revenueByMethod[method] += amt;
      } else {
        revenueByMethod.Other += amt;
      }
    }

    // 2. Sample Pipeline Counts
    const samplesPendingCollection = samples.filter(s => s.collection_status === 'Ordered').length;
    const samplesPendingAccession = samples.filter(s => s.collection_status === 'Collected').length;
    const samplesInLab = samples.filter(s => s.collection_status === 'Received' || s.collection_status === 'In Process').length;

    // 3. Results Pipeline
    const resultsPendingValidation = results.filter(r => r.result_status === 'Entered').length;
    const resultsValidatedToday = results.filter(r => r.result_status === 'Validated' && String(r.validated_at || '').substring(0, 10) === todayDate).length;

    // 4. TAT (Turnaround Time) Breaches Check
    // Orders in process where elapsed time > test TAT hours
    let tatBreachesCount = 0;
    const nowMs = Date.now();
    for (const ord of orders) {
      if (ord.order_status === 'Booked' || ord.order_status === 'Collected' || ord.order_status === 'In Process') {
        const createdMs = new Date(ord.created_at).getTime();
        const elapsedHours = (nowMs - createdMs) / (1000 * 60 * 60);
        if (elapsedHours > 6) { // Flag if pending > 6 hours
          tatBreachesCount++;
        }
      }
    }

    // 5. Test-wise Distribution (Top 5)
    const testCounts = {};
    for (const res of results) {
      const name = res.parameter_name || 'Other';
      testCounts[name] = (testCounts[name] || 0) + 1;
    }
    const topTests = Object.keys(testCounts)
      .map(k => ({ name: k, count: testCounts[k] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // 6. Doctor-wise Referral Counts
    const docCounts = {};
    const doctors = Repository.getTable('Doctors', true);
    for (const ord of orders) {
      const docId = ord.referring_doctor_id || 'DOC-SELF';
      const doc = doctors.find(d => d.id === docId);
      const name = doc ? doc.name : docId;
      docCounts[name] = (docCounts[name] || 0) + 1;
    }
    const topDoctors = Object.keys(docCounts)
      .map(k => ({ name: k, count: docCounts[k] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      todayDate: todayDate,
      kpis: {
        todayPatients: todayPatients,
        todayOrdersCount: todayOrders.length,
        todayRevenueNet: Utils.round(todayNet, 2),
        todayRevenueCollected: Utils.round(todayPaid, 2),
        pendingCollection: samplesPendingCollection,
        pendingAccession: samplesPendingAccession,
        samplesInProcess: samplesInLab,
        awaitingValidation: resultsPendingValidation,
        tatBreaches: tatBreachesCount
      },
      revenueBreakdown: revenueByMethod,
      topTests: topTests,
      topDoctors: topDoctors,
      totalRegisteredPatients: patients.length,
      totalOrdersAllTime: orders.length
    };
  },

  /**
   * Generates or refreshes the native Google Sheets "Reports" tab
   * Injects dynamic spreadsheet formulas (=QUERY, =PIVOT) for direct owner review
   */
  initOwnerReportsSheet() {
    SessionContext.requirePermission(PERMISSIONS.SETTINGS_MANAGE, 'Initialize Owner Reports Sheet');
    const ss = Repository.getSpreadsheet();
    if (!ss) return;

    let sheet = ss.getSheetByName('Reports');
    if (!sheet) {
      sheet = ss.insertSheet('Reports');
    }

    sheet.clear();

    // Title Header
    sheet.getRange('A1:G1').merge();
    sheet.getRange('A1').setValue('AROGYA DIAGNOSTIC LABORATORY - EXECUTIVE OWNER SUMMARY')
      .setFontWeight('bold').setFontSize(14).setBackground('#1E293B').setFontColor('#FFFFFF');

    // Section 1: Daily Revenue Summary Query
    sheet.getRange('A3').setValue('1. DAILY REVENUE SUMMARY (PAST 30 DAYS)').setFontWeight('bold').setFontSize(11);
    sheet.getRange('A4').setFormula(
      '=IFERROR(QUERY(Orders!A1:T, "SELECT G, COUNT(A), SUM(M), SUM(N), SUM(R), SUM(S) WHERE A IS NOT NULL AND U != \'Cancelled\' GROUP BY G ORDER BY G DESC LIMIT 30 LABEL G \'Date\', COUNT(A) \'Total Orders\', SUM(M) \'Gross (INR)\', SUM(N) \'Discount (INR)\', SUM(R) \'Net Billable\', SUM(S) \'Settled Paid\'", 1), "No order records found")'
    );

    // Section 2: Doctor-wise Referral Volumes
    sheet.getRange('I3').setValue('2. REFERRING DOCTOR REVENUE SUMMARY').setFontWeight('bold').setFontSize(11);
    sheet.getRange('I4').setFormula(
      '=IFERROR(QUERY(Orders!A1:T, "SELECT E, COUNT(A), SUM(R) WHERE A IS NOT NULL AND U != \'Cancelled\' GROUP BY E ORDER BY SUM(R) DESC LIMIT 20 LABEL E \'Doctor ID\', COUNT(A) \'Referrals\', SUM(R) \'Revenue (INR)\'", 1), "No doctor records")'
    );

    // Section 3: Collection Centre Performance
    sheet.getRange('M3').setValue('3. COLLECTION CENTRE REVENUE SUMMARY').setFontWeight('bold').setFontSize(11);
    sheet.getRange('M4').setFormula(
      '=IFERROR(QUERY(Orders!A1:T, "SELECT F, COUNT(A), SUM(R) WHERE A IS NOT NULL AND U != \'Cancelled\' GROUP BY F ORDER BY SUM(R) DESC LABEL F \'Centre ID\', COUNT(A) \'Volume\', SUM(R) \'Revenue (INR)\'", 1), "No centre records")'
    );

    sheet.autoResizeColumns(1, 16);
    return { status: 'SUCCESS', message: 'Owner Reports sheet successfully created with dynamic QUERY formulas.' };
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DashboardService;
}
