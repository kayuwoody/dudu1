/**
 * @file lib/db/init.ts
 * @description Mock database for T730 standalone prototype
 * 
 * In production, replace with actual SQLite connection.
 * This uses in-memory storage that persists during runtime.
 */

// In-memory storage
const tables: Record<string, Map<string, any>> = {
  LockerColumn: new Map(),
  Compartment: new Map(),
  LockerEvent: new Map(),
  Order: new Map(),
};

// Mock database interface matching better-sqlite3 API
const db = {
  prepare: (sql: string) => {
    return {
      run: (...params: any[]) => {
        // Parse simple SQL and execute
        const insertMatch = sql.match(/INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+"?(\w+)"?\s+\(([^)]+)\)\s+VALUES\s+\(([^)]+)\)/i);
        const updateMatch = sql.match(/UPDATE\s+"?(\w+)"?\s+SET\s+(.+?)\s+WHERE\s+(.+)/i);
        
        if (insertMatch) {
          const [, table, cols, vals] = insertMatch;
          const columns = cols.split(',').map(c => c.trim());
          const id = params[0];
          
          if (!tables[table]) tables[table] = new Map();
          
          // Check for ON CONFLICT (upsert)
          const isUpsert = sql.includes('ON CONFLICT');
          if (!isUpsert && tables[table].has(id)) {
            return { changes: 0 };
          }
          
          const row: Record<string, any> = {};
          columns.forEach((col, i) => {
            row[col] = params[i];
          });
          
          tables[table].set(id, row);
          return { changes: 1 };
        }
        
        if (updateMatch) {
          const [, table, setClause] = updateMatch;
          if (!tables[table]) return { changes: 0 };
          
          // Simple: assume last param is WHERE id = ?
          const id = params[params.length - 1];
          const row = tables[table].get(id);
          if (!row) return { changes: 0 };
          
          // Parse SET clause and update
          const sets = setClause.split(',').map(s => s.trim());
          let paramIndex = 0;
          sets.forEach(s => {
            const [col] = s.split('=').map(x => x.trim());
            if (col && !col.includes('excluded.')) {
              row[col] = params[paramIndex++];
            }
          });
          
          tables[table].set(id, row);
          return { changes: 1 };
        }
        
        return { changes: 0 };
      },
      
      get: (...params: any[]) => {
        const selectMatch = sql.match(/SELECT\s+(.+?)\s+FROM\s+"?(\w+)"?\s+(?:.*?WHERE\s+(.+))?/i);
        
        if (selectMatch) {
          const [, , table] = selectMatch;
          if (!tables[table]) return undefined;
          
          // Simple: assume first param is id for WHERE
          const id = params[0];
          return tables[table].get(id);
        }
        
        return undefined;
      },
      
      all: (...params: any[]) => {
        const selectMatch = sql.match(/SELECT\s+\*\s+FROM\s+"?(\w+)"?/i);
        
        if (selectMatch) {
          const [, table] = selectMatch;
          if (!tables[table]) return [];
          return Array.from(tables[table].values());
        }
        
        return [];
      },
    };
  },
};

export default db;

// Also export a function to seed test data
export function seedTestData() {
  // Seed a test column
  if (!tables.LockerColumn.has('COL-001')) {
    tables.LockerColumn.set('COL-001', {
      id: 'COL-001',
      ip: '192.168.150.3',  // Updated to match current network
      port: 80,
      lockerCount: 3,
      firmwareVersion: '1.0.0',
      lastSeen: new Date().toISOString(),
      isOnline: 1,
    });
  }
  
  // Seed compartments
  for (let i = 0; i < 3; i++) {
    const id = `COL-001-${i}`;
    if (!tables.Compartment.has(id)) {
      tables.Compartment.set(id, {
        id,
        columnId: 'COL-001',
        lockerIndex: i,
        size: 'M',
        status: 'available',
        currentOrderId: null,
        lastStatusChange: new Date().toISOString(),
      });
    }
  }
}

// Seed on import
seedTestData();
