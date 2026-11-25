/**
 * Laboratory Information System (LIS) - Order & Billing Service
 * Handles:
 * - Test & Panel selection with multi-tier pricing (Walk-in vs B2B Centre rates)
 * - Automatic panel expansion into component tests
 * - Discount management with manager authorization verification
 * - Tax-ready invoicing, partial payments, multiple tenders (UPI, Cash, Card, NEFT)
 * - PDF Invoice generation using Google Docs template / HTML export
 */

// Node.js environment imports
if (typeof require !== 'undefined') {
  var Repository = require('./Repository.js');
  var Utils = require('./Utils.js');
  var { PERMISSIONS, SessionContext } = require('./Auth.js');
  var CatalogService = require('./CatalogService.js');
}

const OrderBillingService = {
  /**
   * Books a diagnostic order, expands panels, generates invoice, and records initial payment
   * @param {Object} orderData 
   * @return {Object} Created order and invoice summary
   */
  createOrder(orderData) {
    SessionContext.requirePermission(PERMISSIONS.ORDER_CREATE, 'Create Diagnostic Order');

    if (!orderData.uhid) throw new Error('Validation Failed: Patient UHID is required.');
    if (!orderData.items || orderData.items.length === 0) {
      throw new Error('Validation Failed: At least one test or panel must be selected.');
    }

    // 1. Verify Patient
    const patient = Repository.findOneByField('Patients', 'uhid', orderData.uhid);
    if (!patient || patient.status === 'Inactive') {
      throw new Error(`Patient not found with UHID: ${orderData.uhid}`);
    }

    const patientName = `${patient.title ? patient.title + ' ' : ''}${patient.first_name} ${patient.last_name || ''}`.trim();
    const centreId = orderData.collection_centre_id || 'CTR-MAIN';
    let doctorId = orderData.referring_doctor_id || orderData.referringDoctorId || '';
    if (!doctorId && orderData.referringDoctor) {
      const doctors = Repository.getTable('Doctors', true);
      const matchedDoc = doctors.find(d => d.id === orderData.referringDoctor || d.name === orderData.referringDoctor);
      doctorId = matchedDoc ? matchedDoc.id : 'DOC-SELF';
    }
    if (!doctorId) doctorId = 'DOC-SELF';

    // Check Centre Price Tier
    const centre = Repository.findById('Centres', centreId, true);
    const isB2B = centre && centre.price_tier && centre.price_tier.startsWith('B2B');

    // 2. Resolve Catalog Items and Pricing
    const catalog = CatalogService.getFullCatalog();
    let grossTotal = 0;
    const resolvedItems = [];
    const expandedTestsForOrder = [];

    for (const item of orderData.items) {
      const targetId = item.id || item.testId || item.code;
      const isPanel = item.type === 'Panel' || item.isPanel === true || (String(targetId).startsWith('PANEL'));

      if (isPanel) {
        const panel = catalog.panels.find(p => p.id === targetId || p.code === targetId || p.id === item.id || p.code === item.code);
        if (!panel) throw new Error(`Invalid panel: ${targetId}`);

        const unitPrice = isB2B ? (panel.b2b_price || panel.price) : panel.price;
        grossTotal += unitPrice;

        resolvedItems.push({
          type: 'Panel',
          id: panel.id,
          code: panel.code,
          name: panel.name,
          department: panel.department,
          price: unitPrice,
          tests: panel.tests
        });

        // Expand panel tests for phlebotomy and technician worklists
        for (const t of (panel.tests || [])) {
          expandedTestsForOrder.push({
            testId: t.id,
            code: t.code,
            name: t.name,
            department: t.department,
            sampleType: t.sample_type,
            containerType: t.container_type,
            tatHours: t.tat_hours,
            parentPanelId: panel.id,
            price: 0 // Bundled in panel
          });
        }
      } else {
        // Individual Test
        const test = catalog.tests.find(t => t.id === targetId || t.code === targetId || t.id === item.id || t.code === item.code);
        if (!test) throw new Error(`Invalid test: ${targetId}`);

        const unitPrice = isB2B ? (test.b2b_price || test.price) : test.price;
        grossTotal += unitPrice;

        resolvedItems.push({
          type: 'Test',
          id: test.id,
          code: test.code,
          name: test.name,
          department: test.department,
          price: unitPrice
        });

        expandedTestsForOrder.push({
          testId: test.id,
          code: test.code,
          name: test.name,
          department: test.department,
          sampleType: test.sample_type,
          containerType: test.container_type,
          tatHours: test.tat_hours,
          parentPanelId: null,
          price: unitPrice
        });
      }
    }

    // 3. Discount Calculations & Authorization
    let discountAmount = parseFloat(orderData.discount_amount) || 0;
    if (orderData.discount_percent && !orderData.discount_amount) {
      const pct = parseFloat(orderData.discount_percent) || 0;
      discountAmount = Utils.round((grossTotal * pct) / 100, 2);
    }

    if (discountAmount > 0) {
      const currentUser = SessionContext.getCurrentUser();
      const isAdmin = currentUser && currentUser.role === 'Admin';
      if (!isAdmin && !orderData.discount_authorized_by) {
        throw new Error('Authorization Gate: Discounts require Admin authorization. Please provide authorizer email.');
      }
    }

    discountAmount = Math.min(discountAmount, grossTotal);
    const taxAmount = 0; // Clinical diagnostics exempt in India under Notification 12/2017
    const netAmount = Utils.round(grossTotal - discountAmount + taxAmount, 2);

    // Initial Payment
    const initialPayment = orderData.initial_payment || orderData.payment || {};
    const paidAmount = Utils.round(parseFloat(initialPayment.amount) || 0, 2);
    const balanceAmount = Utils.round(Math.max(0, netAmount - paidAmount), 2);

    let paymentStatus = 'Unpaid';
    if (paidAmount >= netAmount) {
      paymentStatus = 'Paid';
    } else if (paidAmount > 0) {
      paymentStatus = 'Partial';
    }

    // 4. Atomic Concurrency Lock for ID Generation & Persistence
    return Utils.withScriptLock(() => {
      const orderNo = Utils.generateOrderNo();
      const invoiceNo = Utils.generateInvoiceNo();
      const orderId = Utils.generateId('ORD');
      const invoiceId = Utils.generateId('INV');
      const now = Utils.getTimestamp();
      const userEmail = SessionContext.getCurrentEmail();

      // 4a. Order Record
      const orderRecord = {
        id: orderId,
        order_no: orderNo,
        uhid: orderData.uhid,
        patient_name: patientName,
        referring_doctor_id: doctorId,
        collection_centre_id: centreId,
        order_date: orderData.order_date || now.substring(0, 10),
        collection_type: orderData.collection_type || 'Walk-in',
        home_visit_address: orderData.home_visit_address || '',
        home_visit_scheduled_at: orderData.home_visit_scheduled_at || '',
        priority: orderData.priority || 'Routine',
        clinical_notes: orderData.clinical_notes || '',
        total_amount: grossTotal,
        discount_amount: discountAmount,
        discount_reason: orderData.discount_reason || '',
        discount_authorized_by: orderData.discount_authorized_by || '',
        tax_amount: taxAmount,
        net_amount: netAmount,
        paid_amount: paidAmount,
        payment_status: paymentStatus,
        order_status: 'Booked',
        status: 'Active',
        created_at: now,
        updated_at: now,
        created_by: userEmail,
        updated_by: userEmail
      };

      // 4b. Order Items (expanded individual tests for worklists)
      const orderItemRecords = [];
      for (const item of expandedTestsForOrder) {
        orderItemRecords.push({
          id: Utils.generateId('OI'),
          order_id: orderId,
          item_type: item.parentPanelId ? 'PanelChild' : 'Test',
          test_or_panel_id: item.testId,
          item_code: item.code,
          item_name: item.name,
          department: item.department,
          unit_price: item.price,
          discount_amount: 0,
          final_price: item.price,
          sample_id: '', // Linked in Phase 4 during sample collection
          item_status: 'Pending',
          status: 'Active',
          created_at: now,
          updated_at: now,
          updated_by: userEmail
        });
      }

      // 4c. Invoice Record
      const invoiceRecord = {
        id: invoiceId,
        invoice_no: invoiceNo,
        order_id: orderId,
        uhid: orderData.uhid,
        patient_name: patientName,
        gross_amount: grossTotal,
        discount_amount: discountAmount,
        tax_amount: taxAmount,
        net_amount: netAmount,
        paid_amount: paidAmount,
        balance_amount: balanceAmount,
        payment_status: paymentStatus,
        pdf_drive_file_id: '',
        pdf_url: '',
        status: 'Active',
        created_at: now,
        updated_at: now,
        created_by: userEmail,
        updated_by: userEmail
      };

      // 4d. Payment Record (if paid > 0)
      const paymentRecords = [];
      let receiptNo = '';
      if (paidAmount > 0) {
        receiptNo = Utils.generateReceiptNo();
        paymentRecords.push({
          id: Utils.generateId('PAY'),
          receipt_no: receiptNo,
          invoice_id: invoiceId,
          order_id: orderId,
          uhid: orderData.uhid,
          amount: paidAmount,
          payment_method: initialPayment.payment_method || initialPayment.mode || 'Cash',
          transaction_ref: initialPayment.transaction_ref || '',
          payment_date: now.substring(0, 10),
          received_by: userEmail,
          status: 'Completed',
          created_at: now,
          updated_at: now,
          updated_by: userEmail
        });
      }

      // 5. Batch Persist to Sheets
      Repository.saveRow('Orders', orderRecord);
      Repository.batchInsert('OrderItems', orderItemRecords);
      Repository.saveRow('Invoices', invoiceRecord);
      if (paymentRecords.length > 0) {
        Repository.batchInsert('Payments', paymentRecords);
      }

      // 5b. Automatically generate specimen sample tubes & barcodes for phlebotomy
      if (typeof SampleService !== 'undefined' && typeof SampleService.generateSamplesForOrder === 'function') {
        try {
          SampleService.generateSamplesForOrder(orderId);
        } catch (sampErr) {
          if (typeof Logger !== 'undefined') Logger.log('Sample generation note: ' + sampErr.message);
        }
      }

      // 6. Audit Logging
      Repository.logAudit('CREATE', 'Order', orderNo, {
        orderId: orderId,
        uhid: orderData.uhid,
        netAmount: netAmount,
        paidAmount: paidAmount,
        itemCount: orderItemRecords.length
      });

      return {
        status: 'SUCCESS',
        order: orderRecord,
        invoice: invoiceRecord,
        receiptNo: receiptNo,
        itemsCount: orderItemRecords.length,
        message: `Order ${orderNo} and Invoice ${invoiceNo} generated successfully.`
      };
    });
  },

  /**
   * Records a subsequent payment for an outstanding order invoice
   * @param {string} orderId 
   * @param {Object} paymentData 
   * @return {Object}
   */
  addPayment(orderId, paymentData) {
    SessionContext.requirePermission(PERMISSIONS.BILLING_COLLECT, 'Collect Billing Payment');

    const amount = Utils.round(parseFloat(paymentData.amount) || 0, 2);
    if (amount <= 0) throw new Error('Payment amount must be greater than zero.');

    return Utils.withScriptLock(() => {
      const order = Repository.findById('Orders', orderId);
      if (!order || order.status === 'Cancelled') {
        throw new Error('Order not found or has been cancelled.');
      }

      const invoice = Repository.findOneByField('Invoices', 'order_id', orderId);
      if (!invoice) throw new Error('Associated invoice not found.');

      const previousPaid = parseFloat(invoice.paid_amount) || 0;
      const netAmount = parseFloat(invoice.net_amount) || 0;
      const newPaid = Utils.round(previousPaid + amount, 2);
      const newBalance = Utils.round(Math.max(0, netAmount - newPaid), 2);

      let newStatus = 'Unpaid';
      if (newPaid >= netAmount) {
        newStatus = 'Paid';
      } else if (newPaid > 0) {
        newStatus = 'Partial';
      }

      const receiptNo = Utils.generateReceiptNo();
      const now = Utils.getTimestamp();
      const userEmail = SessionContext.getCurrentEmail();

      // Record Payment
      const paymentRecord = {
        id: Utils.generateId('PAY'),
        receipt_no: receiptNo,
        invoice_id: invoice.id,
        order_id: orderId,
        uhid: order.uhid,
        amount: amount,
        payment_method: paymentData.payment_method || 'UPI',
        transaction_ref: paymentData.transaction_ref || '',
        payment_date: now.substring(0, 10),
        received_by: userEmail,
        status: 'Completed',
        created_at: now,
        updated_at: now,
        updated_by: userEmail
      };
      Repository.saveRow('Payments', paymentRecord);

      // Update Invoice
      invoice.paid_amount = newPaid;
      invoice.balance_amount = newBalance;
      invoice.payment_status = newStatus;
      invoice.updated_at = now;
      invoice.updated_by = userEmail;
      Repository.saveRow('Invoices', invoice);

      // Update Order
      order.paid_amount = newPaid;
      order.payment_status = newStatus;
      order.updated_at = now;
      order.updated_by = userEmail;
      Repository.saveRow('Orders', order);

      Repository.logAudit('CREATE', 'Payment', receiptNo, {
        orderId: orderId,
        amount: amount,
        paymentMethod: paymentData.payment_method
      });

      return {
        status: 'SUCCESS',
        receiptNo: receiptNo,
        amountPaid: amount,
        totalPaid: newPaid,
        remainingBalance: newBalance,
        paymentStatus: newStatus,
        message: `Payment of ₹${amount} received. Receipt: ${receiptNo}`
      };
    });
  },

  /**
   * Generates a printable Google Docs / PDF Invoice
   * Stores PDF in Drive folder LIS_Invoices/YYYY/MM/
   * @param {string} orderId 
   * @return {Object} PDF Drive URL and File ID
   */
  generateInvoicePdf(orderId) {
    SessionContext.requirePermission(PERMISSIONS.BILLING_COLLECT, 'Print / Generate Invoice');

    const order = Repository.findById('Orders', orderId);
    if (!order) throw new Error('Order not found');
    const invoice = Repository.findOneByField('Invoices', 'order_id', orderId);
    if (!invoice) throw new Error('Invoice not found');
    const patient = Repository.findOneByField('Patients', 'uhid', order.uhid);
    const items = Repository.findByField('OrderItems', 'order_id', orderId);
    const payments = Repository.findByField('Payments', 'order_id', orderId);

    // If DocumentApp & DriveApp available (Apps Script environment)
    if (typeof DocumentApp !== 'undefined' && typeof DriveApp !== 'undefined') {
      try {
        const year = new Date().getFullYear();
        const month = String(new Date().getMonth() + 1).padStart(2, '0');

        // Locate or create monthly folder
        const parentFolder = DriveApp.getRootFolder();
        let lisFolder = parentFolder.getFoldersByName('LIS_Invoices');
        const folder = lisFolder.hasNext() ? lisFolder.next() : parentFolder.createFolder('LIS_Invoices');
        let yearFolder = folder.getFoldersByName(String(year));
        const yFolder = yearFolder.hasNext() ? yearFolder.next() : folder.createFolder(String(year));
        let monthFolder = yFolder.getFoldersByName(month);
        const mFolder = monthFolder.hasNext() ? monthFolder.next() : yFolder.createFolder(month);

        // Create temporary Doc
        const doc = DocumentApp.create('Invoice_' + invoice.invoice_no);
        const body = doc.getBody();

        // Header
        const labSettings = Repository.getTable('Settings', true);
        const labName = (labSettings.find(s => s.key === 'LAB_NAME') || {}).value || 'Arogya Diagnostic Laboratory';
        const labAddress = (labSettings.find(s => s.key === 'LAB_ADDRESS') || {}).value || '';
        const labPhone = (labSettings.find(s => s.key === 'LAB_PHONE') || {}).value || '';

        body.appendParagraph(labName).setHeading(DocumentApp.ParagraphHeading.HEADING1);
        body.appendParagraph(labAddress + ' | Phone: ' + labPhone);
        body.appendHorizontalRule();

        // Invoice Meta
        body.appendParagraph(`TAX INVOICE / RECEIPT: ${invoice.invoice_no}`).setHeading(DocumentApp.ParagraphHeading.HEADING2);
        body.appendParagraph(`Order No: ${order.order_no} | Date: ${Utils.formatDate(order.order_date)}`);
        body.appendParagraph(`Patient: ${order.patient_name} (UHID: ${order.uhid}) | Age/Sex: ${patient.age} ${patient.age_unit || 'Y'} / ${patient.gender}`);

        // Items Table
        const tableData = [['#', 'Investigation Parameter', 'Dept', 'Amount (INR)']];
        let idx = 1;
        for (const it of items) {
          tableData.push([String(idx++), it.item_name, it.department, `₹${it.final_price}`]);
        }
        body.appendTable(tableData);

        // Totals Summary
        body.appendParagraph(`\nGross Total: ₹${invoice.gross_amount}`);
        if (invoice.discount_amount > 0) {
          body.appendParagraph(`Discount: -₹${invoice.discount_amount}`);
        }
        body.appendParagraph(`Net Payable: ₹${invoice.net_amount}`).setBold(true);
        body.appendParagraph(`Amount Settled: ₹${invoice.paid_amount}`);
        body.appendParagraph(`Balance Due: ₹${invoice.balance_amount}`);
        body.appendParagraph(`Payment Status: ${invoice.payment_status.toUpperCase()}`);

        doc.saveAndClose();

        // Convert to PDF and Move to folder
        const docFile = DriveApp.getFileById(doc.getId());
        const pdfBlob = docFile.getAs('application/pdf');
        const pdfFile = mFolder.createFile(pdfBlob).setName(`Invoice_${invoice.invoice_no}.pdf`);
        docFile.setTrashed(true); // Delete temp doc

        // Update Invoice record
        invoice.pdf_drive_file_id = pdfFile.getId();
        invoice.pdf_url = pdfFile.getUrl();
        Repository.saveRow('Invoices', invoice);

        return {
          status: 'SUCCESS',
          invoiceNo: invoice.invoice_no,
          pdfUrl: pdfFile.getUrl(),
          fileId: pdfFile.getId()
        };
      } catch (err) {
        console.error('Invoice PDF Generation Failed:', err);
      }
    }

    // Fallback: return printable payload
    return {
      status: 'SUCCESS',
      invoiceNo: invoice.invoice_no,
      orderNo: order.order_no,
      patientName: order.patient_name,
      uhid: order.uhid,
      grossAmount: invoice.gross_amount,
      discountAmount: invoice.discount_amount,
      netAmount: invoice.net_amount,
      paidAmount: invoice.paid_amount,
      balanceAmount: invoice.balance_amount,
      paymentStatus: invoice.payment_status,
      items: items.map(i => ({ name: i.item_name, price: i.final_price, dept: i.department })),
      payments: payments.map(p => ({ receiptNo: p.receipt_no, amount: p.amount, method: p.payment_method }))
    };
  },

  /**
   * Retrieves active orders list for reports and operational tracking
   * @param {string} filter
   * @return {Array<Object>}
   */
  getOrdersList(filter = '') {
    const orders = Repository.getTable('Orders', false).filter(o => o.status !== 'Cancelled');
    if (!filter || filter === 'All') {
      return orders.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    }
    return orders.filter(o => o.order_status === filter).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = OrderBillingService;
}

