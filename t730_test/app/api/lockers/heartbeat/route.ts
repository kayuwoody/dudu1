/**
 * @file app/api/lockers/heartbeat/route.ts
 * @description Handle periodic heartbeat from ESP32 columns
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleHeartbeat } from '@/lib/db/lockerService';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    if (!body.columnId || !body.lockers) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }
    
    // Get IP from body (ESP32 sends it), fallback to headers
    const bodyIp = body.ip;
    const headerIp = request.headers.get('x-forwarded-for')?.split(',')[0] 
      || request.headers.get('x-real-ip')
      || undefined;
    const clientIp = bodyIp || headerIp;
    
    await handleHeartbeat({
      columnId: body.columnId,
      uptime: body.uptime || 0,
      lockers: body.lockers,
      ip: body.ip,
      port: body.port,
    }, clientIp);
    
    return NextResponse.json({
      success: true,
      pendingCommands: [],  // Future: queue commands for ESP32 to execute
    });
  } catch (error) {
    console.error('[API] Heartbeat error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
