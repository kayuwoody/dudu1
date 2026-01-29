/**
 * @file app/api/lockers/pickup/route.ts
 * @description Validate pickup code and unlock locker
 * 
 * For prototype: validates against local order cache and sends
 * real unlock command to ESP32 on local network.
 * 
 * Uses column registry populated by /api/lockers/announce
 * for dynamic ESP32 IP resolution.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getColumn } from '@/lib/db/lockerService';

// Shared order storage - same reference as orders API
// In production, this would be a database query
const orders = new Map<string, any>();

// Seed test orders if empty
function ensureOrders() {
  if (orders.size === 0) {
    const testOrders = [
      {
        id: 'ord_001',
        orderNumber: 'A042',
        customerName: 'John D.',
        compartmentId: 'COL-001-1',
        pickupCode: 'ABC123',
        status: 'delivered',  // Must be 'delivered' (in locker) to be valid
        pickedUpAt: null,
      },
      {
        id: 'ord_002',
        orderNumber: 'A043',
        customerName: 'Sarah M.',
        compartmentId: 'COL-001-2',
        pickupCode: 'XYZ789',
        status: 'delivered',
        pickedUpAt: null,
      },
    ];
    testOrders.forEach(o => orders.set(o.id, o));
  }
}

// Default ESP32 address for prototype (fallback if announce hasn't happened)
const DEFAULT_ESP32_IP = '192.168.150.3';
const DEFAULT_ESP32_PORT = 80;

/**
 * Send unlock command directly to ESP32
 * 
 * Uses column registry for dynamic IP lookup.
 * Falls back to DEFAULT_ESP32_IP if column not registered.
 */
async function unlockLocker(compartmentId: string): Promise<{ success: boolean; error?: string }> {
  // Parse compartmentId: "COL-001-2" -> column "COL-001", locker index 2
  const parts = compartmentId.split('-');
  const lockerIndex = parseInt(parts[parts.length - 1], 10);
  const columnId = parts.slice(0, -1).join('-');
  
  // Get ESP32 address from shared registry, or use default
  const column = getColumn(columnId);
  const ip = column?.ip || DEFAULT_ESP32_IP;
  const port = column?.port || DEFAULT_ESP32_PORT;
  
  console.log(`[Pickup] Column ${columnId} -> ${column ? 'registered' : 'not found, using default'}`);
  console.log(`[Pickup] Sending unlock to ESP32 at ${ip}:${port} for locker ${lockerIndex}`);
  
  try {
    const response = await fetch(`http://${ip}:${port}/api/locker/${lockerIndex}/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: `pickup-${Date.now()}` }),
      signal: AbortSignal.timeout(5000),
    });
    
    const data = await response.json();
    console.log(`[Pickup] ESP32 response:`, data);
    
    return { success: data.success };
  } catch (error: any) {
    console.error(`[Pickup] ESP32 communication failed:`, error.message);
    return { success: false, error: `ESP32 unreachable: ${error.message}` };
  }
}

export async function POST(request: NextRequest) {
  ensureOrders();
  
  try {
    const body = await request.json();
    
    if (!body.code) {
      return NextResponse.json(
        { success: false, error: 'Missing pickup code' },
        { status: 400 }
      );
    }
    
    // Normalize code (uppercase, remove spaces)
    const code = body.code.toString().toUpperCase().replace(/\s/g, '');
    
    console.log(`[Pickup] Validating code: ${code}`);
    
    // Find order by pickup code
    let foundOrder: any = null;
    for (const order of orders.values()) {
      if (order.pickupCode === code && !order.pickedUpAt) {
        foundOrder = order;
        break;
      }
    }
    
    if (!foundOrder) {
      console.log(`[Pickup] Code not found or already used: ${code}`);
      return NextResponse.json(
        { success: false, error: 'Invalid or expired pickup code' },
        { status: 400 }
      );
    }
    
    console.log(`[Pickup] Found order: ${foundOrder.orderNumber} -> ${foundOrder.compartmentId}`);
    
    // Extract locker number for display
    const lockerNumber = parseInt(foundOrder.compartmentId.split('-').pop(), 10) + 1;
    
    // Send unlock command to ESP32
    const unlockResult = await unlockLocker(foundOrder.compartmentId);
    
    if (!unlockResult.success) {
      return NextResponse.json(
        { success: false, error: unlockResult.error || 'Failed to unlock locker' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({
      success: true,
      compartmentId: foundOrder.compartmentId,
      orderNumber: foundOrder.orderNumber,
      lockerNumber,
      message: 'Locker is opening. Please collect your order.',
    });
  } catch (error: any) {
    console.error('[Pickup] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
