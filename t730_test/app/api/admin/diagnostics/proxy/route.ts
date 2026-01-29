/**
 * @file app/api/admin/diagnostics/proxy/route.ts
 * @description Proxy requests from admin UI to ESP32 controllers
 * 
 * Required because browsers can't directly call ESP32 due to CORS.
 * This route forwards requests and returns the ESP32's response.
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { target, method = 'GET', body: requestBody } = body;
    
    if (!target) {
      return NextResponse.json(
        { success: false, error: 'Missing target URL' },
        { status: 400 }
      );
    }
    
    console.log(`[Proxy] ${method} ${target}`);
    
    const fetchOptions: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000), // 5 second timeout
    };
    
    if (requestBody && method !== 'GET') {
      fetchOptions.body = JSON.stringify(requestBody);
    }
    
    const response = await fetch(target, fetchOptions);
    const data = await response.json();
    
    console.log(`[Proxy] Response:`, data);
    
    return NextResponse.json(data);
  } catch (error: any) {
    console.error(`[Proxy] Error:`, error.message);
    
    return NextResponse.json(
      { 
        success: false, 
        error: { 
          code: 'PROXY_ERROR', 
          message: error.message 
        } 
      },
      { status: 502 }
    );
  }
}
