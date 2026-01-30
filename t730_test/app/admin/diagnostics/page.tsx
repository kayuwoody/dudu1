'use client';

/**
 * @file app/admin/diagnostics/page.tsx
 * @description Hardware diagnostic interface for testing locker components
 * 
 * Features:
 *   - Real-time sensor status display
 *   - Direct output control (LED, UVC, heater, solenoid)
 *   - Motor testing (steps, direction, speed)
 *   - Unlock/lock sequence testing
 *   - Per-locker and per-column views
 * 
 * Useful for:
 *   - Initial hardware bring-up
 *   - Production troubleshooting
 *   - Maintenance verification
 */

import { useState, useEffect, useCallback } from 'react';

// ============================================
// TYPES
// ============================================

interface SensorState {
  doorClosed: boolean;
  doorOpen: boolean;
  irBeamClear: boolean;
  occupied: boolean;
  tempOk: boolean;
  safetyOk: boolean;
  motorFault: boolean;
}

interface OutputState {
  led: boolean;
  uvc: boolean;
  solenoid: boolean;
  heater: boolean;
}

interface LockerStatus {
  index: number;
  state?: string;
  sensors: SensorState;
  outputs: OutputState;
}

interface ColumnStatus {
  columnId: string;
  firmwareVersion: string;
  uptime: number;
  lockers: LockerStatus[];
}

// ============================================
// CONFIGURATION
// ============================================

// Default ESP32 address - update to match your setup
const DEFAULT_ESP32_IP = '192.168.150.3';
const DEFAULT_ESP32_PORT = 80;
const POLL_INTERVAL = 1000; // 1 second

// ============================================
// COMPONENT
// ============================================

export default function DiagnosticsPage() {
  // Connection settings
  const [esp32Ip, setEsp32Ip] = useState(DEFAULT_ESP32_IP);
  const [esp32Port, setEsp32Port] = useState(DEFAULT_ESP32_PORT);
  
  // Status
  const [status, setStatus] = useState<ColumnStatus | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Polling
  const [polling, setPolling] = useState(false);
  
  // Selected locker for detailed control
  const [selectedLocker, setSelectedLocker] = useState(0);
  
  // Motor control
  const [motorSteps, setMotorSteps] = useState(100);
  const [motorSpeed, setMotorSpeed] = useState(500);
  
  // Activity log
  const [log, setLog] = useState<string[]>([]);
  
  /**
   * Add entry to activity log
   */
  const addLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLog(prev => [`[${timestamp}] ${message}`, ...prev.slice(0, 49)]);
  }, []);

  /**
   * Fetch status from ESP32
   */
  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/diagnostics/proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: `http://${esp32Ip}:${esp32Port}/api/status`,
          method: 'GET'
        })
      });
      
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const data = await response.json();
      setStatus(data);
      setConnected(true);
      setLastUpdate(new Date());
      setError(null);
    } catch (err: any) {
      setConnected(false);
      setError(err.message);
    }
  }, [esp32Ip, esp32Port]);

  /**
   * Send command to ESP32
   */
  const sendCommand = useCallback(async (
    endpoint: string, 
    method: string = 'POST', 
    body?: any
  ) => {
    const url = `http://${esp32Ip}:${esp32Port}${endpoint}`;
    addLog(`→ ${method} ${endpoint}`);
    
    try {
      const response = await fetch(`/api/admin/diagnostics/proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: url,
          method,
          body
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        addLog(`✓ Success: ${JSON.stringify(data)}`);
      } else {
        addLog(`✗ Failed: ${data.error?.message || 'Unknown error'}`);
      }
      
      // Refresh status after command
      setTimeout(fetchStatus, 200);
      
      return data;
    } catch (err: any) {
      addLog(`✗ Error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }, [esp32Ip, esp32Port, addLog, fetchStatus]);

  /**
   * Toggle output
   */
  const toggleOutput = useCallback((locker: number, output: string, currentState: boolean) => {
    sendCommand(`/api/locker/${locker}/output`, 'POST', {
      output,
      state: !currentState
    });
  }, [sendCommand]);

  /**
   * Run motor
   */
  const runMotor = useCallback((locker: number, direction: 'forward' | 'reverse') => {
    sendCommand(`/api/locker/${locker}/motor`, 'POST', {
      steps: motorSteps,
      direction,
      speed: motorSpeed
    });
  }, [sendCommand, motorSteps, motorSpeed]);

  /**
   * Unlock locker
   */
  const unlockLocker = useCallback((locker: number) => {
    sendCommand(`/api/locker/${locker}/unlock`, 'POST', {
      requestId: `diag-${Date.now()}`
    });
  }, [sendCommand]);

  /**
   * Lock locker
   */
  const lockLocker = useCallback((locker: number) => {
    sendCommand(`/api/locker/${locker}/lock`, 'POST', {
      requestId: `diag-${Date.now()}`
    });
  }, [sendCommand]);

  /**
   * Start sanitize cycle
   */
  const startSanitize = useCallback((locker: number, durationMs: number = 5000) => {
    sendCommand(`/api/locker/${locker}/sanitize`, 'POST', {
      durationMs
    });
  }, [sendCommand]);

  /**
   * Polling effect
   */
  useEffect(() => {
    if (!polling) return;
    
    const interval = setInterval(fetchStatus, POLL_INTERVAL);
    fetchStatus(); // Initial fetch
    
    return () => clearInterval(interval);
  }, [polling, fetchStatus]);

  // ============================================
  // RENDER HELPERS
  // ============================================

  /**
   * Sensor indicator component
   */
  const SensorIndicator = ({ label, value, inverted = false }: { 
    label: string; 
    value: boolean; 
    inverted?: boolean;
  }) => {
    const isGood = inverted ? !value : value;
    return (
      <div className={`sensor-indicator ${isGood ? 'good' : 'bad'}`}>
        <span className="sensor-dot" />
        <span className="sensor-label">{label}</span>
      </div>
    );
  };

  /**
   * Output toggle button
   */
  const OutputButton = ({ label, active, onClick }: {
    label: string;
    active: boolean;
    onClick: () => void;
  }) => (
    <button 
      className={`output-btn ${active ? 'active' : ''}`}
      onClick={onClick}
    >
      {label}: {active ? 'ON' : 'OFF'}
    </button>
  );

  // ============================================
  // RENDER
  // ============================================

  return (
    <div className="diagnostics-page">
      <style jsx>{`
        .diagnostics-page {
          padding: 20px;
          max-width: 1400px;
          margin: 0 auto;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        
        h1 {
          margin-bottom: 20px;
          color: #333;
        }
        
        .connection-bar {
          display: flex;
          gap: 10px;
          align-items: center;
          padding: 15px;
          background: #706d6d;
          border-radius: 8px;
          margin-bottom: 20px;
        }
        
        .connection-bar input {
          padding: 8px 12px;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 14px;
        }
        
        .connection-bar input.ip {
          width: 140px;
        }
        
        .connection-bar input.port {
          width: 70px;
        }
        
        .connection-bar button {
          padding: 8px 16px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-weight: 500;
        }
        
        .btn-primary {
          background: #5a636e;
          color: grey;
        }
        
        .btn-primary:hover {
          background: #0056b3;
        }
        
        .btn-success {
          background: #28a745;
          color: white;
        }
        
        .btn-danger {
          background: #dc3545;
          color: white;
        }
        
        .btn-warning {
          background: #ffc107;
          color: #333;
        }
        
        .btn-secondary {
          background: #6c757d;
          color: white;
        }
        
        .status-badge {
          padding: 4px 12px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 600;
        }
        
        .status-badge.connected {
          background: #d4edda;
          color: #155724;
        }
        
        .status-badge.disconnected {
          background: #f8d7da;
          color: #721c24;
        }
        
        .main-grid {
          display: grid;
          grid-template-columns: 1fr 350px;
          gap: 20px;
        }
        
        .panel {
          background: lightgrey;
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          padding: 15px;
        }
        
        .panel h2 {
          font-size: 16px;
          margin: 0 0 15px 0;
          padding-bottom: 10px;
          border-bottom: 1px solid #eee;
        }
        
        .locker-tabs {
          display: flex;
          gap: 5px;
          margin-bottom: 15px;
        }
        
        .locker-tab {
          padding: 8px 16px;
          border: 1px solid #ddd;
          background: #f8f9fa;
          border-radius: 4px;
          cursor: pointer;
        }
        
        .locker-tab.active {
          background: #007bff;
          color: white;
          border-color: #007bff;
        }
        
        .sensors-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 8px;
          margin-bottom: 20px;
        }
        
        .sensor-indicator {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          background: #f8f9fa;
          border-radius: 4px;
          font-size: 13px;
        }
        
        .sensor-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
        }
        
        .sensor-indicator.good .sensor-dot {
          background: #28a745;
        }
        
        .sensor-indicator.bad .sensor-dot {
          background: #dc3545;
        }
        
        .outputs-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 8px;
          margin-bottom: 20px;
        }
        
        .output-btn {
          padding: 10px;
          border: 2px solid #ddd;
          border-radius: 4px;
          background: #f8f9fa;
          cursor: pointer;
          font-weight: 500;
          transition: all 0.2s;
        }
        
        .output-btn:hover {
          border-color: #007bff;
        }
        
        .output-btn.active {
          background: #007bff;
          color: white;
          border-color: #007bff;
        }
        
        .motor-controls {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-bottom: 20px;
          padding: 15px;
          background: #b5b0b0;
          border-radius: 4px;
        }
        
        .motor-controls label {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 13px;
        }
        
        .motor-controls input {
          width: 80px;
          padding: 4px 8px;
          border: 1px solid #ddd;
          border-radius: 4px;
        }
        
        .motor-buttons {
          display: flex;
          gap: 10px;
        }
        
        .motor-buttons button {
          flex: 1;
          padding: 10px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-weight: 500;
        }
        
        .sequence-buttons {
          display: flex;
          gap: 10px;
          margin-bottom: 20px;
        }
        
        .sequence-buttons button {
          flex: 1;
          padding: 12px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-weight: 600;
          font-size: 14px;
        }
        
        .log-panel {
          height: 100%;
          display: flex;
          flex-direction: column;
        }
        
        .log-entries {
          flex: 1;
          font-family: 'Monaco', 'Consolas', monospace;
          font-size: 11px;
          background: #1e1e1e;
          color: #d4d4d4;
          padding: 10px;
          border-radius: 4px;
          overflow-y: auto;
          max-height: 500px;
        }
        
        .log-entry {
          padding: 2px 0;
          white-space: pre-wrap;
          word-break: break-all;
        }
        
        .log-entry:nth-child(even) {
          background: rgba(255,255,255,0.03);
        }
        
        .info-row {
          display: flex;
          justify-content: space-between;
          font-size: 13px;
          color: #666;
         background: rgba(255,255,255,0.03);
          margin-top: 10px;
        }
        
        .lockers-overview {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 10px;
          margin-bottom: 20px;
        }
        
        .locker-card {
          padding: 12px;
          border: 2px solid #e0e0e0;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .locker-card:hover {
          border-color: #007bff;
        }
        
        .locker-card.selected {
          border-color: #007bff;
          background: #f0f7ff;
        }
        
        .locker-card h3 {
          margin: 0 0 8px 0;
          font-size: 14px;
        }
        
        .locker-card .mini-sensors {
          display: flex;
          gap: 4px;
          flex-wrap: wrap;
        }
        
        .mini-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }
        
        .mini-dot.good { background: #28a745; }
        .mini-dot.bad { background: #dc3545; }
        .mini-dot.neutral { background: #6c757d; }
        
        .error-message {
          padding: 10px;
          background: #f8d7da;
          color: #721c24;
          border-radius: 4px;
          margin-bottom: 15px;
        }
      `}</style>

      <h1>🔧 Locker Diagnostics</h1>
      
      {/* Connection Bar */}
      <div className="connection-bar">
        <label>ESP32 IP:</label>
        <input 
          type="text" 
          className="ip"
          value={esp32Ip}
          onChange={(e) => setEsp32Ip(e.target.value)}
          placeholder="192.168.150.3"
        />
        <span>:</span>
        <input 
          type="number" 
          className="port"
          value={esp32Port}
          onChange={(e) => setEsp32Port(parseInt(e.target.value) || 80)}
          placeholder="80"
        />
        
        <button 
          className={polling ? 'btn-danger' : 'btn-success'}
          onClick={() => setPolling(!polling)}
        >
          {polling ? '⏹ Stop' : '▶ Start'} Polling
        </button>
        
        <button className="btn-primary" onClick={fetchStatus}>
          🔄 Refresh
        </button>
        
        <span className={`status-badge ${connected ? 'connected' : 'disconnected'}`}>
          {connected ? '● Connected' : '○ Disconnected'}
        </span>
        
        {lastUpdate && (
          <span style={{ fontSize: 12, color: '#666' }}>
            Last: {lastUpdate.toLocaleTimeString()}
          </span>
        )}
      </div>

      {error && (
        <div className="error-message">
          ⚠️ Connection error: {error}
        </div>
      )}

      <div className="main-grid">
        <div>
          {/* Lockers Overview */}
          {status && (
            <div className="panel">
              <h2>📦 Lockers Overview</h2>
              <div className="lockers-overview">
                {status.lockers.map((locker) => (
                  <div 
                    key={locker.index}
                    className={`locker-card ${selectedLocker === locker.index ? 'selected' : ''}`}
                    onClick={() => setSelectedLocker(locker.index)}
                  >
                    <h3>Locker {locker.index + 1}</h3>
                    <div className="mini-sensors">
                      <span 
                        className={`mini-dot ${locker.sensors.doorClosed ? 'good' : 'bad'}`} 
                        title="Door Closed"
                      />
                      <span 
                        className={`mini-dot ${locker.sensors.irBeamClear ? 'good' : 'bad'}`} 
                        title="IR Clear"
                      />
                      <span 
                        className={`mini-dot ${locker.sensors.safetyOk ? 'good' : 'bad'}`} 
                        title="Safety OK"
                      />
                      <span 
                        className={`mini-dot ${locker.sensors.occupied ? 'good' : 'neutral'}`} 
                        title="Occupied"
                      />
                      <span 
                        className={`mini-dot ${locker.outputs.led ? 'good' : 'neutral'}`} 
                        title="LED"
                      />
                    </div>
                    <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
                      {locker.state || 'UNKNOWN'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Selected Locker Control */}
          {status && status.lockers[selectedLocker] && (
            <div className="panel">
              <h2>🎛️ Locker {selectedLocker + 1} Control</h2>
              
              {/* Sensors */}
              <h3 style={{ fontSize: 14, marginBottom: 10 }}>Sensors</h3>
              <div className="sensors-grid">
                <SensorIndicator 
                  label="Door Closed" 
                  value={status.lockers[selectedLocker].sensors.doorClosed} 
                />
                <SensorIndicator 
                  label="Door Open" 
                  value={status.lockers[selectedLocker].sensors.doorOpen} 
                />
                <SensorIndicator 
                  label="IR Beam Clear" 
                  value={status.lockers[selectedLocker].sensors.irBeamClear} 
                />
                <SensorIndicator 
                  label="Occupied" 
                  value={status.lockers[selectedLocker].sensors.occupied} 
                />
                <SensorIndicator 
                  label="Temp OK" 
                  value={status.lockers[selectedLocker].sensors.tempOk} 
                />
                <SensorIndicator 
                  label="Safety OK" 
                  value={status.lockers[selectedLocker].sensors.safetyOk} 
                />
                <SensorIndicator 
                  label="Motor Fault" 
                  value={status.lockers[selectedLocker].sensors.motorFault} 
                  inverted 
                />
              </div>
              
              {/* Outputs */}
              <h3 style={{ fontSize: 14, marginBottom: 10 }}>Outputs</h3>
              <div className="outputs-grid">
                <OutputButton 
                  label="💡 LED"
                  active={status.lockers[selectedLocker].outputs.led}
                  onClick={() => toggleOutput(
                    selectedLocker, 
                    'led', 
                    status.lockers[selectedLocker].outputs.led
                  )}
                />
                <OutputButton 
                  label="🔆 UVC"
                  active={status.lockers[selectedLocker].outputs.uvc}
                  onClick={() => toggleOutput(
                    selectedLocker, 
                    'uvc', 
                    status.lockers[selectedLocker].outputs.uvc
                  )}
                />
                <OutputButton 
                  label="🔥 Heater"
                  active={status.lockers[selectedLocker].outputs.heater}
                  onClick={() => toggleOutput(
                    selectedLocker, 
                    'heater', 
                    status.lockers[selectedLocker].outputs.heater
                  )}
                />
              </div>
              
              {/* Motor Control */}
              <h3 style={{ fontSize: 14, marginBottom: 10 }}>Motor Control</h3>
              <div className="motor-controls">
                <label>
                  Steps:
                  <input 
                    type="number" 
                    value={motorSteps}
                    onChange={(e) => setMotorSteps(parseInt(e.target.value) || 100)}
                    min={1}
                    max={10000}
                  />
                </label>
                <label>
                  Speed (µs):
                  <input 
                    type="number" 
                    value={motorSpeed}
                    onChange={(e) => setMotorSpeed(parseInt(e.target.value) || 500)}
                    min={100}
                    max={5000}
                  />
                </label>
                <div className="motor-buttons">
                  <button 
                    className="btn-primary"
                    onClick={() => runMotor(selectedLocker, 'forward')}
                  >
                    ⬆️ Forward
                  </button>
                  <button 
                    className="btn-secondary"
                    onClick={() => runMotor(selectedLocker, 'reverse')}
                  >
                    ⬇️ Reverse
                  </button>
                </div>
              </div>
              
              {/* Sequence Buttons */}
              <h3 style={{ fontSize: 14, marginBottom: 10 }}>Sequences</h3>
              <div className="sequence-buttons">
                <button 
                  className="btn-success"
                  onClick={() => unlockLocker(selectedLocker)}
                >
                  🔓 Unlock
                </button>
                <button 
                  className="btn-danger"
                  onClick={() => lockLocker(selectedLocker)}
                >
                  🔒 Lock
                </button>
                <button 
                  className="btn-warning"
                  onClick={() => startSanitize(selectedLocker, 5000)}
                >
                  🧹 Sanitize (5s)
                </button>
              </div>
            </div>
          )}
          
          {/* Column Info */}
          {status && (
            <div className="info-row">
              <span>Column: {status.columnId}</span>
              <span>Firmware: {status.firmwareVersion}</span>
              <span>Uptime: {Math.floor(status.uptime / 60)}m {status.uptime % 60}s</span>
            </div>
          )}
        </div>
        
        {/* Log Panel */}
        <div className="panel log-panel">
          <h2>📋 Activity Log</h2>
          <button 
            className="btn-secondary" 
            style={{ marginBottom: 10, width: '100%' }}
            onClick={() => setLog([])}
          >
            Clear Log
          </button>
          <div className="log-entries">
            {log.length === 0 && (
              <div style={{ color: '#666' }}>No activity yet...</div>
            )}
            {log.map((entry, i) => (
              <div key={i} className="log-entry">{entry}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
