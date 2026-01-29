/**
 * @file app/kiosk/page.tsx
 * @description Customer pickup kiosk - fullscreen touch-friendly UI
 * 
 * This is the main customer-facing screen at the locker location.
 * Customers enter their pickup code or scan QR to open their locker.
 */

'use client';

import { useState, useEffect, useRef } from 'react';

type KioskState = 'idle' | 'entering' | 'validating' | 'success' | 'error';

interface PickupResult {
  success: boolean;
  compartmentId?: string;
  orderNumber?: string;
  lockerNumber?: number;
  error?: string;
}

export default function KioskPage() {
  const [state, setState] = useState<KioskState>('idle');
  const [code, setCode] = useState('');
  const [result, setResult] = useState<PickupResult | null>(null);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus input and reset to idle after timeout
  useEffect(() => {
    if (state === 'idle' || state === 'entering') {
      inputRef.current?.focus();
    }
    
    if (state === 'success' || state === 'error') {
      const timer = setTimeout(() => {
        setState('idle');
        setCode('');
        setResult(null);
        setError('');
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [state]);

  // Handle code input (keyboard or scanner)
  const handleCodeChange = (value: string) => {
    // Remove any newlines/returns (scanners often add these)
    // Only allow alphanumeric, max 6 chars
    const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    setCode(cleaned);
    
    if (state === 'idle') {
      setState('entering');
    }
    
    // Auto-submit when 6 characters entered
    if (cleaned.length === 6) {
      handleSubmit(cleaned);
    }
  };

  // Handle Enter key (some scanners send this)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && code.length === 6) {
      handleSubmit(code);
    }
  };

  // Handle keypad input
  const handleKeypadPress = (key: string) => {
    if (key === 'CLEAR') {
      setCode('');
      setState('idle');
    } else if (key === 'BACK') {
      setCode(prev => prev.slice(0, -1));
      if (code.length <= 1) setState('idle');
    } else if (code.length < 6) {
      handleCodeChange(code + key);
    }
  };

  // Submit code for validation
  const handleSubmit = async (pickupCode: string) => {
    setState('validating');
    
    try {
      const response = await fetch('/api/lockers/pickup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: pickupCode }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        // Extract locker number from compartmentId (e.g., "COL-001-2" -> 3)
        const lockerNumber = parseInt(data.compartmentId?.split('-').pop() || '0', 10) + 1;
        
        setResult({
          success: true,
          compartmentId: data.compartmentId,
          orderNumber: data.orderNumber,
          lockerNumber,
        });
        setState('success');
      } else {
        setError(data.error || 'Invalid code');
        setState('error');
      }
    } catch (err) {
      setError('Connection error. Please try again.');
      setState('error');
    }
  };

  // Render based on state
  return (
    <div className="kiosk-container">
      <style jsx global>{`
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }
        
        .kiosk-container {
          min-height: 100vh;
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
          color: white;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 40px;
          user-select: none;
        }
        
        .logo {
          font-size: 48px;
          font-weight: bold;
          margin-bottom: 20px;
          color: #e94560;
        }
        
        .title {
          font-size: 36px;
          margin-bottom: 40px;
          text-align: center;
        }
        
        .subtitle {
          font-size: 24px;
          color: #888;
          margin-bottom: 40px;
        }
        
        .code-display {
          display: flex;
          gap: 16px;
          margin-bottom: 40px;
        }
        
        .code-digit {
          width: 80px;
          height: 100px;
          background: rgba(255,255,255,0.1);
          border: 3px solid rgba(255,255,255,0.3);
          border-radius: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 48px;
          font-weight: bold;
        }
        
        .code-digit.filled {
          background: rgba(233, 69, 96, 0.2);
          border-color: #e94560;
        }
        
        .code-digit.current {
          border-color: #4ecca3;
          animation: pulse 1s infinite;
        }
        
        @keyframes pulse {
          0%, 100% { border-color: #4ecca3; }
          50% { border-color: rgba(78, 204, 163, 0.5); }
        }
        
        .keypad {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 16px;
          max-width: 400px;
        }
        
        .key {
          width: 100px;
          height: 80px;
          background: rgba(255,255,255,0.1);
          border: none;
          border-radius: 12px;
          color: white;
          font-size: 32px;
          font-weight: bold;
          cursor: pointer;
          transition: all 0.15s;
        }
        
        .key:active {
          transform: scale(0.95);
          background: rgba(255,255,255,0.2);
        }
        
        .key.action {
          font-size: 18px;
          background: rgba(233, 69, 96, 0.3);
        }
        
        .hidden-input {
          position: absolute;
          opacity: 0;
          pointer-events: none;
        }
        
        /* Success state */
        .success-container {
          text-align: center;
        }
        
        .success-icon {
          font-size: 120px;
          margin-bottom: 30px;
        }
        
        .locker-number {
          font-size: 160px;
          font-weight: bold;
          color: #4ecca3;
          margin: 20px 0;
        }
        
        .success-message {
          font-size: 32px;
          margin-bottom: 20px;
        }
        
        .success-submessage {
          font-size: 24px;
          color: #888;
        }
        
        /* Error state */
        .error-container {
          text-align: center;
        }
        
        .error-icon {
          font-size: 120px;
          margin-bottom: 30px;
        }
        
        .error-message {
          font-size: 32px;
          color: #e94560;
          margin-bottom: 20px;
        }
        
        .error-submessage {
          font-size: 24px;
          color: #888;
        }
        
        /* Validating state */
        .validating-container {
          text-align: center;
        }
        
        .spinner {
          width: 80px;
          height: 80px;
          border: 6px solid rgba(255,255,255,0.2);
          border-top-color: #4ecca3;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto 30px;
        }
        
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        
        .validating-message {
          font-size: 28px;
        }
      `}</style>

      {/* Hidden input for keyboard/scanner */}
      <input
        ref={inputRef}
        type="text"
        className="hidden-input"
        value={code}
        onChange={(e) => handleCodeChange(e.target.value)}
        onKeyDown={handleKeyDown}
        autoFocus
      />

      <div className="logo">☕ Coffee Oasis</div>

      {/* Idle / Entering state */}
      {(state === 'idle' || state === 'entering') && (
        <>
          <h1 className="title">Enter Your Pickup Code</h1>
          <p className="subtitle">Or scan your QR code</p>
          
          <div className="code-display">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div 
                key={i} 
                className={`code-digit ${code[i] ? 'filled' : ''} ${code.length === i ? 'current' : ''}`}
              >
                {code[i] || ''}
              </div>
            ))}
          </div>
          
          <div className="keypad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'CLEAR', '0', 'BACK'].map((key) => (
              <button
                key={key}
                className={`key ${key === 'CLEAR' || key === 'BACK' ? 'action' : ''}`}
                onClick={() => handleKeypadPress(key)}
              >
                {key === 'BACK' ? '⌫' : key}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Validating state */}
      {state === 'validating' && (
        <div className="validating-container">
          <div className="spinner"></div>
          <p className="validating-message">Checking code...</p>
        </div>
      )}

      {/* Success state */}
      {state === 'success' && result && (
        <div className="success-container">
          <div className="success-icon">✓</div>
          <p className="success-message">Your order is in</p>
          <div className="locker-number">{result.lockerNumber}</div>
          <p className="success-message">Locker is opening!</p>
          <p className="success-submessage">Please collect your order</p>
        </div>
      )}

      {/* Error state */}
      {state === 'error' && (
        <div className="error-container">
          <div className="error-icon">✗</div>
          <p className="error-message">{error}</p>
          <p className="error-submessage">Please check your code and try again</p>
        </div>
      )}
    </div>
  );
}
