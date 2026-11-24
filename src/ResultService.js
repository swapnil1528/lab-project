/**
 * Laboratory Information System (LIS) - Result Entry & Validation Service
 * Implements:
 * - Departmental worklist grids (Biochemistry, Hematology, Microbiology, etc.)
 * - Auto-flagging: Normal, Low, High, Critical Low, Critical High
 * - Delta checks comparing against patient's previous validated visit
 * - Clinical auto-calculation engine (e.g. Indirect Bilirubin, Globulin, A/G Ratio, VLDL, Friedewald LDL)
 * - Two-step approval (Lab Technician enters -> Pathologist validates & signs)
 * - Strict result locking post-validation
 * - Version-controlled amendments (never overwrites historical data)
 * - Histopathology & Cytology narrative templates
 */

// Node.js environment imports
if (typeof require !== 'undefined') {
  var Repository = require('./Repository.js');
  var Utils = require('./Utils.js');
  var { PERMISSIONS, SessionContext } = require('./Auth.js');
  var CatalogService = require('./CatalogService.js');
}

const ResultService = {
  RESULT_STATUS: {
    DRAFT: 'Draft',
    ENTERED: 'Entered',
    VALIDATED: 'Validated',
    AMENDED: 'Amended'
  },

  FLAGS: {
    NORMAL: 'Normal',
    LOW: 'Low',
    HIGH: 'High',
    CRITICAL_LOW: 'Critical Low',
    CRITICAL_HIGH: 'Critical High',
    ABNORMAL: 'Abnormal'
  },

  /**
   * Retrieves department worklist ready for result entry
   * @param {string} department e.g. 'Biochemistry', 'Hematology'
   * @return {Array<Object>}
   */
  getDepartmentWorklist(department) {
    SessionContext.requirePermission(PERMISSIONS.RESULT_ENTER, 'View Department Worklist');

    // Fetch samples received in lab
    const samples = Repository.getTable('Samples', false)
      .filter(s => s.status === 'Active' && (s.collection_status === 'Received' || s.collection_status === 'In Process'));

    const filteredSamples = department ? samples.filter(s => s.department === department) : samples;
    const worklist = [];

    for (const sample of filteredSamples) {
      const order = Repository.findById('Orders', sample.order_id);
      if (!order || order.status === 'Cancelled') continue;

      const patient = Repository.findOneByField('Patients', 'uhid', sample.uhid);
      const items = Repository.findByField('OrderItems', 'sample_id', sample.id)
        .filter(i => i.status === 'Active');

      // Fetch existing results if already entered/drafted
      const existingResults = Repository.findByField('Results', 'sample_id', sample.id)
        .filter(r => r.is_current_version === true || r.is_current_version === 'TRUE');

      const resultMap = {};
      for (const res of existingResults) {
        resultMap[res.test_id] = res;
      }

      worklist.push({
        sampleId: sample.id,
        barcode: sample.barcode,
        orderId: order.id,
        orderNo: order.order_no,
        uhid: sample.uhid,
        patientName: sample.patient_name,
        ageGender: `${patient ? patient.age + (patient.age_unit ? patient.age_unit[0] : 'Y') : ''} / ${patient ? patient.gender : ''}`,
        department: sample.department,
        tube: sample.container_tube,
        status: sample.collection_status,
        items: items.map(itm => ({
          orderItemId: itm.id,
          testId: itm.test_or_panel_id,
          code: itm.item_code,
          name: itm.item_name,
          department: itm.department,
          existingResult: resultMap[itm.test_or_panel_id] || null
        }))
      });
    }

    return worklist;
  },

  /**
   * Retrieves parameter input form for a specific order and sample
   * Pre-loads patient age/gender reference ranges and previous visit results for delta check
   * @param {string} orderId 
   * @param {string} sampleId 
   * @return {Object}
   */
  getOrderResultsForEntry(orderId, sampleId) {
    SessionContext.requirePermission(PERMISSIONS.RESULT_ENTER, 'Enter Test Results');

    const order = Repository.findById('Orders', orderId);
    if (!order) throw new Error('Order not found');
    const patient = Repository.findOneByField('Patients', 'uhid', order.uhid);
    const orderItems = Repository.findByField('OrderItems', 'order_id', orderId)
      .filter(i => (!sampleId || i.sample_id === sampleId) && i.status === 'Active');

    const catalogTests = Repository.getTable('Tests', true);
    const ageDays = patient ? (patient.age ? patient.age * 365 : 9125) : 9125;
    const gender = patient ? patient.gender : 'All';

    // Existing current results
    const existingResults = Repository.findByField('Results', 'order_id', orderId)
      .filter(r => r.is_current_version === true || r.is_current_version === 'TRUE');
    const resMap = {};
    for (const r of existingResults) {
      resMap[r.test_id] = r;
    }

    // Historical validated results for this patient (for Delta Check)
    const allPatientResults = Repository.findByField('Results', 'uhid', order.uhid)
      .filter(r => r.order_id !== orderId && r.result_status === this.RESULT_STATUS.VALIDATED && (r.is_current_version === true || r.is_current_version === 'TRUE'))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const pastValMap = {};
    for (const pr of allPatientResults) {
      if (!pastValMap[pr.test_id]) {
        pastValMap[pr.test_id] = pr.numeric_value;
      }
    }

    const parameters = [];
    for (const itm of orderItems) {
      const test = catalogTests.find(t => t.id === itm.test_or_panel_id || t.code === itm.item_code);
      if (!test) continue;

      const refRange = CatalogService.getApplicableReferenceRange(test.id, gender, ageDays);
      const curr = resMap[test.id];
      const prevVal = pastValMap[test.id] !== undefined ? pastValMap[test.id] : null;

      parameters.push({
        orderItemId: itm.id,
        testId: test.id,
        code: test.code,
        name: test.name,
        department: test.department,
        units: test.units,
        isCalculated: test.is_calculated === true || test.is_calculated === 'TRUE',
        calculationFormula: test.calculation_formula || '',
        referenceRangeText: refRange ? (refRange.text_range || `${refRange.normal_low} - ${refRange.normal_high} ${test.units}`) : '',
        normalLow: refRange ? parseFloat(refRange.normal_low) : null,
        normalHigh: refRange ? parseFloat(refRange.normal_high) : null,
        criticalLow: refRange ? parseFloat(refRange.critical_low) : null,
        criticalHigh: refRange ? parseFloat(refRange.critical_high) : null,
        currentValue: curr ? curr.numeric_value : '',
        currentTextValue: curr ? curr.text_value : '',
        currentFlag: curr ? curr.flag : '',
        isCritical: curr ? (curr.is_critical === true || curr.is_critical === 'TRUE') : false,
        deltaFlag: curr ? curr.delta_flag : '',
        previousValue: prevVal,
        resultStatus: curr ? curr.result_status : 'Pending',
        isLocked: curr ? (curr.result_status === this.RESULT_STATUS.VALIDATED) : false
      });
    }

    return {
      orderId: order.id,
      orderNo: order.order_no,
      uhid: order.uhid,
      patientName: order.patient_name,
      sampleId: sampleId,
      parameters: parameters
    };
  },

  /**
   * Evaluates clinical reference range flags for a numeric value
   * @param {number} val 
   * @param {Object} rangeRule 
   * @return {Object} { flag, isCritical }
   */
  evaluateFlag(val, rangeRule) {
    if (val === null || val === undefined || isNaN(val) || !rangeRule) {
      return { flag: this.FLAGS.NORMAL, isCritical: false };
    }

    const num = parseFloat(val);
    const nLow = parseFloat(rangeRule.normal_low);
    const nHigh = parseFloat(rangeRule.normal_high);
    const cLow = rangeRule.critical_low !== '' && rangeRule.critical_low !== null ? parseFloat(rangeRule.critical_low) : null;
    const cHigh = rangeRule.critical_high !== '' && rangeRule.critical_high !== null ? parseFloat(rangeRule.critical_high) : null;

    // Check Critical / Panic Limits first
    if (cLow !== null && !isNaN(cLow) && num <= cLow) {
      return { flag: this.FLAGS.CRITICAL_LOW, isCritical: true };
    }
    if (cHigh !== null && !isNaN(cHigh) && num >= cHigh) {
      return { flag: this.FLAGS.CRITICAL_HIGH, isCritical: true };
    }

    // Check Normal Range
    if (!isNaN(nLow) && num < nLow) {
      return { flag: this.FLAGS.LOW, isCritical: false };
    }
    if (!isNaN(nHigh) && num > nHigh) {
      return { flag: this.FLAGS.HIGH, isCritical: false };
    }

    return { flag: this.FLAGS.NORMAL, isCritical: false };
  },

  /**
   * Evaluates Delta Check comparing against previous visit value
   * @param {number} currentVal 
   * @param {number|null} prevVal 
   * @param {number} thresholdPct (default 25%)
   * @return {Object} { deltaFlag, deltaPercent }
   */
  evaluateDelta(currentVal, prevVal, thresholdPct = 25) {
    if (prevVal === null || prevVal === undefined || isNaN(prevVal) || prevVal === 0) {
      return { deltaFlag: 'No Previous Value', deltaPercent: 0 };
    }

    const cur = parseFloat(currentVal);
    const prev = parseFloat(prevVal);
    const diff = cur - prev;
    const pct = Utils.round((diff / prev) * 100, 1);

    let flag = 'Normal Velocity';
    if (Math.abs(pct) >= thresholdPct) {
      flag = pct > 0 ? 'Significant Increase' : 'Significant Decrease';
    }

    return { deltaFlag: flag, deltaPercent: pct };
  },

  /**
   * Saves or Submits entered results for an order (Lab Technician Step)
   * Auto-evaluates calculated formulas, flags, and delta checks.
   * 
   * @param {string} orderId 
   * @param {string} sampleId 
   * @param {Array<Object>} paramValues - Array of { testId, orderItemId, value, textValue }
   * @param {boolean} submitForValidation - If true, sets status to 'Entered'
   * @return {Object}
   */
  saveResults(orderId, sampleId, paramValues, submitForValidation = true) {
    SessionContext.requirePermission(PERMISSIONS.RESULT_ENTER, 'Save / Submit Results');

    const order = Repository.findById('Orders', orderId);
    if (!order) throw new Error('Order not found');
    const patient = Repository.findOneByField('Patients', 'uhid', order.uhid);
    const catalogTests = Repository.getTable('Tests', true);
    const ageDays = patient ? (patient.age ? patient.age * 365 : 9125) : 9125;
    const gender = patient ? patient.gender : 'All';

    // 1. Build Key-Value map of numeric entries for calculated formulas
    const valueMap = {};
    for (const p of paramValues) {
      const test = catalogTests.find(t => t.id === p.testId);
      if (test && p.value !== '' && p.value !== null && !isNaN(p.value)) {
        valueMap[test.code] = parseFloat(p.value);
      }
    }

    // 2. Auto-evaluate calculated parameters if constituent values are present
    // LFT: Indirect Bilirubin
    if (valueMap['LFT_TBIL'] !== undefined && valueMap['LFT_DBIL'] !== undefined) {
      valueMap['LFT_IBIL'] = Utils.calcIndirectBilirubin(valueMap['LFT_TBIL'], valueMap['LFT_DBIL']);
    }
    // LFT: Globulin & A/G Ratio
    if (valueMap['LFT_TP'] !== undefined && valueMap['LFT_ALB'] !== undefined) {
      const glob = Utils.calcGlobulin(valueMap['LFT_TP'], valueMap['LFT_ALB']);
      valueMap['LFT_GLOB'] = glob;
      valueMap['LFT_AG'] = Utils.calcAGRatio(valueMap['LFT_ALB'], glob);
    }
    // Lipid: VLDL, Friedewald LDL, Chol/HDL Ratio
    if (valueMap['LIP_TRIG'] !== undefined) {
      valueMap['LIP_VLDL'] = Utils.calcVLDL(valueMap['LIP_TRIG']);
    }
    if (valueMap['LIP_CHOL'] !== undefined && valueMap['LIP_HDL'] !== undefined && valueMap['LIP_TRIG'] !== undefined) {
      const ldl = Utils.calcFriedewaldLDL(valueMap['LIP_CHOL'], valueMap['LIP_HDL'], valueMap['LIP_TRIG']);
      if (ldl !== null) valueMap['LIP_LDL'] = ldl;
      valueMap['LIP_RATIO'] = Utils.calcCholHdlRatio(valueMap['LIP_CHOL'], valueMap['LIP_HDL']);
    }

    // 3. Historical values for Delta Check
    const pastResults = Repository.findByField('Results', 'uhid', order.uhid)
      .filter(r => r.order_id !== orderId && r.result_status === this.RESULT_STATUS.VALIDATED && (r.is_current_version === true || r.is_current_version === 'TRUE'));
    const pastMap = {};
    for (const pr of pastResults) {
      if (!pastMap[pr.test_id]) pastMap[pr.test_id] = pr.numeric_value;
    }

    const existingResults = Repository.findByField('Results', 'order_id', orderId);
    const savedResults = [];
    const now = Utils.getTimestamp();
    const userEmail = SessionContext.getCurrentEmail();
    const nextStatus = submitForValidation ? this.RESULT_STATUS.ENTERED : this.RESULT_STATUS.DRAFT;

    Utils.withScriptLock(() => {
      for (const p of paramValues) {
        const test = catalogTests.find(t => t.id === p.testId);
        if (!test) continue;

        // Use calculated value if parameter is calculated
        let numVal = p.value !== '' && p.value !== null && !isNaN(p.value) ? parseFloat(p.value) : '';
        if (valueMap[test.code] !== undefined) {
          numVal = valueMap[test.code];
        }

        const textVal = p.textValue !== undefined && p.textValue !== null ? String(p.textValue) : String(numVal);
        const refRange = CatalogService.getApplicableReferenceRange(test.id, gender, ageDays);
        const flagInfo = this.evaluateFlag(numVal, refRange);
        const prevVal = pastMap[test.id] !== undefined ? pastMap[test.id] : null;
        const deltaInfo = this.evaluateDelta(numVal, prevVal);

        const refText = refRange ? (refRange.text_range || `${refRange.normal_low} - ${refRange.normal_high} ${test.units}`) : '';

        // Check if result record already exists
        let currentRecord = existingResults.find(r => r.test_id === test.id && (r.is_current_version === true || r.is_current_version === 'TRUE'));

        if (currentRecord) {
          // If already validated, prevent direct overwrite!
          if (currentRecord.result_status === this.RESULT_STATUS.VALIDATED) {
            throw new Error(`Record Locked: Parameter [${test.name}] has already been validated and electronically signed. Use the Amendment workflow.`);
          }

          currentRecord.numeric_value = numVal;
          currentRecord.text_value = textVal;
          currentRecord.unit = test.units;
          currentRecord.ref_range_text = refText;
          currentRecord.flag = flagInfo.flag;
          currentRecord.is_critical = flagInfo.isCritical;
          currentRecord.delta_flag = deltaInfo.deltaFlag;
          currentRecord.previous_value = prevVal !== null ? prevVal : '';
          currentRecord.delta_percent = deltaInfo.deltaPercent;
          currentRecord.result_status = nextStatus;
          currentRecord.technician_id = userEmail;
          currentRecord.technician_entered_at = now;
          currentRecord.updated_at = now;
          currentRecord.updated_by = userEmail;

          Repository.saveRow('Results', currentRecord);
          savedResults.push(currentRecord);
        } else {
          // Create new Result record
          const newRecord = {
            id: Utils.generateId('RES'),
            order_id: orderId,
            order_item_id: p.orderItemId || '',
            test_id: test.id,
            uhid: order.uhid,
            sample_id: sampleId || '',
            parameter_name: test.name,
            numeric_value: numVal,
            text_value: textVal,
            unit: test.units,
            ref_range_text: refText,
            flag: flagInfo.flag,
            is_critical: flagInfo.isCritical,
            delta_flag: deltaInfo.deltaFlag,
            previous_value: prevVal !== null ? prevVal : '',
            delta_percent: deltaInfo.deltaPercent,
            version: 1,
            technician_id: userEmail,
            technician_entered_at: now,
            pathologist_id: '',
            validated_at: '',
            result_status: nextStatus,
            amendment_reason: '',
            is_current_version: true,
            status: 'Active',
            created_at: now,
            updated_at: now,
            updated_by: userEmail
          };

          Repository.saveRow('Results', newRecord);
          savedResults.push(newRecord);
        }
      }

      // Update Order & Sample Status
      if (submitForValidation) {
        order.order_status = 'Resulted';
        order.updated_at = now;
        order.updated_by = userEmail;
        Repository.saveRow('Orders', order);

        if (sampleId) {
          const sample = Repository.findById('Samples', sampleId);
          if (sample) {
            sample.collection_status = 'Resulted';
            sample.updated_at = now;
            sample.updated_by = userEmail;
            Repository.saveRow('Samples', sample);
          }
        }
      }
    });

    Repository.logAudit('UPDATE', 'Results', order.order_no, {
      orderId: orderId,
      parametersSaved: savedResults.length,
      status: nextStatus
    });

    return {
      status: 'SUCCESS',
      savedCount: savedResults.length,
      results: savedResults,
      message: submitForValidation
        ? `${savedResults.length} parameters submitted for Pathologist validation.`
        : `${savedResults.length} parameters saved as Draft.`
    };
  },

  /**
   * Pathologist Validation & Electronic Sign-off (Step 2)
   * Locks results and approves the order for report generation
   * @param {string} orderId 
   * @return {Object}
   */
  validateResults(orderId) {
    SessionContext.requirePermission(PERMISSIONS.RESULT_VALIDATE, 'Validate & Sign Results');

    const order = Repository.findById('Orders', orderId);
    if (!order) throw new Error('Order not found');

    const results = Repository.findByField('Results', 'order_id', orderId)
      .filter(r => (r.is_current_version === true || r.is_current_version === 'TRUE') && r.status === 'Active');

    if (results.length === 0) {
      throw new Error('No test results entered for this order yet.');
    }

    const now = Utils.getTimestamp();
    const pathologistUser = SessionContext.getCurrentUser();
    const pathologistEmail = SessionContext.getCurrentEmail();

    Utils.withScriptLock(() => {
      // Validate all active results
      for (const res of results) {
        res.result_status = this.RESULT_STATUS.VALIDATED;
        res.pathologist_id = pathologistEmail;
        res.validated_at = now;
        res.updated_at = now;
        res.updated_by = pathologistEmail;
        Repository.saveRow('Results', res);
      }

      // Update Order Status
      order.order_status = 'Validated';
      order.updated_at = now;
      order.updated_by = pathologistEmail;
      Repository.saveRow('Orders', order);

      // Update Samples
      const samples = Repository.findByField('Samples', 'order_id', orderId);
      for (const s of samples) {
        s.collection_status = 'Validated';
        s.updated_at = now;
        s.updated_by = pathologistEmail;
        Repository.saveRow('Samples', s);
      }
    });

    Repository.logAudit('VALIDATE_RESULT', 'Order', order.order_no, {
      orderId: orderId,
      pathologist: pathologistEmail,
      parameterCount: results.length
    });

    return {
      status: 'SUCCESS',
      validatedCount: results.length,
      pathologist: pathologistUser ? pathologistUser.full_name : pathologistEmail,
      validatedAt: now,
      message: `Order ${order.order_no} successfully validated and signed by ${pathologistUser ? pathologistUser.full_name : pathologistEmail}.`
    };
  },

  /**
   * Clinical Amendment Workflow (Audit-Safe, Never Overwrites)
   * Archives current version, spawns Version N+1 with recorded amendment reason
   * @param {string} resultId 
   * @param {number|string} newValue 
   * @param {string} amendmentReason 
   * @return {Object} Newly created amended result version
   */
  amendResult(resultId, newValue, amendmentReason) {
    SessionContext.requirePermission(PERMISSIONS.RESULT_AMEND, 'Amend Approved Result');

    if (!amendmentReason || String(amendmentReason).trim().length < 5) {
      throw new Error('Audit Compliance: A detailed clinical amendment reason (minimum 5 chars) is mandatory.');
    }

    const currentResult = Repository.findById('Results', resultId);
    if (!currentResult) throw new Error('Result record not found: ' + resultId);

    const order = Repository.findById('Orders', currentResult.order_id);
    const patient = Repository.findOneByField('Patients', 'uhid', currentResult.uhid);
    const test = Repository.findById('Tests', currentResult.test_id);

    const now = Utils.getTimestamp();
    const pathologistEmail = SessionContext.getCurrentEmail();
    const nextVersion = (parseInt(currentResult.version, 10) || 1) + 1;

    let amendedRecord = null;

    Utils.withScriptLock(() => {
      // 1. Archive current version
      currentResult.is_current_version = false;
      currentResult.status = 'Archived';
      currentResult.updated_at = now;
      currentResult.updated_by = pathologistEmail;
      Repository.saveRow('Results', currentResult);

      // 2. Evaluate new flag
      const ageDays = patient ? (patient.age ? patient.age * 365 : 9125) : 9125;
      const gender = patient ? patient.gender : 'All';
      const refRange = CatalogService.getApplicableReferenceRange(currentResult.test_id, gender, ageDays);
      const flagInfo = this.evaluateFlag(newValue, refRange);

      // 3. Create Version N+1
      amendedRecord = {
        id: Utils.generateId('RES'),
        order_id: currentResult.order_id,
        order_item_id: currentResult.order_item_id,
        test_id: currentResult.test_id,
        uhid: currentResult.uhid,
        sample_id: currentResult.sample_id,
        parameter_name: currentResult.parameter_name,
        numeric_value: newValue,
        text_value: String(newValue),
        unit: currentResult.unit,
        ref_range_text: currentResult.ref_range_text,
        flag: flagInfo.flag,
        is_critical: flagInfo.isCritical,
        delta_flag: 'Amended',
        previous_value: currentResult.numeric_value,
        delta_percent: 0,
        version: nextVersion,
        technician_id: currentResult.technician_id,
        technician_entered_at: currentResult.technician_entered_at,
        pathologist_id: pathologistEmail,
        validated_at: now,
        result_status: this.RESULT_STATUS.AMENDED,
        amendment_reason: amendmentReason,
        is_current_version: true,
        status: 'Active',
        created_at: now,
        updated_at: now,
        updated_by: pathologistEmail
      };

      Repository.saveRow('Results', amendedRecord);
    });

    Repository.logAudit('AMEND_RESULT', 'Result', amendedRecord.id, {
      testName: currentResult.parameter_name,
      previousValue: currentResult.numeric_value,
      newValue: newValue,
      version: nextVersion,
      reason: amendmentReason,
      pathologist: pathologistEmail
    });

    return {
      status: 'SUCCESS',
      amendedResult: amendedRecord,
      message: `Parameter [${currentResult.parameter_name}] amended to Version ${nextVersion}. Historical Version ${currentResult.version} preserved in audit trail.`
    };
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ResultService;
}

