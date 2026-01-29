# T730 Locker Kiosk UI

Standalone Next.js application for the T730 locker terminal.

## Features

- **Customer Kiosk** (`/kiosk`) - Pickup code entry screen
- **Staff Admin** (`/admin/lockers`) - Delivery queue, locker management
- **Load Order** (`/admin/lockers/load/[orderId]`) - Unlock, load, confirm

## Offline Capability

The T730 communicates directly with ESP32 backplanes on the local network.
Works without internet - only needs LAN connection to locker columns.

## Installation

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

## Network Setup

| Device | IP | Port | Purpose |
|--------|-----|------|---------|
| T730 | 192.168.1.1 | 3001 | This application |
| ESP32 COL-001 | 192.168.1.10 | 80 | Locker column 0 |
| ESP32 COL-002 | 192.168.1.11 | 80 | Locker column 1 |

## Screens

### Home (`/`)
Mode selection - Customer Kiosk or Staff Admin

### Customer Kiosk (`/kiosk`)
- Large keypad for entering 6-character pickup code
- Supports USB barcode scanner for QR codes
- Shows locker number on successful validation
- Auto-resets after 5 seconds

### Staff Admin (`/admin/lockers`)
Two tabs:
1. **Delivery Queue** - Orders ready to load
2. **Locker Status** - Visual grid of all lockers

### Load Order (`/admin/lockers/load/[orderId]`)
1. View order details and pickup code
2. See assigned locker status
3. Tap UNLOCK to open door
4. Place order inside
5. Tap LOADED to confirm

## API Endpoints

### Orders (local cache)
- `GET /api/orders` - List orders
- `GET /api/orders/[id]` - Get order
- `POST /api/orders` - Create order (testing)
- `PATCH /api/orders/[id]` - Update order

### Lockers
- `GET /api/lockers` - List columns & compartments
- `GET /api/lockers/[id]` - Get compartment status
- `POST /api/lockers/[id]` - Actions (unlock, lock, led)
- `POST /api/lockers/pickup` - Validate code & unlock
- `POST /api/lockers/assign` - Assign order to locker
- `POST /api/lockers/loaded` - Mark order loaded

### ESP32 Registration (incoming)
- `POST /api/lockers/announce` - Column registration
- `POST /api/lockers/heartbeat` - Status update
- `POST /api/lockers/event` - Door/sensor events

## Testing Without Hardware

The app includes mock data for testing:
- 3 test orders with pickup codes
- 3 compartments in COL-001

Test pickup codes:
- `ABC123` - Order A042
- `XYZ789` - Order A043
- `QWE456` - Order A041 (already delivered)

## Production Deployment

1. Build the application: `npm run build`
2. Copy `.next/standalone` to T730
3. Run with: `node server.js`
4. Configure Windows to auto-start on boot
5. Set Chromium to launch fullscreen to `http://localhost:3001/kiosk`

## File Structure

```
t730_ui/
├── app/
│   ├── page.tsx              # Home - mode selection
│   ├── layout.tsx            # Root layout
│   ├── globals.css           # Global styles
│   ├── kiosk/
│   │   └── page.tsx          # Customer pickup
│   ├── admin/
│   │   └── lockers/
│   │       ├── page.tsx      # Delivery queue & status
│   │       └── load/
│   │           └── [orderId]/
│   │               └── page.tsx  # Load order screen
│   └── api/
│       ├── orders/           # Order endpoints
│       └── lockers/          # Locker endpoints
├── lib/
│   └── db/
│       ├── init.ts           # Mock database
│       └── lockerService.ts  # Locker business logic
├── package.json
├── tsconfig.json
└── next.config.js
```
