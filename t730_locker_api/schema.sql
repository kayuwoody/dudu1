-- Locker System Database Schema
-- Add to existing SQLite database

-- Column registry (ESP32 backplanes)
CREATE TABLE IF NOT EXISTS LockerColumn (
  id TEXT PRIMARY KEY,              -- "COL-001"
  ip TEXT NOT NULL,
  port INTEGER DEFAULT 80,
  lockerCount INTEGER NOT NULL,
  firmwareVersion TEXT,
  lastSeen TEXT,
  isOnline INTEGER DEFAULT 1,
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Individual compartments
CREATE TABLE IF NOT EXISTS Compartment (
  id TEXT PRIMARY KEY,              -- "COL-001-0"
  columnId TEXT NOT NULL,
  lockerIndex INTEGER NOT NULL,     -- 0, 1, 2...
  size TEXT DEFAULT 'M',            -- S, M, L
  status TEXT DEFAULT 'available',  -- available, reserved, occupied, open, fault
  currentOrderId TEXT,
  lastStatusChange TEXT,
  FOREIGN KEY (columnId) REFERENCES LockerColumn(id)
);

-- Event log for audit trail
CREATE TABLE IF NOT EXISTS LockerEvent (
  id TEXT PRIMARY KEY,
  compartmentId TEXT NOT NULL,
  event TEXT NOT NULL,
  data TEXT,                        -- JSON
  timestamp TEXT NOT NULL,
  FOREIGN KEY (compartmentId) REFERENCES Compartment(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_compartment_column ON Compartment(columnId);
CREATE INDEX IF NOT EXISTS idx_compartment_order ON Compartment(currentOrderId);
CREATE INDEX IF NOT EXISTS idx_locker_event_compartment ON LockerEvent(compartmentId);
CREATE INDEX IF NOT EXISTS idx_locker_event_timestamp ON LockerEvent(timestamp);

-- Order table additions (run as ALTER if Order table exists)
-- ALTER TABLE "Order" ADD COLUMN fulfillmentType TEXT DEFAULT 'pickup';
-- ALTER TABLE "Order" ADD COLUMN compartmentId TEXT;
-- ALTER TABLE "Order" ADD COLUMN pickupCode TEXT;
-- ALTER TABLE "Order" ADD COLUMN pickedUpAt TEXT;

-- Index for fast pickup code lookup
-- CREATE INDEX IF NOT EXISTS idx_order_pickup_code ON "Order"(pickupCode) WHERE pickedUpAt IS NULL;
