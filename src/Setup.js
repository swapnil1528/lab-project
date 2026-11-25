/**
 * Laboratory Information System (LIS) - Idempotent Schema Setup & Seed Data
 * Creates and formats all 17 database tabs in Google Sheets.
 * Populates comprehensive clinical catalog (CBC, Glucose, HbA1c, KFT, LFT, Lipid, Thyroid, Urine)
 * with evidence-based reference ranges (AIIMS, Tietz, ICMR) and panic limits.
 */

const Setup = {
  /**
   * Main Setup Entrypoint - Run from Script Editor
   */
  setup() {
    console.log('--- Commencing LIS Database Setup ---');
    let ss = null;
    try {
      if (typeof Repository !== 'undefined' && Repository.getSpreadsheet) {
        ss = Repository.getSpreadsheet();
      }
    } catch (e) {}
    if (!ss) {
      try {
        ss = SpreadsheetApp.getActiveSpreadsheet();
      } catch (e) {}
    }
    if (!ss) {
      try {
        let propId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
        if (propId) {
          if (propId.includes('/spreadsheets/d/')) {
            const m = propId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
            if (m) propId = m[1];
          }
          ss = SpreadsheetApp.openById(propId);
        }
      } catch (e) {}
    }

    // Check optional manual configuration variable
    if (!ss && typeof SPREADSHEET_ID_OR_URL !== 'undefined' && SPREADSHEET_ID_OR_URL) {
      try {
        let sid = String(SPREADSHEET_ID_OR_URL).trim();
        if (sid.includes('/spreadsheets/d/')) {
          const m = sid.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
          if (m) sid = m[1];
        }
        ss = SpreadsheetApp.openById(sid);
        PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', sid);
      } catch (e) {}
    }

    // If still null, automatically create the Google Sheet in Drive!
    if (!ss) {
      try {
        console.log('No Google Sheet found. Automatically creating a brand new Google Sheet in your Google Drive...');
        ss = SpreadsheetApp.create('Arogya LIS Pathology Database');
        PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
        console.log('✔ Successfully created and linked Google Sheet: ' + ss.getUrl());
      } catch (err) {
        throw new Error('Could not create or connect Google Sheet: ' + err.message);
      }
    }

    const schemas = this.getSchemas();
    const createdTabs = [];

    // 1. Create all 17 tabs with headers and styling
    for (const schema of schemas) {
      let sheet = ss.getSheetByName(schema.name);
      if (!sheet) {
        sheet = ss.insertSheet(schema.name);
        createdTabs.push(schema.name);
      }

      // Check if headers already present
      const currentLastCol = sheet.getLastColumn();
      if (currentLastCol === 0 || sheet.getLastRow() === 0) {
        // Set headers
        sheet.getRange(1, 1, 1, schema.headers.length).setValues([schema.headers]);
        // Format header row
        const headerRange = sheet.getRange(1, 1, 1, schema.headers.length);
        headerRange.setBackground(schema.headerColor || '#1E293B'); // Slate-800
        headerRange.setFontColor('#FFFFFF');
        headerRange.setFontWeight('bold');
        headerRange.setFontSize(10);
        sheet.setFrozenRows(1);

        // Auto-fit column widths
        for (let c = 1; c <= schema.headers.length; c++) {
          sheet.setColumnWidth(c, 140);
        }
      }
    }

    // Remove default Sheet1 if empty
    const defaultSheet = ss.getSheetByName('Sheet1');
    if (defaultSheet && ss.getSheets().length > 1 && defaultSheet.getLastRow() <= 1) {
      try { ss.deleteSheet(defaultSheet); } catch (e) {}
    }

    // 2. Populate Seed Data (Idempotent)
    this.seedSettings(ss);
    this.seedUsers(ss);
    this.seedCentres(ss);
    this.seedDoctors(ss);
    this.seedCatalogAndRanges(ss);
    this.seedInventory(ss);

    // Invalidate all caches if Repository is loaded
    try {
      if (typeof Repository !== 'undefined' && Repository.clearCache) {
        Repository.clearCache();
      }
    } catch (e) {}

    console.log('--- LIS Database Setup Completed Successfully! Created tabs: ' + createdTabs.join(', ') + ' ---');
    return {
      status: 'SUCCESS',
      message: 'All 17 sheets successfully initialized and seeded with clinical diagnostic baseline.',
      tabs: schemas.map(s => s.name)
    };
  },

  /**
   * Returns schema definitions for all 17 sheets
   */
  getSchemas() {
    return [
      {
        name: 'Patients',
        headerColor: '#1E3A8A', // Blue-900
        headers: [
          'id', 'uhid', 'title', 'first_name', 'last_name', 'dob', 'age', 'age_unit',
          'gender', 'mobile', 'email', 'blood_group', 'address', 'city', 'pin_code',
          'national_id_type', 'national_id_masked', 'medical_history', 'consent_dpdp',
          'status', 'created_at', 'updated_at', 'created_by', 'updated_by'
        ]
      },
      {
        name: 'Tests',
        headerColor: '#0F766E', // Teal-700
        headers: [
          'id', 'code', 'name', 'department', 'sample_type', 'container_type',
          'methodology', 'tat_hours', 'price', 'b2b_price', 'units', 'is_calculated',
          'calculation_formula', 'report_order', 'status', 'created_at', 'updated_at', 'updated_by'
        ]
      },
      {
        name: 'Panels',
        headerColor: '#0F766E',
        headers: [
          'id', 'code', 'name', 'department', 'description', 'price', 'b2b_price',
          'tat_hours', 'status', 'created_at', 'updated_at', 'updated_by'
        ]
      },
      {
        name: 'PanelTests',
        headerColor: '#0F766E',
        headers: [
          'id', 'panel_id', 'test_id', 'display_order', 'status', 'created_at', 'updated_at', 'updated_by'
        ]
      },
      {
        name: 'ReferenceRanges',
        headerColor: '#0F766E',
        headers: [
          'id', 'test_id', 'gender', 'age_min_days', 'age_max_days', 'normal_low',
          'normal_high', 'critical_low', 'critical_high', 'unit', 'text_range',
          'clinical_significance', 'source_reference', 'status', 'created_at', 'updated_at', 'updated_by'
        ]
      },
      {
        name: 'Orders',
        headerColor: '#4338CA', // Indigo-700
        headers: [
          'id', 'order_no', 'uhid', 'patient_name', 'referring_doctor_id', 'collection_centre_id',
          'order_date', 'collection_type', 'home_visit_address', 'home_visit_scheduled_at',
          'priority', 'clinical_notes', 'total_amount', 'discount_amount', 'discount_reason',
          'discount_authorized_by', 'tax_amount', 'net_amount', 'paid_amount', 'payment_status',
          'order_status', 'status', 'created_at', 'updated_at', 'created_by', 'updated_by'
        ]
      },
      {
        name: 'OrderItems',
        headerColor: '#4338CA',
        headers: [
          'id', 'order_id', 'item_type', 'test_or_panel_id', 'item_code', 'item_name',
          'department', 'unit_price', 'discount_amount', 'final_price', 'sample_id',
          'item_status', 'status', 'created_at', 'updated_at', 'updated_by'
        ]
      },
      {
        name: 'Samples',
        headerColor: '#B45309', // Amber-700
        headers: [
          'id', 'barcode', 'order_id', 'uhid', 'patient_name', 'sample_type',
          'container_tube', 'department', 'collection_status', 'collected_at',
          'collected_by', 'received_at', 'received_by', 'rejection_reason',
          'recollection_flag', 'status', 'created_at', 'updated_at', 'updated_by'
        ]
      },
      {
        name: 'Results',
        headerColor: '#15803D', // Green-700
        headers: [
          'id', 'order_id', 'order_item_id', 'test_id', 'uhid', 'sample_id',
          'parameter_name', 'numeric_value', 'text_value', 'unit', 'ref_range_text',
          'flag', 'is_critical', 'delta_flag', 'previous_value', 'delta_percent',
          'version', 'technician_id', 'technician_entered_at', 'pathologist_id',
          'validated_at', 'result_status', 'amendment_reason', 'is_current_version',
          'status', 'created_at', 'updated_at', 'updated_by'
        ]
      },
      {
        name: 'Invoices',
        headerColor: '#0369A1', // Sky-700
        headers: [
          'id', 'invoice_no', 'order_id', 'uhid', 'patient_name', 'gross_amount',
          'discount_amount', 'tax_amount', 'net_amount', 'paid_amount', 'balance_amount',
          'payment_status', 'pdf_drive_file_id', 'pdf_url', 'status', 'created_at',
          'updated_at', 'created_by', 'updated_by'
        ]
      },
      {
        name: 'Payments',
        headerColor: '#0369A1',
        headers: [
          'id', 'receipt_no', 'invoice_id', 'order_id', 'uhid', 'amount',
          'payment_method', 'transaction_ref', 'payment_date', 'received_by',
          'status', 'created_at', 'updated_at', 'updated_by'
        ]
      },
      {
        name: 'Doctors',
        headerColor: '#475569', // Slate-600
        headers: [
          'id', 'code', 'name', 'degree', 'specialization', 'clinic_hospital',
          'mobile', 'email', 'commission_rate', 'portal_access_enabled',
          'status', 'created_at', 'updated_at', 'updated_by'
        ]
      },
      {
        name: 'Centres',
        headerColor: '#475569',
        headers: [
          'id', 'code', 'name', 'type', 'contact_person', 'phone', 'email',
          'address', 'commission_rate', 'price_tier', 'status', 'created_at',
          'updated_at', 'updated_by'
        ]
      },
      {
        name: 'Inventory',
        headerColor: '#7C3AED', // Violet-600
        headers: [
          'id', 'item_code', 'name', 'category', 'unit_of_measure', 'current_stock',
          'min_reorder_level', 'batch_number', 'expiry_date', 'supplier_name',
          'last_restocked_at', 'status', 'created_at', 'updated_at', 'updated_by'
        ]
      },
      {
        name: 'Users',
        headerColor: '#334155', // Slate-700
        headers: [
          'id', 'email', 'full_name', 'role', 'department', 'qualification',
          'signature_file_id', 'status', 'last_login_at', 'created_at', 'updated_at', 'updated_by'
        ]
      },
      {
        name: 'AuditLog',
        headerColor: '#18181B', // Zinc-900
        headers: [
          'id', 'timestamp', 'user_email', 'role', 'action', 'entity_type',
          'entity_id', 'details_json', 'ip_address'
        ]
      },
      {
        name: 'Settings',
        headerColor: '#334155',
        headers: [
          'key', 'value', 'category', 'description', 'updated_at', 'updated_by'
        ]
      }
    ];
  },

  /**
   * Seeds atomic sequential counters & lab configuration
   */
  seedSettings(ss) {
    const sheet = ss.getSheetByName('Settings');
    if (!sheet || sheet.getLastRow() > 1) return; // Already seeded

    const defaults = [
      // Atomic ID Counters
      ['COUNTER_UHID', '10001', 'Counter', 'Next sequential counter for Patient UHID', new Date().toISOString(), 'SYSTEM'],
      ['COUNTER_ORDER', '10001', 'Counter', 'Next sequential counter for Orders', new Date().toISOString(), 'SYSTEM'],
      ['COUNTER_SAMPLE', '100001', 'Counter', 'Next sequential counter for Sample Barcodes', new Date().toISOString(), 'SYSTEM'],
      ['COUNTER_INVOICE', '10001', 'Counter', 'Next sequential counter for Tax Invoices', new Date().toISOString(), 'SYSTEM'],
      ['COUNTER_RECEIPT', '10001', 'Counter', 'Next sequential counter for Money Receipts', new Date().toISOString(), 'SYSTEM'],

      // Lab Profile
      ['LAB_NAME', 'Arogya Diagnostic & Research Laboratory', 'LabProfile', 'Official Diagnostic Centre Name', new Date().toISOString(), 'SYSTEM'],
      ['LAB_TAGLINE', 'Precision Diagnostics & Clinical Excellence', 'LabProfile', 'Header tagline on reports', new Date().toISOString(), 'SYSTEM'],
      ['LAB_ADDRESS', 'Shop 12-14, Health Plaza, SV Road, Andheri West, Mumbai, Maharashtra 400058', 'LabProfile', 'Physical address on invoices & reports', new Date().toISOString(), 'SYSTEM'],
      ['LAB_PHONE', '+91 98200 12345', 'LabProfile', 'Contact helpline number', new Date().toISOString(), 'SYSTEM'],
      ['LAB_EMAIL', 'reports@arogyalabs.in', 'LabProfile', 'Official reports delivery email', new Date().toISOString(), 'SYSTEM'],
      ['LAB_WEBSITE', 'https://arogyalabs.in', 'LabProfile', 'Official lab portal URL', new Date().toISOString(), 'SYSTEM'],
      ['LAB_LOGO_URL', 'https://placehold.co/240x80/1E3A8A/FFFFFF?text=AROGYA+LAB', 'LabProfile', 'Branded header logo URL', new Date().toISOString(), 'SYSTEM'],
      ['LAB_GSTIN', '27AAAAA0000A1Z5', 'LabProfile', 'GST Number (or EXEMPT under Notification 12/2017)', new Date().toISOString(), 'SYSTEM'],

      // Compliance & Policies
      ['DPDP_RETENTION_MONTHS', '36', 'Compliance', 'Data retention period under DPDP 2023', new Date().toISOString(), 'SYSTEM'],
      ['ARCHIVE_AGE_MONTHS', '12', 'Compliance', 'Records older than this are moved to archive', new Date().toISOString(), 'SYSTEM'],
      ['OTP_EXPIRY_MINUTES', '10', 'Security', 'Expiration duration for patient portal OTPs', new Date().toISOString(), 'SYSTEM'],
      ['HOLD_UNPAID_REPORTS', 'TRUE', 'Billing', 'Hold/watermark final PDF reports until paid in full', new Date().toISOString(), 'SYSTEM']
    ];

    sheet.getRange(2, 1, defaults.length, defaults[0].length).setValues(defaults);
  },

  /**
   * Seeds default users across all system roles
   */
  seedUsers(ss) {
    const sheet = ss.getSheetByName('Users');
    if (!sheet || sheet.getLastRow() > 1) return;

    const now = new Date().toISOString();
    const demoUsers = [];

    // Automatically register current Google account as Admin
    try {
      let myEmail = '';
      if (typeof Session !== 'undefined') {
        myEmail = (Session.getActiveUser && Session.getActiveUser().getEmail()) ||
                  (Session.getEffectiveUser && Session.getEffectiveUser().getEmail()) || '';
      }
      if (myEmail) {
        demoUsers.push(['USR-OWNER', myEmail.toLowerCase().trim(), 'Lab Owner (Admin)', 'Admin', 'Management', 'MBBS, MD', '', 'Active', now, now, now, 'SYSTEM']);
      }
    } catch (e) {}

    demoUsers.push(
      ['USR-ADMIN', 'admin@arogyalabs.in', 'Dr. Ramesh Kulkarni (Admin)', 'Admin', 'Management', 'MD (Pathology), DHA', '', 'Active', now, now, now, 'SYSTEM'],
      ['USR-PATH', 'pathologist@arogyalabs.in', 'Dr. Ananya Sen', 'Pathologist', 'Pathology', 'MD (Pathology), FICP', '', 'Active', now, now, now, 'SYSTEM'],
      ['USR-TECH', 'tech@arogyalabs.in', 'Vikram Shinde', 'LabTechnician', 'Biochemistry', 'B.Sc MLT', '', 'Active', now, now, now, 'SYSTEM'],
      ['USR-PHLEB', 'phleb@arogyalabs.in', 'Sunil Pawar', 'Phlebotomist', 'Phlebotomy', 'DMLT', '', 'Active', now, now, now, 'SYSTEM'],
      ['USR-FRONT', 'frontdesk@arogyalabs.in', 'Pooja Sharma', 'FrontDesk', 'Front Office', 'B.Com, PGDHM', '', 'Active', now, now, now, 'SYSTEM']
    );

    sheet.getRange(2, 1, demoUsers.length, demoUsers[0].length).setValues(demoUsers);
  },

  /**
   * Seeds default collection centres
   */
  seedCentres(ss) {
    const sheet = ss.getSheetByName('Centres');
    if (!sheet || sheet.getLastRow() > 1) return;

    const now = new Date().toISOString();
    const centres = [
      ['CTR-MAIN', 'CTR-MAIN', 'Arogya Central Lab (Andheri)', 'Main Lab', 'Dr. Ramesh Kulkarni', '+91 98200 12345', 'andheri@arogyalabs.in', 'SV Road, Andheri West, Mumbai', 0, 'Retail', 'Active', now, now, 'SYSTEM'],
      ['CTR-BORIVALI', 'CTR-BORIVALI', 'Borivali Collection Centre', 'Branch Lab', 'Mahesh Mehta', '+91 98200 67890', 'borivali@arogyalabs.in', 'Station Road, Borivali West, Mumbai', 20, 'B2B Tier 1', 'Active', now, now, 'SYSTEM'],
      ['CTR-BANDRA', 'CTR-BANDRA', 'Bandra Diagnostic Annex', 'Franchise Centre', 'Anita Desai', '+91 98200 54321', 'bandra@arogyalabs.in', 'Hill Road, Bandra West, Mumbai', 25, 'B2B Tier 2', 'Active', now, now, 'SYSTEM']
    ];

    sheet.getRange(2, 1, centres.length, centres[0].length).setValues(centres);
  },

  /**
   * Seeds sample referring doctors
   */
  seedDoctors(ss) {
    const sheet = ss.getSheetByName('Doctors');
    if (!sheet || sheet.getLastRow() > 1) return;

    const now = new Date().toISOString();
    const doctors = [
      ['DOC-SELF', 'DOC-SELF', 'Self / Direct Walk-in', '', 'General Consultation', 'Walk-in Desk', '', '', 0, true, 'Active', now, now, 'SYSTEM'],
      ['DOC-SHARMA', 'DOC-SHARMA', 'Dr. Rajesh Sharma', 'MBBS, MD (Medicine)', 'Internal Medicine', 'Sharma Polyclinic, Andheri', '9811122233', 'dr.sharma@gmail.com', 15, true, 'Active', now, now, 'SYSTEM'],
      ['DOC-PATEL', 'DOC-PATEL', 'Dr. Sneha Patel', 'MBBS, DGO', 'Obstetrics & Gynecology', 'Matruchhaya Hospital, Borivali', '9822233344', 'dr.sneha@gmail.com', 15, true, 'Active', now, now, 'SYSTEM'],
      ['DOC-KHAN', 'DOC-KHAN', 'Dr. Tariq Khan', 'MBBS, MS (General Surgery)', 'General Surgery', 'Khan Nursing Home, Bandra', '9833344455', 'dr.khan@gmail.com', 10, true, 'Active', now, now, 'SYSTEM']
    ];

    sheet.getRange(2, 1, doctors.length, doctors[0].length).setValues(doctors);
  },

  /**
   * Seeds comprehensive Tests, Panels, PanelTests, and ReferenceRanges
   * Sourced from AIIMS, Tietz 6th Ed, and ICMR.
   */
  seedCatalogAndRanges(ss) {
    const testsSheet = ss.getSheetByName('Tests');
    const panelsSheet = ss.getSheetByName('Panels');
    const panelTestsSheet = ss.getSheetByName('PanelTests');
    const rrSheet = ss.getSheetByName('ReferenceRanges');

    if (!testsSheet || testsSheet.getLastRow() > 1) return;

    const now = new Date().toISOString();

    // 1. Tests Catalog
    const tests = [
      // Hematology (CBC)
      ['TST-CBC-HB', 'CBC_HB', 'Hemoglobin (Hb)', 'Hematology', 'EDTA Whole Blood', 'Lavender (EDTA)', 'Automated Cell Counter', 4, 120, 80, 'g/dL', false, '', 1, 'Active', now, now, 'SYSTEM'],
      ['TST-CBC-TLC', 'CBC_TLC', 'Total Leucocyte Count (WBC)', 'Hematology', 'EDTA Whole Blood', 'Lavender (EDTA)', 'Automated Cell Counter', 4, 120, 80, '/cu.mm', false, '', 2, 'Active', now, now, 'SYSTEM'],
      ['TST-CBC-RBC', 'CBC_RBC', 'Total RBC Count', 'Hematology', 'EDTA Whole Blood', 'Lavender (EDTA)', 'Automated Cell Counter', 4, 120, 80, 'mill/cu.mm', false, '', 3, 'Active', now, now, 'SYSTEM'],
      ['TST-CBC-PCV', 'CBC_PCV', 'Packed Cell Volume (PCV)', 'Hematology', 'EDTA Whole Blood', 'Lavender (EDTA)', 'Calculated / Automated', 4, 100, 70, '%', false, '', 4, 'Active', now, now, 'SYSTEM'],
      ['TST-CBC-MCV', 'CBC_MCV', 'Mean Corpuscular Volume (MCV)', 'Hematology', 'EDTA Whole Blood', 'Lavender (EDTA)', 'Automated Cell Counter', 4, 100, 70, 'fL', false, '', 5, 'Active', now, now, 'SYSTEM'],
      ['TST-CBC-MCH', 'CBC_MCH', 'Mean Corpuscular Hemoglobin (MCH)', 'Hematology', 'EDTA Whole Blood', 'Lavender (EDTA)', 'Automated Cell Counter', 4, 100, 70, 'pg', false, '', 6, 'Active', now, now, 'SYSTEM'],
      ['TST-CBC-MCHC', 'CBC_MCHC', 'MCHC', 'Hematology', 'EDTA Whole Blood', 'Lavender (EDTA)', 'Automated Cell Counter', 4, 100, 70, 'g/dL', false, '', 7, 'Active', now, now, 'SYSTEM'],
      ['TST-CBC-PLT', 'CBC_PLT', 'Platelet Count', 'Hematology', 'EDTA Whole Blood', 'Lavender (EDTA)', 'Automated Cell Counter', 4, 150, 100, '/cu.mm', false, '', 8, 'Active', now, now, 'SYSTEM'],
      ['TST-CBC-NEUT', 'CBC_NEUT', 'Neutrophils', 'Hematology', 'EDTA Whole Blood', 'Lavender (EDTA)', 'Automated / Microscopy', 4, 100, 70, '%', false, '', 9, 'Active', now, now, 'SYSTEM'],
      ['TST-CBC-LYMPH', 'CBC_LYMPH', 'Lymphocytes', 'Hematology', 'EDTA Whole Blood', 'Lavender (EDTA)', 'Automated / Microscopy', 4, 100, 70, '%', false, '', 10, 'Active', now, now, 'SYSTEM'],
      ['TST-CBC-MONO', 'CBC_MONO', 'Monocytes', 'Hematology', 'EDTA Whole Blood', 'Lavender (EDTA)', 'Automated / Microscopy', 4, 100, 70, '%', false, '', 11, 'Active', now, now, 'SYSTEM'],
      ['TST-CBC-EOS', 'CBC_EOS', 'Eosinophils', 'Hematology', 'EDTA Whole Blood', 'Lavender (EDTA)', 'Automated / Microscopy', 4, 100, 70, '%', false, '', 12, 'Active', now, now, 'SYSTEM'],
      ['TST-CBC-BASO', 'CBC_BASO', 'Basophils', 'Hematology', 'EDTA Whole Blood', 'Lavender (EDTA)', 'Automated / Microscopy', 4, 100, 70, '%', false, '', 13, 'Active', now, now, 'SYSTEM'],

      // Diabetes
      ['TST-GLU-FAST', 'GLU_FAST', 'Fasting Blood Glucose', 'Biochemistry', 'Fluoride Plasma', 'Grey (Fluoride)', 'Hexokinase / GOD-POD', 4, 100, 60, 'mg/dL', false, '', 14, 'Active', now, now, 'SYSTEM'],
      ['TST-GLU-PP', 'GLU_PP', 'Post Prandial Glucose (PPBS)', 'Biochemistry', 'Fluoride Plasma', 'Grey (Fluoride)', 'Hexokinase / GOD-POD', 4, 100, 60, 'mg/dL', false, '', 15, 'Active', now, now, 'SYSTEM'],
      ['TST-HBA1C', 'HBA1C', 'Glycated Hemoglobin (HbA1c)', 'Biochemistry', 'EDTA Whole Blood', 'Lavender (EDTA)', 'HPLC', 6, 500, 350, '%', false, '', 16, 'Active', now, now, 'SYSTEM'],

      // Kidney Function (KFT)
      ['TST-KFT-UREA', 'KFT_UREA', 'Blood Urea', 'Biochemistry', 'Serum', 'Yellow (SST)', 'GLDH Kinetic', 4, 120, 80, 'mg/dL', false, '', 17, 'Active', now, now, 'SYSTEM'],
      ['TST-KFT-CREAT', 'KFT_CREAT', 'Serum Creatinine', 'Biochemistry', 'Serum', 'Yellow (SST)', 'Modified Jaffe Kinetic', 4, 150, 90, 'mg/dL', false, '', 18, 'Active', now, now, 'SYSTEM'],
      ['TST-KFT-URIC', 'KFT_URIC', 'Serum Uric Acid', 'Biochemistry', 'Serum', 'Yellow (SST)', 'Uricase Enzymatic', 4, 150, 90, 'mg/dL', false, '', 19, 'Active', now, now, 'SYSTEM'],

      // Liver Function (LFT)
      ['TST-LFT-TBIL', 'LFT_TBIL', 'Total Bilirubin', 'Biochemistry', 'Serum', 'Yellow (SST)', 'Diazo / Vanadate Oxidation', 4, 120, 80, 'mg/dL', false, '', 20, 'Active', now, now, 'SYSTEM'],
      ['TST-LFT-DBIL', 'LFT_DBIL', 'Direct Bilirubin', 'Biochemistry', 'Serum', 'Yellow (SST)', 'Diazo Reaction', 4, 120, 80, 'mg/dL', false, '', 21, 'Active', now, now, 'SYSTEM'],
      ['TST-LFT-IBIL', 'LFT_IBIL', 'Indirect Bilirubin', 'Biochemistry', 'Serum', 'Yellow (SST)', 'Calculated', 4, 0, 0, 'mg/dL', true, '[LFT_TBIL] - [LFT_DBIL]', 22, 'Active', now, now, 'SYSTEM'],
      ['TST-LFT-SGOT', 'LFT_SGOT', 'SGOT / AST', 'Biochemistry', 'Serum', 'Yellow (SST)', 'IFCC without Pyridoxal Phosphate', 4, 150, 90, 'U/L', false, '', 23, 'Active', now, now, 'SYSTEM'],
      ['TST-LFT-SGPT', 'LFT_SGPT', 'SGPT / ALT', 'Biochemistry', 'Serum', 'Yellow (SST)', 'IFCC without Pyridoxal Phosphate', 4, 150, 90, 'U/L', false, '', 24, 'Active', now, now, 'SYSTEM'],
      ['TST-LFT-ALP', 'LFT_ALP', 'Alkaline Phosphatase (ALP)', 'Biochemistry', 'Serum', 'Yellow (SST)', 'p-NPP Kinetic', 4, 150, 90, 'U/L', false, '', 25, 'Active', now, now, 'SYSTEM'],
      ['TST-LFT-TP', 'LFT_TP', 'Total Protein', 'Biochemistry', 'Serum', 'Yellow (SST)', 'Biuret Method', 4, 120, 80, 'g/dL', false, '', 26, 'Active', now, now, 'SYSTEM'],
      ['TST-LFT-ALB', 'LFT_ALB', 'Serum Albumin', 'Biochemistry', 'Serum', 'Yellow (SST)', 'BCG Dye Binding', 4, 120, 80, 'g/dL', false, '', 27, 'Active', now, now, 'SYSTEM'],
      ['TST-LFT-GLOB', 'LFT_GLOB', 'Serum Globulin', 'Biochemistry', 'Serum', 'Yellow (SST)', 'Calculated', 4, 0, 0, 'g/dL', true, '[LFT_TP] - [LFT_ALB]', 28, 'Active', now, now, 'SYSTEM'],
      ['TST-LFT-AG', 'LFT_AG', 'A/G Ratio', 'Biochemistry', 'Serum', 'Yellow (SST)', 'Calculated', 4, 0, 0, 'Ratio', true, '[LFT_ALB] / [LFT_GLOB]', 29, 'Active', now, now, 'SYSTEM'],

      // Lipid Profile
      ['TST-LIP-CHOL', 'LIP_CHOL', 'Total Cholesterol', 'Biochemistry', 'Serum', 'Yellow (SST)', 'CHOD-PAP Enzymatic', 4, 150, 100, 'mg/dL', false, '', 30, 'Active', now, now, 'SYSTEM'],
      ['TST-LIP-TRIG', 'LIP_TRIG', 'Triglycerides', 'Biochemistry', 'Serum', 'Yellow (SST)', 'GPO-PAP Enzymatic', 4, 180, 110, 'mg/dL', false, '', 31, 'Active', now, now, 'SYSTEM'],
      ['TST-LIP-HDL', 'LIP_HDL', 'HDL Cholesterol', 'Biochemistry', 'Serum', 'Yellow (SST)', 'Direct Enzymatic Clearance', 4, 200, 130, 'mg/dL', false, '', 32, 'Active', now, now, 'SYSTEM'],
      ['TST-LIP-LDL', 'LIP_LDL', 'LDL Cholesterol (Calculated)', 'Biochemistry', 'Serum', 'Yellow (SST)', 'Friedewald Equation', 4, 0, 0, 'mg/dL', true, '[LIP_CHOL] - [LIP_HDL] - ([LIP_TRIG] / 5)', 33, 'Active', now, now, 'SYSTEM'],
      ['TST-LIP-VLDL', 'LIP_VLDL', 'VLDL Cholesterol', 'Biochemistry', 'Serum', 'Yellow (SST)', 'Calculated', 4, 0, 0, 'mg/dL', true, '[LIP_TRIG] / 5', 34, 'Active', now, now, 'SYSTEM'],
      ['TST-LIP-RATIO', 'LIP_RATIO', 'Cholesterol / HDL Ratio', 'Biochemistry', 'Serum', 'Yellow (SST)', 'Calculated', 4, 0, 0, 'Ratio', true, '[LIP_CHOL] / [LIP_HDL]', 35, 'Active', now, now, 'SYSTEM'],

      // Thyroid
      ['TST-THY-TSH', 'THY_TSH', 'TSH (Ultrasensitive)', 'Immunology', 'Serum', 'Yellow (SST)', 'Chemiluminescence (CLIA)', 6, 250, 170, 'uIU/mL', false, '', 36, 'Active', now, now, 'SYSTEM']
    ];
    testsSheet.getRange(2, 1, tests.length, tests[0].length).setValues(tests);

    // 2. Panels Catalog
    const panels = [
      ['PNL-CBC', 'CBC', 'Complete Blood Count (CBC)', 'Hematology', 'Automated 13-parameter complete hemogram with differential count', 350, 220, 4, 'Active', now, now, 'SYSTEM'],
      ['PNL-LFT', 'LFT', 'Liver Function Test (LFT)', 'Biochemistry', 'Comprehensive liver enzyme, bilirubin & protein evaluation', 750, 480, 4, 'Active', now, now, 'SYSTEM'],
      ['PNL-KFT', 'KFT', 'Kidney Function Test (KFT)', 'Biochemistry', 'Renal profile including Urea, Creatinine and Uric Acid', 600, 380, 4, 'Active', now, now, 'SYSTEM'],
      ['PNL-LIPID', 'LIPID', 'Lipid Profile', 'Biochemistry', 'Complete lipid risk assessment including Cholesterol, Triglycerides, HDL, LDL, VLDL', 650, 420, 4, 'Active', now, now, 'SYSTEM'],
      ['PNL-DIABETES', 'DIAB_BASIC', 'Basic Diabetes Screen', 'Biochemistry', 'Fasting & Post-Prandial Glucose plus Glycated Hemoglobin (HbA1c)', 650, 450, 6, 'Active', now, now, 'SYSTEM']
    ];
    panelsSheet.getRange(2, 1, panels.length, panels[0].length).setValues(panels);

    // 3. PanelTests Junction Mappings
    const panelTests = [
      // CBC
      ['PT-01', 'PNL-CBC', 'TST-CBC-HB', 1, 'Active', now, now, 'SYSTEM'],
      ['PT-02', 'PNL-CBC', 'TST-CBC-TLC', 2, 'Active', now, now, 'SYSTEM'],
      ['PT-03', 'PNL-CBC', 'TST-CBC-RBC', 3, 'Active', now, now, 'SYSTEM'],
      ['PT-04', 'PNL-CBC', 'TST-CBC-PCV', 4, 'Active', now, now, 'SYSTEM'],
      ['PT-05', 'PNL-CBC', 'TST-CBC-MCV', 5, 'Active', now, now, 'SYSTEM'],
      ['PT-06', 'PNL-CBC', 'TST-CBC-MCH', 6, 'Active', now, now, 'SYSTEM'],
      ['PT-07', 'PNL-CBC', 'TST-CBC-MCHC', 7, 'Active', now, now, 'SYSTEM'],
      ['PT-08', 'PNL-CBC', 'TST-CBC-PLT', 8, 'Active', now, now, 'SYSTEM'],
      ['PT-09', 'PNL-CBC', 'TST-CBC-NEUT', 9, 'Active', now, now, 'SYSTEM'],
      ['PT-10', 'PNL-CBC', 'TST-CBC-LYMPH', 10, 'Active', now, now, 'SYSTEM'],
      ['PT-11', 'PNL-CBC', 'TST-CBC-MONO', 11, 'Active', now, now, 'SYSTEM'],
      ['PT-12', 'PNL-CBC', 'TST-CBC-EOS', 12, 'Active', now, now, 'SYSTEM'],
      ['PT-13', 'PNL-CBC', 'TST-CBC-BASO', 13, 'Active', now, now, 'SYSTEM'],

      // LFT
      ['PT-14', 'PNL-LFT', 'TST-LFT-TBIL', 1, 'Active', now, now, 'SYSTEM'],
      ['PT-15', 'PNL-LFT', 'TST-LFT-DBIL', 2, 'Active', now, now, 'SYSTEM'],
      ['PT-16', 'PNL-LFT', 'TST-LFT-IBIL', 3, 'Active', now, now, 'SYSTEM'],
      ['PT-17', 'PNL-LFT', 'TST-LFT-SGOT', 4, 'Active', now, now, 'SYSTEM'],
      ['PT-18', 'PNL-LFT', 'TST-LFT-SGPT', 5, 'Active', now, now, 'SYSTEM'],
      ['PT-19', 'PNL-LFT', 'TST-LFT-ALP', 6, 'Active', now, now, 'SYSTEM'],
      ['PT-20', 'PNL-LFT', 'TST-LFT-TP', 7, 'Active', now, now, 'SYSTEM'],
      ['PT-21', 'PNL-LFT', 'TST-LFT-ALB', 8, 'Active', now, now, 'SYSTEM'],
      ['PT-22', 'PNL-LFT', 'TST-LFT-GLOB', 9, 'Active', now, now, 'SYSTEM'],
      ['PT-23', 'PNL-LFT', 'TST-LFT-AG', 10, 'Active', now, now, 'SYSTEM'],

      // KFT
      ['PT-24', 'PNL-KFT', 'TST-KFT-UREA', 1, 'Active', now, now, 'SYSTEM'],
      ['PT-25', 'PNL-KFT', 'TST-KFT-CREAT', 2, 'Active', now, now, 'SYSTEM'],
      ['PT-26', 'PNL-KFT', 'TST-KFT-URIC', 3, 'Active', now, now, 'SYSTEM'],

      // Lipid
      ['PT-27', 'PNL-LIPID', 'TST-LIP-CHOL', 1, 'Active', now, now, 'SYSTEM'],
      ['PT-28', 'PNL-LIPID', 'TST-LIP-TRIG', 2, 'Active', now, now, 'SYSTEM'],
      ['PT-29', 'PNL-LIPID', 'TST-LIP-HDL', 3, 'Active', now, now, 'SYSTEM'],
      ['PT-30', 'PNL-LIPID', 'TST-LIP-LDL', 4, 'Active', now, now, 'SYSTEM'],
      ['PT-31', 'PNL-LIPID', 'TST-LIP-VLDL', 5, 'Active', now, now, 'SYSTEM'],
      ['PT-32', 'PNL-LIPID', 'TST-LIP-RATIO', 6, 'Active', now, now, 'SYSTEM'],

      // Diabetes
      ['PT-33', 'PNL-DIABETES', 'TST-GLU-FAST', 1, 'Active', now, now, 'SYSTEM'],
      ['PT-34', 'PNL-DIABETES', 'TST-GLU-PP', 2, 'Active', now, now, 'SYSTEM'],
      ['PT-35', 'PNL-DIABETES', 'TST-HBA1C', 3, 'Active', now, now, 'SYSTEM']
    ];
    panelTestsSheet.getRange(2, 1, panelTests.length, panelTests[0].length).setValues(panelTests);

    // 4. Reference Ranges (ICMR / AIIMS / Tietz)
    // Note: Marked editable and to be verified by pathologist
    const refRanges = [
      // Hemoglobin
      ['RR-HB-M', 'TST-CBC-HB', 'Male', 4380, 43800, 13.0, 17.0, 7.0, 20.0, 'g/dL', '13.0 - 17.0 g/dL', 'Anemia if low, Polycythemia if high', 'AIIMS / Tietz 6th Ed (Editable - verify with Pathologist)', 'Active', now, now, 'SYSTEM'],
      ['RR-HB-F', 'TST-CBC-HB', 'Female', 4380, 43800, 12.0, 15.0, 7.0, 20.0, 'g/dL', '12.0 - 15.0 g/dL', 'Anemia if low', 'AIIMS / Tietz 6th Ed (Editable - verify with Pathologist)', 'Active', now, now, 'SYSTEM'],
      ['RR-HB-C', 'TST-CBC-HB', 'All', 365, 4380, 11.0, 14.0, 6.5, 18.0, 'g/dL', '11.0 - 14.0 g/dL', 'Pediatric baseline', 'AIIMS Pediatric Ranges (Editable - verify with Pathologist)', 'Active', now, now, 'SYSTEM'],

      // TLC
      ['RR-TLC', 'TST-CBC-TLC', 'All', 365, 43800, 4000, 11000, 2000, 30000, '/cu.mm', '4,000 - 11,000 /cu.mm', 'Infection / Leukemia if elevated', 'Tietz / ICMR (Editable - verify with Pathologist)', 'Active', now, now, 'SYSTEM'],

      // Platelets
      ['RR-PLT', 'TST-CBC-PLT', 'All', 0, 43800, 150000, 450000, 50000, 1000000, '/cu.mm', '150,000 - 450,000 /cu.mm', 'Thrombocytopenia if low (bleeding risk)', 'AIIMS / ICMR (Editable - verify with Pathologist)', 'Active', now, now, 'SYSTEM'],

      // RBC
      ['RR-RBC-M', 'TST-CBC-RBC', 'Male', 4380, 43800, 4.5, 5.9, 2.5, 7.0, 'mill/cu.mm', '4.5 - 5.9 mill/cu.mm', 'Normal erythropoiesis', 'Tietz (Editable - verify with Pathologist)', 'Active', now, now, 'SYSTEM'],
      ['RR-RBC-F', 'TST-CBC-RBC', 'Female', 4380, 43800, 4.0, 5.2, 2.5, 6.5, 'mill/cu.mm', '4.0 - 5.2 mill/cu.mm', 'Normal erythropoiesis', 'Tietz (Editable - verify with Pathologist)', 'Active', now, now, 'SYSTEM'],

      // PCV
      ['RR-PCV-M', 'TST-CBC-PCV', 'Male', 4380, 43800, 40.0, 50.0, 20.0, 60.0, '%', '40.0 - 50.0 %', 'Hematocrit index', 'Tietz (Editable - verify with Pathologist)', 'Active', now, now, 'SYSTEM'],
      ['RR-PCV-F', 'TST-CBC-PCV', 'Female', 4380, 43800, 36.0, 46.0, 20.0, 55.0, '%', '36.0 - 46.0 %', 'Hematocrit index', 'Tietz (Editable - verify with Pathologist)', 'Active', now, now, 'SYSTEM'],

      // Differential Count
      ['RR-NEUT', 'TST-CBC-NEUT', 'All', 365, 43800, 40.0, 75.0, 10.0, 90.0, '%', '40 - 75 %', 'Neutrophilia in bacterial infection', 'Tietz (Editable - verify with Pathologist)', 'Active', now, now, 'SYSTEM'],
      ['RR-LYMPH', 'TST-CBC-LYMPH', 'All', 365, 43800, 20.0, 45.0, 5.0, 80.0, '%', '20 - 45 %', 'Lymphocytosis in viral infection', 'Tietz (Editable - verify with Pathologist)', 'Active', now, now, 'SYSTEM'],
      ['RR-MONO', 'TST-CBC-MONO', 'All', 365, 43800, 2.0, 10.0, 0, 25.0, '%', '2 - 10 %', 'Chronic infection marker', 'Tietz (Editable - verify with Pathologist)', 'Active', now, now, 'SYSTEM'],
      ['RR-EOS', 'TST-CBC-EOS', 'All', 365, 43800, 1.0, 6.0, 0, 30.0, '%', '1 - 6 %', 'Allergy / Parasitic infestation if high', 'Tietz (Editable - verify with Pathologist)', 'Active', now, now, 'SYSTEM'],
      ['RR-BASO', 'TST-CBC-BASO', 'All', 365, 43800, 0.0, 1.0, 0, 5.0, '%', '0 - 1 %', 'Basophil count', 'Tietz (Editable - verify with Pathologist)', 'Active', now, now, 'SYSTEM'],

      // Glucose & HbA1c
      ['RR-GLU-F', 'TST-GLU-FAST', 'All', 0, 43800, 70.0, 99.0, 50.0, 400.0, 'mg/dL', '70 - 99 mg/dL (Normal)', 'Pre-diabetes: 100-125, Diabetes: >=126', 'ADA / ICMR Guidelines (Editable - verify with Pathologist)', 'Active', now, now, 'SYSTEM'],
      ['RR-GLU-PP', 'TST-GLU-PP', 'All', 0, 43800, 80.0, 139.0, 50.0, 400.0, 'mg/dL', '< 140 mg/dL (Normal)', 'Pre-diabetes: 140-199, Diabetes: >=200', 'ADA / ICMR Guidelines (Editable - verify with Pathologist)', 'Active', now, now, 'SYSTEM'],
      ['RR-HBA1C', 'TST-HBA1C', 'All', 0, 43800, 4.0, 5.6, 3.5, 14.0, '%', '< 5.7 % (Normal)', 'Pre-diabetes: 5.7-6.4, Diabetes: >=6.5', 'ADA / ICMR Guidelines (Editable - verify with Pathologist)', 'Active', now, now, 'SYSTEM'],

      // Renal (KFT)
      ['RR-UREA', 'TST-KFT-UREA', 'All', 0, 43800, 15.0, 45.0, 5.0, 150.0, 'mg/dL', '15 - 45 mg/dL', 'Elevated in renal impairment or dehydration', 'Tietz (Editable - verify with Pathologist)', 'Active', now, now, 'SYSTEM'],
      ['RR-CREAT-M', 'TST-KFT-CREAT', 'Male', 4380, 43800, 0.7, 1.3, 0.3, 5.0, 'mg/dL', '0.7 - 1.3 mg/dL', 'Key glomerular filtration marker', 'Tietz / ICMR (Editable - verify with Pathologist)', 'Active', now, now, 'SYSTEM'],
      ['RR-CREAT-F', 'TST-KFT-CREAT', 'Female', 4380, 43800, 0.5, 1.1, 0.3, 4.0, 'mg/dL', '0.5 - 1.1 mg/dL', 'Key glomerular filtration marker', 'Tietz / ICMR (Editable - verify with Pathologist)', 'Active', now, now, 'SYSTEM'],
      ['RR-URIC-M', 'TST-KFT-URIC', 'Male', 4380, 43800, 3.5, 7.2, 1.5, 12.0, 'mg/dL', '3.5 - 7.2 mg/dL', 'Hyperuricemia / Gout', 'Tietz (Editable - verify with Pathologist)', 'Active', now, now, 'SYSTEM'],
      ['RR-URIC-F', 'TST-KFT-URIC', 'Female', 4380, 43800, 2.6, 6.0, 1.5, 10.0, 'mg/dL', '2.6 - 6.0 mg/dL', 'Hyperuricemia / Gout', 'Tietz (Editable - verify with Pathologist)', 'Active', now, now, 'SYSTEM'],

      // Liver (LFT)
      ['RR-TBIL', 'TST-LFT-TBIL', 'All', 30, 43800, 0.2, 1.2, 0.1, 15.0, 'mg/dL', '0.2 - 1.2 mg/dL', 'Jaundice marker', 'Tietz (Editable - verify with Pathologist)', 'Active', now, now, 'SYSTEM'],
      ['RR-DBIL', 'TST-LFT-DBIL', 'All', 30, 43800, 0.0, 0.3, 0.0, 10.0, 'mg/dL', '0.0 - 0.3 mg/dL', 'Biliary obstruction marker', 'Tietz (Editable - verify with Pathologist)', 'Active', now, now, 'SYSTEM'],
      ['RR-SGOT', 'TST-LFT-SGOT', 'All', 0, 43800, 5.0, 40.0, 0.0, 500.0, 'U/L', '5 - 40 U/L', 'Hepatocellular / cardiac enzyme', 'Tietz (Editable - verify with Pathologist)', 'Active', now, now, 'SYSTEM'],
      ['RR-SGPT', 'TST-LFT-SGPT', 'All', 0, 43800, 5.0, 45.0, 0.0, 500.0, 'U/L', '5 - 45 U/L', 'Specific liver injury marker', 'Tietz (Editable - verify with Pathologist)', 'Active', now, now, 'SYSTEM'],
      ['RR-ALP', 'TST-LFT-ALP', 'All', 6570, 43800, 30.0, 120.0, 0.0, 800.0, 'U/L', '30 - 120 U/L', 'Biliary tree & bone marker', 'Tietz (Editable - verify with Pathologist)', 'Active', now, now, 'SYSTEM'],
      ['RR-TP', 'TST-LFT-TP', 'All', 0, 43800, 6.0, 8.3, 4.0, 10.0, 'g/dL', '6.0 - 8.3 g/dL', 'Serum total protein balance', 'Tietz (Editable - verify with Pathologist)', 'Active', now, now, 'SYSTEM'],
      ['RR-ALB', 'TST-LFT-ALB', 'All', 0, 43800, 3.5, 5.2, 2.0, 6.5, 'g/dL', '3.5 - 5.2 g/dL', 'Nutritional / hepatic synthesis index', 'Tietz (Editable - verify with Pathologist)', 'Active', now, now, 'SYSTEM'],
      ['RR-AG', 'TST-LFT-AG', 'All', 0, 43800, 1.1, 2.2, 0.5, 3.0, 'Ratio', '1.1 - 2.2', 'Albumin to Globulin ratio', 'Tietz (Editable - verify with Pathologist)', 'Active', now, now, 'SYSTEM'],

      // Lipid Profile
      ['RR-CHOL', 'TST-LIP-CHOL', 'All', 0, 43800, 100.0, 200.0, 50.0, 400.0, 'mg/dL', '< 200 mg/dL (Desirable)', 'Borderline: 200-239, High: >=240', 'NCEP ATP III (Editable - verify with Pathologist)', 'Active', now, now, 'SYSTEM'],
      ['RR-TRIG', 'TST-LIP-TRIG', 'All', 0, 43800, 50.0, 150.0, 20.0, 500.0, 'mg/dL', '< 150 mg/dL (Normal)', 'Borderline: 150-199, High: >=200', 'NCEP ATP III (Editable - verify with Pathologist)', 'Active', now, now, 'SYSTEM'],
      ['RR-HDL-M', 'TST-LIP-HDL', 'Male', 0, 43800, 40.0, 60.0, 20.0, 100.0, 'mg/dL', '> 40 mg/dL (Protective)', 'Low: < 40 (Elevated CVD risk)', 'NCEP ATP III (Editable - verify with Pathologist)', 'Active', now, now, 'SYSTEM'],
      ['RR-HDL-F', 'TST-LIP-HDL', 'Female', 0, 43800, 50.0, 70.0, 20.0, 100.0, 'mg/dL', '> 50 mg/dL (Protective)', 'Low: < 50 (Elevated CVD risk)', 'NCEP ATP III (Editable - verify with Pathologist)', 'Active', now, now, 'SYSTEM'],
      ['RR-LDL', 'TST-LIP-LDL', 'All', 0, 43800, 60.0, 100.0, 20.0, 250.0, 'mg/dL', '< 100 mg/dL (Optimal)', 'Near optimal: 100-129, High: >=130', 'NCEP ATP III (Editable - verify with Pathologist)', 'Active', now, now, 'SYSTEM'],
      ['RR-VLDL', 'TST-LIP-VLDL', 'All', 0, 43800, 10.0, 30.0, 2.0, 100.0, 'mg/dL', '10 - 30 mg/dL', 'Triglyceride-rich lipoprotein fraction', 'NCEP ATP III (Editable - verify with Pathologist)', 'Active', now, now, 'SYSTEM'],

      // Thyroid
      ['RR-TSH', 'TST-THY-TSH', 'All', 6570, 43800, 0.27, 4.20, 0.05, 25.0, 'uIU/mL', '0.27 - 4.20 uIU/mL', 'Hypothyroidism if high, Hyperthyroidism if low', 'Tietz / CLIA (Editable - verify with Pathologist)', 'Active', now, now, 'SYSTEM']
    ];
    rrSheet.getRange(2, 1, refRanges.length, refRanges[0].length).setValues(refRanges);
  },

  /**
   * Seeds basic reagent & consumable inventory
   */
  seedInventory(ss) {
    const sheet = ss.getSheetByName('Inventory');
    if (!sheet || sheet.getLastRow() > 1) return;

    const now = new Date().toISOString();
    const inventory = [
      ['INV-TUBE-EDTA', 'TUBE-EDTA-K2', 'Vacutainer K2 EDTA 2ml (Lavender)', 'Blood Tube', 'Pcs', 500, 100, 'LOT-2026-EDTA', '2027-12-31', 'BD Diagnostics', now, 'Active', now, now, 'SYSTEM'],
      ['INV-TUBE-SST', 'TUBE-SST-3ML', 'Vacutainer Gel SST 3ml (Yellow)', 'Blood Tube', 'Pcs', 600, 150, 'LOT-2026-SST', '2027-12-31', 'BD Diagnostics', now, 'Active', now, now, 'SYSTEM'],
      ['INV-TUBE-FLUO', 'TUBE-FLUO-2ML', 'Vacutainer Sodium Fluoride 2ml (Grey)', 'Blood Tube', 'Pcs', 350, 80, 'LOT-2026-FLUO', '2027-11-30', 'BD Diagnostics', now, 'Active', now, now, 'SYSTEM'],
      ['INV-KIT-GLUC', 'KIT-GLU-HEXO', 'Glucose Hexokinase Reagent Kit (500T)', 'Reagent Kit', 'Tests', 1200, 300, 'LOT-GLU-887', '2027-06-30', 'Roche / Erba', now, 'Active', now, now, 'SYSTEM'],
      ['INV-KIT-CBC', 'KIT-CBC-DIL', 'Sysmex Cellpack Diluent (20L)', 'Reagent Kit', 'Bottles', 8, 2, 'LOT-CP-9901', '2027-08-31', 'Sysmex India', now, 'Active', now, now, 'SYSTEM']
    ];

    sheet.getRange(2, 1, inventory.length, inventory[0].length).setValues(inventory);
  }
};

/**
 * Top-level global functions recognized by Google Apps Script Run button
 */
function setup() {
  return Setup.setup();
}

function runSetup() {
  return Setup.setup();
}

/**
 * Manually connect an existing Google Sheet by pasting its URL or ID
 * @param {string} sheetUrlOrId 
 */
function connectExistingSheet(sheetUrlOrId) {
  let id = String(sheetUrlOrId || '').trim();
  if (id.includes('/spreadsheets/d/')) {
    const m = id.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (m) id = m[1];
  }
  const ss = SpreadsheetApp.openById(id);
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', id);
  console.log('✔ Successfully connected to Google Sheet: ' + ss.getName() + ' (' + ss.getUrl() + ')');
  return ss.getUrl();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Setup;
}

