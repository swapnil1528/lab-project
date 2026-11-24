/**
 * Laboratory Information System (LIS) - Reagent & Consumable Inventory Service
 * Manages Stock Levels, Lot Numbers, Expiry Tracking, and Low Stock Alerts
 */

// Node.js environment imports
if (typeof require !== 'undefined') {
  var Repository = require('./Repository.js');
  var Utils = require('./Utils.js');
  var { PERMISSIONS, SessionContext } = require('./Auth.js');
}

const InventoryService = {
  /**
   * Fetches full inventory catalog with stock status flags
   * @return {Array<Object>}
   */
  getInventoryList() {
    SessionContext.requirePermission(PERMISSIONS.INVENTORY_VIEW, 'View Inventory');

    const items = Repository.getTable('Inventory', false).filter(i => i.status !== 'Archived');
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + (30 * 24 * 60 * 60 * 1000));

    return items.map(item => {
      const stock = parseInt(item.current_stock, 10) || 0;
      const reorder = parseInt(item.min_reorder_level, 10) || 0;
      const expiryDate = item.expiry_date ? new Date(item.expiry_date) : null;

      const isLowStock = stock <= reorder;
      const isExpiringSoon = expiryDate && expiryDate <= thirtyDaysFromNow && expiryDate >= now;
      const isExpired = expiryDate && expiryDate < now;

      let alertStatus = 'Optimal';
      if (isExpired) alertStatus = 'Expired';
      else if (isLowStock) alertStatus = 'Low Stock';
      else if (isExpiringSoon) alertStatus = 'Expiring Soon';

      return {
        id: item.id,
        itemCode: item.item_code,
        name: item.name,
        category: item.category,
        unitOfMeasure: item.unit_of_measure,
        currentStock: stock,
        minReorderLevel: reorder,
        batchNumber: item.batch_number,
        expiryDate: item.expiry_date,
        supplierName: item.supplier_name,
        lastRestockedAt: item.last_restocked_at,
        status: item.status,
        alertStatus: alertStatus,
        isLowStock: isLowStock,
        isExpiringSoon: isExpiringSoon,
        isExpired: isExpired
      };
    });
  },

  /**
   * Adjusts stock quantity (Add receipt / Deduct usage)
   * @param {string} itemId 
   * @param {number} delta - Positive for restock, negative for consumption
   * @param {string} reason 
   * @return {Object}
   */
  adjustStock(itemId, delta, reason = 'Routine Consumption') {
    SessionContext.requirePermission(PERMISSIONS.INVENTORY_MANAGE, 'Adjust Inventory Stock');

    const item = Repository.findById('Inventory', itemId);
    if (!item) throw new Error('Inventory item not found: ' + itemId);

    const current = parseInt(item.current_stock, 10) || 0;
    const newQty = Math.max(0, current + delta);
    const now = Utils.getTimestamp();
    const userEmail = SessionContext.getCurrentEmail();

    item.current_stock = newQty;
    if (delta > 0) {
      item.last_restocked_at = now;
    }
    item.updated_at = now;
    item.updated_by = userEmail;

    Repository.saveRow('Inventory', item);

    Repository.logAudit('UPDATE', 'Inventory', item.item_code, {
      previousStock: current,
      change: delta,
      newStock: newQty,
      reason: reason
    });

    return {
      status: 'SUCCESS',
      itemCode: item.item_code,
      name: item.name,
      newStock: newQty,
      message: `Stock for ${item.name} updated to ${newQty} ${item.unit_of_measure}.`
    };
  },

  /**
   * Checks for low stock & expiring reagents and dispatches alert email
   * @return {Object}
   */
  checkLowStockAndAlert() {
    const list = this.getInventoryList();
    const lowStockItems = list.filter(i => i.isLowStock || i.isExpired || i.isExpiringSoon);

    if (lowStockItems.length === 0) {
      return { alertsFound: 0, message: 'All reagent and consumable stock levels optimal.' };
    }

    const settings = Repository.getTable('Settings', true);
    const labEmail = (settings.find(s => s.key === 'LAB_EMAIL') || {}).value || 'admin@arogyalabs.in';
    const labName = (settings.find(s => s.key === 'LAB_NAME') || {}).value || 'Arogya Diagnostic Laboratory';

    let emailBody = `ATTENTION: Reagent & Consumable Inventory Alert - ${labName}\n\n`;
    emailBody += `The following ${lowStockItems.length} items require immediate restocking or lot replacement:\n\n`;

    for (const item of lowStockItems) {
      emailBody += `- [${item.itemCode}] ${item.name} (${item.category})\n`
        + `  Current Stock: ${item.currentStock} ${item.unitOfMeasure} (Min Threshold: ${item.minReorderLevel})\n`
        + `  Batch: ${item.batchNumber} | Expiry: ${item.expiryDate}\n`
        + `  Alert Condition: ${item.alertStatus.toUpperCase()}\n\n`;
    }

    emailBody += `Please reorder immediately to avoid diagnostic testing delays.\n\nAutomated System Notification\n${labName}`;

    if (typeof MailApp !== 'undefined') {
      try {
        MailApp.sendEmail({
          to: labEmail,
          subject: `CRITICAL: Reagent Low Stock Alert (${lowStockItems.length} items) - ${labName}`,
          body: emailBody
        });
      } catch (err) {
        console.error('Inventory Alert Mail Failed:', err);
      }
    }

    return {
      alertsFound: lowStockItems.length,
      alertItems: lowStockItems,
      recipient: labEmail,
      message: `${lowStockItems.length} inventory alert notifications generated.`
    };
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = InventoryService;
}
