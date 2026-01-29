/**
 * @file app/api/lockers/event/route.ts
 * @description Handle event notifications from ESP32 columns
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleLockerEvent } from '@/lib/db/lockerService';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    if (!body.columnId || !body.event || body.lockerIndex === undefined) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }
    
    await handleLockerEvent({
      columnId: body.columnId,
      timestamp: body.timestamp || new Date().toISOString(),
      event: body.event,
      lockerIndex: body.lockerIndex,
      data: body.data,
    });
    
    return NextResponse.json({
      success: true,
      ack: true,
    });
  } catch (error) {
    console.error('[API] Event error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
