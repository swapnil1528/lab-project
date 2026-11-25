const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, 'src');
const SHEET_ID = '1rJlUcwN7tLRz15BoF5jyxFUM2AMEfcHvwoxR2lYDPNfrg';

const jsFiles = [
  'Utils.js',
  'Repository.js',
  'Auth.js',
  'Setup.js',
  'PatientService.js',
  'CatalogService.js',
  'OrderBillingService.js',
  'SampleService.js',
  'ResultService.js',
  'ReportService.js',
  'DashboardService.js',
  'InventoryService.js',
  'AdminService.js',
  'Triggers.js'
];

let codeGs = `/**
 * ============================================================================
 * MASTERPRICK CLINICAL LABORATORY - BACKEND API & GOOGLE SHEETS DATABASE ENGINE
 * Database: Google Sheet ID [${SHEET_ID}]
 * Pure Backend Code.gs (NO HTML) - Cloud REST/JSON API Gateway & Core Engine
 * ============================================================================
 */

// Target Google Sheet Database ID
var TARGET_SPREADSHEET_ID = '${SHEET_ID}';
var SPREADSHEET_ID_OR_URL = '${SHEET_ID}';

/**
 * Top-Level Script Editor Functions (Visible in Run Dropdown)
 */
function setup() {
  return Setup.setup();
}

function runSetup() {
  return Setup.setup();
}

function installAllTriggers() {
  return Triggers.installAllTriggers();
}

function connectExistingSheet(sheetUrlOrId) {
  var id = String(sheetUrlOrId || '${SHEET_ID}').trim();
  if (id.includes('/spreadsheets/d/')) {
    var m = id.match(/\\/spreadsheets\\/d\\/([a-zA-Z0-9-_]+)/);
    if (m) id = m[1];
  }
  var ss = SpreadsheetApp.openById(id);
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', id);
  console.log('Successfully connected to Google Sheet: ' + ss.getName() + ' (' + ss.getUrl() + ')');
  return ss.getUrl();
}
`;

for (const file of jsFiles) {
  let code = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
  // Strip Node.js require blocks at top
  code = code.replace(/if\s*\(typeof\s+require\s*!==\s*'undefined'\)\s*\{[\s\S]*?\}\s*\n/g, '');
  // Strip Node.js module.exports blocks at bottom
  code = code.replace(/if\s*\(typeof\s+module\s*!==\s*'undefined'[\s\S]*$/, '');
  code = code.replace(/const\s+TARGET_SPREADSHEET_ID\s*=.*?;/g, '');
  code = code.replace(/const\s+SPREADSHEET_ID_OR_URL\s*=.*?;/g, '');
  // Convert top-level const to var for Google Apps Script multi-file compatibility
  code = code.replace(/^const\s+([A-Za-z0-9_]+)\s*=/gm, 'var $1 =');
  codeGs += `\n// ==================== ${file} ====================\n` + code.trim() + '\n';
}

codeGs += `
// ==================== PURE CLOUD API GATEWAY (doGet & doPost) ====================

/**
 * HTTP GET Endpoint
 * - If an 'Index.html' file exists in your Apps Script project, serves it with ALLOWALL
 * - Otherwise returns JSON API status & database connectivity info
 */
function doGet(e) {
  try {
    return HtmlService.createHtmlOutputFromFile('Index')
      .setTitle('Masterprick Clinical Laboratory')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  } catch (htmlErr) {}

  return ContentService.createTextOutput(JSON.stringify({
    status: 'ONLINE',
    service: 'Masterprick Clinical Laboratory LIS API Engine',
    databaseId: TARGET_SPREADSHEET_ID,
    timestamp: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}

/**
 * HTTP POST RPC API Gateway - Receives calls from React WebApp (Localhost or Web)
 */
function doPost(e) {
  try {
    try {
      var owner = Session.getEffectiveUser().getEmail();
      SessionContext.setMockSession(owner, ROLES.ADMIN);
    } catch (authErr) {}

    var body = {};
    if (e && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }
    var action = body.action || (e && e.parameter && e.parameter.action);
    var args = body.args || [];
    var result;

    if (action === 'getContext' || action === 'apiGetContext') result = SessionContext.getClientContext();
    else if (action === 'searchPatients' || action === 'apiSearchPatients') result = PatientService.searchPatients(args[0]);
    else if (action === 'registerPatient' || action === 'apiRegisterPatient') result = PatientService.registerPatient(args[0], args[1]);
    else if (action === 'getPatientProfile' || action === 'apiGetPatientProfile') result = PatientService.getPatientProfile(args[0]);
    else if (action === 'updatePatient' || action === 'apiUpdatePatient') result = PatientService.updatePatient(args[0], args[1]);
    else if (action === 'getCatalog' || action === 'apiGetCatalog') result = CatalogService.getFullCatalog();
    else if (action === 'searchCatalog' || action === 'apiSearchCatalog') result = CatalogService.searchCatalog(args[0]);
    else if (action === 'bulkImportCatalog' || action === 'apiBulkImportCatalog') result = CatalogService.bulkImportCsv(args[0]);
    else if (action === 'updateCatalogPrice' || action === 'apiUpdateCatalogPrice') result = CatalogService.updateCatalogPrice(args[0]);
    else if (action === 'createOrder' || action === 'apiCreateOrder') result = OrderBillingService.createOrder(args[0]);
    else if (action === 'getOrdersList' || action === 'apiGetOrdersList') result = OrderBillingService.getOrdersList(args[0]);
    else if (action === 'addPayment' || action === 'apiAddPayment') result = OrderBillingService.addPayment(args[0], args[1]);
    else if (action === 'generateInvoicePdf' || action === 'apiGenerateInvoicePdf') result = OrderBillingService.generateInvoicePdf(args[0]);
    else if (action === 'generateSamplesForOrder' || action === 'apiGenerateSamplesForOrder') result = SampleService.generateSamplesForOrder(args[0]);
    else if (action === 'getPhlebotomyWorklist' || action === 'apiGetPhlebotomyWorklist') result = SampleService.getPhlebotomyWorklist(args[0]);
    else if (action === 'markSampleCollected' || action === 'apiMarkSampleCollected') result = SampleService.markCollected(args[0]);
    else if (action === 'markSampleReceived' || action === 'apiMarkSampleReceived') result = SampleService.markReceived(args[0]);
    else if (action === 'rejectSample' || action === 'apiRejectSample') result = SampleService.rejectSample(args[0], args[1], args[2]);
    else if (action === 'getLabelPayload' || action === 'apiGetLabelPayload') result = SampleService.getLabelPayload(args[0]);
    else if (action === 'getDepartmentWorklist' || action === 'apiGetDepartmentWorklist') result = ResultService.getDepartmentWorklist(args[0]);
    else if (action === 'getOrderResultsForEntry' || action === 'apiGetOrderResultsForEntry') result = ResultService.getOrderResultsForEntry(args[0], args[1]);
    else if (action === 'saveResults' || action === 'apiSaveResults') result = ResultService.saveResults(args[0], args[1], args[2], args[3]);
    else if (action === 'validateResults' || action === 'apiValidateResults') result = ResultService.validateResults(args[0]);
    else if (action === 'amendResult' || action === 'apiAmendResult') result = ResultService.amendResult(args[0], args[1], args[2]);
    else if (action === 'compileReportData' || action === 'apiCompileReportData') result = ReportService.compileReportData(args[0]);
    else if (action === 'generateReportPdf' || action === 'apiGenerateReportPdf') result = ReportService.generateReportPdf(args[0]);
    else if (action === 'sendReportEmail' || action === 'apiSendReportEmail') result = ReportService.sendReportEmail(args[0]);
    else if (action === 'getWhatsAppShareUrl' || action === 'apiGetWhatsAppShareUrl') result = ReportService.getWhatsAppShareUrl(args[0]);
    else if (action === 'getOperationalDashboard' || action === 'apiGetOperationalDashboard') result = DashboardService.getOperationalDashboard();
    else if (action === 'initOwnerReportsSheet' || action === 'apiInitOwnerReportsSheet') result = DashboardService.initOwnerReportsSheet();
    else if (action === 'getInventoryList' || action === 'apiGetInventoryList') result = InventoryService.getInventoryList();
    else if (action === 'adjustStock' || action === 'apiAdjustStock') result = InventoryService.adjustStock(args[0], args[1], args[2]);
    else if (action === 'getSettings' || action === 'apiGetSettings') result = AdminService.getSettings();
    else if (action === 'updateSettings' || action === 'apiUpdateSettings') result = AdminService.updateSettings(args[0]);
    else if (action === 'getUsersList' || action === 'apiGetUsersList') result = AdminService.getUsersList();
    else if (action === 'saveUser' || action === 'apiSaveUser') result = AdminService.saveUser(args[0]);
    else if (action === 'getAuditLogs' || action === 'apiGetAuditLogs') result = AdminService.getAuditLogs(args[0], args[1]);
    else if (action === 'getDoctorsList' || action === 'apiGetDoctorsList') result = AdminService.getDoctorsList(args[0]);
    else if (action === 'saveDoctor' || action === 'apiSaveDoctor') result = AdminService.saveDoctor(args[0]);
    else if (action === 'deleteDoctor' || action === 'apiDeleteDoctor') result = AdminService.deleteDoctor(args[0]);
    else if (action === 'portalRequestOtp' || action === 'apiPortalRequestOtp') result = ReportService.requestPortalOtp(args[0], args[1]);
    else if (action === 'portalVerifyOtp' || action === 'apiPortalVerifyOtp') result = ReportService.verifyPortalOtp(args[0], args[1], args[2]);
    else if (action === 'setup' || action === 'runSetup') result = Setup.setup();
    else throw new Error('Unknown API action: ' + action);

    return ContentService.createTextOutput(JSON.stringify({ success: true, result: result }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ==================== TOP-LEVEL APIS FOR google.script.run ====================

function apiGetContext() { return SessionContext.getClientContext(); }
function apiSearchPatients(q) { return PatientService.searchPatients(q); }
function apiRegisterPatient(d, f) { return PatientService.registerPatient(d, f); }
function apiGetPatientProfile(u) { return PatientService.getPatientProfile(u); }
function apiUpdatePatient(u, d) { return PatientService.updatePatient(u, d); }
function apiGetCatalog() { return CatalogService.getFullCatalog(); }
function apiSearchCatalog(q) { return CatalogService.searchCatalog(q); }
function apiBulkImportCatalog(csv) { return CatalogService.bulkImportCsv(csv); }
function apiUpdateCatalogPrice(d) { return CatalogService.updateCatalogPrice(d); }
function apiCreateOrder(o) { return OrderBillingService.createOrder(o); }
function apiGetOrdersList(f) { return OrderBillingService.getOrdersList(f); }
function apiAddPayment(id, p) { return OrderBillingService.addPayment(id, p); }
function apiGenerateInvoicePdf(id) { return OrderBillingService.generateInvoicePdf(id); }
function apiGenerateSamplesForOrder(id) { return SampleService.generateSamplesForOrder(id); }
function apiGetPhlebotomyWorklist(s) { return SampleService.getPhlebotomyWorklist(s); }
function apiMarkSampleCollected(id) { return SampleService.markCollected(id); }
function apiMarkSampleReceived(id) { return SampleService.markReceived(id); }
function apiRejectSample(id, r, rec) { return SampleService.rejectSample(id, r, rec); }
function apiGetLabelPayload(id) { return SampleService.getLabelPayload(id); }
function apiGetDepartmentWorklist(d) { return ResultService.getDepartmentWorklist(d); }
function apiGetOrderResultsForEntry(o, s) { return ResultService.getOrderResultsForEntry(o, s); }
function apiSaveResults(o, s, v, sub) { return ResultService.saveResults(o, s, v, sub); }
function apiValidateResults(o) { return ResultService.validateResults(o); }
function apiAmendResult(id, val, r) { return ResultService.amendResult(id, val, r); }
function apiCompileReportData(o) { return ReportService.compileReportData(o); }
function apiGenerateReportPdf(o) { return ReportService.generateReportPdf(o); }
function apiSendReportEmail(o) { return ReportService.sendReportEmail(o); }
function apiGetWhatsAppShareUrl(o) { return ReportService.getWhatsAppShareUrl(o); }
function apiGetOperationalDashboard() { return DashboardService.getOperationalDashboard(); }
function apiInitOwnerReportsSheet() { return DashboardService.initOwnerReportsSheet(); }
function apiGetInventoryList() { return InventoryService.getInventoryList(); }
function apiAdjustStock(id, d, r) { return InventoryService.adjustStock(id, d, r); }
function apiGetSettings() { return AdminService.getSettings(); }
function apiUpdateSettings(m) { return AdminService.updateSettings(m); }
function apiGetUsersList() { return AdminService.getUsersList(); }
function apiSaveUser(u) { return AdminService.saveUser(u); }
function apiGetAuditLogs(l, o) { return AdminService.getAuditLogs(l, o); }
function apiGetDoctorsList(inc) { return AdminService.getDoctorsList(inc); }
function apiSaveDoctor(d) { return AdminService.saveDoctor(d); }
function apiDeleteDoctor(id) { return AdminService.deleteDoctor(id); }
function apiPortalRequestOtp(t, m) { return ReportService.requestPortalOtp(t, m); }
function apiPortalVerifyOtp(t, m, o) { return ReportService.verifyPortalOtp(t, m, o); }
function apiRunDatabaseSetup() { return Setup.setup(); }
function apiInstallTriggers() { return Triggers.installAllTriggers(); }
`;

const outputPath = path.join(__dirname, 'Code.gs');
fs.writeFileSync(outputPath, codeGs);
console.log('Successfully generated pure backend Code.gs! Size: ' + (codeGs.length / 1024).toFixed(1) + ' KB');

