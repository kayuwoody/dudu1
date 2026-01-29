# Locker Admin UI Specification

**Version:** 1.0
**Date:** January 2025
**Purpose:** Integration guide for POS admin locker management

---

## Overview

Admin interface for delivery staff to manage locker loading and troubleshooting.

**Two systems:**
1. **Main POS** (at cafe) - order management, assigns lockers
2. **T730** (at locker location) - hardware control, customer pickup, staff loading

---

## Order Status Flow

```
pending (unpaid)
    │
    ▼ payment received
preparing
    │
    ▼ kitchen marks done
ready_for_delivery
    │ • Auto-assign locker at delivery location
    │ • Generate 6-char pickup code
    │ • Notify delivery staff (websocket)
    │
    ▼ staff picks up from kitchen
out_for_delivery
    │
    ▼ staff loads into locker, taps "Loaded" on T730
delivered (in locker)
    │ • Customer notified (SMS/push/email)
    │ • LED on, display shows "Ready"
    │
    ▼ customer picks up (sensor detects item removed)
completed
```

---

## Screens

### 1. Delivery Queue

**Path:** `/admin/lockers`

**Purpose:** List orders ready for delivery, filtered by location

**Data:**
```typescript
interface DeliveryQueueItem {
  orderId: string;
  orderNumber: string;
  customerName: string;
  location: { id: string; name: string };
  assignedLocker: {
    compartmentId: string;
    lockerNumber: number;
    status: 'online' | 'offline' | 'fault';
  } | null;
  pickupCode: string;
  status: 'ready_for_delivery' | 'out_for_delivery' | 'delivered';
  createdAt: string;
  itemCount: number;
}
```

**API:** `GET /api/orders?status=ready_for_delivery,out_for_delivery&location={id}`

**UI:**
- Location filter dropdown
- Order cards: order number, customer, locker #, status
- Tap → Load Order screen
- Auto-refresh every 5s or via websocket

---

### 2. Load Order

**Path:** `/admin/lockers/load/{orderId}`

**Purpose:** View order, unlock locker, mark as loaded

**UI Flow:**
```
┌─────────────────────────────────────────┐
│ ← Back            LOAD ORDER            │
├─────────────────────────────────────────┤
│ Order #A042                             │
│ Customer: John D.                       │
│                                         │
│ Items:                                  │
│   2x Latte                              │
│   1x Croissant (extra butter)           │
│                                         │
│ Pickup Code: ABC123                     │
├─────────────────────────────────────────┤
│ ASSIGNED LOCKER                         │
│ ┌─────────────────────────────────────┐ │
│ │  Locker 2  •  Online ●              │ │
│ │  Door: Closed                       │ │
│ │                       [Change]      │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │         🔓 UNLOCK                   │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ┌─────────────────────────────────────┐ │
│ │         ✓ LOADED (disabled)         │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

**Button States:**

| Door State | UNLOCK | LOADED |
|------------|--------|--------|
| Closed, not loaded | Active | Disabled |
| Opening | Loading... | Disabled |
| Open | Disabled | Active |
| Load complete | — | → Back to queue |

**API Calls:**
- `GET /api/orders/{id}` - order details
- `GET /api/lockers/{compartmentId}` - locker status
- `POST /api/lockers/{id}` `{ action: 'unlock' }` - open door
- `POST /api/lockers/loaded` `{ orderId }` - mark loaded
- `POST /api/lockers/assign` `{ orderId, compartmentId }` - reassign

---

### 3. Locker Status (Troubleshooting)

**Path:** `/admin/lockers/status`

**Purpose:** View all lockers, manual control

**UI:**
```
┌─────────────────────────────────────────┐
│ LOCKER STATUS           Column: COL-001 │
│                         Online ●        │
├─────────────────────────────────────────┤
│ ┌─────────┐ ┌─────────┐ ┌─────────┐    │
│ │    1    │ │    2    │ │    3    │    │
│ │         │ │  #A042  │ │         │    │
│ │  AVAIL  │ │ LOADED  │ │  FAULT  │    │
│ │    🟢   │ │    🟡   │ │    🔴   │    │
│ └─────────┘ └─────────┘ └─────────┘    │
│                                         │
│ Tap locker for manual control           │
└─────────────────────────────────────────┘
```

**Locker Detail Modal:**
- Sensor readings (door, occupancy, IR, motor, safety)
- Manual controls: Unlock, LED on/off, Clear fault

---

## Websocket Events

### Server → Client

| Event | Data | When |
|-------|------|------|
| `order:ready` | orderId, lockerNumber, pickupCode | New order assigned |
| `locker:door_opened` | compartmentId | Door opened |
| `locker:door_closed` | compartmentId | Door closed |
| `locker:picked_up` | compartmentId, orderId | Customer took item |
| `locker:fault` | compartmentId, faultType | Hardware issue |
| `column:status` | columnId, online | ESP32 online/offline |

### Client → Server

| Event | Data | Purpose |
|-------|------|---------|
| `subscribe` | locationId | Watch location updates |
| `unsubscribe` | locationId | Stop watching |

---

## Data Model Changes

### Order Table Additions

```sql
ALTER TABLE "Order" ADD COLUMN fulfillmentType TEXT DEFAULT 'pickup';
ALTER TABLE "Order" ADD COLUMN deliveryLocationId TEXT;
ALTER TABLE "Order" ADD COLUMN compartmentId TEXT;
ALTER TABLE "Order" ADD COLUMN pickupCode TEXT;
ALTER TABLE "Order" ADD COLUMN pickedUpAt TEXT;
```

### New Tables

```sql
CREATE TABLE LockerLocation (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  columnId TEXT,              -- FK to LockerColumn
  isActive INTEGER DEFAULT 1
);
```

---

## Offline Behavior

### T730 Offline (no internet, but local network works)

| Function | Works? | Notes |
|----------|--------|-------|
| Customer pickup (code entry) | ✓ | Validates against local cache |
| Staff unlock locker | ✓ | Direct to ESP32 |
| View locker status | ✓ | Direct from ESP32 |
| Load new orders | ✗ | Needs POS sync |
| Send notifications | ✗ | Queue until online |

**Local cache:**
- Pickup codes synced periodically
- Valid for 24 hours
- Cleared after use

---

## API Summary

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/orders` | GET | List orders by status/location |
| `/api/orders/{id}` | GET | Order details |
| `/api/lockers` | GET | List columns & compartments |
| `/api/lockers/{id}` | GET | Compartment status + sensors |
| `/api/lockers/{id}` | POST | Actions: unlock, lock, led |
| `/api/lockers/assign` | POST | Assign order to locker |
| `/api/lockers/loaded` | POST | Mark order loaded |
| `/api/lockers/pickup` | POST | Validate code, unlock |
| `/api/lockers/announce` | POST | ESP32 registration |
| `/api/lockers/heartbeat` | POST | ESP32 status update |
| `/api/lockers/event` | POST | ESP32 event notification |

---

## Implementation Priority

1. ✓ ESP32 firmware (done)
2. ✓ T730 API routes (done)
3. **Next:** T730 standalone UI (kiosk + admin)
4. **Later:** Main POS integration

---

*End of Spec*
