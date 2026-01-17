import { auth, db } from "./firebase-config.js";
import { 
  collection, doc, getDocs, updateDoc, deleteDoc, query, where,
  onSnapshot, serverTimestamp, addDoc, getDoc, orderBy, limit, increment
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import {
  createUserWithEmailAndPassword, signOut, deleteUser as deleteAuthUser
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-storage.js";

const storage = getStorage();

function checkAdminAuth() {
  const adminToken = localStorage.getItem('adminToken');
  const adminEmail = localStorage.getItem('adminEmail');
  const tokenTimestamp = localStorage.getItem('tokenTimestamp');
  
  if (tokenTimestamp && Date.now() - parseInt(tokenTimestamp) > 24 * 60 * 60 * 1000) {
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminEmail');
    localStorage.removeItem('tokenTimestamp');
    window.location.href = 'index.html';
    return false;
  }
  
  if (!adminToken || !adminEmail) {
    window.location.href = 'index.html';
    return false;
  }
  
  return true;
}

if (!checkAdminAuth()) {
  throw new Error('Unauthorized access');
}

let currentAdminName = "Admin";
let selectedUserId = null;
let selectedReportId = null;
let allUsers = [];
let allReports = [];
let allBlockedUsers = [];
let allAdmins = [];


function sanitizeInput(input) {
  const div = document.createElement('div');
  div.textContent = input;
  return div.innerHTML;
}

function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  notification.style.position = 'fixed';
  notification.style.top = '20px';
  notification.style.right = '20px';
  notification.style.padding = '15px 20px';
  notification.style.borderRadius = '6px';
  notification.style.zIndex = '3000';
  notification.style.fontWeight = 'bold';
  notification.style.animation = 'slideInRight 0.3s ease';
  
  if (type === 'success') {
    notification.style.background = 'rgba(76, 175, 80, 0.9)';
    notification.style.color = '#fff';
  } else if (type === 'error') {
    notification.style.background = 'rgba(244, 67, 54, 0.9)';
    notification.style.color = '#fff';
  } else {
    notification.style.background = 'rgba(0, 255, 102, 0.9)';
    notification.style.color = '#000';
  }
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'slideOutRight 0.3s ease';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

function generateRandomPassword(length = 12) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

window.addEventListener('load', () => {
  if (!checkAdminAuth()) return;
  
  currentAdminName = localStorage.getItem('adminEmail') || 'Admin';
  document.getElementById('adminName').textContent = `${currentAdminName} (Admin)`;
  
  loadOverviewStats();
  setupTabNavigation();
  setupEventListeners();
  loadUsers();
});

function setupEventListeners() {
  // Logout
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to logout?')) {
        localStorage.removeItem('adminToken');
        localStorage.removeItem('adminEmail');
        localStorage.removeItem('tokenTimestamp');
        window.location.href = 'index.html';
      }
    });
  }

  // User search
  const searchInput = document.getElementById('userSearch');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const searchTerm = e.target.value.toLowerCase();
      const rows = document.querySelectorAll('#usersTableBody tr');
      
      rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(searchTerm) ? '' : 'none';
      });
    });
  }

  // Report filter
  const reportFilter = document.getElementById('reportFilter');
  if (reportFilter) {
    reportFilter.addEventListener('change', (e) => {
      filterReports(e.target.value);
    });
  }

  // Admin management
  const generatePasswordBtn = document.getElementById('generatePasswordBtn');
  if (generatePasswordBtn) {
    generatePasswordBtn.addEventListener('click', () => {
      const password = generateRandomPassword();
      document.getElementById('newAdminPassword').value = password;
      document.getElementById('passwordText').textContent = password;
      document.getElementById('generatedPassword').style.display = 'block';
    });
  }

  const copyPasswordBtn = document.getElementById('copyPasswordBtn');
  if (copyPasswordBtn) {
    copyPasswordBtn.addEventListener('click', () => {
      const password = document.getElementById('newAdminPassword').value;
      navigator.clipboard.writeText(password).then(() => {
        showNotification('✅ Password copied to clipboard', 'success');
      }).catch(() => {
        showNotification('❌ Failed to copy password', 'error');
      });
    });
  }

  const createAdminBtn = document.getElementById('createAdminBtn');
  if (createAdminBtn) {
    createAdminBtn.addEventListener('click', createNewAdmin);
  }

  // Modal close buttons
  document.querySelectorAll('.close-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const modal = e.target.closest('.modal');
      if (modal) modal.style.display = 'none';
    });
  });

  // Modal background click
  window.addEventListener('click', (e) => {
    const userModal = document.getElementById('userActionModal');
    const reportModal = document.getElementById('reportModal');
    
    if (e.target === userModal) userModal.style.display = 'none';
    if (e.target === reportModal) reportModal.style.display = 'none';
  });

  // User action modal buttons
  const viewUserBtn = document.getElementById('viewUserBtn');
  const blockUserBtn = document.getElementById('blockUserBtn');
  const unblockUserBtn = document.getElementById('unblockUserBtn');
  const deleteUserBtn = document.getElementById('deleteUserBtn');
  
  if (viewUserBtn) viewUserBtn.addEventListener('click', viewUserProfile);
  if (blockUserBtn) blockUserBtn.addEventListener('click', blockSelectedUser);
  if (unblockUserBtn) unblockUserBtn.addEventListener('click', unblockSelectedUser);
  if (deleteUserBtn) deleteUserBtn.addEventListener('click', deleteSelectedUser);

  // Report modal buttons
  const markResolvedBtn = document.getElementById('markResolvedBtn');
  const blockReporterBtn = document.getElementById('blockReporterBtn');
  const blockReportedBtn = document.getElementById('blockReportedBtn');
  
  if (markResolvedBtn) markResolvedBtn.addEventListener('click', () => handleReport(selectedReportId, 'resolved'));
  if (blockReporterBtn) blockReporterBtn.addEventListener('click', blockReporter);
  if (blockReportedBtn) blockReportedBtn.addEventListener('click', blockReportedUser);

  // Settings buttons
  document.querySelectorAll('.setting-btn').forEach(btn => {
    btn.addEventListener('click', handleSettingsActions);
  });

  // Mint tokens button
  const mintBtn = document.getElementById('mintTokensBtn');
  if (mintBtn) {
    mintBtn.addEventListener('click', async () => {
      try {
        mintBtn.disabled = true;
        mintBtn.textContent = '⏳ Minting...';
        await mintTokens();
      } finally {
        mintBtn.disabled = false;
        mintBtn.textContent = '🚀 Mint Tokens';
      }
    });
  }
}

// Mint tokens to a user (admin only - requires admin auth present in localStorage)
async function mintTokens() {
  const recipientUID = (document.getElementById('mintRecipientUID')?.value || '').trim();
  const amountRaw = document.getElementById('mintAmount')?.value;
  const note = (document.getElementById('mintNote')?.value || '').trim();
  const resultDiv = document.getElementById('mintResult');

  if (!recipientUID) {
    showNotification('Recipient UID is required', 'error');
    if (resultDiv) { resultDiv.style.display = 'block'; resultDiv.textContent = 'Recipient UID is required'; resultDiv.style.background = 'rgba(244,67,54,0.06)'; }
    return;
  }

  const amount = parseInt(amountRaw, 10);
  if (!amount || amount <= 0) {
    showNotification('Enter a valid token amount', 'error');
    if (resultDiv) { resultDiv.style.display = 'block'; resultDiv.textContent = 'Enter a valid token amount'; resultDiv.style.background = 'rgba(244,67,54,0.06)'; }
    return;
  }

  try {
    const userRef = doc(db, 'users', recipientUID);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      showNotification('Recipient user not found', 'error');
      if (resultDiv) { resultDiv.style.display = 'block'; resultDiv.textContent = 'Recipient user not found'; resultDiv.style.background = 'rgba(244,67,54,0.06)'; }
      return;
    }

    // Update user's token balance atomically
    await updateDoc(userRef, { tokens: increment(amount) });

    // Log the transaction
    await addDoc(collection(db, 'tokenTransactions'), {
      admin: currentAdminName || localStorage.getItem('adminEmail') || 'admin',
      recipientUID,
      amount,
      note: note || null,
      type: 'mint',
      createdAt: serverTimestamp()
    });

    showNotification(`✅ Minted ${amount} tokens to ${recipientUID}`, 'success');
    if (resultDiv) { resultDiv.style.display = 'block'; resultDiv.textContent = `✅ Minted ${amount} tokens to ${recipientUID}`; resultDiv.style.background = 'rgba(76,175,80,0.06)'; }

    // Clear inputs
    document.getElementById('mintRecipientUID').value = '';
    document.getElementById('mintAmount').value = '';
    document.getElementById('mintNote').value = '';
  } catch (error) {
    console.error('Error minting tokens:', error);
    showNotification('Error minting tokens: ' + error.message, 'error');
    if (resultDiv) { resultDiv.style.display = 'block'; resultDiv.textContent = 'Error: ' + error.message; resultDiv.style.background = 'rgba(244,67,54,0.06)'; }
  }
}

// Quick console helper to test minting (admin must be authenticated in localStorage)
window.testMint = async function(recipientUID, amount = 100, note = 'test') {
  document.getElementById('mintRecipientUID').value = recipientUID;
  document.getElementById('mintAmount').value = amount;
  document.getElementById('mintNote').value = note;
  return await mintTokens();
};

function setupTabNavigation() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.getAttribute('data-tab');
      
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      
      btn.classList.add('active');
      document.getElementById(tabName).classList.add('active');
      
      if (tabName === 'users') loadUsers();
      if (tabName === 'gmail') loadGmailUsers();
      if (tabName === 'reports') loadReports();
      if (tabName === 'blocked') loadBlockedUsers();
      if (tabName === 'admins') loadAdmins();
      if (tabName === 'watchReels') loadWatchReels();
      if (tabName === 'postReels') initPostReels();
      if (tabName === 'analytics') initAnalytics();
      if (tabName === 'tokens') initTokenMinting();
    });
  });
}

function loadOverviewStats() {
  try {
    // Load users count - real-time
    onSnapshot(collection(db, 'users'), (snapshot) => {
      document.getElementById('totalUsers').textContent = snapshot.size;
    });
    
    // Load messages count - real-time
    onSnapshot(collection(db, 'messages'), (snapshot) => {
      document.getElementById('totalMessages').textContent = snapshot.size;
    });
    
    // Load videos count (NEX-REELS) - real-time
    onSnapshot(collection(db, 'videos'), (snapshot) => {
      document.getElementById('totalVideos').textContent = snapshot.size;
    });
    
    // Load pending reports - real-time
    onSnapshot(query(collection(db, 'reports'), where('status', '==', 'pending')), (snapshot) => {
      document.getElementById('pendingReports').textContent = snapshot.size;
    });
    
    // Load blocked users - real-time
    onSnapshot(query(collection(db, 'users'), where('blockedUsers', '!=', [])), (snapshot) => {
      document.getElementById('blockedCount').textContent = snapshot.size;
    });
    
    console.log('✅ Overview stats set to real-time updates');
  } catch (error) {
    console.error('Error setting up overview stats listener:', error);
  }
}

function loadUsers() {
  const tbody = document.getElementById('usersTableBody');
  tbody.innerHTML = '<tr class="loading"><td colspan="6">Loading users...</td></tr>';
  
  try {
    // Use onSnapshot for real-time updates
    onSnapshot(collection(db, 'users'), (snapshot) => {
      allUsers = [];
      tbody.innerHTML = '';
      
      snapshot.forEach(doc => {
        const user = { id: doc.id, ...doc.data() };
        allUsers.push(user);
        
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>
            <div class="user-profile">
              <span style="font-size: 1.5rem;">${user.profilePic || user.profilePicUrl || '👤'}</span>
              <strong>${sanitizeInput(user.username || user.name || 'Unknown')}</strong>
            </div>
          </td>
          <td>${sanitizeInput(user.username || user.name || 'N/A')}</td>
          <td>${sanitizeInput(user.email || 'N/A')}</td>
          <td><span class="status-badge ${user.online ? 'online' : 'offline'}">${user.online ? 'ONLINE' : 'OFFLINE'}</span></td>
          <td>${user.createdAt ? new Date(user.createdAt.toDate?.() || user.createdAt).toLocaleDateString() : 'N/A'}</td>
          <td>
            <button class="action-btn view-btn" onclick="showUserModal('${doc.id}')">👁️ View</button>
            <button class="action-btn warn-btn" onclick="toggleBlockUser('${doc.id}')">🚫 Block</button>
          </td>
        `;
        tbody.appendChild(row);
      });
      
      if (allUsers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px;">No users found</td></tr>';
      }
    }, (error) => {
      console.error('Error loading users:', error);
      tbody.innerHTML = `<tr><td colspan="6" style="color: red;">Error loading users: ${error.message}</td></tr>`;
    });
  } catch (error) {
    console.error('Error setting up users listener:', error);
    tbody.innerHTML = `<tr><td colspan="6" style="color: red;">Error: ${error.message}</td></tr>`;
  }
}

async function loadGmailUsers() {
  const tbody = document.getElementById('gmailUsersTableBody');
  tbody.innerHTML = '<tr class="loading"><td colspan="7">Loading Gmail users...</td></tr>';
  
  try {
    const usersSnapshot = await getDocs(query(collection(db, 'users'), where('email', '!=', '')));
    const gmailUsers = [];
    
    usersSnapshot.forEach(doc => {
      const user = { id: doc.id, ...doc.data() };
      if (user.email && user.email.includes('@gmail.com')) {
        gmailUsers.push(user);
      }
    });
    
    gmailUsers.sort((a, b) => {
      const dateA = a.createdAt?.toDate?.() || new Date(a.createdAt);
      const dateB = b.createdAt?.toDate?.() || new Date(b.createdAt);
      return dateB - dateA;
    });
    
    const onlineCount = gmailUsers.filter(u => u.isOnline).length;
    document.getElementById('totalGmailUsers').textContent = gmailUsers.length;
    document.getElementById('gmailUsersOnline').textContent = onlineCount;
    
    tbody.innerHTML = '';
    gmailUsers.forEach(user => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>
          <div class="user-profile">
            <span style="font-size: 1.5rem;">📧</span>
            <strong>${sanitizeInput(user.username || user.displayName || 'Unknown')}</strong>
          </div>
        </td>
        <td>${sanitizeInput(user.username || user.displayName || 'N/A')}</td>
        <td>${sanitizeInput(user.email || 'N/A')}</td>
        <td><span class="status-badge ${user.isOnline ? 'online' : 'offline'}">${user.isOnline ? 'ONLINE' : 'OFFLINE'}</span></td>
        <td>${user.lastLogin ? new Date(user.lastLogin.toDate?.() || user.lastLogin).toLocaleString() : 'Never'}</td>
        <td>${user.createdAt ? new Date(user.createdAt.toDate?.() || user.createdAt).toLocaleDateString() : 'N/A'}</td>
        <td>
          <button class="action-btn view-btn" onclick="showUserModal('${user.id}')">👁️ View</button>
          <button class="action-btn ${user.isBlocked ? 'success-btn' : 'warn-btn'}" onclick="toggleBlockUser('${user.id}')">
            ${user.isBlocked ? '✅ Unblock' : '🚫 Block'}
          </button>
        </td>
      `;
      tbody.appendChild(row);
    });
    
    if (gmailUsers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px;">No Gmail users found</td></tr>';
    }
  } catch (error) {
    console.error('Error loading Gmail users:', error);
    tbody.innerHTML = `<tr><td colspan="7" style="color: red;">Error loading Gmail users: ${error.message}</td></tr>`;
  }
}

async function showUserModal(userId) {
  selectedUserId = userId;
  const user = allUsers.find(u => u.id === userId);
  
  if (!user) {
    try {
      const userDoc = await getDoc(doc(db, 'users', userId));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        displayUserModal(userId, userData);
      }
    } catch (error) {
      showNotification('Error loading user profile', 'error');
    }
    return;
  }
  
  displayUserModal(userId, user);
}

function displayUserModal(userId, user) {
  const modal = document.getElementById('userActionModal');
  const info = document.getElementById('userActionInfo');
  
  info.innerHTML = `
    <h4>${sanitizeInput(user.username || user.displayName || 'Unknown User')}</h4>
    <p><strong>Email:</strong> ${sanitizeInput(user.email || 'N/A')}</p>
    <p><strong>User ID:</strong> ${userId}</p>
    <p><strong>Account Status:</strong> ${user.isBlocked ? '🚫 BLOCKED' : '✅ ACTIVE'}</p>
    <p><strong>Joined:</strong> ${user.createdAt ? new Date(user.createdAt.toDate?.() || user.createdAt).toLocaleDateString() : 'N/A'}</p>
  `;
  
  const blockBtn = document.getElementById('blockUserBtn');
  const unblockBtn = document.getElementById('unblockUserBtn');
  
  if (user.isBlocked) {
    blockBtn.style.display = 'none';
    unblockBtn.style.display = 'block';
  } else {
    blockBtn.style.display = 'block';
    unblockBtn.style.display = 'none';
  }
  
  modal.style.display = 'flex';
}

function viewUserProfile() {
  if (!selectedUserId) return;
  alert(`🔍 Profile view for user: ${selectedUserId}\n\nFull profile viewing feature would open detailed user information.`);
}

// ===== TOGGLE BLOCK USER =====
async function toggleBlockUser(userId) {
  const user = allUsers.find(u => u.id === userId);
  if (!user) return;
  
  try {
    await updateDoc(doc(db, 'users', userId), {
      isBlocked: !user.isBlocked
    });
    showNotification(`✅ User ${!user.isBlocked ? 'blocked' : 'unblocked'} successfully`, 'success');
    loadUsers();
    loadBlockedUsers();
    loadOverviewStats();
    document.getElementById('userActionModal').style.display = 'none';
  } catch (error) {
    showNotification(`❌ Error: ${error.message}`, 'error');
  }
}

function blockSelectedUser() {
  if (!selectedUserId) return;
  const user = allUsers.find(u => u.id === selectedUserId);
  if (user && !user.isBlocked) {
    toggleBlockUser(selectedUserId);
  }
}

function unblockSelectedUser() {
  if (!selectedUserId) return;
  const user = allUsers.find(u => u.id === selectedUserId);
  if (user && user.isBlocked) {
    toggleBlockUser(selectedUserId);
  }
}

// ===== DELETE USER =====
async function deleteSelectedUser() {
  if (!selectedUserId) return;
  
  if (confirm('Are you sure you want to delete this user? This cannot be undone.')) {
    try {
      // Delete user data from Firestore
      await deleteDoc(doc(db, 'users', selectedUserId));
      
      // Try to delete from Auth (may fail if not admin)
      try {
        const userAuth = await auth.currentUser;
        if (userAuth && userAuth.uid === selectedUserId) {
          await deleteAuthUser(userAuth);
        }
      } catch (authError) {
        console.log('Could not delete from Auth (expected if not current user)');
      }
      
      showNotification('✅ User deleted successfully', 'success');
      loadUsers();
      loadBlockedUsers();
      loadOverviewStats();
      document.getElementById('userActionModal').style.display = 'none';
    } catch (error) {
      showNotification(`❌ Error: ${error.message}`, 'error');
    }
  }
}

// ===== LOAD AND DISPLAY REPORTS =====
function loadReports() {
  const container = document.getElementById('reportsContainer');
  container.innerHTML = '<div class="loading-message">Loading reports...</div>';
  
  try {
    // Use onSnapshot for real-time updates
    onSnapshot(collection(db, 'reports'), (snapshot) => {
      allReports = [];
      container.innerHTML = '';
      
      snapshot.forEach(doc => {
        const report = { id: doc.id, ...doc.data() };
        allReports.push(report);
      });
      
      console.log('📊 Reports updated in real-time:', allReports.length);
      
      // Apply current filter
      const filterValue = document.getElementById('reportFilter')?.value || 'all';
      filterReports(filterValue);
    }, (error) => {
      console.error('Error loading reports:', error);
      container.innerHTML = `<div class="loading-message" style="color: red;">Error: ${error.message}</div>`;
    });
  } catch (error) {
    console.error('Error setting up reports listener:', error);
    container.innerHTML = `<div class="loading-message" style="color: red;">Error: ${error.message}</div>`;
  }
}

function filterReports(status) {
  const container = document.getElementById('reportsContainer');
  container.innerHTML = '';
  
  let filteredReports = allReports;
  if (status !== 'all') {
    filteredReports = allReports.filter(r => r.status === status);
  }
  
  if (filteredReports.length === 0) {
    container.innerHTML = '<div class="loading-message">No reports found</div>';
    return;
  }
  
  filteredReports.forEach(report => {
    const card = document.createElement('div');
    card.className = `report-card ${report.status}`;
    card.innerHTML = `
      <div class="report-header">
        <h3>Report from ${sanitizeInput(report.reporterName || report.reporterId || 'Unknown')}</h3>
        <span class="report-status ${report.status}">${(report.status || 'pending').toUpperCase()}</span>
      </div>
      <div class="report-content">
        <p><strong>Reported User:</strong> ${sanitizeInput(report.reportedName || report.reportedId || 'Unknown')}</p>
        <p><strong>Reason:</strong> ${sanitizeInput(report.reason || 'N/A')}</p>
        <p><strong>Details:</strong> ${sanitizeInput(report.details || 'No details provided')}</p>
        <p><strong>Date:</strong> ${report.timestamp ? new Date(report.timestamp.toDate?.() || report.timestamp).toLocaleDateString() : 'N/A'}</p>
      </div>
      <div class="action-buttons">
        <button class="action-btn success-btn" onclick="showReportModal('${report.id}')">👁️ Details</button>
        <button class="action-btn warn-btn" onclick="handleReport('${report.id}', 'reviewed')">⚠️ Mark Reviewed</button>
        <button class="action-btn danger-btn" onclick="handleReport('${report.id}', 'dismissed')">❌ Dismiss</button>
      </div>
    `;
    container.appendChild(card);
  });
}

// ===== SHOW REPORT MODAL =====
function showReportModal(reportId) {
  selectedReportId = reportId;
  const report = allReports.find(r => r.id === reportId);
  
  if (!report) return;
  
  const modal = document.getElementById('reportModal');
  const details = document.getElementById('reportDetails');
  
  details.innerHTML = `
    <h4>Report Details</h4>
    <p><strong>Reporter:</strong> ${sanitizeInput(report.reporterName || report.reporterId || 'Unknown')}</p>
    <p><strong>Reported User:</strong> ${sanitizeInput(report.reportedName || report.reportedId || 'Unknown')}</p>
    <p><strong>Reason:</strong> ${sanitizeInput(report.reason || 'N/A')}</p>
    <p><strong>Details:</strong> ${sanitizeInput(report.details || 'No details provided')}</p>
    <p><strong>Status:</strong> ${(report.status || 'pending').toUpperCase()}</p>
    <p><strong>Date:</strong> ${report.timestamp ? new Date(report.timestamp.toDate?.() || report.timestamp).toLocaleString() : 'N/A'}</p>
  `;
  
  modal.style.display = 'flex';
}

// ===== HANDLE REPORT =====
async function handleReport(reportId, newStatus) {
  try {
    await updateDoc(doc(db, 'reports', reportId), {
      status: newStatus,
      updatedAt: serverTimestamp()
    });
    
    showNotification(`✅ Report marked as ${newStatus}`, 'success');
    loadReports();
    loadOverviewStats();
    document.getElementById('reportModal').style.display = 'none';
  } catch (error) {
    showNotification(`❌ Error: ${error.message}`, 'error');
  }
}

function blockReporter() {
  if (!selectedReportId) return;
  const report = allReports.find(r => r.id === selectedReportId);
  if (report) {
    // Block the reporter's user account
    if (confirm(`Block user: ${report.reporterName || report.reporterId}?`)) {
      // Find and block the user
      const userToBlock = allUsers.find(u => u.id === report.reporterId);
      if (userToBlock) {
        toggleBlockUser(report.reporterId);
      }
    }
  }
}

function blockReportedUser() {
  if (!selectedReportId) return;
  const report = allReports.find(r => r.id === selectedReportId);
  if (report) {
    if (confirm(`Block reported user: ${report.reportedName || report.reportedId}?`)) {
      const userToBlock = allUsers.find(u => u.id === report.reportedId);
      if (userToBlock) {
        toggleBlockUser(report.reportedId);
      }
    }
  }
}

// ===== LOAD BLOCKED USERS =====
async function loadBlockedUsers() {
  const container = document.getElementById('blockedUsersContainer');
  container.innerHTML = '<div class="loading-message">Loading blocked users...</div>';
  
  try {
    const blockedSnapshot = await getDocs(query(collection(db, 'users'), where('isBlocked', '==', true)));
    allBlockedUsers = [];
    container.innerHTML = '';
    
    blockedSnapshot.forEach(doc => {
      const user = { id: doc.id, ...doc.data() };
      allBlockedUsers.push(user);
      
      const card = document.createElement('div');
      card.className = 'blocked-card';
      card.innerHTML = `
        <div class="report-header">
          <h3>${sanitizeInput(user.username || user.displayName || 'Unknown')}</h3>
          <span class="report-status">BLOCKED</span>
        </div>
        <div class="report-content">
          <p><strong>Email:</strong> ${sanitizeInput(user.email || 'N/A')}</p>
          <p><strong>Joined:</strong> ${user.createdAt ? new Date(user.createdAt.toDate?.() || user.createdAt).toLocaleDateString() : 'N/A'}</p>
          <p><strong>Status:</strong> ${user.isOnline ? 'Online' : 'Offline'}</p>
        </div>
        <div class="action-buttons">
          <button class="action-btn success-btn" onclick="toggleBlockUser('${doc.id}')">✅ Unblock User</button>
          <button class="action-btn danger-btn" onclick="deleteSelectedUser_FromBlocked('${doc.id}')">🗑️ Delete Account</button>
        </div>
      `;
      container.appendChild(card);
    });
    
    if (allBlockedUsers.length === 0) {
      container.innerHTML = '<p class="empty-state">No blocked users</p>';
    }
  } catch (error) {
    console.error('Error loading blocked users:', error);
    container.innerHTML = `<div class="loading-message" style="color: red;">Error: ${error.message}</div>`;
  }
}

async function deleteSelectedUser_FromBlocked(userId) {
  selectedUserId = userId;
  deleteSelectedUser();
}

// ===== LOAD AND MANAGE ADMINS =====
async function loadAdmins() {
  const adminsList = document.getElementById('adminsList');
  adminsList.innerHTML = '<p>Loading admins...</p>';
  
  try {
    const adminsSnapshot = await getDocs(query(collection(db, 'admins'), where('isActive', '==', true)));
    allAdmins = [];
    adminsList.innerHTML = '';
    
    adminsSnapshot.forEach(doc => {
      const admin = { id: doc.id, ...doc.data() };
      allAdmins.push(admin);
      
      const card = document.createElement('div');
      card.className = 'admin-card';
      card.innerHTML = `
        <div class="admin-card-header">
          <h4>👑 ${sanitizeInput(admin.displayName || admin.email || 'Admin')}</h4>
          <span class="admin-email">${sanitizeInput(admin.email || 'N/A')}</span>
        </div>
        <div class="admin-details">
          <p><strong>Created:</strong> ${admin.createdAt ? new Date(admin.createdAt.toDate?.() || admin.createdAt).toLocaleDateString() : 'N/A'}</p>
          <p><strong>Created By:</strong> ${sanitizeInput(admin.createdBy || 'System')}</p>
          <p><strong>Status:</strong> ✅ Active</p>
          <p><strong>Last Login:</strong> ${admin.lastLogin ? new Date(admin.lastLogin.toDate?.() || admin.lastLogin).toLocaleString() : 'Never'}</p>
        </div>
        <div class="admin-actions">
          <button class="action-btn warn-btn" onclick="deactivateAdmin('${doc.id}')">🔒 Deactivate</button>
          <button class="action-btn danger-btn" onclick="deleteAdmin('${doc.id}')">🗑️ Remove</button>
        </div>
      `;
      adminsList.appendChild(card);
    });
    
    // Also load inactive admins
    const inactiveSnapshot = await getDocs(query(collection(db, 'admins'), where('isActive', '==', false)));
    inactiveSnapshot.forEach(doc => {
      const admin = { id: doc.id, ...doc.data() };
      
      const card = document.createElement('div');
      card.className = 'admin-card';
      card.innerHTML = `
        <div class="admin-card-header">
          <h4>👑 ${sanitizeInput(admin.displayName || admin.email || 'Admin')} (Inactive)</h4>
          <span class="admin-email">${sanitizeInput(admin.email || 'N/A')}</span>
        </div>
        <div class="admin-details">
          <p><strong>Created:</strong> ${admin.createdAt ? new Date(admin.createdAt.toDate?.() || admin.createdAt).toLocaleDateString() : 'N/A'}</p>
          <p><strong>Created By:</strong> ${sanitizeInput(admin.createdBy || 'System')}</p>
          <p><strong>Status:</strong> ❌ Inactive</p>
          <p><strong>Last Login:</strong> ${admin.lastLogin ? new Date(admin.lastLogin.toDate?.() || admin.lastLogin).toLocaleString() : 'Never'}</p>
        </div>
        <div class="admin-actions">
          <button class="action-btn success-btn" onclick="activateAdmin('${doc.id}')">🔓 Activate</button>
          <button class="action-btn danger-btn" onclick="deleteAdmin('${doc.id}')">🗑️ Remove</button>
        </div>
      `;
      adminsList.appendChild(card);
    });
    
    if (allAdmins.length === 0 && inactiveSnapshot.empty) {
      adminsList.innerHTML = '<p>No admins found</p>';
    }
  } catch (error) {
    console.error('Error loading admins:', error);
    adminsList.innerHTML = `<p style="color: red;">Error: ${error.message}</p>`;
  }
}

// ===== CREATE NEW ADMIN =====
async function createNewAdmin() {
  const email = document.getElementById('newAdminEmail').value.trim();
  const password = document.getElementById('newAdminPassword').value.trim();
  const name = document.getElementById('newAdminName').value.trim();
  
  // Validation
  if (!email) {
    showNotification('❌ Please enter an email', 'error');
    return;
  }
  
  if (!isValidEmail(email)) {
    showNotification('❌ Please enter a valid email', 'error');
    return;
  }
  
  if (!password) {
    showNotification('❌ Please enter or generate a password', 'error');
    return;
  }
  
  if (!name) {
    showNotification('❌ Please enter admin name', 'error');
    return;
  }
  
  try {
    // Create auth user
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const adminUser = userCredential.user;
    
    // Create admin document in Firestore
    await addDoc(collection(db, 'admins'), {
      uid: adminUser.uid,
      email: email,
      displayName: name,
      createdAt: serverTimestamp(),
      createdBy: currentAdminName,
      isActive: true,
      lastLogin: null,
      role: 'admin',
      permissions: ['manage_users', 'manage_reports', 'manage_admins', 'view_logs']
    });
    
    // Clear form
    document.getElementById('newAdminEmail').value = '';
    document.getElementById('newAdminPassword').value = '';
    document.getElementById('newAdminName').value = '';
    document.getElementById('generatedPassword').style.display = 'none';
    document.getElementById('passwordText').textContent = '';
    
    showNotification(`✅ Admin "${name}" created successfully with email: ${email}`, 'success');
    loadAdmins();
  } catch (error) {
    showNotification(`❌ Error: ${error.message}`, 'error');
  }
}

// ===== MANAGE ADMIN STATUS =====
async function deactivateAdmin(adminId) {
  if (confirm('Are you sure you want to deactivate this admin?')) {
    try {
      await updateDoc(doc(db, 'admins', adminId), {
        isActive: false
      });
      showNotification('✅ Admin deactivated successfully', 'success');
      loadAdmins();
    } catch (error) {
      showNotification(`❌ Error: ${error.message}`, 'error');
    }
  }
}

async function activateAdmin(adminId) {
  try {
    await updateDoc(doc(db, 'admins', adminId), {
      isActive: true
    });
    showNotification('✅ Admin activated successfully', 'success');
    loadAdmins();
  } catch (error) {
    showNotification(`❌ Error: ${error.message}`, 'error');
  }
}

async function deleteAdmin(adminId) {
  if (confirm('Are you sure you want to remove this admin?')) {
    try {
      await deleteDoc(doc(db, 'admins', adminId));
      showNotification('✅ Admin removed successfully', 'success');
      loadAdmins();
    } catch (error) {
      showNotification(`❌ Error: ${error.message}`, 'error');
    }
  }
}

// ===== SETTINGS ACTIONS =====
function handleSettingsActions(e) {
  const buttonText = e.target.textContent.trim();
  
  if (buttonText.includes('System Logs')) {
    showNotification('📋 System logs loading...', 'info');
    alert('System Logs:\n\n- Dashboard accessed: ' + new Date().toLocaleString() + '\n- All systems operational\n- Last backup: 24 hours ago\n- Active connections: 5');
  }
  else if (buttonText.includes('Backup')) {
    showNotification('💾 Generating backup...', 'info');
    setTimeout(() => {
      // Simulate backup download
      const backupData = {
        timestamp: new Date().toISOString(),
        totalUsers: document.getElementById('totalUsers').textContent,
        totalMessages: document.getElementById('totalMessages').textContent,
        exportedAt: new Date().toLocaleString()
      };
      
      const dataStr = JSON.stringify(backupData, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `nexchat-backup-${Date.now()}.json`;
      link.click();
      
      showNotification('✅ Backup downloaded successfully', 'success');
    }, 1000);
  }
  else if (buttonText.includes('Clear Cache')) {
    if (confirm('Are you sure you want to clear the cache? This may affect performance temporarily.')) {
      localStorage.clear();
      sessionStorage.clear();
      showNotification('✅ Cache cleared successfully', 'success');
    }
  }
}

// Make functions globally accessible for onclick handlers
window.showUserModal = showUserModal;
window.toggleBlockUser = toggleBlockUser;
window.deleteSelectedUser = deleteSelectedUser;
window.deleteSelectedUser_FromBlocked = deleteSelectedUser_FromBlocked;
window.showReportModal = showReportModal;
window.handleReport = handleReport;
window.deactivateAdmin = deactivateAdmin;
window.activateAdmin = activateAdmin;
window.deleteAdmin = deleteAdmin;

// ============================================================
// NEX-REELS VIDEO MANAGEMENT
// ============================================================

let allVideos = [];
let selectedVideoId = null;
let selectedVideoData = null;

// Load videos for NEX-REELS monitoring
async function loadVideos() {
  try {
    const videosRef = collection(db, 'videos');
    const q = query(videosRef);
    const snap = await getDocs(q);
    
    allVideos = [];
    let totalViews = 0;
    let flaggedCount = 0;
    
    snap.forEach(docSnap => {
      const video = docSnap.data();
      video.id = docSnap.id;
      allVideos.push(video);
      
      totalViews += video.views || 0;
      if (video.flagged || video.isFlagged) flaggedCount++;
    });
    
    // Update stats
    document.getElementById('totalVideos').textContent = allVideos.length;
    document.getElementById('flaggedVideos').textContent = flaggedCount;
    document.getElementById('totalViews').textContent = totalViews.toLocaleString();
    document.getElementById('videoStats').textContent = allVideos.length;
    
    displayVideos(allVideos);
    
    console.log('✅ Loaded ' + allVideos.length + ' videos');
  } catch (err) {
    console.error('❌ Error loading videos:', err);
    showNotification('Error loading videos: ' + err.message, 'error');
  }
}

// Display videos in grid
function displayVideos(videos) {
  const container = document.getElementById('videosContainer');
  
  if (videos.length === 0) {
    container.innerHTML = '<p class="empty-message">No videos found</p>';
    return;
  }
  
  container.innerHTML = videos.map(video => `
    <div class="video-card" onclick="window.openVideoModal('${video.id}')">
      <div class="video-thumbnail">
        ${video.thumbnailUrl ? `<img src="${sanitizeInput(video.thumbnailUrl)}" alt="thumbnail">` : '<div class="placeholder">📹</div>'}
        <span class="video-duration">${video.duration || 0}s</span>
        ${video.flagged || video.isFlagged ? '<span class="flag-badge">🚩 FLAGGED</span>' : ''}
      </div>
      <div class="video-info">
        <h4>${sanitizeInput(video.title || 'Untitled')}</h4>
        <p class="video-author">By: @${sanitizeInput(video.author || 'Unknown')}</p>
        <div class="video-stats">
          <span>👁️ ${(video.views || 0).toLocaleString()}</span>
          <span>❤️ ${(video.likes || 0).toLocaleString()}</span>
          <span>💬 ${(video.comments || 0).toLocaleString()}</span>
        </div>
        <p class="video-date">${new Date(video.createdAt?.toDate?.() || video.createdAt).toLocaleDateString()}</p>
      </div>
    </div>
  `).join('');
}

// Open video action modal
async function openVideoModal(videoId) {
  selectedVideoId = videoId;
  selectedVideoData = allVideos.find(v => v.id === videoId);
  
  if (!selectedVideoData) return;
  
  const modal = document.getElementById('videoActionModal');
  const info = document.getElementById('videoActionInfo');
  
  info.innerHTML = `
    <div class="modal-info">
      <h4>${sanitizeInput(selectedVideoData.title)}</h4>
      <p><strong>Creator:</strong> @${sanitizeInput(selectedVideoData.author)}</p>
      <p><strong>Creator UID:</strong> ${sanitizeInput(selectedVideoData.authorId)}</p>
      <p><strong>Views:</strong> ${(selectedVideoData.views || 0).toLocaleString()}</p>
      <p><strong>Likes:</strong> ${(selectedVideoData.likes || 0).toLocaleString()}</p>
      <p><strong>Comments:</strong> ${(selectedVideoData.comments || 0).toLocaleString()}</p>
      <p><strong>Uploaded:</strong> ${new Date(selectedVideoData.createdAt?.toDate?.() || selectedVideoData.createdAt).toLocaleString()}</p>
      <p><strong>Description:</strong> ${sanitizeInput(selectedVideoData.description || 'No description')}</p>
      ${selectedVideoData.flagged || selectedVideoData.isFlagged ? '<p style="color: #ff6b6b;"><strong>⚠️ Status: FLAGGED</strong></p>' : ''}
    </div>
  `;
  
  // Update video preview
  const videoPreview = document.getElementById('videoPreview');
  const thumbnailPreview = document.getElementById('thumbnailPreview');
  
  if (selectedVideoData.videoUrl) {
    videoPreview.src = selectedVideoData.videoUrl;
    videoPreview.style.display = 'block';
    thumbnailPreview.style.display = 'none';
  } else if (selectedVideoData.thumbnailUrl) {
    thumbnailPreview.src = selectedVideoData.thumbnailUrl;
    thumbnailPreview.style.display = 'block';
    videoPreview.style.display = 'none';
  }
  
  modal.style.display = 'flex';
}

// Flag video
async function flagVideo() {
  if (!selectedVideoId) return;
  
  try {
    await updateDoc(doc(db, 'videos', selectedVideoId), {
      flagged: true,
      isFlagged: true,
      flaggedAt: serverTimestamp(),
      flaggedBy: 'admin'
    });
    
    showNotification('✅ Video flagged for review', 'success');
    document.getElementById('videoActionModal').style.display = 'none';
    loadVideos();
  } catch (err) {
    console.error('❌ Error flagging video:', err);
    showNotification('Error flagging video: ' + err.message, 'error');
  }
}

// Delete video
async function deleteVideo() {
  if (!selectedVideoId) return;
  
  if (!confirm('⚠️ Are you sure you want to permanently delete this video? This cannot be undone.')) return;
  
  try {
    // Delete from Firestore
    await deleteDoc(doc(db, 'videos', selectedVideoId));
    
    showNotification('✅ Video deleted successfully', 'success');
    document.getElementById('videoActionModal').style.display = 'none';
    loadVideos();
  } catch (err) {
    console.error('❌ Error deleting video:', err);
    showNotification('Error deleting video: ' + err.message, 'error');
  }
}

// Ban video creator
async function banVideoCreator() {
  if (!selectedVideoData) return;
  
  const creatorId = selectedVideoData.authorId;
  if (!creatorId) {
    showNotification('❌ Cannot ban: Creator ID not found', 'error');
    return;
  }
  
  if (!confirm(`⚠️ Ban user @${selectedVideoData.author}? They will not be able to upload more videos.`)) return;
  
  try {
    // Add to banned users
    const userRef = doc(db, 'users', creatorId);
    await updateDoc(userRef, {
      banned: true,
      bannedAt: serverTimestamp(),
      bannedReason: 'Inappropriate video content on NEX-REELS',
      bannedBy: 'admin'
    });
    
    // Also delete all their other videos
    const videoRef = collection(db, 'videos');
    const q = query(videoRef, where('authorId', '==', creatorId));
    const snap = await getDocs(q);
    
    snap.forEach(async (docSnap) => {
      await deleteDoc(docSnap.ref);
    });
    
    showNotification(`✅ User @${selectedVideoData.author} has been banned`, 'success');
    document.getElementById('videoActionModal').style.display = 'none';
    loadVideos();
  } catch (err) {
    console.error('❌ Error banning creator:', err);
    showNotification('Error banning creator: ' + err.message, 'error');
  }
}

// Filter videos
function filterVideos(filterType) {
  let filtered = [...allVideos];
  
  if (filterType === 'trending') {
    filtered = filtered.sort((a, b) => (b.likes || 0) - (a.likes || 0)).slice(0, 50);
  } else if (filterType === 'flagged') {
    filtered = filtered.filter(v => v.flagged || v.isFlagged);
  } else if (filterType === 'recent') {
    filtered = filtered.sort((a, b) => {
      const dateA = a.createdAt?.toDate?.() || new Date(a.createdAt);
      const dateB = b.createdAt?.toDate?.() || new Date(b.createdAt);
      return dateB - dateA;
    }).slice(0, 50);
  }
  
  displayVideos(filtered);
}

// ============================================================
// VIDEO REPORTS MANAGEMENT
// ============================================================

let allVideoReports = [];
let selectedReportId = null;
let selectedReportData = null;

// Load video reports from Firestore
async function loadVideoReports() {
  const container = document.getElementById('reportsContainer');
  container.innerHTML = '<div class="loading-message">Loading reports...</div>';
  
  try {
    const reportsRef = collection(db, 'reports');
    const snap = await getDocs(reportsRef);
    
    allVideoReports = [];
    
    snap.forEach(docSnap => {
      const report = { id: docSnap.id, ...docSnap.data() };
      // Only show video reports (not user-to-user reports)
      if (report.videoId) {
        allVideoReports.push(report);
      }
    });
    
    // Sort by creation date (newest first)
    allVideoReports.sort((a, b) => {
      const dateA = a.createdAt?.toDate?.() || new Date(a.createdAt);
      const dateB = b.createdAt?.toDate?.() || new Date(b.createdAt);
      return dateB - dateA;
    });
    
    displayVideoReports(allVideoReports);
  } catch (err) {
    console.error('❌ Error loading reports:', err);
    container.innerHTML = '<p class="empty-state">Error loading reports</p>';
    showNotification('Error loading reports: ' + err.message, 'error');
  }
}

// Display video reports
function displayVideoReports(reports) {
  const container = document.getElementById('reportsContainer');
  container.innerHTML = '';
  
  if (reports.length === 0) {
    container.innerHTML = '<p class="empty-state">No reports yet</p>';
    return;
  }
  
  reports.forEach(report => {
    const statusColor = report.status === 'resolved' ? 'success-btn' : 
                       report.status === 'reviewed' ? 'warn-btn' : 'danger-btn';
    
    const card = document.createElement('div');
    card.className = 'report-card';
    card.innerHTML = `
      <div class="report-header">
        <div>
          <h4>Video: ${sanitizeInput(report.videoTitle || 'Unknown')}</h4>
          <p>Creator: <strong>@${sanitizeInput(report.author || 'Unknown')}</strong></p>
        </div>
        <span class="report-status ${statusColor}">${(report.status || 'pending').toUpperCase()}</span>
      </div>
      <div class="report-content">
        <p><strong>Reason:</strong> ${sanitizeInput(report.reason || 'N/A')}</p>
        <p><strong>Description:</strong> ${sanitizeInput(report.description || 'No description')}</p>
        <p><strong>Reported By:</strong> ${report.isAnonymous ? 'Anonymous' : sanitizeInput(report.reportedByEmail || 'Unknown')}</p>
        <p><strong>Date:</strong> ${new Date(report.createdAt?.toDate?.() || report.createdAt).toLocaleString()}</p>
      </div>
      <div class="action-buttons">
        <button class="action-btn view-btn" onclick="openVideoReportModal('${report.id}')">👁️ View Details</button>
      </div>
    `;
    container.appendChild(card);
  });
}

// Open video report details modal
async function openVideoReportModal(reportId) {
  selectedReportId = reportId;
  selectedReportData = allVideoReports.find(r => r.id === reportId);
  
  if (!selectedReportData) return;
  
  const modal = document.getElementById('reportModal');
  const details = document.getElementById('reportDetails');
  
  details.innerHTML = `
    <div class="modal-info">
      <h4>📋 Report Details</h4>
      <p><strong>Video:</strong> ${sanitizeInput(selectedReportData.videoTitle || 'Unknown')}</p>
      <p><strong>Creator:</strong> @${sanitizeInput(selectedReportData.author || 'Unknown')}</p>
      <p><strong>Video ID:</strong> ${sanitizeInput(selectedReportData.videoId)}</p>
      <p><strong>Creator ID:</strong> ${sanitizeInput(selectedReportData.authorId)}</p>
      <hr style="margin: 12px 0; border: none; border-top: 1px solid rgba(255,255,255,0.1);">
      <p><strong>Report Reason:</strong> <span style="color: #ff6b6b;">${sanitizeInput(selectedReportData.reason || 'N/A')}</span></p>
      <p><strong>Description:</strong> ${sanitizeInput(selectedReportData.description || 'No additional details')}</p>
      <p><strong>Reported By:</strong> ${selectedReportData.isAnonymous ? '<em>Anonymous</em>' : sanitizeInput(selectedReportData.reportedByEmail || 'Unknown')}</p>
      <p><strong>Report Date:</strong> ${new Date(selectedReportData.createdAt?.toDate?.() || selectedReportData.createdAt).toLocaleString()}</p>
      <p><strong>Status:</strong> <span style="color: #1db854;"><strong>${(selectedReportData.status || 'pending').toUpperCase()}</strong></span></p>
    </div>
  `;
  
  modal.style.display = 'flex';
}

// Mark report as reviewed
async function markReportReviewed() {
  if (!selectedReportId) return;
  
  try {
    await updateDoc(doc(db, 'reports', selectedReportId), {
      status: 'reviewed'
    });
    
    showNotification('✅ Report marked as reviewed', 'success');
    document.getElementById('reportModal').style.display = 'none';
    loadVideoReports();
  } catch (err) {
    console.error('❌ Error updating report:', err);
    showNotification('Error updating report: ' + err.message, 'error');
  }
}

// Delete reported video
async function deleteReportedVideo() {
  if (!selectedReportData) return;
  
  if (!confirm('⚠️ Are you sure you want to permanently delete this video?')) return;
  
  try {
    await deleteDoc(doc(db, 'videos', selectedReportData.videoId));
    
    await updateDoc(doc(db, 'reports', selectedReportId), {
      status: 'resolved',
      resolvedAt: serverTimestamp(),
      actionTaken: 'video_deleted'
    });
    
    showNotification('✅ Video deleted and report resolved', 'success');
    document.getElementById('reportModal').style.display = 'none';
    loadVideoReports();
  } catch (err) {
    console.error('❌ Error deleting video:', err);
    showNotification('Error deleting video: ' + err.message, 'error');
  }
}

// Ban creator from report
async function banCreatorFromReport() {
  if (!selectedReportData) return;
  
  const creatorId = selectedReportData.authorId;
  if (!creatorId) {
    showNotification('❌ Cannot ban: Creator ID not found', 'error');
    return;
  }
  
  if (!confirm(`⚠️ Ban user @${selectedReportData.author}? All their videos will be deleted.`)) return;
  
  try {
    // Ban the user
    await updateDoc(doc(db, 'users', creatorId), {
      banned: true,
      bannedAt: serverTimestamp(),
      bannedReason: 'Violation: ' + selectedReportData.reason
    });
    
    // Delete all their videos
    const videosRef = collection(db, 'videos');
    const q = query(videosRef, where('authorId', '==', creatorId));
    const snap = await getDocs(q);
    
    snap.forEach(async (docSnap) => {
      await deleteDoc(docSnap.ref);
    });
    
    // Mark report as resolved
    await updateDoc(doc(db, 'reports', selectedReportId), {
      status: 'resolved',
      resolvedAt: serverTimestamp(),
      actionTaken: 'creator_banned'
    });
    
    showNotification(`✅ User @${selectedReportData.author} has been banned`, 'success');
    document.getElementById('reportModal').style.display = 'none';
    loadVideoReports();
  } catch (err) {
    console.error('❌ Error banning creator:', err);
    showNotification('Error banning creator: ' + err.message, 'error');
  }
}

// Dismiss report (mark as resolved but no action taken)
async function dismissReport() {
  if (!selectedReportId) return;
  
  try {
    await updateDoc(doc(db, 'reports', selectedReportId), {
      status: 'resolved',
      resolvedAt: serverTimestamp(),
      actionTaken: 'dismissed'
    });
    
    showNotification('✅ Report dismissed', 'success');
    document.getElementById('reportModal').style.display = 'none';
    loadVideoReports();
  } catch (err) {
    console.error('❌ Error dismissing report:', err);
    showNotification('Error dismissing report: ' + err.message, 'error');
  }
}

// ============================================================
// EVENT LISTENERS FOR VIDEO MANAGEMENT
// ============================================================

document.getElementById('videoFilter')?.addEventListener('change', (e) => {
  filterVideos(e.target.value);
});

document.getElementById('refreshVideosBtn')?.addEventListener('click', loadVideos);

document.getElementById('flagVideoBtn')?.addEventListener('click', flagVideo);
document.getElementById('deleteVideoBtn')?.addEventListener('click', deleteVideo);
document.getElementById('banVideoCreatorBtn')?.addEventListener('click', banVideoCreator);

document.getElementById('viewVideoBtn')?.addEventListener('click', () => {
  if (selectedVideoData?.videoUrl) {
    window.open(selectedVideoData.videoUrl, '_blank');
  } else {
    showNotification('❌ Video URL not available', 'error');
  }
});

// Load videos when tab is clicked
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', function() {
    if (this.getAttribute('data-tab') === 'videos') {
      setTimeout(loadVideos, 100);
    }
    if (this.getAttribute('data-tab') === 'reports') {
      setTimeout(loadVideoReports, 100);
    }
  });
});

// Report modal button listeners
document.getElementById('markResolvedBtn')?.addEventListener('click', markReportReviewed);
document.getElementById('blockReportedBtn')?.addEventListener('click', banCreatorFromReport);

// Make functions globally accessible
window.openVideoModal = openVideoModal;
window.flagVideo = flagVideo;
window.deleteVideo = deleteVideo;
window.banVideoCreator = banVideoCreator;
window.filterVideos = filterVideos;

// ========================================
// WATCH REELS FUNCTIONS
// ========================================
async function loadWatchReels() {
  const reelsFeed = document.getElementById('reelsFeed');
  reelsFeed.innerHTML = '<div class="loading-message">Loading reels...</div>';
  
  try {
    const videosQuery = query(
      collection(db, 'videos'), 
      orderBy('createdAt', 'desc'), 
      limit(50)
    );
    
    onSnapshot(videosQuery, (snap) => {
      reelsFeed.innerHTML = '';
      
      if (snap.docs.length === 0) {
        reelsFeed.innerHTML = '<div class="loading-message">No reels uploaded yet 📹</div>';
        document.getElementById('totalReels').textContent = '0';
        document.getElementById('reelsViews').textContent = '0';
        document.getElementById('reelsLikes').textContent = '0';
        return;
      }
      
      let totalViews = 0;
      let totalLikes = 0;
      
      snap.docs.forEach(doc => {
        const video = doc.data();
        totalViews += video.views || 0;
        totalLikes += video.likes || 0;
        
        const reelCard = document.createElement('div');
        reelCard.className = 'reel-card';
        
        const timeStr = video.createdAt 
          ? new Date(video.createdAt.toDate?.() || video.createdAt).toLocaleDateString()
          : 'Unknown';
        
        reelCard.innerHTML = `
          <div class="reel-card-title">🎬 ${video.title || 'Untitled'}</div>
          <div class="reel-card-author">By @${video.author || 'Unknown'}</div>
          <div style="color: #888; font-size: 0.8rem; margin-bottom: 8px;">${timeStr}</div>
          <div style="color: #999; font-size: 0.85rem; margin-bottom: 10px; line-height: 1.3;">${video.description || 'No description'}</div>
          <div class="reel-card-stats">
            <div class="reel-card-stat">👁️ ${video.views || 0}</div>
            <div class="reel-card-stat">❤️ ${video.likes || 0}</div>
            <div class="reel-card-stat">💬 ${video.comments?.length || 0}</div>
          </div>
        `;
        
        reelsFeed.appendChild(reelCard);
      });
      
      document.getElementById('totalReels').textContent = snap.docs.length;
      document.getElementById('reelsViews').textContent = totalViews;
      document.getElementById('reelsLikes').textContent = totalLikes;
      
    });
  } catch (error) {
    console.error('Error loading reels:', error);
    reelsFeed.innerHTML = `<div style="color: #ff4d4d;">Error loading reels: ${error.message}</div>`;
  }
}

// ========================================
// POST REELS FUNCTIONS
// ========================================
function initPostReels() {
  const publishBtn = document.getElementById('publishReelBtn');
  const videoFile = document.getElementById('adminVideoFile');
  const videoPreview = document.getElementById('adminVideoPreview');
  const uploadPreview = document.getElementById('uploadPreview');
  
  // Video preview
  if (videoFile) {
    videoFile.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const url = URL.createObjectURL(file);
        videoPreview.src = url;
        uploadPreview.style.display = 'block';
      }
    });
  }
  
  // Publish button
  if (publishBtn) {
    publishBtn.addEventListener('click', publishAdminReel);
  }
  
  // Load admin's existing reels
  loadAdminReels();
}

async function publishAdminReel() {
  const title = document.getElementById('adminReelTitle');
  const description = document.getElementById('adminReelDescription');
  const videoFile = document.getElementById('adminVideoFile');
  const thumbnail = document.getElementById('adminVideoThumbnail');
  const uploadStatus = document.getElementById('uploadStatus');
  const publishBtn = document.getElementById('publishReelBtn');
  
  if (!title.value.trim()) {
    uploadStatus.innerHTML = '❌ Please enter a title';
    uploadStatus.className = 'error';
    uploadStatus.style.display = 'block';
    return;
  }
  
  if (!videoFile.files[0]) {
    uploadStatus.innerHTML = '❌ Please select a video file';
    uploadStatus.className = 'error';
    uploadStatus.style.display = 'block';
    return;
  }
  
  const file = videoFile.files[0];
  if (file.size > 500 * 1024 * 1024) {
    uploadStatus.innerHTML = '❌ Video too large (max 500MB)';
    uploadStatus.className = 'error';
    uploadStatus.style.display = 'block';
    return;
  }
  
  try {
    publishBtn.disabled = true;
    publishBtn.textContent = '⏳ Publishing...';
    uploadStatus.innerHTML = '⏳ Uploading video...';
    uploadStatus.className = 'loading';
    uploadStatus.style.display = 'block';
    
    const timestamp = Date.now();
    const videoPath = `admin-reels/${currentAdminName}/${timestamp}_${file.name}`;
    const videoRef = storageRef(storage, videoPath);
    
    await uploadBytes(videoRef, file);
    const videoUrl = await getDownloadURL(videoRef);
    
    let thumbnailUrl = '';
    if (thumbnail.files[0]) {
      const thumbFile = thumbnail.files[0];
      if (thumbFile.size < 5 * 1024 * 1024) {
        const thumbPath = `admin-reels-thumbs/${currentAdminName}/${timestamp}_${thumbFile.name}`;
        const thumbRef = storageRef(storage, thumbPath);
        await uploadBytes(thumbRef, thumbFile);
        thumbnailUrl = await getDownloadURL(thumbRef);
      }
    }
    
    await addDoc(collection(db, 'videos'), {
      title: title.value.trim(),
      description: description.value.trim(),
      author: currentAdminName + ' (Admin)',
      authorId: auth.currentUser.uid,
      videoUrl: videoUrl,
      thumbnailUrl: thumbnailUrl,
      createdAt: new Date(),
      likes: 0,
      comments: [],
      views: 0,
      shares: 0,
      isAdminContent: true
    });
    
    uploadStatus.innerHTML = '✅ Reel published successfully!';
    uploadStatus.className = 'success';
    uploadStatus.style.display = 'block';
    
    title.value = '';
    description.value = '';
    videoFile.value = '';
    thumbnail.value = '';
    document.getElementById('uploadPreview').style.display = 'none';
    
    publishBtn.disabled = false;
    publishBtn.textContent = '🚀 Publish Reel';
    
    loadAdminReels();
    
  } catch (error) {
    console.error('Error publishing reel:', error);
    uploadStatus.innerHTML = `❌ Error: ${error.message}`;
    uploadStatus.className = 'error';
    uploadStatus.style.display = 'block';
    publishBtn.disabled = false;
    publishBtn.textContent = '🚀 Publish Reel';
  }
}

async function loadAdminReels() {
  try {
    const adminReelsList = document.querySelector('.admin-reels-list');
    adminReelsList.innerHTML = '<div class="loading-message">Loading your reels...</div>';
    
    const reelsQuery = query(
      collection(db, 'videos'),
      where('authorId', '==', auth.currentUser.uid),
      orderBy('createdAt', 'desc')
    );
    
    const snap = await getDocs(reelsQuery);
    adminReelsList.innerHTML = '';
    
    if (snap.docs.length === 0) {
      adminReelsList.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #888; padding: 20px;">No reels published yet</div>';
      return;
    }
    
    snap.docs.forEach(doc => {
      const video = doc.data();
      const item = document.createElement('div');
      item.className = 'admin-reel-item';
      item.innerHTML = `
        <div class="admin-reel-item-title">${video.title || 'Untitled'}</div>
        <div class="admin-reel-item-stat">
          <span>👁️ <strong>${video.views || 0}</strong></span>
          <span>❤️ <strong>${video.likes || 0}</strong></span>
          <span>💬 <strong>${video.comments?.length || 0}</strong></span>
        </div>
      `;
      adminReelsList.appendChild(item);
    });
    
  } catch (error) {
    console.error('Error loading admin reels:', error);
  }
}

// ========================================
// ANALYTICS & USER TRACKING
// ========================================

async function initAnalytics() {
  loadPlatformAnalytics();
  setupAnalyticsSearchHandler();
  setupRefreshButton();
  
  // Auto-refresh every 30 seconds
  setInterval(loadPlatformAnalytics, 30000);
}

async function loadPlatformAnalytics() {
  try {
    // Count total users
    const usersSnap = await getDocs(collection(db, 'users'));
    document.getElementById('analyticsTotal Users').textContent = usersSnap.docs.length;
    
    // Count total messages
    const messagesSnap = await getDocs(collection(db, 'messageActivity'));
    document.getElementById('analyticsTotalMessages').textContent = messagesSnap.docs.length;
    
    // Count total videos
    const videosSnap = await getDocs(collection(db, 'videoActivity'));
    document.getElementById('analyticsTotalVideos').textContent = videosSnap.docs.length;
    
    // Count views from video engagement
    const viewsSnap = await getDocs(
      query(
        collection(db, 'videoEngagement'),
        where('engagementType', '==', 'view')
      )
    );
    document.getElementById('analyticsTotalViews').textContent = viewsSnap.docs.length;
    
    // Count new users in last 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const newUsersSnap = await getDocs(
      query(
        collection(db, 'userRegistrations'),
        where('registeredAt', '>=', oneDayAgo)
      )
    );
    document.getElementById('analyticsDailyNewUsers').textContent = newUsersSnap.docs.length;
    
    // Count active users in last 24 hours
    const activeUsersSnap = await getDocs(
      query(
        collection(db, 'userActivity'),
        where('timestamp', '>=', oneDayAgo)
      )
    );
    const activeUserIds = new Set(activeUsersSnap.docs.map(d => d.data().userId));
    document.getElementById('analyticsActiveUsers').textContent = activeUserIds.size;
    
  } catch (error) {
    console.error('Error loading platform analytics:', error);
  }
}

function setupAnalyticsSearchHandler() {
  const searchBtn = document.getElementById('analyticsSearchBtn');
  const searchInput = document.getElementById('analyticsUserSearch');
  
  if (searchBtn) {
    searchBtn.addEventListener('click', searchUserAnalytics);
  }
  
  if (searchInput) {
    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') searchUserAnalytics();
    });
  }
}

async function searchUserAnalytics() {
  const searchTerm = document.getElementById('analyticsUserSearch').value.toLowerCase().trim();
  const resultDiv = document.getElementById('analyticsUserResult');
  const contentDiv = document.getElementById('userStatsContent');
  
  if (!searchTerm) {
    resultDiv.style.display = 'none';
    return;
  }
  
  try {
    contentDiv.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #00ff66;">⏳ Loading user analytics...</div>';
    resultDiv.style.display = 'block';
    
    // Search users by UID, email, or username
    const usersSnap = await getDocs(collection(db, 'users'));
    let foundUser = null;
    
    for (const doc of usersSnap.docs) {
      const userData = doc.data();
      if (
        doc.id.toLowerCase().includes(searchTerm) ||
        (userData.email && userData.email.toLowerCase().includes(searchTerm)) ||
        (userData.username && userData.username.toLowerCase().includes(searchTerm))
      ) {
        foundUser = { id: doc.id, data: userData };
        break;
      }
    }
    
    if (!foundUser) {
      contentDiv.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #ff6666;">❌ User not found</div>';
      return;
    }
    
    // Get user stats
    const userId = foundUser.id;
    
    // Registration info
    const regQuery = query(
      collection(db, 'userRegistrations'),
      where('userId', '==', userId)
    );
    const regSnap = await getDocs(regQuery);
    let accountAge = 'Unknown';
    if (regSnap.docs.length > 0) {
      const regData = regSnap.docs[0].data();
      accountAge = Math.floor((Date.now() - regData.registeredAt.toDate().getTime()) / (1000 * 60 * 60 * 24)) + ' days';
    }
    
    // Messages sent
    const sentQuery = query(
      collection(db, 'messageActivity'),
      where('userId', '==', userId)
    );
    const sentSnap = await getDocs(sentQuery);
    
    // Messages received
    const receivedQuery = query(
      collection(db, 'messageActivity'),
      where('recipientId', '==', userId)
    );
    const receivedSnap = await getDocs(receivedQuery);
    
    // Videos uploaded
    const videoUploadQuery = query(
      collection(db, 'videoActivity'),
      where('userId', '==', userId)
    );
    const videoUploadSnap = await getDocs(videoUploadQuery);
    
    // Video engagements
    const engagementQuery = query(
      collection(db, 'videoEngagement'),
      where('userId', '==', userId)
    );
    const engagementSnap = await getDocs(engagementQuery);
    
    let videoViews = 0, videoLikes = 0, videoComments = 0;
    engagementSnap.docs.forEach(doc => {
      const engagement = doc.data();
      if (engagement.engagementType === 'view') videoViews++;
      if (engagement.engagementType === 'like') videoLikes++;
      if (engagement.engagementType === 'comment') videoComments++;
    });
    
    // Build HTML
    contentDiv.innerHTML = `
      <div class="user-stat-item">
        <div class="user-stat-label">👤 Username</div>
        <div class="user-stat-value">${foundUser.data.username || 'N/A'}</div>
      </div>
      <div class="user-stat-item">
        <div class="user-stat-label">📧 Email</div>
        <div class="user-stat-value" style="font-size: 0.9rem; word-break: break-all;">${foundUser.data.email || 'N/A'}</div>
      </div>
      <div class="user-stat-item">
        <div class="user-stat-label">📅 Account Age</div>
        <div class="user-stat-value">${accountAge}</div>
      </div>
      <div class="user-stat-item">
        <div class="user-stat-label">💰 Tokens</div>
        <div class="user-stat-value">${foundUser.data.tokens || 0}</div>
      </div>
      <div class="user-stat-item">
        <div class="user-stat-label">💬 Messages Sent</div>
        <div class="user-stat-value">${sentSnap.docs.length}</div>
      </div>
      <div class="user-stat-item">
        <div class="user-stat-label">📬 Messages Received</div>
        <div class="user-stat-value">${receivedSnap.docs.length}</div>
      </div>
      <div class="user-stat-item">
        <div class="user-stat-label">🎬 Videos Uploaded</div>
        <div class="user-stat-value">${videoUploadSnap.docs.length}</div>
      </div>
      <div class="user-stat-item">
        <div class="user-stat-label">👁️ Video Views</div>
        <div class="user-stat-value">${videoViews}</div>
      </div>
      <div class="user-stat-item">
        <div class="user-stat-label">❤️ Video Likes</div>
        <div class="user-stat-value">${videoLikes}</div>
      </div>
      <div class="user-stat-item">
        <div class="user-stat-label">💬 Video Comments</div>
        <div class="user-stat-value">${videoComments}</div>
      </div>
      <div class="user-stat-item">
        <div class="user-stat-label">🌍 Registration IP</div>
        <div class="user-stat-value" style="font-size: 0.85rem;">${foundUser.data.registrationIP || 'N/A'}</div>
      </div>
      <div class="user-stat-item">
        <div class="user-stat-label">📍 Country</div>
        <div class="user-stat-value">${foundUser.data.registrationCountry || 'N/A'}</div>
      </div>
    `;
    
  } catch (error) {
    console.error('Error searching user analytics:', error);
    contentDiv.innerHTML = `<div style="grid-column: 1/-1; color: #ff6666;">❌ Error: ${error.message}</div>`;
  }
}

function setupRefreshButton() {
  const refreshBtn = document.getElementById('refreshAnalyticsBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      refreshBtn.textContent = '⏳ Refreshing...';
      loadPlatformAnalytics().then(() => {
        refreshBtn.textContent = '🔄 Refresh Now';
      });
    });
  }
}

// Token Minting System
async function initTokenMinting() {
  await loadTokenStatistics();
  await loadTransactionHistory();
  setupTokenMintingListeners();
}

function setupTokenMintingListeners() {
  const clearBtn = document.getElementById('clearMintFormBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      document.getElementById('mintRecipientUID').value = '';
      document.getElementById('mintAmount').value = '';
      document.getElementById('mintNote').value = '';
      document.getElementById('mintResult').style.display = 'none';
    });
  }

  const lookupBtn = document.getElementById('lookupBalanceBtn');
  if (lookupBtn) {
    lookupBtn.addEventListener('click', async () => {
      await lookupUserTokenBalance();
    });
  }

  const lookupInput = document.getElementById('balanceLookupInput');
  if (lookupInput) {
    lookupInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        lookupUserTokenBalance();
      }
    });
  }

  const txnFilter = document.getElementById('txnFilter');
  if (txnFilter) {
    txnFilter.addEventListener('change', async () => {
      await loadTransactionHistory();
    });
  }
}

async function loadTokenStatistics() {
  try {
    const txnsSnapshot = await getDocs(collection(db, 'tokenTransactions'));
    const txns = txnsSnapshot.docs.map(d => d.data());
    
    // Total tokens minted
    const totalMinted = txns
      .filter(t => t.type === 'mint')
      .reduce((sum, t) => sum + (t.amount || 0), 0);
    
    document.getElementById('totalTokensMinted').textContent = totalMinted.toLocaleString();
    document.getElementById('totalTokenTxns').textContent = txns.length;
    
    // Last mint time
    const lastMint = txns
      .filter(t => t.type === 'mint')
      .sort((a, b) => (b.createdAt?.toDate?.() || 0) - (a.createdAt?.toDate?.() || 0))[0];
    
    if (lastMint && lastMint.createdAt) {
      const lastTime = lastMint.createdAt.toDate?.() || new Date(lastMint.createdAt);
      const timeStr = lastTime.toLocaleString();
      document.getElementById('lastMintTime').textContent = timeStr;
    }
  } catch (error) {
    console.error('Error loading token statistics:', error);
  }
}

async function loadTransactionHistory() {
  try {
    const filter = document.getElementById('txnFilter')?.value || 'all';
    let txnsSnapshot = await getDocs(
      query(
        collection(db, 'tokenTransactions'),
        orderBy('createdAt', 'desc'),
        limit(20)
      )
    );
    
    let txns = txnsSnapshot.docs.map(d => d.data());
    
    if (filter !== 'all') {
      txns = txns.filter(t => t.type === filter);
    }
    
    const txnsList = document.getElementById('transactionsList');
    txnsList.innerHTML = '';
    
    if (txns.length === 0) {
      txnsList.innerHTML = '<div class="loading-message">No transactions found</div>';
      return;
    }
    
    txns.forEach(txn => {
      const txnTime = txn.createdAt?.toDate?.() || new Date(txn.createdAt);
      const timeStr = txnTime.toLocaleString();
      
      const txnEl = document.createElement('div');
      txnEl.className = 'transaction-item';
      txnEl.innerHTML = `
        <div class="transaction-info">
          <div class="transaction-type">
            ${txn.type === 'mint' ? '🚀' : txn.type === 'transfer' ? '➡️' : '🔥'} 
            ${txn.type.toUpperCase()}
          </div>
          <div class="transaction-details">
            ${txn.note ? `<strong>${txn.note}</strong> • ` : ''}
            By: ${txn.admin || 'system'} • ${timeStr}
          </div>
        </div>
        <div class="transaction-amount">+${txn.amount} tokens</div>
      `;
      txnsList.appendChild(txnEl);
    });
  } catch (error) {
    console.error('Error loading transaction history:', error);
    document.getElementById('transactionsList').innerHTML = `<div class="loading-message" style="color: red;">Error: ${error.message}</div>`;
  }
}

async function lookupUserTokenBalance() {
  const searchTerm = (document.getElementById('balanceLookupInput')?.value || '').trim();
  const resultDiv = document.getElementById('balanceResult');
  
  if (!searchTerm) {
    resultDiv.style.display = 'none';
    return;
  }
  
  try {
    resultDiv.innerHTML = '<div style="color: #888;">🔍 Searching...</div>';
    resultDiv.style.display = 'block';
    
    let user = null;
    
    // Try UID first
    const userRef = doc(db, 'users', searchTerm);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      user = { id: searchTerm, data: userSnap.data() };
    } else {
      // Try email
      const emailQuery = await getDocs(query(collection(db, 'users'), where('email', '==', searchTerm)));
      if (emailQuery.docs.length > 0) {
        user = { id: emailQuery.docs[0].id, data: emailQuery.docs[0].data() };
      }
    }
    
    if (!user) {
      resultDiv.className = 'balance-result not-found';
      resultDiv.innerHTML = `<div style="color: #ff3c3c;">❌ User not found</div>`;
      return;
    }
    
    resultDiv.className = 'balance-result';
    resultDiv.innerHTML = `
      <div class="balance-item">
        <div class="balance-label">Username</div>
        <div class="balance-value">${user.data.username || user.data.displayName || 'N/A'}</div>
      </div>
      <div class="balance-item">
        <div class="balance-label">Email</div>
        <div class="balance-value" style="font-size: 0.95rem; word-break: break-all;">${user.data.email || 'N/A'}</div>
      </div>
      <div class="balance-item">
        <div class="balance-label">💰 Current Token Balance</div>
        <div class="balance-value">${(user.data.tokens || 0).toLocaleString()} tokens</div>
      </div>
      <div class="balance-item">
        <div class="balance-label">User ID</div>
        <div class="balance-value" style="font-size: 0.85rem; word-break: break-all;">${user.id}</div>
      </div>
    `;
  } catch (error) {
    console.error('Error looking up balance:', error);
    resultDiv.className = 'balance-result not-found';
    resultDiv.innerHTML = `<div style="color: #ff3c3c;">❌ Error: ${error.message}</div>`;
    resultDiv.style.display = 'block';
  }
}

window.openVideoReportModal = openVideoReportModal;
window.markReportReviewed = markReportReviewed;
window.banCreatorFromReport = banCreatorFromReport;
window.dismissReport = dismissReport;
window.loadVideoReports = loadVideoReports;