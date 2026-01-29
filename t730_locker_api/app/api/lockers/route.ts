/**
 * @file app/api/lockers/route.ts
 * @description Get locker status and manage compartments
 */

import { NextRequest, NextResponse } from 'next/server';
import { 
  getColumns, 
  getAllCompartments, 
  getAvailableCompartments,
  getCompartmentStatus,
} from '@/lib/db/lockerService';

/**
 * GET /api/lockers
 * Get all columns and compartments status
 * 
 * Query params:
 *   - available: only return available compartments
 *   - size: filter by size (S, M, L)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const availableOnly = searchParams.get('available') === 'true';
    const size = searchParams.get('size') as 'S' | 'M' | 'L' | null;
    
    if (availableOnly) {
      const compartments = size 
        ? getAvailableCompartments(size)
        : getAvailableCompartments();
      
      return NextResponse.json({
        success: true,
        compartments,
        count: compartments.length,
      });
    }
    
    const columns = getColumns();
    const compartments = getAllCompartments();
    
    // Group compartments by column
    const columnData = columns.map(column => ({
      ...column,
      compartments: compartments.filter(c => c.columnId === column.id),
    }));
    
    return NextResponse.json({
      success: true,
      columns: columnData,
      totalCompartments: compartments.length,
      availableCount: compartments.filter(c => c.status === 'available').length,
    });
  } catch (error) {
    console.error('[API] Lockers list error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
