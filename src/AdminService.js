/**
 * Laboratory Information System (LIS) - Admin & User Management Service
 * Manages Lab Profile, System Configuration, Staff Accounts, and Audit Log Queries
 */

// Node.js environment imports
if (typeof require !== 'undefined') {
  var Repository = require('./Repository.js');
  var Utils = require('./Utils.js');
  var { PERMISSIONS, SessionContext } = require('./Auth.js');
}

const AdminService = {
  /**
   * Fetches all system configuration key-values
   * @return {Array<Object>}
   */
  getSettings() {
    SessionContext.requirePermission(PERMISSIONS.SETTINGS_MANAGE, 'View Admin Settings');
    return Repository.getTable('Settings', false);
  },

  /**
   * Updates key-value settings in Settings sheet
   * @param {Object} settingsMap 
   * @return {Object}
   */
  updateSettings(settingsMap) {
    SessionContext.requirePermission(PERMISSIONS.SETTINGS_MANAGE, 'Update System Settings');

    const settings = Repository.getTable('Settings', false);
    const now = Utils.getTimestamp();
    const userEmail = SessionContext.getCurrentEmail();
    const updated = [];

    for (const key in settingsMap) {
      const val = String(settingsMap[key]);
      let record = settings.find(s => s.key === key);
      if (record) {
        record.value = val;
        record.updated_at = now;
        record.updated_by = userEmail;
        Repository.saveRow('Settings', record);
        updated.push(key);
      } else {
        const newRecord = {
          key: key,
          value: val,
          category: 'Custom',
          description: 'Custom configuration key',
          updated_at: now,
          updated_by: userEmail
        };
        Repository.saveRow('Settings', newRecord);
        updated.push(key);
      }
    }

    Repository.clearCache('Settings');
    Repository.logAudit('UPDATE', 'Settings', 'SYSTEM', { updatedKeys: updated });

    return {
      status: 'SUCCESS',
      updatedKeys: updated,
      message: `${updated.length} settings successfully updated.`
    };
  },

  /**
   * Returns list of staff users
   * @return {Array<Object>}
   */
  getUsersList() {
    SessionContext.requirePermission(PERMISSIONS.USER_MANAGE, 'View Users');
    return Repository.getTable('Users', false);
  },

  /**
   * Creates or updates a staff user account
   * @param {Object} userData 
   * @return {Object}
   */
  saveUser(userData) {
    SessionContext.requirePermission(PERMISSIONS.USER_MANAGE, 'Save User Account');

    if (!userData.email || !userData.email.includes('@')) {
      throw new Error('A valid Google user email address is required.');
    }
    if (!userData.role) {
      throw new Error('User role is required.');
    }

    const cleanEmail = userData.email.toLowerCase().trim();
    const existing = Repository.findOneByField('Users', 'email', cleanEmail);
    const now = Utils.getTimestamp();
    const adminEmail = SessionContext.getCurrentEmail();

    if (existing) {
      existing.full_name = userData.full_name || existing.full_name;
      existing.role = userData.role || existing.role;
      existing.department = userData.department || existing.department;
      existing.qualification = userData.qualification || existing.qualification;
      existing.signature_file_id = userData.signature_file_id || existing.signature_file_id;
      existing.status = userData.status || existing.status;
      existing.updated_at = now;
      existing.updated_by = adminEmail;

      Repository.saveRow('Users', existing);
      Repository.clearCache('Users');
      Repository.logAudit('UPDATE', 'User', cleanEmail, { role: existing.role, status: existing.status });

      return { status: 'SUCCESS', user: existing, message: `User [${cleanEmail}] updated successfully.` };
    } else {
      const newUser = {
        id: Utils.generateId('USR'),
        email: cleanEmail,
        full_name: userData.full_name || 'Staff Member',
        role: userData.role,
        department: userData.department || 'General',
        qualification: userData.qualification || '',
        signature_file_id: userData.signature_file_id || '',
        status: userData.status || 'Active',
        last_login_at: '',
        created_at: now,
        updated_at: now,
        updated_by: adminEmail
      };

      Repository.saveRow('Users', newUser);
      Repository.clearCache('Users');
      Repository.logAudit('CREATE', 'User', cleanEmail, { role: newUser.role });

      return { status: 'SUCCESS', user: newUser, message: `New user [${cleanEmail}] registered with role ${newUser.role}.` };
    }
  },

  /**
   * Retrieves paginated audit logs
   * @param {number} limit 
   * @param {number} offset 
   * @return {Object}
   */
  getAuditLogs(limit = 50, offset = 0) {
    SessionContext.requirePermission(PERMISSIONS.AUDIT_VIEW, 'View Audit Logs');

    const logs = Repository.getTable('AuditLog', false)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    const paged = logs.slice(offset, offset + limit);

    return {
      totalCount: logs.length,
      limit: limit,
      offset: offset,
      logs: paged
    };
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AdminService;
}

