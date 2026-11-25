/**
 * Laboratory Information System (LIS) - Web App Routing & Controller API Gateway
 * Serves HtmlService UI and exposes server-side API endpoints to google.script.run
 */

function doGet(e) {
  const page = e && e.parameter && e.parameter.page ? e.parameter.page : 'app';

  // 1. Patient / Doctor Public Report Portal
  if (page === 'portal') {
    let template;
    try {
      template = HtmlService.createTemplateFromFile('ui/PatientPortal');
    } catch (err) {
      template = HtmlService.createTemplateFromFile('PatientPortal');
    }
    template.token = e && e.parameter ? e.parameter.token || '' : '';
    return template.evaluate()
      .setTitle('Arogya Diagnostics - Secure Report Portal')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  // 2. Main LIS Single Page Application
  let template;
  try {
    template = HtmlService.createTemplateFromFile('ui/Index');
  } catch (err) {
    template = HtmlService.createTemplateFromFile('Index');
  }
  template.initialContext = typeof SessionContext !== 'undefined' ? SessionContext.getClientContext() : {};

  return template.evaluate()
    .setTitle('Arogya Laboratory Information System (LIS)')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Injects sub-templates into main template
 * Supports both clasp path 'ui/Styles' and web editor name 'Styles'
 * @param {string} filename 
 * @return {string}
 */
function include(filename) {
  try {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  } catch (e) {
    const cleanName = filename.replace(/^ui\//, '');
    return HtmlService.createHtmlOutputFromFile(cleanName).getContent();
  }
}

// =========================================================================
// Server API Controllers (Exposed to google.script.run)
// =========================================================================

function apiGetContext() {
  return SessionContext.getClientContext();
}

// --- Patient APIs ---
function apiSearchPatients(query) {
  return PatientService.searchPatients(query);
}

function apiRegisterPatient(data, forceRegister) {
  return PatientService.registerPatient(data, forceRegister);
}

function apiGetPatientProfile(uhid) {
  return PatientService.getPatientProfile(uhid);
}

function apiUpdatePatient(uhid, updateData) {
  return PatientService.updatePatient(uhid, updateData);
}

// --- Catalog APIs ---
function apiGetCatalog() {
  return CatalogService.getFullCatalog();
}

function apiSearchCatalog(query) {
  return CatalogService.searchCatalog(query);
}

function apiBulkImportCatalog(csvString) {
  return CatalogService.bulkImportCsv(csvString);
}

// --- Order & Billing APIs ---
function apiCreateOrder(orderData) {
  return OrderBillingService.createOrder(orderData);
}

function apiAddPayment(orderId, paymentData) {
  return OrderBillingService.addPayment(orderId, paymentData);
}

function apiGenerateInvoicePdf(orderId) {
  return OrderBillingService.generateInvoicePdf(orderId);
}

// --- Sample APIs ---
function apiGenerateSamplesForOrder(orderId) {
  return SampleService.generateSamplesForOrder(orderId);
}

function apiGetPhlebotomyWorklist(statusFilter) {
  return SampleService.getPhlebotomyWorklist(statusFilter);
}

function apiMarkSampleCollected(sampleId) {
  return SampleService.markCollected(sampleId);
}

function apiMarkSampleReceived(sampleId) {
  return SampleService.markReceived(sampleId);
}

function apiRejectSample(sampleId, reason, requestRecollection) {
  return SampleService.rejectSample(sampleId, reason, requestRecollection);
}

function apiGetLabelPayload(sampleId) {
  return SampleService.getLabelPayload(sampleId);
}

// --- Result APIs ---
function apiGetDepartmentWorklist(department) {
  return ResultService.getDepartmentWorklist(department);
}

function apiGetOrderResultsForEntry(orderId, sampleId) {
  return ResultService.getOrderResultsForEntry(orderId, sampleId);
}

function apiSaveResults(orderId, sampleId, paramValues, submitForValidation) {
  return ResultService.saveResults(orderId, sampleId, paramValues, submitForValidation);
}

function apiValidateResults(orderId) {
  return ResultService.validateResults(orderId);
}

function apiAmendResult(resultId, newValue, amendmentReason) {
  return ResultService.amendResult(resultId, newValue, amendmentReason);
}

// --- Report APIs ---
function apiCompileReportData(orderId) {
  return ReportService.compileReportData(orderId);
}

function apiGenerateReportPdf(orderId) {
  const url = ScriptApp.getService().getUrl();
  return ReportService.generateReportPdf(orderId, url);
}

function apiSendReportEmail(orderId) {
  return ReportService.sendReportEmail(orderId);
}

function apiGetWhatsAppShareUrl(orderId) {
  const url = ScriptApp.getService().getUrl();
  return ReportService.getWhatsAppShareUrl(orderId, url);
}

// --- Dashboard & Analytics APIs ---
function apiGetOperationalDashboard() {
  return DashboardService.getOperationalDashboard();
}

function apiInitOwnerReportsSheet() {
  return DashboardService.initOwnerReportsSheet();
}

// --- Inventory APIs ---
function apiGetInventoryList() {
  return InventoryService.getInventoryList();
}

function apiAdjustStock(itemId, delta, reason) {
  return InventoryService.adjustStock(itemId, delta, reason);
}

// --- Admin APIs ---
function apiGetSettings() {
  return AdminService.getSettings();
}

function apiUpdateSettings(settingsMap) {
  return AdminService.updateSettings(settingsMap);
}

function apiGetUsersList() {
  return AdminService.getUsersList();
}

function apiSaveUser(userData) {
  return AdminService.saveUser(userData);
}

function apiGetAuditLogs(limit, offset) {
  return AdminService.getAuditLogs(limit, offset);
}

// --- Patient Portal APIs (Public Token + OTP) ---
function apiRequestPortalOtp(token, mobileNumber) {
  return ReportService.requestPortalOtp(token, mobileNumber);
}

function apiVerifyPortalOtp(token, mobileNumber, enteredOtp) {
  return ReportService.verifyPortalOtp(token, mobileNumber, enteredOtp);
}

// --- Trigger & Setup Management ---
function apiRunDatabaseSetup() {
  return Setup.setup();
}

function apiInstallTriggers() {
  return Triggers.installAllTriggers();
}

