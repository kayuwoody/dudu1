"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';

// --- Interfaces ---
interface SensorState { doorClosed: boolean; doorOpen: boolean; irBeamClear: boolean; occupied: boolean; tempOk: boolean; safetyOk: boolean; motorFault: boolean; }
interface OutputState { led: boolean; uvc: boolean; solenoid: boolean; heater: boolean; }
interface LockerStatus { index: number; state: string; steps: number; sensors: SensorState; outputs: OutputState; }
interface ColumnStatus { columnId: string; firmwareVersion: string; uptime: number; lockers: LockerStatus[]; }

const Indicator = ({ label, active, onClick, color = "#10b981" }: any) => (
  <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '4px 0', cursor: onClick ? 'pointer' : 'default', padding: '4px', borderRadius: '4px', background: onClick ? 'rgba(255,255,255,0.05)' : 'transparent' }}>
    <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: active ? color : '#334155', boxShadow: active ? `0 0 8px ${color}` : 'none' }} />
    <span style={{ fontSize: '12px', color: active ? '#fff' : '#64748b' }}>{label}</span>
  </div>
);

export default function Diag1Page() {
  const [status, setStatus] = useState<ColumnStatus | null>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [motorConfig, setMotorConfig] = useState({ steps: 200, speed: 80 });
  const [isPaused, setIsPaused] = useState(false);

  const esp32Ip = "192.168.150.3";

  const addLog = (msg: string, data?: any) => setLogs(prev => [{ time: new Date().toLocaleTimeString(), msg, data }, ...prev].slice(0, 30));

  const sendCommand = useCallback(async (path: string, body: any = {}) => {
    try {
      const res = await fetch(`/api/admin/diag1/proxy`, {
        method: 'POST',
        body: JSON.stringify({ target: `http://${esp32Ip}${path}`, method: 'POST', body })
      });
      const data = await res.json();
      addLog(`CMD: ${path}`, data);
      return data;
    } catch (e: any) { addLog(`ERR: ${e.message}`); }
  }, []);

  const fetchStatus = useCallback(async () => {
    if (isPaused) return;
    try {
      const res = await fetch(`/api/admin/diag1/proxy`, {
        method: 'POST',
        body: JSON.stringify({ target: `http://${esp32Ip}/api/status`, method: 'GET' })
      });
      setStatus(await res.json());
    } catch (e) {}
  }, [isPaused]);

  useEffect(() => {
    const interval = setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  return (
    <div style={{ padding: '20px', background: '#020617', minHeight: '100vh', color: '#f8fafc', fontFamily: 'monospace' }}>
      <header style={{ borderBottom: '1px solid #1e293b', paddingBottom: '10px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: '18px', margin: 0 }}>HARDWARE_CALIBRATION_v1</h1>
        <button onClick={() => setIsPaused(!isPaused)} style={{ background: isPaused ? '#ef4444' : '#1e293b', border: 'none', color: '#fff', padding: '4px 10px', borderRadius: '4px' }}>
          {isPaused ? 'RESUME_POLLING' : 'PAUSE_POLLING'}
        </button>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '20px' }}>
        {status?.lockers.map(locker => (
          <div key={locker.index} style={{ background: '#0f172a', borderRadius: '8px', padding: '15px', border: '1px solid #1e293b' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong style={{ color: '#38bdf8' }}>LOCKER_{locker.index}</strong>
              <span style={{ fontSize: '11px' }}>{locker.steps} STEPS</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '10px' }}>
              <section>
                <Indicator label="DoorClosed" active={locker.sensors.doorClosed} />
                <Indicator label="DoorOpen" active={locker.sensors.doorOpen} />
                <Indicator label="MotorFault" active={locker.sensors.motorFault} color="#ef4444" />
              </section>
              <section>
                <Indicator label="LED" active={locker.outputs.led} color="#fbbf24" onClick={() => sendCommand(`/api/locker/${locker.index}/output`, { output: 'led', state: !locker.outputs.led })} />
                <Indicator label="UVC" active={locker.outputs.uvc} color="#a855f7" onClick={() => sendCommand(`/api/locker/${locker.index}/output`, { output: 'uvc', state: !locker.outputs.uvc })} />
                <Indicator label="Heater" active={locker.outputs.heater} color="#f43f5e" onClick={() => sendCommand(`/api/locker/${locker.index}/output`, { output: 'heater', state: !locker.outputs.heater })} />
              </section>
            </div>

            <div style={{ marginTop: '15px', padding: '10px', background: '#020617', borderRadius: '4px' }}>
              <label style={{ fontSize: '10px' }}>JOG_CONFIG: {motorConfig.steps} steps @ {motorConfig.speed}%</label>
              <input type="range" min="50" max="2000" value={motorConfig.steps} onChange={e => setMotorConfig({ ...motorConfig, steps: +e.target.value })} style={{ width: '100%' }} />
              <div style={{ display: 'flex', gap: '4px', marginTop: '8px' }}>
                <button style={btnStyle} onClick={() => sendCommand(`/api/locker/${locker.index}/motor`, { ...motorConfig, direction: 'reverse' })}>REV</button>
                <button style={btnStyle} onClick={() => sendCommand(`/api/locker/${locker.index}/motor`, { ...motorConfig, direction: 'forward' })}>FWD</button>
                <button style={{ ...btnStyle, background: '#3b82f6' }} onClick={() => sendCommand(`/api/locker/${locker.index}/calibrate`)}>CALIBRATE</button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: '20px', height: '150px', overflowY: 'auto', background: '#000', padding: '10px', borderRadius: '4px', border: '1px solid #1e293b', fontSize: '11px' }}>
        {logs.map((l, i) => (
          <div key={i} style={{ marginBottom: '4px' }}><span style={{ color: '#475569' }}>[{l.time}]</span> {l.msg} <span style={{ color: '#475569' }}>{JSON.stringify(l.data)}</span></div>
        ))}
      </div>
    </div>
  );
}

const btnStyle = { flex: 1, padding: '6px', background: '#1e293b', border: 'none', color: '#fff', fontSize: '10px', borderRadius: '4px', cursor: 'pointer' };
