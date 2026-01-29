/**
 * @file app/admin/lockers/page.tsx
 * @description Staff admin - delivery queue and locker management
 * 
 * Shows orders ready to load and current locker status.
 * Staff selects an order to load into its assigned locker.
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface Order {
  id: string;
  orderNumber: string;
  customerName: string;
  items: string;
  compartmentId: string;
  lockerNumber: number;
  pickupCode: string;
  status: 'ready_for_delivery' | 'out_for_delivery' | 'delivered';
  createdAt: string;
}

interface Compartment {
  id: string;
  lockerIndex: number;
  status: 'available' | 'reserved' | 'occupied' | 'open' | 'fault';
  currentOrderId: string | null;
  online: boolean;
}

interface ColumnStatus {
  id: string;
  isOnline: boolean;
  compartments: Compartment[];
}

export default function AdminLockersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [columns, setColumns] = useState<ColumnStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'queue' | 'status'>('queue');

  // Fetch data
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000); // Refresh every 5s
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      // Fetch orders ready for delivery
      const ordersRes = await fetch('/api/orders?fulfillmentType=locker&status=ready_for_delivery,out_for_delivery,delivered');
      const ordersData = await ordersRes.json();
      if (ordersData.orders) {
        setOrders(ordersData.orders.map((o: any) => ({
          ...o,
          lockerNumber: parseInt(o.compartmentId?.split('-').pop() || '0', 10) + 1,
        })));
      }

      // Fetch locker status
      const lockersRes = await fetch('/api/lockers');
      const lockersData = await lockersRes.json();
      if (lockersData.columns) {
        setColumns(lockersData.columns);
      }
    } catch (err) {
      console.error('Failed to fetch data:', err);
    } finally {
      setLoading(false);
    }
  };

  // Group orders by status
  const readyOrders = orders.filter(o => o.status === 'ready_for_delivery');
  const outForDeliveryOrders = orders.filter(o => o.status === 'out_for_delivery');
  const deliveredOrders = orders.filter(o => o.status === 'delivered');

  // Handle order selection
  const handleOrderClick = (order: Order) => {
    router.push(`/admin/lockers/load/${order.id}`);
  };

  // Handle direct locker control
  const handleLockerClick = async (compartment: Compartment) => {
    if (compartment.status === 'fault') {
      alert('This locker has a fault. Please check hardware.');
      return;
    }
    
    // Show quick actions
    const action = confirm(`Locker ${compartment.lockerIndex + 1}\n\nUnlock this locker?`);
    if (action) {
      try {
        const res = await fetch(`/api/lockers/${compartment.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'unlock' }),
        });
        const data = await res.json();
        if (!data.success) {
          alert(`Failed: ${data.error}`);
        }
        fetchData();
      } catch (err) {
        alert('Failed to unlock locker');
      }
    }
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

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'available': return 'AVAIL';
      case 'reserved': return 'RESV';
      case 'occupied': return 'LOADED';
      case 'open': return 'OPEN';
      case 'fault': return 'FAULT';
      default: return status;
    }
  };

  return (
    <div className="admin-container">
      <style jsx>{`
        .admin-container {
          min-height: 100vh;
          background: #1a1a2e;
          color: white;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          padding: 20px;
        }
        
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
          padding-bottom: 20px;
          border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        
        .title {
          font-size: 28px;
          font-weight: bold;
        }
        
        .tabs {
          display: flex;
          gap: 10px;
        }
        
        .tab {
          padding: 12px 24px;
          background: rgba(255,255,255,0.1);
          border: none;
          border-radius: 8px;
          color: white;
          font-size: 16px;
          cursor: pointer;
        }
        
        .tab.active {
          background: #e94560;
        }
        
        .section {
          margin-bottom: 30px;
        }
        
        .section-title {
          font-size: 18px;
          color: #888;
          margin-bottom: 15px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        
        .section-title .count {
          background: #e94560;
          padding: 2px 10px;
          border-radius: 12px;
          font-size: 14px;
        }
        
        .order-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        
        .order-card {
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 12px;
          padding: 16px 20px;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .order-card:hover {
          background: rgba(255,255,255,0.1);
          border-color: #e94560;
        }
        
        .order-info {
          flex: 1;
        }
        
        .order-number {
          font-size: 20px;
          font-weight: bold;
          margin-bottom: 4px;
        }
        
        .order-customer {
          color: #888;
          margin-bottom: 4px;
        }
        
        .order-items {
          font-size: 14px;
          color: #666;
        }
        
        .order-locker {
          text-align: right;
        }
        
        .locker-number {
          font-size: 36px;
          font-weight: bold;
          color: #4ecca3;
        }
        
        .locker-label {
          font-size: 14px;
          color: #888;
        }
        
        .pickup-code {
          font-family: monospace;
          font-size: 16px;
          background: rgba(255,255,255,0.1);
          padding: 4px 8px;
          border-radius: 4px;
          margin-top: 8px;
        }
        
        /* Locker status grid */
        .locker-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
          gap: 16px;
          margin-top: 20px;
        }
        
        .locker-cell {
          aspect-ratio: 1;
          background: rgba(255,255,255,0.05);
          border: 2px solid rgba(255,255,255,0.2);
          border-radius: 12px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .locker-cell:hover {
          transform: scale(1.05);
        }
        
        .locker-cell.fault {
          border-color: #dc3545;
          animation: fault-pulse 2s infinite;
        }
        
        @keyframes fault-pulse {
          0%, 100% { background: rgba(220, 53, 69, 0.1); }
          50% { background: rgba(220, 53, 69, 0.3); }
        }
        
        .locker-cell-number {
          font-size: 32px;
          font-weight: bold;
        }
        
        .locker-cell-status {
          font-size: 12px;
          padding: 2px 8px;
          border-radius: 4px;
          margin-top: 8px;
        }
        
        .locker-cell-order {
          font-size: 11px;
          color: #888;
          margin-top: 4px;
        }
        
        .column-header {
          margin-top: 30px;
          margin-bottom: 10px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        
        .column-name {
          font-size: 18px;
          font-weight: bold;
        }
        
        .online-indicator {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #4ecca3;
        }
        
        .online-indicator.offline {
          background: #dc3545;
        }
        
        .empty-state {
          text-align: center;
          padding: 40px;
          color: #666;
        }
        
        .kiosk-link {
          position: fixed;
          bottom: 20px;
          right: 20px;
          padding: 12px 24px;
          background: #e94560;
          border: none;
          border-radius: 8px;
          color: white;
          font-size: 16px;
          cursor: pointer;
          text-decoration: none;
        }
      `}</style>

      <div className="header">
        <h1 className="title">Locker Management</h1>
        <div className="tabs">
          <button 
            className={`tab ${activeTab === 'queue' ? 'active' : ''}`}
            onClick={() => setActiveTab('queue')}
          >
            Delivery Queue
          </button>
          <button 
            className={`tab ${activeTab === 'status' ? 'active' : ''}`}
            onClick={() => setActiveTab('status')}
          >
            Locker Status
          </button>
        </div>
      </div>

      {loading ? (
        <div className="empty-state">Loading...</div>
      ) : activeTab === 'queue' ? (
        <>
          {/* Ready for Delivery */}
          <div className="section">
            <h2 className="section-title">
              Ready for Delivery
              {readyOrders.length > 0 && <span className="count">{readyOrders.length}</span>}
            </h2>
            {readyOrders.length === 0 ? (
              <div className="empty-state">No orders ready for delivery</div>
            ) : (
              <div className="order-list">
                {readyOrders.map(order => (
                  <div 
                    key={order.id} 
                    className="order-card"
                    onClick={() => handleOrderClick(order)}
                  >
                    <div className="order-info">
                      <div className="order-number">#{order.orderNumber}</div>
                      <div className="order-customer">{order.customerName}</div>
                      <div className="order-items">
                        {Array.isArray(order.items) 
                          ? order.items.map((item: any) => `${item.quantity}x ${item.name}`).join(', ')
                          : order.items}
                      </div>
                    </div>
                    <div className="order-locker">
                      <div className="locker-label">Locker</div>
                      <div className="locker-number">{order.lockerNumber}</div>
                      <div className="pickup-code">{order.pickupCode}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Out for Delivery */}
          {outForDeliveryOrders.length > 0 && (
            <div className="section">
              <h2 className="section-title">
                Out for Delivery
                <span className="count">{outForDeliveryOrders.length}</span>
              </h2>
              <div className="order-list">
                {outForDeliveryOrders.map(order => (
                  <div 
                    key={order.id} 
                    className="order-card"
                    onClick={() => handleOrderClick(order)}
                  >
                    <div className="order-info">
                      <div className="order-number">#{order.orderNumber}</div>
                      <div className="order-customer">{order.customerName}</div>
                    </div>
                    <div className="order-locker">
                      <div className="locker-label">Locker</div>
                      <div className="locker-number">{order.lockerNumber}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* In Locker - Awaiting Pickup */}
          {deliveredOrders.length > 0 && (
            <div className="section">
              <h2 className="section-title">
                In Locker - Awaiting Pickup
                <span className="count">{deliveredOrders.length}</span>
              </h2>
              <div className="order-list">
                {deliveredOrders.map(order => (
                  <div 
                    key={order.id} 
                    className="order-card"
                    onClick={() => handleOrderClick(order)}
                    style={{ opacity: 0.7 }}
                  >
                    <div className="order-info">
                      <div className="order-number">#{order.orderNumber}</div>
                      <div className="order-customer">{order.customerName}</div>
                    </div>
                    <div className="order-locker">
                      <div className="locker-label">Locker</div>
                      <div className="locker-number">{order.lockerNumber}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        /* Locker Status Tab */
        <>
          {columns.length === 0 ? (
            <div className="empty-state">No locker columns registered</div>
          ) : (
            columns.map(column => (
              <div key={column.id}>
                <div className="column-header">
                  <div className={`online-indicator ${column.isOnline ? '' : 'offline'}`}></div>
                  <span className="column-name">{column.id}</span>
                  <span style={{ color: '#888', fontSize: 14 }}>
                    {column.isOnline ? 'Online' : 'Offline'}
                  </span>
                </div>
                <div className="locker-grid">
                  {column.compartments.map(comp => (
                    <div 
                      key={comp.id}
                      className={`locker-cell ${comp.status === 'fault' ? 'fault' : ''}`}
                      style={{ borderColor: getStatusColor(comp.status) }}
                      onClick={() => handleLockerClick(comp)}
                    >
                      <div className="locker-cell-number">{comp.lockerIndex + 1}</div>
                      <div 
                        className="locker-cell-status"
                        style={{ background: getStatusColor(comp.status) }}
                      >
                        {getStatusLabel(comp.status)}
                      </div>
                      {comp.currentOrderId && (
                        <div className="locker-cell-order">
                          #{comp.currentOrderId.slice(-4)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </>
      )}

      <a href="/kiosk" className="kiosk-link">
        Switch to Kiosk Mode
      </a>
    </div>
  );
}
