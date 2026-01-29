/**
 * @file app/api/lockers/assign/route.ts
 * @description Assign order to locker compartment
 */

import { NextRequest, NextResponse } from 'next/server';
import { 
  assignOrderToLocker, 
  markOrderLoaded,
  getAvailableCompartments,
} from '@/lib/db/lockerService';

/**
 * POST /api/lockers/assign
 * Assign an order to a locker compartment
 * 
 * Body: { orderId: string, compartmentId?: string, size?: 'S' | 'M' | 'L' }
 * 
 * If compartmentId not provided, auto-assign to first available
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
    
    let compartmentId = body.compartmentId;
    
    // Auto-assign if no compartment specified
    if (!compartmentId) {
      const available = getAvailableCompartments(body.size);
      
      if (available.length === 0) {
        return NextResponse.json(
          { success: false, error: 'No available compartments' },
          { status: 400 }
        );
      }
      
      compartmentId = available[0].id;
    }
    
    const result = await assignOrderToLocker(body.orderId, compartmentId);
    
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }
    
    return NextResponse.json({
      success: true,
      compartmentId,
      pickupCode: result.pickupCode,
    });
  } catch (error) {
    console.error('[API] Assign error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
