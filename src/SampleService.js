/**
 * Laboratory Information System (LIS) - Sample Management Service
 * Implements:
 * - Intelligent Specimen Tube Grouping (e.g. EDTA, SST, Fluoride)
 * - Unique sequential barcode generation (SMP-1XXXXX)
 * - Strict Sample Status Lifecycle: Ordered -> Collected -> Received -> In Process -> Resulted -> Validated
 * - Specimen rejection (Hemolyzed, Clotted, Insufficient) with automatic recollection workflow
 * - Home-collection phlebotomist scheduling
 * - 50mm x 25mm barcode thermal label print data
 */

// Node.js environment imports
if (typeof require !== 'undefined') {
  var Repository = require('./Repository.js');
  var Utils = require('./Utils.js');
  var { PERMISSIONS, SessionContext } = require('./Auth.js');
}

const SampleService = {
  SAMPLE_STATUSES: {
    ORDERED: 'Ordered',
    COLLECTED: 'Collected',
    RECEIVED: 'Received',
    IN_PROCESS: 'In Process',
    RESULTED: 'Resulted',
    VALIDATED: 'Validated',
    REJECTED: 'Rejected'
  },

  REJECTION_REASONS: [
    'Hemolyzed',
    'Lipemic / Turbid',
    'Clotted Specimen',
    'Insufficient Volume (QNS)',
    'Incorrect Container / Tube',
    'Unlabelled / Mislabeled Specimen',
    'Specimen Leakage / Contamination'
  ],

  /**
   * Intelligently groups an order's tests into specimen tubes and creates barcode records
   * Multiple tests requiring the same tube (e.g. LFT + KFT + Lipid on SST) share ONE sample tube!
   * @param {string} orderId 
   * @return {Array<Object>} Generated sample tube records
   */
  generateSamplesForOrder(orderId) {
    SessionContext.requirePermission(PERMISSIONS.SAMPLE_COLLECT, 'Generate Samples for Order');

    const order = Repository.findById('Orders', orderId);
    if (!order || order.status === 'Cancelled') {
      throw new Error(`Order not found or inactive: ${orderId}`);
    }

    // Check if samples already generated
    const existingSamples = Repository.findByField('Samples', 'order_id', orderId)
      .filter(s => s.status !== 'Archived');
    if (existingSamples.length > 0) {
      return existingSamples;
    }

    const orderItems = Repository.findByField('OrderItems', 'order_id', orderId);
    const catalogTests = Repository.getTable('Tests', true);

    // Group order items by (sample_type + container_tube)
    const tubeGroups = {};
    for (const item of orderItems) {
      const test = catalogTests.find(t => t.id === item.test_or_panel_id || t.code === item.item_code);
      const sampleType = test ? test.sample_type : 'Serum';
      const containerTube = test ? test.container_type : 'Yellow (SST)';
      const department = test ? test.department : item.department;

      const groupKey = `${sampleType}__${containerTube}`;
      if (!tubeGroups[groupKey]) {
        tubeGroups[groupKey] = {
          sampleType: sampleType,
          containerTube: containerTube,
          department: department,
          items: []
        };
      }
      tubeGroups[groupKey].items.push(item);
    }

    const generatedSamples = [];
    const updatedOrderItems = [];
    const now = Utils.getTimestamp();
    const userEmail = SessionContext.getCurrentEmail();

    Utils.withScriptLock(() => {
      for (const key in tubeGroups) {
        const grp = tubeGroups[key];
        const barcode = Utils.generateSampleBarcode();
        const sampleId = Utils.generateId('SMP');

        const sampleRecord = {
          id: sampleId,
          barcode: barcode,
          order_id: orderId,
          uhid: order.uhid,
          patient_name: order.patient_name,
          sample_type: grp.sampleType,
          container_tube: grp.containerTube,
          department: grp.department,
          collection_status: this.SAMPLE_STATUSES.ORDERED,
          collected_at: '',
          collected_by: '',
          received_at: '',
          received_by: '',
          rejection_reason: '',
          recollection_flag: false,
          status: 'Active',
          created_at: now,
          updated_at: now,
          updated_by: userEmail
        };

        generatedSamples.push(sampleRecord);

        // Link sample_id back to each order item
        for (const itm of grp.items) {
          itm.sample_id = sampleId;
          itm.item_status = 'Pending Collection';
          itm.updated_at = now;
          itm.updated_by = userEmail;
          updatedOrderItems.push(itm);
        }
      }

      // Persist samples and updated items
      Repository.batchInsert('Samples', generatedSamples);
      for (const itm of updatedOrderItems) {
        Repository.saveRow('OrderItems', itm);
      }
    });

    Repository.logAudit('CREATE', 'Sample', order.order_no, {
      orderId: orderId,
      tubesGenerated: generatedSamples.length,
      barcodes: generatedSamples.map(s => s.barcode)
    });

    return generatedSamples;
  },

  /**
   * Marks sample as Collected by Phlebotomist
   * @param {string} sampleId 
   * @return {Object}
   */
  markCollected(sampleId) {
    SessionContext.requirePermission(PERMISSIONS.SAMPLE_COLLECT, 'Mark Sample Collected');

    const sample = Repository.findById('Samples', sampleId);
    if (!sample) throw new Error(`Sample not found: ${sampleId}`);

    const now = Utils.getTimestamp();
    const userEmail = SessionContext.getCurrentEmail();

    sample.collection_status = this.SAMPLE_STATUSES.COLLECTED;
    sample.collected_at = now;
    sample.collected_by = userEmail;
    sample.updated_at = now;
    sample.updated_by = userEmail;

    Repository.saveRow('Samples', sample);

    // Update linked order items
    const items = Repository.findByField('OrderItems', 'sample_id', sampleId);
    for (const itm of items) {
      itm.item_status = 'Sample Collected';
      itm.updated_at = now;
      itm.updated_by = userEmail;
      Repository.saveRow('OrderItems', itm);
    }

    // Check if all samples for order collected -> update Order status
    this._syncOrderStatus(sample.order_id);

    Repository.logAudit('UPDATE', 'Sample', sample.barcode, {
      action: 'COLLECTED',
      collectedBy: userEmail,
      sampleId: sampleId
    });

    return {
      status: 'SUCCESS',
      sample: sample,
      message: `Sample ${sample.barcode} (${sample.container_tube}) marked as Collected.`
    };
  },

  /**
   * Accessions sample inside the laboratory (Received in Lab)
   * @param {string} sampleId 
   * @return {Object}
   */
  markReceived(sampleId) {
    SessionContext.requirePermission(PERMISSIONS.SAMPLE_RECEIVE, 'Receive Sample in Lab');

    const sample = Repository.findById('Samples', sampleId);
    if (!sample) throw new Error(`Sample not found: ${sampleId}`);

    const now = Utils.getTimestamp();
    const userEmail = SessionContext.getCurrentEmail();

    sample.collection_status = this.SAMPLE_STATUSES.RECEIVED;
    sample.received_at = now;
    sample.received_by = userEmail;
    sample.updated_at = now;
    sample.updated_by = userEmail;

    Repository.saveRow('Samples', sample);

    // Update order items
    const items = Repository.findByField('OrderItems', 'sample_id', sampleId);
    for (const itm of items) {
      itm.item_status = 'Received in Lab';
      itm.updated_at = now;
      itm.updated_by = userEmail;
      Repository.saveRow('OrderItems', itm);
    }

    this._syncOrderStatus(sample.order_id);

    Repository.logAudit('UPDATE', 'Sample', sample.barcode, {
      action: 'RECEIVED',
      receivedBy: userEmail,
      sampleId: sampleId
    });

    return {
      status: 'SUCCESS',
      sample: sample,
      message: `Sample ${sample.barcode} received and accessioned in ${sample.department}.`
    };
  },

  /**
   * Rejects an unsuitable sample and triggers recollection if requested
   * @param {string} sampleId 
   * @param {string} reason 
   * @param {boolean} requestRecollection 
   * @return {Object}
   */
  rejectSample(sampleId, reason, requestRecollection = true) {
    SessionContext.requirePermission(PERMISSIONS.SAMPLE_REJECT, 'Reject Specimen');

    const sample = Repository.findById('Samples', sampleId);
    if (!sample) throw new Error(`Sample not found: ${sampleId}`);

    const now = Utils.getTimestamp();
    const userEmail = SessionContext.getCurrentEmail();

    sample.collection_status = this.SAMPLE_STATUSES.REJECTED;
    sample.rejection_reason = reason;
    sample.recollection_flag = requestRecollection;
    sample.updated_at = now;
    sample.updated_by = userEmail;

    Repository.saveRow('Samples', sample);

    let replacementSample = null;
    if (requestRecollection) {
      // Spawn fresh replacement tube in 'Ordered' state
      Utils.withScriptLock(() => {
        const newBarcode = Utils.generateSampleBarcode();
        replacementSample = {
          id: Utils.generateId('SMP'),
          barcode: newBarcode,
          order_id: sample.order_id,
          uhid: sample.uhid,
          patient_name: sample.patient_name,
          sample_type: sample.sample_type,
          container_tube: sample.container_tube,
          department: sample.department,
          collection_status: this.SAMPLE_STATUSES.ORDERED,
          collected_at: '',
          collected_by: '',
          received_at: '',
          received_by: '',
          rejection_reason: '',
          recollection_flag: false,
          status: 'Active',
          created_at: now,
          updated_at: now,
          updated_by: userEmail
        };
        Repository.saveRow('Samples', replacementSample);

        // Relink order items to the replacement tube
        const items = Repository.findByField('OrderItems', 'sample_id', sampleId);
        for (const itm of items) {
          itm.sample_id = replacementSample.id;
          itm.item_status = 'Recollection Required';
          itm.updated_at = now;
          itm.updated_by = userEmail;
          Repository.saveRow('OrderItems', itm);
        }
      });
    }

    this._syncOrderStatus(sample.order_id);

    Repository.logAudit('UPDATE', 'Sample', sample.barcode, {
      action: 'REJECTED',
      reason: reason,
      recollection: requestRecollection,
      newBarcode: replacementSample ? replacementSample.barcode : null
    });

    return {
      status: 'SUCCESS',
      rejectedSample: sample,
      replacementBarcode: replacementSample ? replacementSample.barcode : null,
      message: `Sample ${sample.barcode} rejected (${reason}). ${replacementSample ? 'New recollection tube ' + replacementSample.barcode + ' scheduled.' : ''}`
    };
  },

  /**
   * Returns phlebotomy worklist filtered by status
   * @param {string} statusFilter 
   * @return {Array<Object>}
   */
  getPhlebotomyWorklist(statusFilter = '') {
    SessionContext.requirePermission(PERMISSIONS.SAMPLE_COLLECT, 'View Phlebotomy Worklist');

    const samples = Repository.getTable('Samples', false).filter(s => s.status === 'Active');
    if (!statusFilter || statusFilter === 'All') return samples;
    return samples.filter(s => s.collection_status === statusFilter);
  },

  /**
   * Prepares printable label payload for standard 50mm x 25mm thermal printer
   * @param {string} sampleId 
   * @return {Object}
   */
  getLabelPayload(sampleId) {
    const sample = Repository.findById('Samples', sampleId);
    if (!sample) throw new Error('Sample not found');
    const order = Repository.findById('Orders', sample.order_id);
    const patient = Repository.findOneByField('Patients', 'uhid', sample.uhid);

    return {
      barcode: sample.barcode,
      sampleId: sample.id,
      uhid: sample.uhid,
      patientName: sample.patient_name,
      ageGender: `${patient ? patient.age + (patient.age_unit ? patient.age_unit[0] : 'Y') : ''} / ${patient ? patient.gender[0] : ''}`,
      tube: sample.container_tube,
      sampleType: sample.sample_type,
      department: sample.department,
      orderNo: order ? order.order_no : '',
      date: Utils.formatDateTime(new Date())
    };
  },

  /**
   * Synchronizes parent Order status based on all child samples
   * @private
   */
  _syncOrderStatus(orderId) {
    const order = Repository.findById('Orders', orderId);
    if (!order) return;

    const samples = Repository.findByField('Samples', 'order_id', orderId).filter(s => s.status === 'Active');
    if (samples.length === 0) return;

    const allReceived = samples.every(s => s.collection_status === this.SAMPLE_STATUSES.RECEIVED || s.collection_status === this.SAMPLE_STATUSES.IN_PROCESS);
    const anyCollected = samples.some(s => s.collection_status === this.SAMPLE_STATUSES.COLLECTED);
    const anyRejected = samples.some(s => s.collection_status === this.SAMPLE_STATUSES.REJECTED);

    let nextOrderStatus = order.order_status;
    if (allReceived) {
      nextOrderStatus = 'In Process';
    } else if (anyRejected) {
      nextOrderStatus = 'Recollection Pending';
    } else if (anyCollected) {
      nextOrderStatus = 'Collected';
    }

    if (nextOrderStatus !== order.order_status) {
      order.order_status = nextOrderStatus;
      order.updated_at = Utils.getTimestamp();
      order.updated_by = SessionContext.getCurrentEmail();
      Repository.saveRow('Orders', order);
    }
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SampleService;
}

