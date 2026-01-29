/**
 * @file app/api/lockers/[id]/route.ts
 * @description Operations on individual compartments
 */

import { NextRequest, NextResponse } from 'next/server';
import { 
  getCompartmentStatus,
  unlockLocker,
  lockLocker,
  setLockerLED,
  updateLockerDisplay,
} from '@/lib/db/lockerService';

interface RouteParams {
  params: { id: string };
}

/**
 * GET /api/lockers/[id]
 * Get compartment status including live sensor data
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = params;
    const status = getCompartmentStatus(id);
    
    if (!status.compartment) {
      return NextResponse.json(
        { success: false, error: 'Compartment not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      ...status,
    });
  } catch (error) {
    console.error('[API] Compartment status error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/lockers/[id]
 * Perform action on compartment
 * 
 * Body: { action: 'unlock' | 'lock' | 'led' | 'display', ... }
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = params;
    const body = await request.json();
    
    if (!body.action) {
      return NextResponse.json(
        { success: false, error: 'Missing action' },
        { status: 400 }
      );
    }
    
    let result: { success: boolean; error?: string };
    
    switch (body.action) {
      case 'unlock':
        result = await unlockLocker(id, body.requestId);
        break;
        
      case 'lock':
        result = await lockLocker(id, body.requestId);
        break;
        
      case 'led':
        if (body.state === undefined) {
          return NextResponse.json(
            { success: false, error: 'Missing state for LED action' },
            { status: 400 }
          );
        }
        result = await setLockerLED(id, body.state);
        break;
        
      case 'display':
        if (!body.screen) {
          return NextResponse.json(
            { success: false, error: 'Missing screen for display action' },
            { status: 400 }
          );
        }
        result = await updateLockerDisplay(id, body.screen, body.data || {});
        break;
        
      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${body.action}` },
          { status: 400 }
        );
    }
    
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API] Compartment action error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
