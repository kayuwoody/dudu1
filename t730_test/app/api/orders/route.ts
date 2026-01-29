/**
 * @file app/api/orders/route.ts
 * @description Orders API for T730 standalone operation
 * 
 * In standalone mode, orders are cached locally and synced with main POS when online.
 * For prototype, we'll use in-memory storage that can be replaced with SQLite.
 */

import { NextRequest, NextResponse } from 'next/server';

// In-memory order storage (replace with SQLite for production)
// This simulates orders that would come from main POS
const orders = new Map<string, any>();

// Seed some test orders for prototype
function seedTestOrders() {
  if (orders.size === 0) {
    const testOrders = [
      {
        id: 'ord_001',
        orderNumber: 'A042',
        customerName: 'John D.',
        customerPhone: '+60 12-345 6789',
        items: [
          { name: 'Latte', quantity: 2 },
          { name: 'Croissant', quantity: 1, notes: 'Extra butter' },
        ],
        compartmentId: 'COL-001-1',
        pickupCode: 'ABC123',
        status: 'ready_for_delivery',
        createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      },
      {
        id: 'ord_002',
        orderNumber: 'A043',
        customerName: 'Sarah M.',
        customerPhone: '+60 12-999 8888',
        items: [
          { name: 'Cappuccino', quantity: 1 },
          { name: 'Muffin', quantity: 2 },
        ],
        compartmentId: 'COL-001-2',
        pickupCode: 'XYZ789',
        status: 'ready_for_delivery',
        createdAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      },
      {
        id: 'ord_003',
        orderNumber: 'A041',
        customerName: 'Mike T.',
        customerPhone: '+60 11-222 3333',
        items: [
          { name: 'Espresso', quantity: 2 },
        ],
        compartmentId: 'COL-001-0',
        pickupCode: 'QWE456',
        status: 'delivered',
        createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      },
    ];
    
    testOrders.forEach(order => orders.set(order.id, order));
  }
}

/**
 * GET /api/orders
 * List orders, optionally filtered by status and fulfillment type
 */
export async function GET(request: NextRequest) {
  seedTestOrders();
  
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const fulfillmentType = searchParams.get('fulfillmentType');
  
  let filteredOrders = Array.from(orders.values());
  
  // Filter by status (comma-separated)
  if (status) {
    const statuses = status.split(',');
    filteredOrders = filteredOrders.filter(o => statuses.includes(o.status));
  }
  
  // Filter by fulfillment type
  if (fulfillmentType) {
    filteredOrders = filteredOrders.filter(o => 
      o.fulfillmentType === fulfillmentType || fulfillmentType === 'locker'
    );
  }
  
  // Sort by created date descending
  filteredOrders.sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  
  return NextResponse.json({
    success: true,
    orders: filteredOrders,
  });
}

/**
 * POST /api/orders
 * Create a new order (for testing/manual entry)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const order = {
      id: `ord_${Date.now()}`,
      orderNumber: body.orderNumber || `A${Math.floor(Math.random() * 1000)}`,
      customerName: body.customerName || 'Guest',
      customerPhone: body.customerPhone,
      items: body.items || [],
      compartmentId: body.compartmentId,
      pickupCode: body.pickupCode || generatePickupCode(),
      status: 'ready_for_delivery',
      fulfillmentType: 'locker',
      createdAt: new Date().toISOString(),
    };
    
    orders.set(order.id, order);
    
    return NextResponse.json({
      success: true,
      order,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Invalid request' },
      { status: 400 }
    );
  }
}

function generatePickupCode(): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
