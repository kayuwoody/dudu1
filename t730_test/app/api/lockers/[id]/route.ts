/**
 * @file app/api/lockers/[id]/route.ts
 * @description Operations on individual compartments - sends real commands to ESP32
 */

import { NextRequest, NextResponse } from 'next/server';

// Default ESP32 address for prototype (192.168.150.x network)
const DEFAULT_ESP32_IP = '192.168.150.3';
const DEFAULT_ESP32_PORT = 80;

// Column registry - populated by announce endpoint
const columnRegistry = new Map<string, { ip: string; port: number; online: boolean }>();

// Compartment status cache
const compartmentCache = new Map<string, any>();

interface RouteParams {
  params: { id: string };
}

/**
 * Send command to ESP32
 */
async function sendToESP32(
  compartmentId: string,
  endpoint: string,
  body?: Record<string, any>
): Promise<{ success: boolean; data?: any; error?: string }> {
  // Parse compartmentId: "COL-001-2" -> column "COL-001", locker index 2
  const parts = compartmentId.split('-');
  const lockerIndex = parseInt(parts[parts.length - 1], 10);
  const columnId = parts.slice(0, -1).join('-');
  
  // Get ESP32 address
  const column = columnRegistry.get(columnId);
  const ip = column?.ip || DEFAULT_ESP32_IP;
  const port = column?.port || DEFAULT_ESP32_PORT;
  
  const url = `http://${ip}:${port}/api/locker/${lockerIndex}${endpoint}`;
  console.log(`[Locker] Sending to ${url}:`, body);
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    });
    
    const data = await response.json();
    console.log(`[Locker] ESP32 response:`, data);
    return { success: data.success, data };
  } catch (error: any) {
    console.error(`[Locker] ESP32 error:`, error.message);
    return { success: false, error: `ESP32 unreachable: ${error.message}` };
  }
}

/**
 * GET /api/lockers/[id]
 * Get compartment status - queries ESP32 directly
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = params;
    
    // Parse compartmentId
    const parts = id.split('-');
    const lockerIndex = parseInt(parts[parts.length - 1], 10);
    const columnId = parts.slice(0, -1).join('-');
    
    // Get ESP32 address
    const column = columnRegistry.get(columnId);
    const ip = column?.ip || DEFAULT_ESP32_IP;
    const port = column?.port || DEFAULT_ESP32_PORT;
    
    // Query ESP32 for live status
    try {
      const response = await fetch(`http://${ip}:${port}/api/status`, {
        signal: AbortSignal.timeout(3000),
      });
      const data = await response.json();
      
    // ESP32 returns { columnId, lockers: [...] } without a success field
    if (data.lockers && data.lockers[lockerIndex]) {
      const locker = data.lockers[lockerIndex];
      // Sensors are nested under locker.sensors in ESP32 response
      const sensors = locker.sensors || {};
      return NextResponse.json({
        success: true,
        compartment: {
          id,
          columnId,
          lockerIndex,
          status: locker.state?.toLowerCase() || 'unknown',
        },
        sensors: {
          doorClosed: sensors.doorClosed ?? false,
          doorOpen: sensors.doorOpen ?? false,
          irBeamClear: sensors.irBeamClear ?? true,
          occupied: sensors.occupied ?? false,
          tempOk: sensors.tempOk ?? true,
          safetyOk: sensors.safetyOk ?? true,
          motorFault: sensors.motorFault ?? false,
          online: true,
        });
      }
    } catch (error) {
      console.log(`[Locker] ESP32 unreachable, returning cached/default`);
    }
    
    // Return cached or default if ESP32 unreachable
    const cached = compartmentCache.get(id);
    return NextResponse.json({
      success: true,
      compartment: cached || {
        id,
        columnId,
        lockerIndex,
        status: 'unknown',
      },
      sensors: null,
      online: false,
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
 * Perform action on compartment - sends command to ESP32
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
    
    let result: { success: boolean; data?: any; error?: string };
    
    switch (body.action) {
      case 'unlock':
        // POST /api/locker/{n}/unlock
        result = await sendToESP32(id, '/unlock', { requestId: body.requestId || `unlock-${Date.now()}` });
        break;
        
      case 'lock':
        // POST /api/locker/{n}/lock
        result = await sendToESP32(id, '/lock', { requestId: body.requestId || `lock-${Date.now()}` });
        break;
        
      case 'led':
        // POST /api/locker/{n}/output { output: 'led', state: true/false }
        if (body.state === undefined) {
          return NextResponse.json(
            { success: false, error: 'Missing state for LED action' },
            { status: 400 }
          );
        }
        result = await sendToESP32(id, '/output', { output: 'led', state: body.state });
        break;
        
      case 'display':
        // POST /api/locker/{n}/display { screen: '...', data: {...} }
        if (!body.screen) {
          return NextResponse.json(
            { success: false, error: 'Missing screen for display action' },
            { status: 400 }
          );
        }
        result = await sendToESP32(id, '/display', { screen: body.screen, data: body.data || {} });
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
        { status: 500 }
      );
    }
    
    return NextResponse.json({ success: true, data: result.data });
  } catch (error) {
    console.error('[API] Compartment action error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Export registry for other endpoints
export { columnRegistry, compartmentCache };
