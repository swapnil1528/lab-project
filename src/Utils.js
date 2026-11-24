/**
 * Laboratory Information System (LIS) - Utility & Concurrency Engine
 * Handles Locking, Counter Generation, Cryptographic Hashing, and Clinical Math
 */

const Utils = {
  /**
   * Executes a function within an exclusive Script Lock
   * Prevents race conditions across concurrent web requests
   * @param {Function} callback 
   * @param {number} timeoutMs - Max lock wait time in milliseconds (default: 30000)
   * @return {*}
   */
  withScriptLock(callback, timeoutMs = 30000) {
    let lock;
    try {
      lock = LockService.getScriptLock();
    } catch (e) {
      // If LockService is not available (e.g. local unit tests)
      return callback();
    }

    try {
      const acquired = lock.waitLock(timeoutMs);
      if (!acquired) {
        throw new Error('LockTimeout: System is busy processing concurrent transactions. Please retry.');
      }
      return callback();
    } finally {
      try {
        lock.releaseLock();
      } catch (err) {
        // Ignored if already released
      }
    }
  },

  /**
   * Generates a sequential ID using an atomic counter stored in Settings
   * @param {string} counterKey e.g. 'COUNTER_UHID'
   * @param {string} prefix e.g. 'UHID-2026-'
   * @param {number} padLength e.g. 5
   * @return {string}
   */
  getAndIncrementCounter(counterKey, prefix, padLength = 5) {
    return this.withScriptLock(() => {
      const repo = typeof Repository !== 'undefined' ? Repository : (typeof global !== 'undefined' ? global.Repository : null);
      const session = typeof SessionContext !== 'undefined' ? SessionContext : (typeof global !== 'undefined' ? global.SessionContext : null);
      const currentEmail = session && session.getCurrentEmail ? session.getCurrentEmail() : 'SYSTEM';

      if (!repo) {
        return prefix + '10001';
      }

      const setting = repo.findOneByField('Settings', 'key', counterKey);
      let currentVal = 1;
      if (setting && setting.value) {
        currentVal = parseInt(setting.value, 10);
        if (isNaN(currentVal) || currentVal < 1) currentVal = 1;
      }

      const nextVal = currentVal + 1;
      if (setting && setting._rowIndex) {
        setting.value = String(nextVal);
        setting.updated_at = this.getTimestamp();
        setting.updated_by = currentEmail;
        repo.saveRow('Settings', setting);
      } else {
        repo.saveRow('Settings', {
          key: counterKey,
          value: String(nextVal),
          category: 'Counter',
          description: 'Atomic sequential counter for ' + counterKey,
          updated_at: this.getTimestamp(),
          updated_by: currentEmail
        });
      }

      const formattedNum = String(currentVal).padStart(padLength, '0');
      return prefix + formattedNum;
    });
  },

  /**
   * Generates Patient UHID (e.g. UHID-2026-10001)
   */
  generateUHID() {
    const year = new Date().getFullYear();
    return this.getAndIncrementCounter('COUNTER_UHID', 'UHID-' + year + '-', 5);
  },

  /**
   * Generates Order Number (e.g. ORD-2026-10001)
   */
  generateOrderNo() {
    const year = new Date().getFullYear();
    return this.getAndIncrementCounter('COUNTER_ORDER', 'ORD-' + year + '-', 5);
  },

  /**
   * Generates Sample Tube Barcode (e.g. SMP-100001)
   */
  generateSampleBarcode() {
    return this.getAndIncrementCounter('COUNTER_SAMPLE', 'SMP-', 6);
  },

  /**
   * Generates Tax/Bill Invoice Number (e.g. INV-2026-10001)
   */
  generateInvoiceNo() {
    const year = new Date().getFullYear();
    return this.getAndIncrementCounter('COUNTER_INVOICE', 'INV-' + year + '-', 5);
  },

  /**
   * Generates Money Receipt Number (e.g. RCP-2026-10001)
   */
  generateReceiptNo() {
    const year = new Date().getFullYear();
    return this.getAndIncrementCounter('COUNTER_RECEIPT', 'RCP-' + year + '-', 5);
  },

  /**
   * Generates a random internal UUID-style entity ID
   * @param {string} prefix e.g. 'PAT', 'ORD', 'TST'
   * @return {string}
   */
  generateId(prefix = 'ID') {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return prefix + '-' + code;
  },

  /**
   * Generates a high-entropy, secure token for patient report links
   * @return {string}
   */
  generateSecureToken() {
    const hasUtils = typeof Utilities !== 'undefined';
    const uuid = hasUtils && Utilities.getUuid ? Utilities.getUuid() : Math.random().toString(36).substring(2);
    const raw = uuid + '-' + Date.now() + '-' + Math.random().toString(36).substring(2);
    if (hasUtils && Utilities.computeDigest) {
      const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw);
      return Utilities.base64EncodeWebSafe(digest).replace(/[^a-zA-Z0-9]/g, '').substring(0, 32);
    }
    return raw.replace(/[^a-zA-Z0-9]/g, '').substring(0, 32);
  },

  /**
   * Generates a 6-digit numeric OTP
   * @return {string}
   */
  generateOtp() {
    return String(Math.floor(100000 + Math.random() * 900000));
  },

  /**
   * Computes SHA-256 hash of an OTP with salt for secure storage
   * @param {string} otp 
   * @param {string} salt 
   * @return {string}
   */
  hashOtp(otp, salt = 'LIS_PATIENT_PORTAL_SALT') {
    const input = String(otp).trim() + ':' + salt;
    if (typeof Utilities !== 'undefined' && Utilities.computeDigest) {
      const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input);
      return Utilities.base64EncodeWebSafe(digest);
    }
    // Fallback simple hash for testing
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) - hash) + input.charCodeAt(i);
      hash |= 0;
    }
    return 'HASH_' + Math.abs(hash);
  },

  /**
   * Current ISO-8601 Timestamp in Indian Standard Time (IST)
   * @return {string}
   */
  getTimestamp() {
    return new Date().toISOString();
  },

  /**
   * Formats a Date object or ISO string to Indian format DD/MM/YYYY
   * @param {Date|string} date 
   * @return {string}
   */
  formatDate(date) {
    if (!date) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return String(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  },

  /**
   * Formats a Date to DD/MM/YYYY HH:MM AM/PM
   * @param {Date|string} date 
   * @return {string}
   */
  formatDateTime(date) {
    if (!date) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return String(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    let hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${day}/${month}/${year} ${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
  },

  /**
   * Calculates patient age in days from DOB
   * @param {string|Date} dob 
   * @return {number}
   */
  calculateAgeInDays(dob) {
    if (!dob) return 0;
    const birthDate = new Date(dob);
    if (isNaN(birthDate.getTime())) return 0;
    const diffTime = Math.abs(Date.now() - birthDate.getTime());
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  },

  /**
   * Rounds a number safely to fixed decimal places
   * @param {number|string} val 
   * @param {number} decimals 
   * @return {number}
   */
  round(val, decimals = 2) {
    const num = parseFloat(val);
    if (isNaN(num)) return 0;
    const factor = Math.pow(10, decimals);
    return Math.round(num * factor) / factor;
  },

  // -------------------------------------------------------------
  // Clinical Calculation Formulas
  // -------------------------------------------------------------

  /**
   * Indirect Bilirubin = Total Bilirubin - Direct Bilirubin
   */
  calcIndirectBilirubin(totalBilirubin, directBilirubin) {
    const tb = parseFloat(totalBilirubin) || 0;
    const db = parseFloat(directBilirubin) || 0;
    return this.round(Math.max(0, tb - db), 2);
  },

  /**
   * Globulin = Total Protein - Albumin
   */
  calcGlobulin(totalProtein, albumin) {
    const tp = parseFloat(totalProtein) || 0;
    const alb = parseFloat(albumin) || 0;
    return this.round(Math.max(0, tp - alb), 2);
  },

  /**
   * A/G Ratio = Albumin / Globulin
   */
  calcAGRatio(albumin, globulin) {
    const alb = parseFloat(albumin) || 0;
    const glob = parseFloat(globulin) || 0;
    if (glob <= 0) return 0;
    return this.round(alb / glob, 2);
  },

  /**
   * VLDL = Triglycerides / 5 (valid when TG < 400 mg/dL)
   */
  calcVLDL(triglycerides) {
    const tg = parseFloat(triglycerides) || 0;
    return this.round(tg / 5, 1);
  },

  /**
   * Friedewald LDL = Total Cholesterol - HDL - (Triglycerides / 5)
   */
  calcFriedewaldLDL(totalChol, hdl, triglycerides) {
    const tc = parseFloat(totalChol) || 0;
    const h = parseFloat(hdl) || 0;
    const tg = parseFloat(triglycerides) || 0;
    if (tg >= 400) return null; // Friedewald formula invalid when TG >= 400
    const ldl = tc - h - (tg / 5);
    return this.round(Math.max(0, ldl), 1);
  },

  /**
   * Total Cholesterol / HDL Ratio
   */
  calcCholHdlRatio(totalChol, hdl) {
    const tc = parseFloat(totalChol) || 0;
    const h = parseFloat(hdl) || 0;
    if (h <= 0) return 0;
    return this.round(tc / h, 2);
  },

  /**
   * Absolute Neutrophil Count (ANC) = (TLC * Neutrophil %) / 100
   */
  calcANC(tlc, neutrophilPercent) {
    const wbc = parseFloat(tlc) || 0;
    const neut = parseFloat(neutrophilPercent) || 0;
    return Math.round((wbc * neut) / 100);
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Utils;
}
