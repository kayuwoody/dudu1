/**
 * @file app/admin/lockers/load/[orderId]/page.tsx
 * @description Staff load order screen
 * 
 * Staff selects order, views assigned locker, unlocks, loads, confirms.
 * Works offline via direct ESP32 communication on local network.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';

interface OrderItem {
  name: string;
  quantity: number;
  notes?: string;
}

interface Order {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone?: string;
  items: OrderItem[];
  pickupCode: string;
  compartmentId: string;
  status: string;
}

interface LockerInfo {
  compartmentId: string;
  lockerNumber: number;
  columnId: string;
  online: boolean;
  status: 'available' | 'reserved' | 'occupied' | 'open' | 'fault';
  sensors: {
    doorClosed: boolean;
    doorOpen: boolean;
    occupied: boolean;
    irBeamClear: boolean;
  };
}

type LoadState = 'loading' | 'ready' | 'unlocking' | 'open' | 'marking' | 'done' | 'error';

export default function LoadOrderPage() {
  const router = useRouter();
  const params = useParams();
  const orderId = params.orderId as string;

  const [order, setOrder] = useState<Order | null>(null);
  const [locker, setLocker] = useState<LockerInfo | null>(null);
  const [availableLockers, setAvailableLockers] = useState<LockerInfo[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [error, setError] = useState('');
  const [showChangeLocker, setShowChangeLocker] = useState(false);

  // Fetch order and locker data
  const fetchData = useCallback(async () => {
    try {
      // Fetch order
      const orderRes = await fetch(`/api/orders/${orderId}`);
      const orderData = await orderRes.json();
      
      if (!orderData.success) {
        throw new Error(orderData.error || 'Order not found');
      }
      
      setOrder(orderData.order);

      // Fetch locker status
      if (orderData.order.compartmentId) {
        const lockerRes = await fetch(`/api/lockers/${orderData.order.compartmentId}`);
        const lockerData = await lockerRes.json();
        
        if (lockerData.success) {
          setLocker({
            ...lockerData.compartment,
            lockerNumber: parseInt(lockerData.compartment.id.split('-').pop(), 10) + 1,
            sensors: lockerData.sensors || {},
            online: lockerData.online,
          });
        }
      }

      // Fetch available lockers for change option
      const availRes = await fetch('/api/lockers?available=true');
      const availData = await availRes.json();
      if (availData.compartments) {
        setAvailableLockers(availData.compartments.map((c: any) => ({
          ...c,
          lockerNumber: parseInt(c.id.split('-').pop(), 10) + 1,
        })));
      }

      setLoadState('ready');
    } catch (err: any) {
      setError(err.message || 'Failed to load data');
      setLoadState('error');
    }
  }, [orderId]);

  useEffect(() => {
    fetchData();
    
    // Poll locker status every 2 seconds when door is being operated
    const interval = setInterval(() => {
      if (locker?.compartmentId && (loadState === 'unlocking' || loadState === 'open')) {
        refreshLockerStatus();
      }
    }, 2000);
    
    return () => clearInterval(interval);
  }, [fetchData, loadState]);

  // Refresh just locker status
  const refreshLockerStatus = async () => {
    if (!locker?.compartmentId) return;
    
    try {
      const res = await fetch(`/api/lockers/${locker.compartmentId}`);
      const data = await res.json();
      
      if (data.success && data.sensors) {
        const newLocker = {
          ...locker,
          status: data.compartment?.status || locker.status,
          sensors: data.sensors,
          online: data.online,
        };
        setLocker(newLocker);

        // Auto-update state based on door position
        if (loadState === 'unlocking' && data.sensors.doorOpen) {
          setLoadState('open');
        }
      }
    } catch (err) {
      console.error('Failed to refresh locker status:', err);
    }
  };

  // Unlock locker
  const handleUnlock = async () => {
    if (!locker?.compartmentId) return;
    
    setLoadState('unlocking');
    setError('');
    
    try {
      const res = await fetch(`/api/lockers/${locker.compartmentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unlock' }),
      });
      
      const data = await res.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to unlock');
      }
      
      // Will transition to 'open' state via polling when door opens
    } catch (err: any) {
      setError(err.message || 'Failed to unlock locker');
      setLoadState('ready');
    }
  };

  // Mark order as loaded
  const handleLoaded = async () => {
    setLoadState('marking');
    setError('');
    
    try {
      const res = await fetch('/api/lockers/loaded', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });
      
      const data = await res.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to mark as loaded');
      }
      
      setLoadState('done');
      
      // Return to queue after short delay
      setTimeout(() => {
        router.push('/admin/lockers');
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to mark as loaded');
      setLoadState('open');
    }
  };

  // Change locker assignment
  const handleChangeLocker = async (newCompartmentId: string) => {
    setShowChangeLocker(false);
    setError('');
    
    try {
      const res = await fetch('/api/lockers/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, compartmentId: newCompartmentId }),
      });
      
      const data = await res.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Failed to reassign locker');
      }
      
      // Refresh data
      fetchData();
    } catch (err: any) {
      setError(err.message || 'Failed to change locker');
    }
  };

  const getDoorStatusText = () => {
    if (!locker?.sensors) return 'Unknown';
    if (locker.sensors.doorOpen) return 'Open';
    if (locker.sensors.doorClosed) return 'Closed';
    return 'Moving...';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'available': return '#4ecca3';
      case 'reserved': return '#ffc107';
      case 'occupied': return '#e94560';
      case 'open': return '#17a2b8';
      case 'fault': return '#dc3545';
      default: return '#888';
    }
  };

  return (
    <div className="load-container">
      <style jsx>{`
        .load-container {
          min-height: 100vh;
          background: #1a1a2e;
          color: white;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          padding: 20px;
        }
        
        .header {
          display: flex;
          align-items: center;
          gap: 20px;
          margin-bottom: 30px;
          padding-bottom: 20px;
          border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        
        .back-btn {
          background: rgba(255,255,255,0.1);
          border: none;
          color: white;
          padding: 12px 20px;
          border-radius: 8px;
          font-size: 16px;
          cursor: pointer;
        }
        
        .title {
          font-size: 28px;
          font-weight: bold;
        }
        
        .section {
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 12px;
          padding: 20px;
          margin-bottom: 20px;
        }
        
        .section-title {
          font-size: 14px;
          color: #888;
          text-transform: uppercase;
          margin-bottom: 15px;
        }
        
        .order-number {
          font-size: 36px;
          font-weight: bold;
          color: #e94560;
          margin-bottom: 10px;
        }
        
        .customer-name {
          font-size: 20px;
          margin-bottom: 5px;
        }
        
        .customer-phone {
          color: #888;
          margin-bottom: 15px;
        }
        
        .items-list {
          margin-top: 15px;
        }
        
        .item {
          display: flex;
          padding: 8px 0;
          border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        
        .item-qty {
          width: 40px;
          color: #4ecca3;
          font-weight: bold;
        }
        
        .item-name {
          flex: 1;
        }
        
        .item-notes {
          font-size: 14px;
          color: #888;
          margin-left: 40px;
        }
        
        .pickup-code {
          font-family: monospace;
          font-size: 32px;
          font-weight: bold;
          background: rgba(78, 204, 163, 0.2);
          color: #4ecca3;
          padding: 15px 30px;
          border-radius: 8px;
          display: inline-block;
        }
        
        .locker-info {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .locker-main {
          display: flex;
          align-items: center;
          gap: 20px;
        }
        
        .locker-number {
          font-size: 64px;
          font-weight: bold;
          color: #4ecca3;
        }
        
        .locker-details {
          
        }
        
        .locker-status {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 5px;
        }
        
        .status-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
        }
        
        .door-status {
          color: #888;
        }
        
        .change-btn {
          background: rgba(255,255,255,0.1);
          border: none;
          color: white;
          padding: 10px 20px;
          border-radius: 8px;
          cursor: pointer;
        }
        
        .action-buttons {
          display: flex;
          gap: 20px;
          margin-top: 30px;
        }
        
        .action-btn {
          flex: 1;
          padding: 25px;
          border: none;
          border-radius: 12px;
          font-size: 24px;
          font-weight: bold;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .action-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        
        .action-btn:not(:disabled):hover {
          transform: scale(1.02);
        }
        
        .unlock-btn {
          background: #4ecca3;
          color: #1a1a2e;
        }
        
        .loaded-btn {
          background: #e94560;
          color: white;
        }
        
        .error-message {
          background: rgba(220, 53, 69, 0.2);
          border: 1px solid #dc3545;
          color: #dc3545;
          padding: 15px;
          border-radius: 8px;
          margin-bottom: 20px;
        }
        
        .success-message {
          text-align: center;
          padding: 40px;
        }
        
        .success-icon {
          font-size: 80px;
          margin-bottom: 20px;
        }
        
        .success-text {
          font-size: 28px;
          margin-bottom: 10px;
        }
        
        .success-subtext {
          color: #888;
        }
        
        /* Change locker modal */
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0,0,0,0.8);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }
        
        .modal {
          background: #1a1a2e;
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 16px;
          padding: 30px;
          width: 90%;
          max-width: 500px;
        }
        
        .modal-title {
          font-size: 24px;
          font-weight: bold;
          margin-bottom: 20px;
        }
        
        .locker-options {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 15px;
          margin-bottom: 20px;
        }
        
        .locker-option {
          background: rgba(255,255,255,0.05);
          border: 2px solid rgba(255,255,255,0.2);
          border-radius: 12px;
          padding: 20px;
          text-align: center;
          cursor: pointer;
        }
        
        .locker-option:hover {
          border-color: #4ecca3;
        }
        
        .locker-option-number {
          font-size: 32px;
          font-weight: bold;
        }
        
        .modal-cancel {
          width: 100%;
          padding: 15px;
          background: rgba(255,255,255,0.1);
          border: none;
          border-radius: 8px;
          color: white;
          font-size: 18px;
          cursor: pointer;
        }
        
        .loading-spinner {
          display: inline-block;
          width: 20px;
          height: 20px;
          border: 3px solid rgba(255,255,255,0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin-right: 10px;
        }
        
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      <div className="header">
        <button className="back-btn" onClick={() => router.push('/admin/lockers')}>
          ← Back
        </button>
        <h1 className="title">Load Order</h1>
      </div>

      {loadState === 'loading' && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div className="loading-spinner"></div>
          Loading...
        </div>
      )}

      {loadState === 'error' && (
        <div className="error-message">
          {error}
          <br />
          <button 
            className="back-btn" 
            style={{ marginTop: 15 }}
            onClick={() => router.push('/admin/lockers')}
          >
            Back to Queue
          </button>
        </div>
      )}

      {loadState === 'done' && (
        <div className="success-message">
          <div className="success-icon">✓</div>
          <div className="success-text">Order Loaded Successfully</div>
          <div className="success-subtext">Customer has been notified</div>
        </div>
      )}

      {order && locker && loadState !== 'loading' && loadState !== 'error' && loadState !== 'done' && (
        <>
          {error && <div className="error-message">{error}</div>}

          {/* Order Info */}
          <div className="section">
            <div className="section-title">Order Details</div>
            <div className="order-number">#{order.orderNumber}</div>
            <div className="customer-name">{order.customerName}</div>
            {order.customerPhone && (
              <div className="customer-phone">{order.customerPhone}</div>
            )}
            
            <div className="items-list">
              {order.items.map((item, i) => (
                <div key={i}>
                  <div className="item">
                    <span className="item-qty">{item.quantity}x</span>
                    <span className="item-name">{item.name}</span>
                  </div>
                  {item.notes && <div className="item-notes">→ {item.notes}</div>}
                </div>
              ))}
            </div>
          </div>

          {/* Pickup Code */}
          <div className="section">
            <div className="section-title">Pickup Code</div>
            <div className="pickup-code">{order.pickupCode}</div>
          </div>

          {/* Locker Info */}
          <div className="section">
            <div className="section-title">Assigned Locker</div>
            <div className="locker-info">
              <div className="locker-main">
                <div className="locker-number">{locker.lockerNumber}</div>
                <div className="locker-details">
                  <div className="locker-status">
                    <span 
                      className="status-dot" 
                      style={{ background: locker.online ? '#4ecca3' : '#dc3545' }}
                    ></span>
                    <span>{locker.online ? 'Online' : 'Offline'}</span>
                  </div>
                  <div className="door-status">
                    Door: {getDoorStatusText()}
                  </div>
                </div>
              </div>
              <button className="change-btn" onClick={() => setShowChangeLocker(true)}>
                Change
              </button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="action-buttons">
            <button
              className="action-btn unlock-btn"
              onClick={handleUnlock}
              disabled={loadState !== 'ready' || !locker.online || locker.sensors?.doorOpen}
            >
              {loadState === 'unlocking' && <span className="loading-spinner"></span>}
              🔓 UNLOCK
            </button>
            
            <button
              className="action-btn loaded-btn"
              onClick={handleLoaded}
              disabled={loadState !== 'open'}
            >
              {loadState === 'marking' && <span className="loading-spinner"></span>}
              ✓ LOADED
            </button>
          </div>
        </>
      )}

      {/* Change Locker Modal */}
      {showChangeLocker && (
        <div className="modal-overlay" onClick={() => setShowChangeLocker(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Select Locker</div>
            <div className="locker-options">
              {availableLockers
                .filter(l => l.compartmentId !== locker?.compartmentId)
                .map(l => (
                  <div 
                    key={l.compartmentId}
                    className="locker-option"
                    onClick={() => handleChangeLocker(l.compartmentId)}
                  >
                    <div className="locker-option-number">{l.lockerNumber}</div>
                    <div style={{ color: '#4ecca3', fontSize: 12 }}>Available</div>
                  </div>
                ))}
            </div>
            {availableLockers.filter(l => l.compartmentId !== locker?.compartmentId).length === 0 && (
              <div style={{ textAlign: 'center', color: '#888', marginBottom: 20 }}>
                No other lockers available
              </div>
            )}
            <button className="modal-cancel" onClick={() => setShowChangeLocker(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
