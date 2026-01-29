/**
 * @file app/api/lockers/loaded/route.ts
 * @description Mark order as loaded into locker (staff action)
 */

import { NextRequest, NextResponse } from 'next/server';
import { markOrderLoaded } from '@/lib/db/lockerService';

/**
 * POST /api/lockers/loaded
 * Mark an order as loaded into its assigned locker
 * 
 * Body: { orderId: string }
 * 
 * This triggers:
 * - Compartment status → 'occupied'
 * - Display update → 'ORDER_READY'
 * - LED turns on
 * - (Future) Customer notification
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    if (!body.orderId) {
      return NextResponse.json(
        { success: false, error: 'Missing orderId' },
        { status: 400 }
      );
    }
    
    const result = await markOrderLoaded(body.orderId);
    
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }
    
    return NextResponse.json({
      success: true,
      message: 'Order marked as loaded, customer can now pick up',
    });
  } catch (error) {
    console.error('[API] Loaded error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
