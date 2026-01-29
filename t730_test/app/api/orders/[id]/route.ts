/**
 * @file app/api/orders/[id]/route.ts
 * @description Get/update individual order
 */

import { NextRequest, NextResponse } from 'next/server';

// Shared order storage (in production, use database)
// Import from main orders route or use shared module
const orders = new Map<string, any>();

// Re-seed if empty (for prototype)
function ensureTestData() {
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

interface RouteParams {
  params: { id: string };
}

/**
 * GET /api/orders/[id]
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  ensureTestData();
  
  const { id } = params;
  const order = orders.get(id);
  
  if (!order) {
    return NextResponse.json(
      { success: false, error: 'Order not found' },
      { status: 404 }
    );
  }
  
  return NextResponse.json({
    success: true,
    order,
  });
}

/**
 * PATCH /api/orders/[id]
 * Update order status
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  ensureTestData();
  
  const { id } = params;
  const order = orders.get(id);
  
  if (!order) {
    return NextResponse.json(
      { success: false, error: 'Order not found' },
      { status: 404 }
    );
  }
  
  try {
    const body = await request.json();
    
    // Update allowed fields
    if (body.status) order.status = body.status;
    if (body.compartmentId) order.compartmentId = body.compartmentId;
    if (body.pickupCode) order.pickupCode = body.pickupCode;
    if (body.pickedUpAt) order.pickedUpAt = body.pickedUpAt;
    
    orders.set(id, order);
    
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
