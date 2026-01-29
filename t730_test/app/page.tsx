/**
 * @file app/page.tsx
 * @description Home page - select Kiosk or Admin mode
 * 
 * In production, this would auto-launch into kiosk mode,
 * with admin accessible via hidden gesture or PIN.
 */

'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';

export default function HomePage() {
  const router = useRouter();
  const [systemStatus, setSystemStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [lockerCount, setLockerCount] = useState(0);

  useEffect(() => {
    checkSystemStatus();
  }, []);

  const checkSystemStatus = async () => {
    try {
      const res = await fetch('/api/lockers');
      const data = await res.json();
      
      if (data.success) {
        setSystemStatus('online');
        // Count total compartments
        const total = data.columns?.reduce((sum: number, col: any) => 
          sum + (col.compartments?.length || 0), 0) || 0;
        setLockerCount(total);
      } else {
        setSystemStatus('offline');
      }
    } catch {
      setSystemStatus('offline');
    }
  };

  return (
    <div className="home-container">
      <style jsx>{`
        .home-container {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 40px;
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        }
        
        .logo {
          font-size: 64px;
          margin-bottom: 20px;
        }
        
        .title {
          font-size: 48px;
          font-weight: bold;
          margin-bottom: 10px;
          color: #e94560;
        }
        
        .subtitle {
          font-size: 24px;
          color: #888;
          margin-bottom: 60px;
        }
        
        .mode-buttons {
          display: flex;
          gap: 30px;
          margin-bottom: 60px;
        }
        
        .mode-btn {
          width: 280px;
          height: 200px;
          background: rgba(255,255,255,0.05);
          border: 2px solid rgba(255,255,255,0.1);
          border-radius: 20px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.3s;
        }
        
        .mode-btn:hover {
          background: rgba(255,255,255,0.1);
          border-color: #e94560;
          transform: scale(1.02);
        }
        
        .mode-icon {
          font-size: 64px;
          margin-bottom: 15px;
        }
        
        .mode-label {
          font-size: 24px;
          font-weight: bold;
        }
        
        .mode-desc {
          font-size: 14px;
          color: #888;
          margin-top: 8px;
        }
        
        .status-bar {
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          background: rgba(0,0,0,0.5);
          padding: 15px 30px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .status-item {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        
        .status-dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
        }
        
        .status-dot.online { background: #4ecca3; }
        .status-dot.offline { background: #dc3545; }
        .status-dot.checking { background: #ffc107; animation: pulse 1s infinite; }
        
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        
        .version {
          color: #666;
          font-size: 14px;
        }
      `}</style>

      <div className="logo">☕</div>
      <h1 className="title">Coffee Oasis</h1>
      <p className="subtitle">Smart Locker System</p>

      <div className="mode-buttons">
        <div className="mode-btn" onClick={() => router.push('/kiosk')}>
          <div className="mode-icon">📱</div>
          <div className="mode-label">Customer Kiosk</div>
          <div className="mode-desc">Enter pickup code</div>
        </div>

        <div className="mode-btn" onClick={() => router.push('/admin/lockers')}>
          <div className="mode-icon">🔧</div>
          <div className="mode-label">Staff Admin</div>
          <div className="mode-desc">Manage orders & lockers</div>
        </div>
      </div>

      <div className="status-bar">
        <div className="status-item">
          <span className={`status-dot ${systemStatus}`}></span>
          <span>
            {systemStatus === 'checking' && 'Checking system...'}
            {systemStatus === 'online' && `System Online • ${lockerCount} Lockers`}
            {systemStatus === 'offline' && 'System Offline'}
          </span>
        </div>
        <div className="version">v1.0.0</div>
      </div>
    </div>
  );
}
