/**
 * @file lib/db/lockerService.ts
 * @description Locker system database operations and ESP32 communication
 */

import db from './init';  // Your existing db connection
import { nanoid } from 'nanoid';  // Or your existing ID generator

// ============================================
// Types
// ============================================

export interface LockerColumn {
  id: string;
  ip: string;
  port: number;
  lockerCount: number;
  firmwareVersion: string;
  lastSeen: string;
  isOnline: boolean;
}

export interface Compartment {
  id: string;
  columnId: string;
  lockerIndex: number;
  size: 'S' | 'M' | 'L';
  status: 'available' | 'reserved' | 'occupied' | 'open' | 'fault';
  currentOrderId: string | null;
  lastStatusChange: string;
}

export interface LockerEvent {
  id: string;
  compartmentId: string;
  event: string;
  data: Record<string, any> | null;
  timestamp: string;
}

export interface LockerSensorState {
  doorClosed: boolean;
  doorOpen: boolean;
  irBeamClear: boolean;
  occupied: boolean;
  tempOk: boolean;
  safetyOk: boolean;
  motorFault: boolean;
}

// ============================================
// In-Memory Column Registry
// ============================================

const columnRegistry = new Map<string, LockerColumn & { sensors: LockerSensorState[] }>();

/**
 * Get all registered columns
 */
export function getColumns(): LockerColumn[] {
  return Array.from(columnRegistry.values());
}

/**
 * Get specific column
 */
export function getColumn(columnId: string): LockerColumn | undefined {
  return columnRegistry.get(columnId);
}

/**
 * Check if column is online (seen within last 60 seconds)
 */
export function isColumnOnline(columnId: string): boolean {
  const column = columnRegistry.get(columnId);
  if (!column) return false;
  const lastSeen = new Date(column.lastSeen).getTime();
  return Date.now() - lastSeen < 60000;
}

// ============================================
// ESP32 Communication
// ============================================

/**
 * Send command to ESP32 column
 */
async function sendToColumn(
  columnId: string, 
  endpoint: string, 
  body?: Record<string, any>
): Promise<{ success: boolean; data?: any; error?: string }> {
  const column = columnRegistry.get(columnId);
  
  if (!column) {
    return { success: false, error: 'Column not found' };
  }
  
  if (!isColumnOnline(columnId)) {
    return { success: false, error: 'Column offline' };
  }
  
  try {
    const url = `http://${column.ip}:${column.port}${endpoint}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),  // 5 second timeout
    });
    
    const data = await response.json();
    return { success: data.success, data };
  } catch (error) {
    console.error(`[Locker] Failed to contact ${columnId}:`, error);
    return { success: false, error: 'Communication failed' };
  }
}

// ============================================
// Column Registration
// ============================================

/**
 * Handle column announcement (ESP32 boot)
 */
export async function handleColumnAnnounce(data: {
  columnId: string;
  ip: string;
  port: number;
  lockerCount: number;
  firmwareVersion: string;
  uptime: number;
}): Promise<void> {
  const now = new Date().toISOString();
  
  // Update in-memory registry
  columnRegistry.set(data.columnId, {
    id: data.columnId,
    ip: data.ip,
    port: data.port,
    lockerCount: data.lockerCount,
    firmwareVersion: data.firmwareVersion,
    lastSeen: now,
    isOnline: true,
    sensors: Array(data.lockerCount).fill(null).map(() => ({
      doorClosed: false,
      doorOpen: false,
      irBeamClear: true,
      occupied: false,
      tempOk: true,
      safetyOk: true,
      motorFault: false,
    })),
  });
  
  // Persist to database
  db.prepare(`
    INSERT INTO LockerColumn (id, ip, port, lockerCount, firmwareVersion, lastSeen, isOnline)
    VALUES (?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(id) DO UPDATE SET
      ip = excluded.ip,
      port = excluded.port,
      lockerCount = excluded.lockerCount,
      firmwareVersion = excluded.firmwareVersion,
      lastSeen = excluded.lastSeen,
      isOnline = 1
  `).run(data.columnId, data.ip, data.port, data.lockerCount, data.firmwareVersion, now);
  
  // Ensure compartments exist
  for (let i = 0; i < data.lockerCount; i++) {
    const compartmentId = `${data.columnId}-${i}`;
    db.prepare(`
      INSERT OR IGNORE INTO Compartment (id, columnId, lockerIndex, status, lastStatusChange)
      VALUES (?, ?, ?, 'available', ?)
    `).run(compartmentId, data.columnId, i, now);
  }
  
  console.log(`[Locker] Column ${data.columnId} registered: ${data.ip}:${data.port} (${data.lockerCount} lockers)`);
}

/**
 * Handle heartbeat from ESP32
 */
export async function handleHeartbeat(data: {
  columnId: string;
  uptime: number;
  lockers: Array<{
    index: number;
    doorClosed: boolean;
    doorOpen: boolean;
    irBeamClear: boolean;
    occupied: boolean;
    tempOk: boolean;
    safetyOk: boolean;
    motorFault: boolean;
  }>;
}): Promise<void> {
  const column = columnRegistry.get(data.columnId);
  if (!column) {
    console.warn(`[Locker] Heartbeat from unknown column: ${data.columnId}`);
    return;
  }
  
  // Update last seen
  column.lastSeen = new Date().toISOString();
  column.isOnline = true;
  
  // Update sensor states
  for (const locker of data.lockers) {
    if (locker.index < column.sensors.length) {
      column.sensors[locker.index] = {
        doorClosed: locker.doorClosed,
        doorOpen: locker.doorOpen,
        irBeamClear: locker.irBeamClear,
        occupied: locker.occupied,
        tempOk: locker.tempOk,
        safetyOk: locker.safetyOk,
        motorFault: locker.motorFault,
      };
    }
  }
  
  // Update database
  db.prepare(`
    UPDATE LockerColumn SET lastSeen = ?, isOnline = 1 WHERE id = ?
  `).run(column.lastSeen, data.columnId);
}

/**
 * Handle event from ESP32
 */
export async function handleLockerEvent(data: {
  columnId: string;
  timestamp: string | number;
  event: string;
  lockerIndex: number;
  data?: Record<string, any>;
}): Promise<void> {
  const compartmentId = `${data.columnId}-${data.lockerIndex}`;
  const now = new Date().toISOString();
  const eventTimestamp = typeof data.timestamp === 'number' 
    ? new Date(data.timestamp).toISOString() 
    : data.timestamp;
  
  console.log(`[Locker] Event: ${data.event} on ${compartmentId}`);
  
  // Log event
  db.prepare(`
    INSERT INTO LockerEvent (id, compartmentId, event, data, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `).run(nanoid(), compartmentId, data.event, JSON.stringify(data.data || {}), eventTimestamp);
  
  // Update compartment status based on event
  switch (data.event) {
    case 'DOOR_OPENED':
      db.prepare(`
        UPDATE Compartment SET status = 'open', lastStatusChange = ? WHERE id = ?
      `).run(now, compartmentId);
      break;
      
    case 'DOOR_CLOSED':
      // Check if it was occupied before
      const compartment = db.prepare(`
        SELECT currentOrderId FROM Compartment WHERE id = ?
      `).get(compartmentId) as { currentOrderId: string | null } | undefined;
      
      const newStatus = compartment?.currentOrderId ? 'occupied' : 'available';
      db.prepare(`
        UPDATE Compartment SET status = ?, lastStatusChange = ? WHERE id = ?
      `).run(newStatus, now, compartmentId);
      break;
      
    case 'ITEM_REMOVED':
      // Order picked up
      const comp = db.prepare(`
        SELECT currentOrderId FROM Compartment WHERE id = ?
      `).get(compartmentId) as { currentOrderId: string | null } | undefined;
      
      if (comp?.currentOrderId) {
        // Mark order as picked up
        db.prepare(`
          UPDATE "Order" SET pickedUpAt = ? WHERE id = ?
        `).run(now, comp.currentOrderId);
        
        // Clear compartment
        db.prepare(`
          UPDATE Compartment SET status = 'available', currentOrderId = NULL, lastStatusChange = ? WHERE id = ?
        `).run(now, compartmentId);
        
        console.log(`[Locker] Order ${comp.currentOrderId} picked up from ${compartmentId}`);
      }
      break;
      
    case 'MOTOR_FAULT':
    case 'SAFETY_TRIPPED':
      db.prepare(`
        UPDATE Compartment SET status = 'fault', lastStatusChange = ? WHERE id = ?
      `).run(now, compartmentId);
      // TODO: Send alert to staff
      break;
      
    case 'MOTOR_FAULT_CLEARED':
    case 'SAFETY_CLEARED':
      db.prepare(`
        UPDATE Compartment SET status = 'available', lastStatusChange = ? WHERE id = ?
      `).run(now, compartmentId);
      break;
  }
}

// ============================================
// Locker Operations
// ============================================

/**
 * Unlock a specific locker
 */
export async function unlockLocker(
  compartmentId: string,
  requestId?: string
): Promise<{ success: boolean; error?: string }> {
  const [columnId, indexStr] = compartmentId.split('-');
  const lockerIndex = parseInt(indexStr, 10);
  
  if (isNaN(lockerIndex)) {
    return { success: false, error: 'Invalid compartment ID' };
  }
  
  const result = await sendToColumn(columnId, `/api/locker/${lockerIndex}/unlock`, {
    requestId: requestId || nanoid(),
  });
  
  return result;
}

/**
 * Lock a specific locker
 */
export async function lockLocker(
  compartmentId: string,
  requestId?: string
): Promise<{ success: boolean; error?: string }> {
  const [columnId, indexStr] = compartmentId.split('-');
  const lockerIndex = parseInt(indexStr, 10);
  
  if (isNaN(lockerIndex)) {
    return { success: false, error: 'Invalid compartment ID' };
  }
  
  const result = await sendToColumn(columnId, `/api/locker/${lockerIndex}/lock`, {
    requestId: requestId || nanoid(),
  });
  
  return result;
}

/**
 * Update locker display
 */
export async function updateLockerDisplay(
  compartmentId: string,
  screen: string,
  data: Record<string, any>
): Promise<{ success: boolean; error?: string }> {
  const [columnId, indexStr] = compartmentId.split('-');
  const lockerIndex = parseInt(indexStr, 10);
  
  if (isNaN(lockerIndex)) {
    return { success: false, error: 'Invalid compartment ID' };
  }
  
  return sendToColumn(columnId, `/api/locker/${lockerIndex}/display`, {
    screen,
    data,
  });
}

/**
 * Set LED state
 */
export async function setLockerLED(
  compartmentId: string,
  on: boolean
): Promise<{ success: boolean; error?: string }> {
  const [columnId, indexStr] = compartmentId.split('-');
  const lockerIndex = parseInt(indexStr, 10);
  
  if (isNaN(lockerIndex)) {
    return { success: false, error: 'Invalid compartment ID' };
  }
  
  return sendToColumn(columnId, `/api/locker/${lockerIndex}/output`, {
    output: 'led',
    state: on,
  });
}

// ============================================
// Pickup Code Operations
// ============================================

/**
 * Generate a unique 6-digit pickup code
 */
export function generatePickupCode(): string {
  // Generate random 6-digit code, avoid confusing chars
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * Assign order to locker compartment
 */
export async function assignOrderToLocker(
  orderId: string,
  compartmentId: string
): Promise<{ success: boolean; pickupCode?: string; error?: string }> {
  const now = new Date().toISOString();
  
  // Check compartment is available
  const compartment = db.prepare(`
    SELECT status, currentOrderId FROM Compartment WHERE id = ?
  `).get(compartmentId) as Compartment | undefined;
  
  if (!compartment) {
    return { success: false, error: 'Compartment not found' };
  }
  
  if (compartment.status !== 'available') {
    return { success: false, error: `Compartment is ${compartment.status}` };
  }
  
  // Generate pickup code
  const pickupCode = generatePickupCode();
  
  // Update order
  db.prepare(`
    UPDATE "Order" SET compartmentId = ?, pickupCode = ?, fulfillmentType = 'locker' WHERE id = ?
  `).run(compartmentId, pickupCode, orderId);
  
  // Reserve compartment
  db.prepare(`
    UPDATE Compartment SET status = 'reserved', currentOrderId = ?, lastStatusChange = ? WHERE id = ?
  `).run(orderId, now, compartmentId);
  
  // Update display
  await updateLockerDisplay(compartmentId, 'RESERVED', {
    orderNumber: orderId.slice(-4).toUpperCase(),
    message: 'Preparing...',
  });
  
  console.log(`[Locker] Order ${orderId} assigned to ${compartmentId}, code: ${pickupCode}`);
  
  return { success: true, pickupCode };
}

/**
 * Mark order as loaded into locker (staff action)
 */
export async function markOrderLoaded(orderId: string): Promise<{ success: boolean; error?: string }> {
  const now = new Date().toISOString();
  
  // Get order's compartment
  const order = db.prepare(`
    SELECT compartmentId, pickupCode FROM "Order" WHERE id = ?
  `).get(orderId) as { compartmentId: string; pickupCode: string } | undefined;
  
  if (!order || !order.compartmentId) {
    return { success: false, error: 'Order not assigned to locker' };
  }
  
  // Update compartment status
  db.prepare(`
    UPDATE Compartment SET status = 'occupied', lastStatusChange = ? WHERE id = ?
  `).run(now, order.compartmentId);
  
  // Update display
  await updateLockerDisplay(order.compartmentId, 'ORDER_READY', {
    orderNumber: orderId.slice(-4).toUpperCase(),
    message: 'Ready for pickup!',
  });
  
  // Turn on LED
  await setLockerLED(order.compartmentId, true);
  
  // TODO: Send notification to customer (SMS/push)
  
  console.log(`[Locker] Order ${orderId} loaded into ${order.compartmentId}`);
  
  return { success: true };
}

/**
 * Validate pickup code and unlock locker
 */
export async function validateAndUnlock(
  pickupCode: string
): Promise<{ success: boolean; compartmentId?: string; orderNumber?: string; error?: string }> {
  // Find order by pickup code
  const order = db.prepare(`
    SELECT o.id, o.compartmentId, o.orderNumber 
    FROM "Order" o
    JOIN Compartment c ON o.compartmentId = c.id
    WHERE o.pickupCode = ? 
      AND o.pickedUpAt IS NULL
      AND c.status = 'occupied'
  `).get(pickupCode) as { id: string; compartmentId: string; orderNumber: string } | undefined;
  
  if (!order) {
    console.log(`[Locker] Invalid pickup code: ${pickupCode}`);
    return { success: false, error: 'Invalid or expired pickup code' };
  }
  
  // Trigger attention mode on display
  await updateLockerDisplay(order.compartmentId, 'PICKUP_ALERT', {
    orderNumber: order.orderNumber || order.id.slice(-4).toUpperCase(),
    message: 'Opening...',
  });
  
  // Unlock the locker
  const result = await unlockLocker(order.compartmentId, `pickup-${pickupCode}`);
  
  if (!result.success) {
    return { success: false, error: result.error || 'Failed to unlock' };
  }
  
  console.log(`[Locker] Pickup code ${pickupCode} validated, unlocking ${order.compartmentId}`);
  
  return { 
    success: true, 
    compartmentId: order.compartmentId,
    orderNumber: order.orderNumber || order.id.slice(-4).toUpperCase(),
  };
}

// ============================================
// Status Queries
// ============================================

/**
 * Get all compartments with their status
 */
export function getAllCompartments(): Compartment[] {
  return db.prepare(`
    SELECT * FROM Compartment ORDER BY columnId, lockerIndex
  `).all() as Compartment[];
}

/**
 * Get available compartments
 */
export function getAvailableCompartments(size?: 'S' | 'M' | 'L'): Compartment[] {
  if (size) {
    return db.prepare(`
      SELECT * FROM Compartment WHERE status = 'available' AND size = ? ORDER BY columnId, lockerIndex
    `).all(size) as Compartment[];
  }
  return db.prepare(`
    SELECT * FROM Compartment WHERE status = 'available' ORDER BY columnId, lockerIndex
  `).all() as Compartment[];
}

/**
 * Get compartment status including live sensor data
 */
export function getCompartmentStatus(compartmentId: string): {
  compartment: Compartment | null;
  sensors: LockerSensorState | null;
  online: boolean;
} {
  const compartment = db.prepare(`
    SELECT * FROM Compartment WHERE id = ?
  `).get(compartmentId) as Compartment | undefined;
  
  if (!compartment) {
    return { compartment: null, sensors: null, online: false };
  }
  
  const column = columnRegistry.get(compartment.columnId);
  const sensors = column?.sensors[compartment.lockerIndex] || null;
  const online = isColumnOnline(compartment.columnId);
  
  return { compartment, sensors, online };
}

// ============================================
// Maintenance
// ============================================

/**
 * Mark stale columns as offline (run periodically)
 */
export function checkColumnHealth(): void {
  const now = Date.now();
  
  for (const [id, column] of columnRegistry) {
    const lastSeen = new Date(column.lastSeen).getTime();
    if (now - lastSeen > 60000 && column.isOnline) {
      column.isOnline = false;
      db.prepare(`UPDATE LockerColumn SET isOnline = 0 WHERE id = ?`).run(id);
      console.log(`[Locker] Column ${id} marked offline`);
    }
  }
}

// Run health check every 30 seconds
setInterval(checkColumnHealth, 30000);
