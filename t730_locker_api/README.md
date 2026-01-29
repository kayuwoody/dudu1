# T730 Locker API Integration

Add these files to your existing Next.js POS application to enable locker functionality.

## File Structure

```
your-pos-app/
├── app/
│   └── api/
│       └── lockers/
│           ├── route.ts          # GET /api/lockers - list all
│           ├── announce/
│           │   └── route.ts      # POST - ESP32 registration
│           ├── heartbeat/
│           │   └── route.ts      # POST - ESP32 status updates
│           ├── event/
│           │   └── route.ts      # POST - ESP32 event notifications
│           ├── pickup/
│           │   └── route.ts      # POST - validate code & unlock
│           ├── assign/
│           │   └── route.ts      # POST - assign order to locker
│           ├── loaded/
│           │   └── route.ts      # POST - mark order loaded
│           └── [id]/
│               └── route.ts      # GET/POST - compartment operations
└── lib/
    └── db/
        └── lockerService.ts      # All locker business logic
```

## Setup

### 1. Run Database Migration

Execute `schema.sql` against your SQLite database:

```bash
sqlite3 your-database.db < schema.sql
```

Or add the tables via your migration system.

### 2. Add Order Table Columns

If your Order table exists, add these columns:

```sql
ALTER TABLE "Order" ADD COLUMN fulfillmentType TEXT DEFAULT 'pickup';
ALTER TABLE "Order" ADD COLUMN compartmentId TEXT;
ALTER TABLE "Order" ADD COLUMN pickupCode TEXT;
ALTER TABLE "Order" ADD COLUMN pickedUpAt TEXT;

CREATE INDEX idx_order_pickup_code ON "Order"(pickupCode) WHERE pickedUpAt IS NULL;
```

### 3. Copy Files

Copy the API routes and lockerService.ts to your project.

### 4. Update Imports

In `lockerService.ts`, update the db import to match your setup:

```typescript
import db from './init';  // Your existing db connection
```

### 5. Install nanoid (if not already)

```bash
npm install nanoid
```

## API Endpoints

### ESP32 → T730 (Incoming from lockers)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/lockers/announce` | POST | ESP32 registers on boot |
| `/api/lockers/heartbeat` | POST | Periodic status update |
| `/api/lockers/event` | POST | Door/sensor events |

### T730 UI → Lockers (Outgoing to lockers)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/lockers` | GET | List all columns & compartments |
| `/api/lockers?available=true` | GET | List available compartments |
| `/api/lockers/[id]` | GET | Get compartment status |
| `/api/lockers/[id]` | POST | Action: unlock, lock, led, display |
| `/api/lockers/pickup` | POST | Validate code & unlock |
| `/api/lockers/assign` | POST | Assign order to compartment |
| `/api/lockers/loaded` | POST | Mark order as loaded |

## Typical Flows

### Staff Flow: Order Ready for Locker

```
1. Order completed in kitchen
2. Staff calls: POST /api/lockers/assign
   Body: { orderId: "order-123" }
   Response: { compartmentId: "COL-001-2", pickupCode: "ABC123" }

3. Staff places order in locker, calls: POST /api/lockers/loaded
   Body: { orderId: "order-123" }
   
4. Customer receives notification with pickup code
```

### Customer Flow: Pickup

```
1. Customer enters code on kiosk touchscreen
2. UI calls: POST /api/lockers/pickup
   Body: { code: "ABC123" }
   
3. If valid:
   - Locker display shows alert
   - LED pulses
   - Door unlocks
   Response: { success: true, compartmentId: "COL-001-2" }

4. Customer takes order
5. ESP32 detects item removed, sends event
6. Compartment returns to 'available'
```

### Admin: Manual Unlock

```
POST /api/lockers/COL-001-2
Body: { action: "unlock" }
```

### Admin: Update Display

```
POST /api/lockers/COL-001-2
Body: { 
  action: "display", 
  screen: "MAINTENANCE",
  data: { message: "Out of service" }
}
```

## Testing Without Hardware

You can simulate ESP32 announcements for testing:

```bash
# Simulate column registration
curl -X POST http://localhost:3000/api/lockers/announce \
  -H "Content-Type: application/json" \
  -d '{"columnId":"COL-001","ip":"192.168.1.10","port":80,"lockerCount":3,"firmwareVersion":"1.0.0"}'

# Check registered columns
curl http://localhost:3000/api/lockers
```

## Network Configuration

Ensure T730 and ESP32s are on same network:

| Device | IP | Port |
|--------|-----|------|
| T730 | 192.168.1.1 | 3000 |
| ESP32 COL-001 | 192.168.1.10 | 80 |
| ESP32 COL-002 | 192.168.1.11 | 80 |

ESP32s find T730 at hardcoded `192.168.1.1:3000` (configurable in firmware).

## Error Handling

All endpoints return:

```json
// Success
{ "success": true, ... }

// Error
{ "success": false, "error": "Description of error" }
```

Common errors:
- `Column not found` - ESP32 hasn't announced yet
- `Column offline` - No heartbeat in 60 seconds
- `Compartment not found` - Invalid compartment ID
- `Invalid or expired pickup code` - Code not found or already used
- `No available compartments` - All lockers occupied
