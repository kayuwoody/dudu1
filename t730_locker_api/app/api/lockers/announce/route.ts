/**
 * @file app/api/lockers/announce/route.ts
 * @description Handle ESP32 column announcements on boot
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleColumnAnnounce } from '@/lib/db/lockerService';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate required fields
    if (!body.columnId || !body.ip || !body.lockerCount) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }
    
    await handleColumnAnnounce({
      columnId: body.columnId,
      ip: body.ip,
      port: body.port || 80,
      lockerCount: body.lockerCount,
      firmwareVersion: body.firmwareVersion || 'unknown',
      uptime: body.uptime || 0,
    });
    
    return NextResponse.json({
      success: true,
      serverTime: new Date().toISOString(),
      config: {
        pollInterval: 5000,
        heartbeatInterval: 30000,
      },
    });
  } catch (error) {
    console.error('[API] Announce error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
