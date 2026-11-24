/**
 * Laboratory Information System (LIS) - Test Catalog Service
 * Manages Diagnostic Tests, Panels (Packages), Reference Ranges, and Bulk CSV Import
 */

// Node.js environment imports
if (typeof require !== 'undefined') {
  var Repository = require('./Repository.js');
  var Utils = require('./Utils.js');
  var { PERMISSIONS, SessionContext } = require('./Auth.js');
}

const CatalogService = {
  /**
   * Fetches full diagnostic catalog: Tests and Panels with Reference Ranges
   * Cached via CacheService for instant retrieval at front desk
   * @return {Object}
   */
  getFullCatalog() {
    SessionContext.requirePermission(PERMISSIONS.CATALOG_VIEW, 'View Catalog');

    const tests = Repository.getTable('Tests', true).filter(t => t.status === 'Active');
    const panels = Repository.getTable('Panels', true).filter(p => p.status === 'Active');
    const panelTests = Repository.getTable('PanelTests', true).filter(pt => pt.status === 'Active');
    const refRanges = Repository.getTable('ReferenceRanges', true).filter(rr => rr.status === 'Active');

    // Map reference ranges by test_id
    const rangesByTest = {};
    for (const rr of refRanges) {
      if (!rangesByTest[rr.test_id]) rangesByTest[rr.test_id] = [];
      rangesByTest[rr.test_id].push(rr);
    }

    // Attach reference ranges to tests
    const enrichedTests = tests.map(t => ({
      ...t,
      referenceRanges: rangesByTest[t.id] || []
    }));

    // Map panel tests
    const panelItemsMap = {};
    for (const pt of panelTests) {
      if (!panelItemsMap[pt.panel_id]) panelItemsMap[pt.panel_id] = [];
      const testObj = tests.find(t => t.id === pt.test_id);
      if (testObj) {
        panelItemsMap[pt.panel_id].push({
          ...testObj,
          displayOrder: pt.display_order
        });
      }
    }

    // Sort panel items
    for (const pid in panelItemsMap) {
      panelItemsMap[pid].sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
    }

    const enrichedPanels = panels.map(p => ({
      ...p,
      tests: panelItemsMap[p.id] || [],
      testCount: (panelItemsMap[p.id] || []).length
    }));

    // Group tests by department
    const departments = {};
    for (const t of enrichedTests) {
      const dept = t.department || 'General';
      if (!departments[dept]) departments[dept] = [];
      departments[dept].push(t);
    }

    return {
      tests: enrichedTests,
      panels: enrichedPanels,
      departments: departments,
      totalTests: enrichedTests.length,
      totalPanels: enrichedPanels.length
    };
  },

  /**
   * Fast auto-complete search across both Tests and Panels
   * @param {string} query 
   * @return {Array<Object>}
   */
  searchCatalog(query) {
    if (!query || String(query).trim().length < 1) return [];
    const clean = String(query).trim().toLowerCase();

    const catalog = this.getFullCatalog();
    const results = [];

    // Search Panels first (higher priority for billing packages)
    for (const p of catalog.panels) {
      if (p.code.toLowerCase().includes(clean) || p.name.toLowerCase().includes(clean)) {
        results.push({
          type: 'Panel',
          id: p.id,
          code: p.code,
          name: p.name,
          department: p.department,
          price: p.price,
          b2bPrice: p.b2b_price,
          tatHours: p.tat_hours,
          testCount: p.testCount,
          tests: p.tests.map(t => t.name)
        });
      }
    }

    // Search Individual Tests
    for (const t of catalog.tests) {
      if (t.code.toLowerCase().includes(clean) || t.name.toLowerCase().includes(clean)) {
        results.push({
          type: 'Test',
          id: t.id,
          code: t.code,
          name: t.name,
          department: t.department,
          sampleType: t.sample_type,
          containerType: t.container_type,
          price: t.price,
          b2bPrice: t.b2b_price,
          tatHours: t.tat_hours,
          units: t.units,
          isCalculated: t.is_calculated
        });
      }
    }

    return results;
  },

  /**
   * Evaluates the appropriate clinical reference range for a specific patient
   * @param {string} testId 
   * @param {string} gender - 'Male', 'Female', 'Other'
   * @param {number} ageInDays 
   * @return {Object|null}
   */
  getApplicableReferenceRange(testId, gender, ageInDays = 9125) { // default 25y
    const ranges = Repository.findByField('ReferenceRanges', 'test_id', testId, true)
      .filter(r => r.status === 'Active');

    if (ranges.length === 0) return null;

    // Filter by Gender ('All' or matching biological sex)
    const genderMatches = ranges.filter(r => r.gender === 'All' || r.gender === gender);
    const pool = genderMatches.length > 0 ? genderMatches : ranges;

    // Filter by Age range in days
    for (const r of pool) {
      const minDays = parseInt(r.age_min_days, 10) || 0;
      const maxDays = parseInt(r.age_max_days, 10) || 43800;
      if (ageInDays >= minDays && ageInDays <= maxDays) {
        return r;
      }
    }

    // Fallback to first available range rule
    return pool[0] || null;
  },

  /**
   * Bulk CSV Paste-Import for Tests & Reference Ranges
   * Expected CSV format:
   * code,name,department,sample_type,container_type,methodology,tat_hours,price,b2b_price,units,gender,normal_low,normal_high,critical_low,critical_high,ref_range_text
   * 
   * @param {string} csvContent 
   * @return {Object}
   */
  bulkImportCsv(csvContent) {
    SessionContext.requirePermission(PERMISSIONS.CATALOG_EDIT, 'Bulk Import Test Catalog');

    if (!csvContent || String(csvContent).trim().length === 0) {
      throw new Error('CSV content cannot be empty.');
    }

    const lines = csvContent.trim().split(/\r?\n/);
    if (lines.length <= 1) {
      throw new Error('CSV must contain a header row and at least one data row.');
    }

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const requiredCols = ['code', 'name', 'department', 'sample_type', 'price'];
    for (const col of requiredCols) {
      if (!headers.includes(col)) {
        throw new Error(`CSV Missing mandatory column: ${col}`);
      }
    }

    const now = Utils.getTimestamp();
    const userEmail = SessionContext.getCurrentEmail();

    const newTests = [];
    const newRanges = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Handle simple CSV splitting
      const parts = line.split(',').map(p => p.trim());
      const row = {};
      for (let j = 0; j < headers.length; j++) {
        row[headers[j]] = parts[j] || '';
      }

      const testId = Utils.generateId('TST');
      const testRecord = {
        id: testId,
        code: row.code,
        name: row.name,
        department: row.department,
        sample_type: row.sample_type || 'Serum',
        container_type: row.container_type || 'Yellow (SST)',
        methodology: row.methodology || 'Automated Analysis',
        tat_hours: parseInt(row.tat_hours, 10) || 4,
        price: parseFloat(row.price) || 0,
        b2b_price: parseFloat(row.b2b_price) || Math.round((parseFloat(row.price) || 0) * 0.7),
        units: row.units || '',
        is_calculated: false,
        calculation_formula: '',
        report_order: 99,
        status: 'Active',
        created_at: now,
        updated_at: now,
        updated_by: userEmail
      };
      newTests.push(testRecord);

      // If reference range fields present in CSV
      if (row.normal_low !== undefined || row.normal_high !== undefined || row.ref_range_text) {
        const rangeRecord = {
          id: Utils.generateId('RR'),
          test_id: testId,
          gender: row.gender || 'All',
          age_min_days: 0,
          age_max_days: 43800,
          normal_low: parseFloat(row.normal_low) || 0,
          normal_high: parseFloat(row.normal_high) || 0,
          critical_low: parseFloat(row.critical_low) || 0,
          critical_high: parseFloat(row.critical_high) || 0,
          unit: row.units || '',
          text_range: row.ref_range_text || `${row.normal_low || 0} - ${row.normal_high || 0} ${row.units || ''}`,
          clinical_significance: 'Imported via CSV',
          source_reference: 'Bulk CSV Import (Editable - verify with Pathologist)',
          status: 'Active',
          created_at: now,
          updated_at: now,
          updated_by: userEmail
        };
        newRanges.push(rangeRecord);
      }
    }

    if (newTests.length > 0) {
      Repository.batchInsert('Tests', newTests);
    }
    if (newRanges.length > 0) {
      Repository.batchInsert('ReferenceRanges', newRanges);
    }

    Repository.clearCache('Tests');
    Repository.clearCache('ReferenceRanges');

    Repository.logAudit('CREATE', 'TestCatalog', 'BULK_IMPORT', {
      testsImported: newTests.length,
      rangesImported: newRanges.length
    });

    return {
      status: 'SUCCESS',
      importedTestCount: newTests.length,
      importedRangeCount: newRanges.length,
      message: `Successfully imported ${newTests.length} tests and ${newRanges.length} reference ranges.`
    };
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CatalogService;
}

