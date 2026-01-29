/**
 * @file app/api/lockers/pickup/route.ts
 * @description Validate pickup code and unlock locker
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateAndUnlock } from '@/lib/db/lockerService';

export async function POST(request: NextRequest) {
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
    
    // Rate limiting could be added here
    // e.g., check IP, limit to 5 attempts per minute
    
    const result = await validateAndUnlock(code);
    
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }
    
    return NextResponse.json({
      success: true,
      compartmentId: result.compartmentId,
      orderNumber: result.orderNumber,
      message: 'Locker is opening. Please collect your order.',
    });
  } catch (error) {
    console.error('[API] Pickup error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
