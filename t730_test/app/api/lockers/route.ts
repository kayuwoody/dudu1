/**
 * @file app/api/lockers/route.ts
 * @description Get locker status - queries ESP32 directly
 */

import { NextRequest, NextResponse } from 'next/server';

// Default ESP32 address for prototype (192.168.150.x network)
const DEFAULT_ESP32_IP = '192.168.150.3';
const DEFAULT_ESP32_PORT = 80;

// Column registry - updated by announce endpoint
const columnRegistry = new Map<string, {
  id: string;
  ip: string;
  port: number;
  lockerCount: number;
  lastSeen: string;
  isOnline: boolean;
}>();

// Seed default column for prototype testing
if (columnRegistry.size === 0) {
  columnRegistry.set('COL-001', {
    id: 'COL-001',
    ip: DEFAULT_ESP32_IP,
    port: DEFAULT_ESP32_PORT,
    lockerCount: 3,  // Match actual hardware
    lastSeen: new Date().toISOString(),
    isOnline: true,
  });
}

/**
 * GET /api/lockers
 * Get all columns and compartments status - queries ESP32 directly
 * 
 * Query params:
 *   - available: only return available compartments
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const availableOnly = searchParams.get('available') === 'true';
    
    const columns: any[] = [];
    
    for (const [columnId, column] of columnRegistry) {
      let compartments: any[] = [];
      let isOnline = false;
      
      // Try to query ESP32 directly
      try {
        const response = await fetch(`http://${column.ip}:${column.port}/api/status`, {
          signal: AbortSignal.timeout(3000),
        });
        const data = await response.json();
        
        // ESP32 returns { columnId, lockers: [...] } without a success field
        if (data.lockers) {
          isOnline = true;
          column.lastSeen = new Date().toISOString();
          column.isOnline = true;

          // Sensors are nested under locker.sensors in ESP32 response
          compartments = data.lockers.map((locker: any, index: number) => {
            const sensors = locker.sensors || {};
            return {
              id: `${columnId}-${index}`,
              columnId,
              lockerIndex: index,
              status: mapLockerState(locker.state),
              sensors: {
                doorClosed: sensors.doorClosed ?? false,
                doorOpen: sensors.doorOpen ?? false,
                irBeamClear: sensors.irBeamClear ?? true,
                occupied: sensors.occupied ?? false,
              },
              online: true,
            };
          });
        }
      } catch (err) {
        console.log(`[Lockers] ESP32 ${columnId} unreachable`);
        column.isOnline = false;
        
        // Generate placeholder compartments
        for (let i = 0; i < column.lockerCount; i++) {
          compartments.push({
            id: `${columnId}-${i}`,
            columnId,
            lockerIndex: i,
            status: 'unknown',
            online: false,
          });
        }
      }
      
      // Filter if needed
      if (availableOnly) {
        compartments = compartments.filter(c => c.status === 'available' || c.status === 'idle');
      }
      
      columns.push({
        id: columnId,
        ip: column.ip,
        port: column.port,
        lockerCount: compartments.length,
        lastSeen: column.lastSeen,
        isOnline,
        compartments,
      });
    }
    
    // Calculate totals
    const allCompartments = columns.flatMap(c => c.compartments);
    const availableCount = allCompartments.filter(c => 
      c.status === 'available' || c.status === 'idle'
    ).length;
    
    if (availableOnly) {
      return NextResponse.json({
        success: true,
        compartments: allCompartments,
        count: allCompartments.length,
      });
    }
    
    return NextResponse.json({
      success: true,
      columns,
      totalCompartments: allCompartments.length,
      availableCount,
    });
  } catch (error) {
    console.error('[API] Lockers list error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Map ESP32 locker state to UI status
 */
function mapLockerState(state: string): string {
  switch (state?.toUpperCase()) {
    case 'IDLE':
    case 'LOCKED':
      return 'available';
    case 'UNLOCKING':
    case 'OPEN':
      return 'open';
    case 'CLOSING':
      return 'closing';
    case 'FAULT':
      return 'fault';
    case 'SANITIZING':
      return 'sanitizing';
    default:
      return 'unknown';
  }
}

// Export for other endpoints
export { columnRegistry };
