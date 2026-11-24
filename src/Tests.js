/**
 * Laboratory Information System (LIS) - Unit Tests for Phase 1
 * Validates ID generation, atomic counters, role permissions, repository mapping,
 * and clinical calculation formulas.
 */

// If running in Node.js environment
if (typeof require !== 'undefined') {
  var Utils = require('./Utils.js');
  var { ROLES, PERMISSIONS, SessionContext } = require('./Auth.js');
  var Setup = require('./Setup.js');
  var Repository = require('./Repository.js');
  var PatientService = require('./PatientService.js');
  var CatalogService = require('./CatalogService.js');
  var OrderBillingService = require('./OrderBillingService.js');
  var SampleService = require('./SampleService.js');
  var ResultService = require('./ResultService.js');
  var ReportService = require('./ReportService.js');
  var DashboardService = require('./DashboardService.js');
  var InventoryService = require('./InventoryService.js');
  var AdminService = require('./AdminService.js');
  var Triggers = require('./Triggers.js');

  global.Utils = Utils;
  global.Repository = Repository;
  global.SessionContext = SessionContext;
  global.ROLES = ROLES;
  global.PERMISSIONS = PERMISSIONS;
}

const Tests = {
  /**
   * Test 1: Concurrency and ID Generation
   */
  testIdGeneration() {
    console.log('Running testIdGeneration...');
    const id = Utils.generateId('PAT');
    if (!id.startsWith('PAT-') || id.length < 10) {
      throw new Error('generateId failed: ' + id);
    }

    const token = Utils.generateSecureToken();
    if (!token || token.length < 16) {
      throw new Error('generateSecureToken failed: ' + token);
    }

    const otp = Utils.generateOtp();
    if (!otp || otp.length !== 6 || isNaN(Number(otp))) {
      throw new Error('generateOtp failed: ' + otp);
    }

    const hash = Utils.hashOtp(otp, 'TEST_SALT');
    if (!hash || hash.length < 4) {
      throw new Error('hashOtp failed: ' + hash);
    }

    console.log('✔ testIdGeneration passed.');
    return true;
  },

  /**
   * Test 2: RBAC Matrix and Session Enforcement
   */
  testRolePermissions() {
    console.log('Running testRolePermissions...');

    // Admin should have all permissions
    SessionContext.setMockSession('admin@test.com', ROLES.ADMIN);
    if (!SessionContext.hasPermission(PERMISSIONS.PATIENT_REGISTER)) throw new Error('Admin should register patients');
    if (!SessionContext.hasPermission(PERMISSIONS.RESULT_VALIDATE)) throw new Error('Admin should validate results');
    if (!SessionContext.hasPermission(PERMISSIONS.SETTINGS_MANAGE)) throw new Error('Admin should manage settings');

    // FrontDesk permissions
    SessionContext.setMockSession('front@test.com', ROLES.FRONT_DESK);
    if (!SessionContext.hasPermission(PERMISSIONS.PATIENT_REGISTER)) throw new Error('FrontDesk must register patients');
    if (!SessionContext.hasPermission(PERMISSIONS.ORDER_CREATE)) throw new Error('FrontDesk must create orders');
    if (!SessionContext.hasPermission(PERMISSIONS.BILLING_COLLECT)) throw new Error('FrontDesk must collect billing');
    if (SessionContext.hasPermission(PERMISSIONS.RESULT_VALIDATE)) throw new Error('FrontDesk CANNOT validate results');
    if (SessionContext.hasPermission(PERMISSIONS.SETTINGS_MANAGE)) throw new Error('FrontDesk CANNOT manage settings');

    // Pathologist permissions
    SessionContext.setMockSession('path@test.com', ROLES.PATHOLOGIST);
    if (!SessionContext.hasPermission(PERMISSIONS.RESULT_VALIDATE)) throw new Error('Pathologist must validate results');
    if (!SessionContext.hasPermission(PERMISSIONS.REPORT_GENERATE)) throw new Error('Pathologist must generate reports');
    if (SessionContext.hasPermission(PERMISSIONS.BILLING_COLLECT)) throw new Error('Pathologist should not collect billing');

    // Lab Technician permissions
    SessionContext.setMockSession('tech@test.com', ROLES.LAB_TECHNICIAN);
    if (!SessionContext.hasPermission(PERMISSIONS.RESULT_ENTER)) throw new Error('Tech must enter results');
    if (SessionContext.hasPermission(PERMISSIONS.RESULT_VALIDATE)) throw new Error('Tech CANNOT validate results');

    // Anonymous Patient permissions
    SessionContext.setMockSession('anonymous@patient.local', ROLES.PATIENT);
    if (SessionContext.hasPermission(PERMISSIONS.PATIENT_REGISTER)) throw new Error('Patient CANNOT register patients directly');

    SessionContext.clearMockSession();
    console.log('✔ testRolePermissions passed.');
    return true;
  },

  /**
   * Test 3: Clinical Calculation Formulas
   */
  testClinicalFormulas() {
    console.log('Running testClinicalFormulas...');

    // Indirect Bilirubin = Total (1.8) - Direct (0.5) = 1.3
    const indBilirubin = Utils.calcIndirectBilirubin(1.8, 0.5);
    if (indBilirubin !== 1.3) throw new Error('calcIndirectBilirubin failed: ' + indBilirubin);

    // Globulin = Total Protein (7.5) - Albumin (4.2) = 3.3
    const globulin = Utils.calcGlobulin(7.5, 4.2);
    if (globulin !== 3.3) throw new Error('calcGlobulin failed: ' + globulin);

    // A/G Ratio = Albumin (4.2) / Globulin (3.3) = 1.27
    const agRatio = Utils.calcAGRatio(4.2, 3.3);
    if (agRatio !== 1.27) throw new Error('calcAGRatio failed: ' + agRatio);

    // VLDL = Triglycerides (150) / 5 = 30.0
    const vldl = Utils.calcVLDL(150);
    if (vldl !== 30.0) throw new Error('calcVLDL failed: ' + vldl);

    // Friedewald LDL = Total (220) - HDL (45) - VLDL (150/5 = 30) = 145.0
    const ldl = Utils.calcFriedewaldLDL(220, 45, 150);
    if (ldl !== 145.0) throw new Error('calcFriedewaldLDL failed: ' + ldl);

    // Chol / HDL Ratio = 220 / 45 = 4.89
    const cholHdl = Utils.calcCholHdlRatio(220, 45);
    if (cholHdl !== 4.89) throw new Error('calcCholHdlRatio failed: ' + cholHdl);

    // ANC = (TLC 8000 * Neutrophils 65%) / 100 = 5200
    const anc = Utils.calcANC(8000, 65);
    if (anc !== 5200) throw new Error('calcANC failed: ' + anc);

    console.log('✔ testClinicalFormulas passed.');
    return true;
  },

  /**
   * Test 4: Schema Definition Integrity
   */
  testSchemaIntegrity() {
    console.log('Running testSchemaIntegrity...');
    const schemas = Setup.getSchemas();
    if (schemas.length !== 17) {
      throw new Error(`Expected 17 schemas, but found ${schemas.length}`);
    }

    const requiredSheets = [
      'Patients', 'Tests', 'Panels', 'PanelTests', 'ReferenceRanges',
      'Orders', 'OrderItems', 'Samples', 'Results', 'Invoices',
      'Payments', 'Doctors', 'Centres', 'Inventory', 'Users',
      'AuditLog', 'Settings'
    ];

    for (const name of requiredSheets) {
      const found = schemas.find(s => s.name === name);
      if (!found) throw new Error('Missing schema for tab: ' + name);
      if (!found.headers || found.headers.length < 4) {
        throw new Error('Headers invalid for tab: ' + name);
      }
    }

    console.log('✔ testSchemaIntegrity passed.');
    return true;
  },

  /**
   * Test 5: Patient Validation and DPDP Gate
   */
  testPatientValidation() {
    console.log('Running testPatientValidation...');
    SessionContext.setMockSession('front@arogyalabs.in', ROLES.FRONT_DESK);

    // Missing Name
    let failedWithoutName = false;
    try {
      PatientService.registerPatient({ mobile: '9820011223', gender: 'Male', consent_dpdp: true });
    } catch (e) {
      failedWithoutName = true;
    }
    if (!failedWithoutName) throw new Error('Patient registration must fail without first name');

    // Invalid Mobile (e.g. 5 digits)
    let failedBadMobile = false;
    try {
      PatientService.registerPatient({ first_name: 'Amit', mobile: '12345', gender: 'Male', consent_dpdp: true });
    } catch (e) {
      failedBadMobile = true;
    }
    if (!failedBadMobile) throw new Error('Patient registration must fail with invalid mobile number');

    // Missing DPDP Consent
    let failedNoConsent = false;
    try {
      PatientService.registerPatient({ first_name: 'Amit', mobile: '9820011223', gender: 'Male', consent_dpdp: false });
    } catch (e) {
      failedNoConsent = true;
    }
    if (!failedNoConsent) throw new Error('Patient registration must strictly enforce DPDP 2023 consent');

    SessionContext.clearMockSession();
    console.log('✔ testPatientValidation passed.');
    return true;
  },

  /**
   * Test 6: Reference Range Resolution by Age and Gender
   */
  testReferenceRangeResolution() {
    console.log('Running testReferenceRangeResolution...');

    // Mock ReferenceRanges in memory
    const mockRanges = [
      {
        id: 'RR-HB-M', test_id: 'TST-CBC-HB', gender: 'Male',
        age_min_days: 4380, age_max_days: 43800, normal_low: 13.0, normal_high: 17.0, status: 'Active'
      },
      {
        id: 'RR-HB-F', test_id: 'TST-CBC-HB', gender: 'Female',
        age_min_days: 4380, age_max_days: 43800, normal_low: 12.0, normal_high: 15.0, status: 'Active'
      },
      {
        id: 'RR-HB-P', test_id: 'TST-CBC-HB', gender: 'All',
        age_min_days: 365, age_max_days: 4380, normal_low: 11.0, normal_high: 14.0, status: 'Active'
      }
    ];

    Repository._requestCache['ReferenceRanges'] = mockRanges;

    // Adult Male (30 years = 10,950 days)
    const maleRange = CatalogService.getApplicableReferenceRange('TST-CBC-HB', 'Male', 10950);
    if (!maleRange || maleRange.normal_low !== 13.0) {
      throw new Error('Failed to resolve adult male Hb range');
    }

    // Adult Female (30 years)
    const femaleRange = CatalogService.getApplicableReferenceRange('TST-CBC-HB', 'Female', 10950);
    if (!femaleRange || femaleRange.normal_low !== 12.0) {
      throw new Error('Failed to resolve adult female Hb range');
    }

    // Pediatric Patient (5 years = 1,825 days)
    const pedRange = CatalogService.getApplicableReferenceRange('TST-CBC-HB', 'Male', 1825);
    if (!pedRange || pedRange.normal_low !== 11.0) {
      throw new Error('Failed to resolve pediatric Hb range');
    }

    delete Repository._requestCache['ReferenceRanges'];
    console.log('✔ testReferenceRangeResolution passed.');
    return true;
  },

  /**
   * Master Runner for Phase 2
   */
  runAllPhase2Tests() {
    console.log('=== STARTING LIS PHASE 2 UNIT TESTS ===');
    const results = {
      testPatientValidation: this.testPatientValidation(),
      testReferenceRangeResolution: this.testReferenceRangeResolution()
    };
    console.log('=== ALL PHASE 2 TESTS PASSED SUCCESSFULLY! ===');
    return results;
  },

  /**
   * Test 7: Order Creation and Billing Totals
   */
  testOrderAndBillingTotals() {
    console.log('Running testOrderAndBillingTotals...');
    SessionContext.setMockSession('front@arogyalabs.in', ROLES.FRONT_DESK);

    // Setup Mock Patient in cache
    Repository._requestCache['Patients'] = [
      { id: 'PAT-1', uhid: 'UHID-2026-10001', first_name: 'Rajesh', last_name: 'Verma', title: 'Mr', status: 'Active' }
    ];

    // Setup Mock Catalog in cache
    Repository._requestCache['Tests'] = [
      { id: 'TST-1', code: 'GLU_FAST', name: 'Fasting Glucose', department: 'Biochemistry', price: 100, b2b_price: 60, status: 'Active' },
      { id: 'TST-2', code: 'CBC_HB', name: 'Hemoglobin', department: 'Hematology', price: 120, b2b_price: 80, status: 'Active' }
    ];
    Repository._requestCache['Panels'] = [
      { id: 'PNL-1', code: 'CBC', name: 'Complete Blood Count', department: 'Hematology', price: 350, b2b_price: 220, status: 'Active' }
    ];
    Repository._requestCache['PanelTests'] = [
      { id: 'PT-1', panel_id: 'PNL-1', test_id: 'TST-2', display_order: 1, status: 'Active' }
    ];
    Repository._requestCache['Settings'] = [
      { key: 'COUNTER_ORDER', value: '10001' },
      { key: 'COUNTER_INVOICE', value: '10001' },
      { key: 'COUNTER_RECEIPT', value: '10001' }
    ];

    // Mock storage arrays
    const savedOrders = [];
    const savedInvoices = [];
    const savedItems = [];
    const savedPayments = [];

    const origSaveRow = Repository.saveRow;
    const origBatchInsert = Repository.batchInsert;

    Repository.saveRow = function(sheet, row) {
      if (sheet === 'Orders') savedOrders.push(row);
      if (sheet === 'Invoices') savedInvoices.push(row);
      return row;
    };
    Repository.batchInsert = function(sheet, rows) {
      if (sheet === 'OrderItems') savedItems.push(...rows);
      if (sheet === 'Payments') savedPayments.push(...rows);
    };

    // Test: Book Order with Test + Panel + 10% Discount + Partial Payment
    // Test: 100 (Glucose) + 350 (CBC Panel) = 450 gross
    // Discount: 50 -> Net: 400
    // Payment: 200 -> Balance: 200, Status: Partial
    const orderPayload = {
      uhid: 'UHID-2026-10001',
      items: [
        { type: 'Test', code: 'GLU_FAST' },
        { type: 'Panel', code: 'CBC' }
      ],
      discount_amount: 50,
      discount_authorized_by: 'admin@arogyalabs.in',
      discount_reason: 'Senior Citizen concession',
      initial_payment: {
        amount: 200,
        payment_method: 'UPI',
        transaction_ref: 'UPI-UTR-998877'
      }
    };

    const result = OrderBillingService.createOrder(orderPayload);

    if (result.order.total_amount !== 450) {
      throw new Error('Gross total calculation failed: expected 450, got ' + result.order.total_amount);
    }
    if (result.order.net_amount !== 400) {
      throw new Error('Net amount calculation failed: expected 400, got ' + result.order.net_amount);
    }
    if (result.order.paid_amount !== 200) {
      throw new Error('Paid amount calculation failed: expected 200, got ' + result.order.paid_amount);
    }
    if (result.order.payment_status !== 'Partial') {
      throw new Error('Payment status failed: expected Partial, got ' + result.order.payment_status);
    }
    if (result.invoice.balance_amount !== 200) {
      throw new Error('Balance calculation failed: expected 200, got ' + result.invoice.balance_amount);
    }

    // Restore Repository
    Repository.saveRow = origSaveRow;
    Repository.batchInsert = origBatchInsert;
    Repository._requestCache = {};
    SessionContext.clearMockSession();

    console.log('✔ testOrderAndBillingTotals passed.');
    return true;
  },

  /**
   * Master Runner for Phase 3
   */
  runAllPhase3Tests() {
    console.log('=== STARTING LIS PHASE 3 UNIT TESTS ===');
    const results = {
      testOrderAndBillingTotals: this.testOrderAndBillingTotals()
    };
    console.log('=== ALL PHASE 3 TESTS PASSED SUCCESSFULLY! ===');
    return results;
  },

  /**
   * Test 8: Sample Tube Grouping, Status Transitions & Recollection
   */
  testSampleTrackingAndRecollection() {
    console.log('Running testSampleTrackingAndRecollection...');
    SessionContext.setMockSession('phleb@arogyalabs.in', ROLES.PHLEBOTOMIST);

    // Mock Order
    const mockOrder = {
      id: 'ORD-TEST-1',
      order_no: 'ORD-2026-10001',
      uhid: 'UHID-2026-10001',
      patient_name: 'Rajesh Verma',
      order_status: 'Booked',
      status: 'Active'
    };

    // Mock Order Items: 3 tests (2 on Serum SST, 1 on EDTA)
    const mockItems = [
      { id: 'OI-1', order_id: 'ORD-TEST-1', item_code: 'LFT_TBIL', department: 'Biochemistry' },
      { id: 'OI-2', order_id: 'ORD-TEST-1', item_code: 'KFT_CREAT', department: 'Biochemistry' },
      { id: 'OI-3', order_id: 'ORD-TEST-1', item_code: 'CBC_HB', department: 'Hematology' }
    ];

    // Mock Catalog Tests defining container types
    const mockTests = [
      { id: 'TST-1', code: 'LFT_TBIL', sample_type: 'Serum', container_type: 'Yellow (SST)', department: 'Biochemistry', status: 'Active' },
      { id: 'TST-2', code: 'KFT_CREAT', sample_type: 'Serum', container_type: 'Yellow (SST)', department: 'Biochemistry', status: 'Active' },
      { id: 'TST-3', code: 'CBC_HB', sample_type: 'EDTA Whole Blood', container_type: 'Lavender (EDTA)', department: 'Hematology', status: 'Active' }
    ];

    Repository._requestCache['Orders'] = [mockOrder];
    Repository._requestCache['OrderItems'] = mockItems;
    Repository._requestCache['Tests'] = mockTests;
    Repository._requestCache['Samples'] = [];
    Repository._requestCache['Settings'] = [
      { key: 'COUNTER_SAMPLE', value: '100001' }
    ];

    const savedSamples = [];
    const origBatchInsert = Repository.batchInsert;
    const origSaveRow = Repository.saveRow;

    Repository.batchInsert = function(sheet, rows) {
      if (sheet === 'Samples') savedSamples.push(...rows);
    };
    Repository.saveRow = function(sheet, row) {
      if (sheet === 'Samples') {
        const idx = savedSamples.findIndex(s => s.id === row.id);
        if (idx >= 0) savedSamples[idx] = row;
        else savedSamples.push(row);
      }
      return row;
    };

    // 1. Generate Samples - should create exactly 2 tubes (1 SST for both LFT+KFT, 1 EDTA for CBC)
    const samples = SampleService.generateSamplesForOrder('ORD-TEST-1');
    if (samples.length !== 2) {
      throw new Error('Tube grouping failed: expected 2 tubes, got ' + samples.length);
    }

    const sstTube = samples.find(s => s.container_tube === 'Yellow (SST)');
    const edtaTube = samples.find(s => s.container_tube === 'Lavender (EDTA)');

    if (!sstTube || !edtaTube) {
      throw new Error('Tube grouping failed: missing SST or EDTA tube');
    }

    // 2. Mark SST Collected by Phleb
    Repository._requestCache['Samples'] = savedSamples;
    SampleService.markCollected(sstTube.id);
    if (sstTube.collection_status !== 'Collected') {
      throw new Error('Mark collected failed: expected Collected, got ' + sstTube.collection_status);
    }

    // 3. Mark SST Received by Lab Tech
    SessionContext.setMockSession('tech@arogyalabs.in', ROLES.LAB_TECHNICIAN);
    SampleService.markReceived(sstTube.id);
    if (sstTube.collection_status !== 'Received') {
      throw new Error('Mark received failed: expected Received, got ' + sstTube.collection_status);
    }

    // 4. Reject EDTA tube with Hemolyzed and request recollection
    const rejectResult = SampleService.rejectSample(edtaTube.id, 'Hemolyzed', true);
    if (edtaTube.collection_status !== 'Rejected') {
      throw new Error('Sample rejection failed');
    }
    if (!rejectResult.replacementBarcode) {
      throw new Error('Recollection replacement tube was not scheduled');
    }

    // Restore
    Repository.batchInsert = origBatchInsert;
    Repository.saveRow = origSaveRow;
    Repository._requestCache = {};
    SessionContext.clearMockSession();

    console.log('✔ testSampleTrackingAndRecollection passed.');
    return true;
  },

  /**
   * Master Runner for Phase 4
   */
  runAllPhase4Tests() {
    console.log('=== STARTING LIS PHASE 4 UNIT TESTS ===');
    const results = {
      testSampleTrackingAndRecollection: this.testSampleTrackingAndRecollection()
    };
    console.log('=== ALL PHASE 4 TESTS PASSED SUCCESSFULLY! ===');
    return results;
  },

  /**
   * Test 9: Result Auto-flagging, Delta Check & Versioned Amendments
   */
  testResultFlagsAndAmendments() {
    console.log('Running testResultFlagsAndAmendments...');

    // 1. Reference range flag evaluation
    const hbRange = { normal_low: 13.0, normal_high: 17.0, critical_low: 7.0, critical_high: 20.0 };

    const normalFlag = ResultService.evaluateFlag(14.5, hbRange);
    if (normalFlag.flag !== 'Normal' || normalFlag.isCritical) throw new Error('Expected Normal flag');

    const lowFlag = ResultService.evaluateFlag(11.5, hbRange);
    if (lowFlag.flag !== 'Low' || lowFlag.isCritical) throw new Error('Expected Low flag');

    const highFlag = ResultService.evaluateFlag(18.5, hbRange);
    if (highFlag.flag !== 'High' || highFlag.isCritical) throw new Error('Expected High flag');

    const panicLow = ResultService.evaluateFlag(5.8, hbRange);
    if (panicLow.flag !== 'Critical Low' || !panicLow.isCritical) throw new Error('Expected Critical Low panic flag');

    const panicHigh = ResultService.evaluateFlag(21.2, hbRange);
    if (panicHigh.flag !== 'Critical High' || !panicHigh.isCritical) throw new Error('Expected Critical High panic flag');

    // 2. Delta Check evaluation
    // Previous: 14.0, Current: 14.2 -> Normal velocity
    const delta1 = ResultService.evaluateDelta(14.2, 14.0);
    if (delta1.deltaFlag !== 'Normal Velocity') throw new Error('Expected Normal Velocity');

    // Previous: 1.0 (Creatinine), Current: 2.2 -> > 100% Increase
    const delta2 = ResultService.evaluateDelta(2.2, 1.0);
    if (delta2.deltaFlag !== 'Significant Increase') throw new Error('Expected Significant Increase');

    // 3. Two-Step Approval and Versioned Amendment
    SessionContext.setMockSession('tech@arogyalabs.in', ROLES.LAB_TECHNICIAN);

    const savedResults = [];
    const origSaveRow = Repository.saveRow;
    Repository.saveRow = function(sheet, row) {
      if (sheet === 'Results') {
        const idx = savedResults.findIndex(r => r.id === row.id);
        if (idx >= 0) savedResults[idx] = row;
        else savedResults.push(row);
      }
      return row;
    };

    // Tech enters result (Version 1)
    const initialResult = {
      id: 'RES-001',
      order_id: 'ORD-TEST-1',
      test_id: 'TST-CBC-HB',
      uhid: 'UHID-2026-10001',
      parameter_name: 'Hemoglobin (Hb)',
      numeric_value: 14.2,
      version: 1,
      is_current_version: true,
      result_status: 'Entered',
      status: 'Active'
    };
    savedResults.push(initialResult);
    Repository._requestCache['Results'] = savedResults;

    // Pathologist validates
    SessionContext.setMockSession('path@arogyalabs.in', ROLES.PATHOLOGIST);
    Repository._requestCache['Orders'] = [{ id: 'ORD-TEST-1', order_no: 'ORD-2026-10001', order_status: 'Resulted' }];
    Repository._requestCache['Samples'] = [{ id: 'SMP-1', order_id: 'ORD-TEST-1', collection_status: 'Resulted' }];

    ResultService.validateResults('ORD-TEST-1');
    if (initialResult.result_status !== 'Validated') {
      throw new Error('Pathologist validation failed: expected Validated');
    }

    // Now amend the result to 13.8 (Reason: Sample re-spun and re-analyzed)
    const amendResult = ResultService.amendResult('RES-001', 13.8, 'Sample re-spun and re-analyzed on secondary analyzer');
    if (initialResult.is_current_version !== false || initialResult.status !== 'Archived') {
      throw new Error('Previous version was not archived');
    }
    if (amendResult.amendedResult.version !== 2) {
      throw new Error('Amended result version expected 2, got ' + amendResult.amendedResult.version);
    }
    if (amendResult.amendedResult.numeric_value !== 13.8) {
      throw new Error('Amended result value expected 13.8');
    }

    // Restore
    Repository.saveRow = origSaveRow;
    Repository._requestCache = {};
    SessionContext.clearMockSession();

    console.log('✔ testResultFlagsAndAmendments passed.');
    return true;
  },

  /**
   * Master Runner for Phase 5
   */
  runAllPhase5Tests() {
    console.log('=== STARTING LIS PHASE 5 UNIT TESTS ===');
    const results = {
      testResultFlagsAndAmendments: this.testResultFlagsAndAmendments()
    };
    console.log('=== ALL PHASE 5 TESTS PASSED SUCCESSFULLY! ===');
    return results;
  },

  /**
   * Test 10: Report Data Compilation, Trend Tables & Secure Patient Portal OTP
   */
  testReportCompilationAndPortalOtp() {
    console.log('Running testReportCompilationAndPortalOtp...');

    // Mock Patient
    const mockPatient = {
      id: 'PAT-001',
      uhid: 'UHID-2026-10001',
      title: 'Mr',
      first_name: 'Rajesh',
      last_name: 'Verma',
      gender: 'Male',
      age: 45,
      mobile: '9820012345',
      email: 'rajesh.verma@example.com',
      status: 'Active'
    };

    // Mock Order
    const mockOrder = {
      id: 'ORD-001',
      order_no: 'ORD-2026-10001',
      uhid: 'UHID-2026-10001',
      patient_name: 'Mr Rajesh Verma',
      order_date: '2026-11-24',
      payment_status: 'Unpaid', // Unpaid to test watermark
      order_status: 'Validated',
      referring_doctor_id: 'DOC-SELF',
      collection_centre_id: 'CTR-MAIN',
      status: 'Active',
      created_at: '2026-11-24T08:00:00Z'
    };

    // Mock Results
    const mockResults = [
      {
        id: 'RES-01',
        order_id: 'ORD-001',
        test_id: 'TST-CBC-HB',
        uhid: 'UHID-2026-10001',
        parameter_name: 'Hemoglobin (Hb)',
        numeric_value: 14.2,
        unit: 'g/dL',
        ref_range_text: '13.0 - 17.0 g/dL',
        flag: 'Normal',
        is_critical: false,
        is_current_version: true,
        result_status: 'Validated',
        status: 'Active',
        validated_at: '2026-11-24T10:00:00Z'
      }
    ];

    Repository._requestCache['Patients'] = [mockPatient];
    Repository._requestCache['Orders'] = [mockOrder];
    Repository._requestCache['Results'] = mockResults;
    Repository._requestCache['Settings'] = [
      { key: 'HOLD_UNPAID_REPORTS', value: 'TRUE' },
      { key: 'LAB_NAME', value: 'Arogya Diagnostic Laboratory' }
    ];

    // 1. Compile Report Data
    const report = ReportService.compileReportData('ORD-001');
    if (!report || report.orderNo !== 'ORD-2026-10001') {
      throw new Error('Report data compilation failed');
    }
    // Should have watermark because order is unpaid
    if (!report.showWatermark) {
      throw new Error('Unpaid order report must have provisional watermark enabled');
    }

    // 2. WhatsApp Click-to-chat URL
    const waUrl = ReportService.getWhatsAppShareUrl('ORD-001');
    if (!waUrl.startsWith('https://wa.me/919820012345')) {
      throw new Error('WhatsApp share URL generation failed: ' + waUrl);
    }

    // 3. Secure Patient Portal OTP
    const token = ReportService.getOrCreateReportToken('ORD-001');
    const otpRes = ReportService.requestPortalOtp(token, '9820012345');
    if (otpRes.status !== 'SUCCESS') {
      throw new Error('Patient portal OTP request failed');
    }

    // Cleanup
    Repository._requestCache = {};
    console.log('✔ testReportCompilationAndPortalOtp passed.');
    return true;
  },

  /**
   * Master Runner for Phase 6
   */
  runAllPhase6Tests() {
    console.log('=== STARTING LIS PHASE 6 UNIT TESTS ===');
    const results = {
      testReportCompilationAndPortalOtp: this.testReportCompilationAndPortalOtp()
    };
    console.log('=== ALL PHASE 6 TESTS PASSED SUCCESSFULLY! ===');
    return results;
  },

  /**
   * Test 11: Dashboard KPI Aggregation, Inventory Alerts & Admin Management
   */
  testDashboardAndInventory() {
    console.log('Running testDashboardAndInventory...');
    SessionContext.setMockSession('admin@arogyalabs.in', ROLES.ADMIN);

    const todayStr = new Date().toISOString().substring(0, 10);

    // Mock Patients, Orders, Samples, Results, Payments
    Repository._requestCache['Patients'] = [
      { id: 'P1', uhid: 'UHID-01', created_at: todayStr + 'T08:00:00Z', status: 'Active' },
      { id: 'P2', uhid: 'UHID-02', created_at: todayStr + 'T09:00:00Z', status: 'Active' }
    ];
    Repository._requestCache['Orders'] = [
      { id: 'O1', order_date: todayStr, total_amount: 500, discount_amount: 50, net_amount: 450, paid_amount: 450, status: 'Active', order_status: 'Validated' },
      { id: 'O2', order_date: todayStr, total_amount: 300, discount_amount: 0, net_amount: 300, paid_amount: 150, status: 'Active', order_status: 'In Process' }
    ];
    Repository._requestCache['Samples'] = [
      { id: 'S1', collection_status: 'Ordered', status: 'Active' },
      { id: 'S2', collection_status: 'Received', status: 'Active' }
    ];
    Repository._requestCache['Results'] = [
      { id: 'R1', parameter_name: 'Hemoglobin (Hb)', result_status: 'Validated', is_current_version: true, status: 'Active' },
      { id: 'R2', parameter_name: 'Fasting Glucose', result_status: 'Entered', is_current_version: true, status: 'Active' }
    ];
    Repository._requestCache['Payments'] = [
      { id: 'PAY-1', amount: 450, payment_method: 'UPI', payment_date: todayStr, status: 'Completed' },
      { id: 'PAY-2', amount: 150, payment_method: 'Cash', payment_date: todayStr, status: 'Completed' }
    ];
    Repository._requestCache['Doctors'] = [];
    Repository._requestCache['Tests'] = [];

    // 1. Dashboard KPIs
    const dash = DashboardService.getOperationalDashboard();
    if (dash.kpis.todayPatients !== 2) throw new Error('Dashboard todayPatients expected 2');
    if (dash.kpis.todayOrdersCount !== 2) throw new Error('Dashboard todayOrdersCount expected 2');
    if (dash.kpis.todayRevenueNet !== 750) throw new Error('Dashboard todayRevenueNet expected 750');
    if (dash.revenueBreakdown.UPI !== 450 || dash.revenueBreakdown.Cash !== 150) {
      throw new Error('Revenue breakdown mismatch');
    }

    // 2. Inventory Alerts Check
    Repository._requestCache['Inventory'] = [
      { id: 'I1', item_code: 'TUBE-EDTA', name: 'EDTA Vacutainer', current_stock: 40, min_reorder_level: 100, expiry_date: '2027-12-31', status: 'Active' },
      { id: 'I2', item_code: 'KIT-GLU', name: 'Glucose Kit', current_stock: 500, min_reorder_level: 100, expiry_date: '2027-12-31', status: 'Active' }
    ];
    Repository._requestCache['Settings'] = [
      { key: 'LAB_EMAIL', value: 'admin@arogyalabs.in' },
      { key: 'LAB_NAME', value: 'Arogya Diagnostic Laboratory' }
    ];

    const invAlert = InventoryService.checkLowStockAndAlert();
    if (invAlert.alertsFound !== 1) {
      throw new Error('Inventory low-stock detection failed: expected 1 item');
    }

    // 3. User Management
    const origSaveRow = Repository.saveRow;
    const savedUsers = [];
    Repository.saveRow = function(sheet, row) {
      if (sheet === 'Users') savedUsers.push(row);
      return row;
    };

    const saveUserRes = AdminService.saveUser({
      email: 'tech2@arogyalabs.in',
      full_name: 'Rohan Joshi',
      role: 'LabTechnician',
      department: 'Hematology'
    });
    if (saveUserRes.status !== 'SUCCESS') {
      throw new Error('User creation failed');
    }
    Repository.saveRow = origSaveRow;

    // Cleanup
    Repository._requestCache = {};
    SessionContext.clearMockSession();

    console.log('✔ testDashboardAndInventory passed.');
    return true;
  },

  /**
   * Master Runner for Phase 7
   */
  runAllPhase7Tests() {
    console.log('=== STARTING LIS PHASE 7 UNIT TESTS ===');
    const results = {
      testDashboardAndInventory: this.testDashboardAndInventory()
    };
    console.log('=== ALL PHASE 7 TESTS PASSED SUCCESSFULLY! ===');
    return results;
  },

  /**
   * Master Runner for Phase 1
   */
  runAllPhase1Tests() {
    console.log('=== STARTING LIS PHASE 1 UNIT TESTS ===');
    const results = {
      testIdGeneration: this.testIdGeneration(),
      testRolePermissions: this.testRolePermissions(),
      testClinicalFormulas: this.testClinicalFormulas(),
      testSchemaIntegrity: this.testSchemaIntegrity()
    };
    console.log('=== ALL PHASE 1 TESTS PASSED SUCCESSFULLY! ===');
    return results;
  }
};

// Auto-run if executed directly via Node.js
if (typeof require !== 'undefined' && require.main === module) {
  Tests.runAllPhase1Tests();
  Tests.runAllPhase2Tests();
  Tests.runAllPhase3Tests();
  Tests.runAllPhase4Tests();
  Tests.runAllPhase5Tests();
  Tests.runAllPhase6Tests();
  Tests.runAllPhase7Tests();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Tests;
}
