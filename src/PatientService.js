/**
 * Laboratory Information System (LIS) - Patient Management Service
 * Implements:
 * - Patient registration with atomic UHID generation (UHID-YYYY-XXXXX)
 * - Multi-criteria duplicate detection (Mobile + Name + DOB)
 * - DPDP Act 2023 digital consent capture
 * - Fast debounced search across UHID, Mobile, and Name
 * - Comprehensive visit and order history lookup
 */

// Node.js environment imports
if (typeof require !== 'undefined') {
  var Repository = require('./Repository.js');
  var Utils = require('./Utils.js');
  var { PERMISSIONS, SessionContext } = require('./Auth.js');
}

const PatientService = {
  /**
   * Fast Patient Search by UHID, Mobile Number, or Patient Name
   * @param {string} query 
   * @return {Array<Object>}
   */
  searchPatients(query) {
    if (!query || String(query).trim().length < 2) return [];
    SessionContext.requirePermission(PERMISSIONS.PATIENT_SEARCH, 'Search Patients');

    const cleanQuery = String(query).trim().toLowerCase();
    const patients = Repository.getTable('Patients', false);
    const matches = [];

    for (let i = 0; i < patients.length; i++) {
      const p = patients[i];
      if (p.status === 'Inactive') continue;

      const uhid = String(p.uhid || '').toLowerCase();
      const mobile = String(p.mobile || '').toLowerCase();
      const fullName = (String(p.first_name || '') + ' ' + String(p.last_name || '')).trim().toLowerCase();

      if (uhid.includes(cleanQuery) || mobile.includes(cleanQuery) || fullName.includes(cleanQuery)) {
        matches.push({
          id: p.id,
          uhid: p.uhid,
          title: p.title || '',
          firstName: p.first_name,
          lastName: p.last_name || '',
          fullName: `${p.title ? p.title + ' ' : ''}${p.first_name} ${p.last_name || ''}`.trim(),
          age: p.age,
          ageUnit: p.age_unit || 'Years',
          gender: p.gender,
          mobile: p.mobile,
          email: p.email || '',
          city: p.city || '',
          consentDpdp: p.consent_dpdp === true || p.consent_dpdp === 'TRUE',
          createdAt: p.created_at
        });

        if (matches.length >= 25) break; // Limit search return for front desk speed
      }
    }

    return matches;
  },

  /**
   * Multi-criteria Duplicate Patient Detection Algorithm
   * Detects if patient already exists by:
   * 1. Exact 10-digit mobile number match
   * 2. First name + DOB match
   * 
   * @param {string} mobile 
   * @param {string} firstName 
   * @param {string} dob 
   * @return {Array<Object>} List of potential existing duplicate records
   */
  checkDuplicates(mobile, firstName, dob) {
    const cleanMobile = String(mobile || '').replace(/\D/g, '').slice(-10);
    const cleanName = String(firstName || '').trim().toLowerCase();
    const cleanDob = dob ? String(dob).substring(0, 10) : '';

    if (!cleanMobile && !cleanName) return [];

    const patients = Repository.getTable('Patients', false);
    const duplicates = [];

    for (const p of patients) {
      if (p.status === 'Inactive') continue;

      const pMobile = String(p.mobile || '').replace(/\D/g, '').slice(-10);
      const pName = String(p.first_name || '').trim().toLowerCase();
      const pDob = p.dob ? String(p.dob).substring(0, 10) : '';

      let matchReason = null;
      if (cleanMobile && pMobile === cleanMobile) {
        matchReason = 'Mobile number already registered';
      } else if (cleanName && cleanDob && pName === cleanName && pDob === cleanDob) {
        matchReason = 'Identical name and Date of Birth';
      }

      if (matchReason) {
        duplicates.push({
          uhid: p.uhid,
          fullName: `${p.title ? p.title + ' ' : ''}${p.first_name} ${p.last_name || ''}`.trim(),
          age: p.age,
          ageUnit: p.age_unit || 'Years',
          gender: p.gender,
          mobile: p.mobile,
          reason: matchReason
        });
      }
    }

    return duplicates;
  },

  /**
   * Registers a new patient with atomic UHID generation and DPDP consent recording
   * @param {Object} data 
   * @param {boolean} forceRegister - If true, bypasses duplicate warning
   * @return {Object} Registered patient profile
   */
  registerPatient(data, forceRegister = false) {
    SessionContext.requirePermission(PERMISSIONS.PATIENT_REGISTER, 'Register Patient');

    // 1. Mandatory Validations
    if (!data.first_name || String(data.first_name).trim().length === 0) {
      throw new Error('Validation Failed: First name is mandatory.');
    }

    const cleanMobile = String(data.mobile || '').replace(/\D/g, '');
    if (!cleanMobile || cleanMobile.length !== 10 || !/^[6-9]\d{9}$/.test(cleanMobile)) {
      throw new Error('Validation Failed: A valid 10-digit Indian mobile number starting with 6-9 is required.');
    }

    if (!data.gender || !['Male', 'Female', 'Other'].includes(data.gender)) {
      throw new Error('Validation Failed: Valid gender (Male/Female/Other) is required for clinical reference ranges.');
    }

    // DPDP Act 2023 Explicit Consent Verification
    const hasConsent = data.consent_dpdp === true || data.consent_dpdp === 'TRUE' || data.consent_dpdp === 'true';
    if (!hasConsent) {
      throw new Error('Compliance Gate: Patient explicit consent under DPDP Act 2023 is mandatory before registration.');
    }

    // 2. Duplicate Check
    if (!forceRegister) {
      const existing = this.checkDuplicates(cleanMobile, data.first_name, data.dob);
      if (existing.length > 0) {
        return {
          duplicateDetected: true,
          duplicates: existing,
          message: 'Potential duplicate patient profile found with matching mobile or identity.'
        };
      }
    }

    // 3. Compute Age and DOB
    let age = parseInt(data.age, 10);
    let ageUnit = data.age_unit || 'Years';
    let dob = data.dob || '';

    if (dob && (!age || isNaN(age))) {
      const birthDate = new Date(dob);
      if (!isNaN(birthDate.getTime())) {
        const today = new Date();
        let calculatedYears = today.getFullYear() - birthDate.getFullYear();
        const m = today.getMonth() - birthDate.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
          calculatedYears--;
        }
        if (calculatedYears > 0) {
          age = calculatedYears;
          ageUnit = 'Years';
        } else {
          // Infant in months or days
          const days = Utils.calculateAgeInDays(dob);
          if (days > 30) {
            age = Math.floor(days / 30);
            ageUnit = 'Months';
          } else {
            age = days;
            ageUnit = 'Days';
          }
        }
      }
    }

    // 4. Generate Atomic UHID within ScriptLock
    const uhid = Utils.generateUHID();
    const patientId = Utils.generateId('PAT');
    const timestamp = Utils.getTimestamp();
    const userEmail = SessionContext.getCurrentEmail();

    const patientRecord = {
      id: patientId,
      uhid: uhid,
      title: data.title || 'Mr',
      first_name: String(data.first_name).trim(),
      last_name: String(data.last_name || '').trim(),
      dob: dob,
      age: age || 0,
      age_unit: ageUnit,
      gender: data.gender,
      mobile: cleanMobile,
      email: String(data.email || '').trim().toLowerCase(),
      blood_group: data.blood_group || 'Unknown',
      address: data.address || '',
      city: data.city || 'Mumbai',
      pin_code: data.pin_code || '',
      national_id_type: data.national_id_type || 'None',
      national_id_masked: data.national_id_number ? 'XXXX-XXXX-' + String(data.national_id_number).slice(-4) : '',
      medical_history: data.medical_history || '',
      consent_dpdp: true,
      status: 'Active',
      created_at: timestamp,
      updated_at: timestamp,
      created_by: userEmail,
      updated_by: userEmail
    };

    // 5. Persist to Patients sheet
    Repository.saveRow('Patients', patientRecord);

    // 6. Audit Log
    Repository.logAudit('CREATE', 'Patient', uhid, {
      name: `${patientRecord.title} ${patientRecord.first_name} ${patientRecord.last_name}`.trim(),
      mobile: cleanMobile,
      dpdpConsent: true
    });

    return {
      duplicateDetected: false,
      patient: patientRecord,
      message: `Patient registered successfully with UHID: ${uhid}`
    };
  },

  /**
   * Retrieves full patient profile and complete clinical visit/order history
   * @param {string} uhid 
   * @return {Object}
   */
  getPatientProfile(uhid) {
    if (!uhid) throw new Error('UHID is required');
    SessionContext.requirePermission(PERMISSIONS.PATIENT_VIEW, 'View Patient Profile');

    const patient = Repository.findOneByField('Patients', 'uhid', uhid);
    if (!patient || patient.status === 'Inactive') {
      throw new Error(`Patient not found with UHID: ${uhid}`);
    }

    // Fetch visit orders
    const orders = Repository.findByField('Orders', 'uhid', uhid)
      .filter(o => o.status !== 'Cancelled')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return {
      profile: patient,
      orderCount: orders.length,
      orders: orders.map(o => ({
        id: o.id,
        orderNo: o.order_no,
        date: o.order_date,
        netAmount: o.net_amount,
        paidAmount: o.paid_amount,
        paymentStatus: o.payment_status,
        orderStatus: o.order_status,
        createdAt: o.created_at
      }))
    };
  },

  /**
   * Updates patient demographic information with audit trail
   * @param {string} uhid 
   * @param {Object} updateData 
   * @return {Object}
   */
  updatePatient(uhid, updateData) {
    SessionContext.requirePermission(PERMISSIONS.PATIENT_REGISTER, 'Update Patient Demographics');

    const patient = Repository.findOneByField('Patients', 'uhid', uhid);
    if (!patient || patient.status === 'Inactive') {
      throw new Error(`Patient not found with UHID: ${uhid}`);
    }

    const allowedFields = [
      'title', 'first_name', 'last_name', 'dob', 'age', 'age_unit',
      'gender', 'mobile', 'email', 'blood_group', 'address', 'city', 'pin_code', 'medical_history'
    ];

    const changes = {};
    for (const key of allowedFields) {
      if (updateData[key] !== undefined && updateData[key] !== patient[key]) {
        changes[key] = { from: patient[key], to: updateData[key] };
        patient[key] = updateData[key];
      }
    }

    patient.updated_at = Utils.getTimestamp();
    patient.updated_by = SessionContext.getCurrentEmail();

    Repository.saveRow('Patients', patient);
    Repository.logAudit('UPDATE', 'Patient', uhid, changes);

    return {
      status: 'SUCCESS',
      patient: patient,
      changes: changes
    };
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PatientService;
}

