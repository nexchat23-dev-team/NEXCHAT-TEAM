// ======= ADMIN DASHBOARD - ENHANCED SECURITY & PERMISSION SYSTEM =======

import { auth, db } from "./firebase-config.js";
import { 
  collection, doc, getDocs, updateDoc, deleteDoc, query, where,
  onSnapshot, serverTimestamp, addDoc, getDoc
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// ======= ROLE-BASED ACCESS CONTROL (RBAC) SYSTEM =======

class AdminSecurityManager {
  constructor() {
    this.adminRoles = {
      'super-admin': {
        permissions: ['ALL'],
        description: 'Full system access'
      },
      'admin': {
        permissions: [
          'manage_users', 
          'manage_reports', 
          'manage_admins', 
          'view_logs',
          'manage_tokens',
          'manage_messages',
          'manage_videos',
          'manage_announcements',
          'view_analytics'
        ],
        description: 'Standard admin access'
      },
      'moderator': {
        permissions: [
          'manage_users',
          'manage_reports',
          'view_logs',
          'manage_messages'
        ],
        description: 'Moderation access only'
      },
      'analyst': {
        permissions: [
          'view_logs',
          'view_analytics'
        ],
        description: 'View-only analytics access'
      }
    };

    this.permissionCache = new Map();
    this.sessionTimeout = 24 * 60 * 60 * 1000; // 24 hours
    this.activityTimeout = 30 * 60 * 1000; // 30 minutes of inactivity
    this.lastActivityTime = Date.now();
  }

  // Check if admin has required permission
  hasPermission(adminRole, requiredPermission) {
    if (adminRole === 'super-admin') return true;
    
    const role = this.adminRoles[adminRole];
    if (!role) return false;
    
    return role.permissions.includes(requiredPermission) || 
           role.permissions.includes('ALL');
  }

  // Check if admin can perform action
  canPerformAction(action) {
    const adminRole = this.getAdminRole();
    if (!adminRole) return false;
    
    return this.hasPermission(adminRole, action);
  }

  // Get admin role from session
  getAdminRole() {
    return localStorage.getItem('adminRole') || 'admin';
  }

  // Verify session validity
  verifySession() {
    const adminToken = localStorage.getItem('adminToken');
    const adminEmail = localStorage.getItem('adminEmail');
    const tokenTimestamp = localStorage.getItem('tokenTimestamp');
    const lastActivity = localStorage.getItem('lastActivityTime');

    // Check if token expired (24 hours)
    if (tokenTimestamp && Date.now() - parseInt(tokenTimestamp) > this.sessionTimeout) {
      this.invalidateSession();
      return false;
    }

    // Check for inactivity (30 minutes)
    if (lastActivity && Date.now() - parseInt(lastActivity) > this.activityTimeout) {
      this.invalidateSession('Session expired due to inactivity');
      return false;
    }

    // Token and email must exist
    if (!adminToken || !adminEmail) {
      return false;
    }

    // Update last activity
    this.updateActivity();
    return true;
  }

  // Update last activity timestamp
  updateActivity() {
    localStorage.setItem('lastActivityTime', Date.now().toString());
    this.lastActivityTime = Date.now();
  }

  // Invalidate session
  invalidateSession(reason = 'Session expired') {
    console.warn(`[SECURITY] ${reason}`);
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminEmail');
    localStorage.removeItem('adminRole');
    localStorage.removeItem('tokenTimestamp');
    localStorage.removeItem('lastActivityTime');
  }

  // Create admin session
  createSession(email, role = 'admin', expiresIn = this.sessionTimeout) {
    const token = this.generateSecureToken();
    const timestamp = Date.now();

    localStorage.setItem('adminToken', token);
    localStorage.setItem('adminEmail', email);
    localStorage.setItem('adminRole', role);
    localStorage.setItem('tokenTimestamp', timestamp.toString());
    localStorage.setItem('lastActivityTime', timestamp.toString());
    localStorage.setItem('sessionExpiresAt', (timestamp + expiresIn).toString());

    this.logSecurityEvent('SESSION_CREATED', email, `Role: ${role}`);
    return token;
  }

  // Generate secure token
  generateSecureToken() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  // Validate admin credentials
  async validateAdmin(email, role) {
    try {
      // Check in Firestore for admin records
      const adminQuery = query(
        collection(db, 'admins'),
        where('email', '==', email)
      );
      
      const adminDocs = await getDocs(adminQuery);
      
      if (adminDocs.empty) {
        this.logSecurityEvent('INVALID_ADMIN', email, 'Admin record not found');
        return false;
      }

      const adminDoc = adminDocs.docs[0].data();
      
      // Check if admin is active
      if (!adminDoc.isActive) {
        this.logSecurityEvent('INACTIVE_ADMIN', email, 'Admin account is inactive');
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error validating admin:', error);
      this.logSecurityEvent('VALIDATION_ERROR', email, error.message);
      return false;
    }
  }

  // Require permission decorator
  requirePermission(permission) {
    return (target, propertyKey, descriptor) => {
      const originalMethod = descriptor.value;

      descriptor.value = function(...args) {
        if (!this.canPerformAction(permission)) {
          const error = new Error(`Insufficient permission: ${permission} required`);
          error.code = 'INSUFFICIENT_PERMISSION';
          throw error;
        }
        return originalMethod.apply(this, args);
      };

      return descriptor;
    };
  }

  // Log security events to Firestore
  async logSecurityEvent(eventType, adminEmail, details = '') {
    try {
      await addDoc(collection(db, 'adminSecurityLogs'), {
        eventType: eventType,
        adminEmail: adminEmail,
        details: this.sanitizeInput(details),
        timestamp: serverTimestamp(),
        userAgent: navigator.userAgent.substring(0, 255),
        screenResolution: `${window.screen.width}x${window.screen.height}`,
        adminRole: this.getAdminRole()
      });

      console.log(`[SECURITY LOG] ${eventType}: ${details}`);
    } catch (error) {
      console.error('Failed to log security event:', error);
    }
  }

  // Sanitize input to prevent XSS
  sanitizeInput(input) {
    const div = document.createElement('div');
    div.textContent = input;
    return div.innerHTML;
  }

  // Request audit trail for admin actions
  async getAuditTrail(adminEmail = null, limit = 50) {
    try {
      let q;
      if (adminEmail) {
        q = query(
          collection(db, 'adminSecurityLogs'),
          where('adminEmail', '==', adminEmail),
          orderBy('timestamp', 'desc'),
          limit(limit)
        );
      } else {
        q = query(
          collection(db, 'adminSecurityLogs'),
          orderBy('timestamp', 'desc'),
          limit(limit)
        );
      }

      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error('Error fetching audit trail:', error);
      return [];
    }
  }
}

// Create global security manager instance
const securityManager = new AdminSecurityManager();

// ======= EXPORT FOR USE IN OTHER MODULES =======
export { securityManager, AdminSecurityManager };
