const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/medicare';

const pool = new Pool({
    connectionString: connectionString
});

// A mapping of table names to primary keys, to get the lastID for inserts
const PRIMARY_KEYS = {
    users: 'user_id',
    doctors: 'id',
    appointments: 'appointment_id',
    tokens: 'token_id',
    reviews: 'id',
    hospital_reviews: 'id',
    notifications: 'notification_id',
    consultations: 'consultation_id',
    prescriptions: 'prescription_id',
    follow_ups: 'followup_id'
};

function convertSql(sql) {
    if (!sql) return sql;

    // 1. Handle SQLite PRAGMA statements
    if (sql.trim().toUpperCase().startsWith('PRAGMA')) {
        return 'SELECT 1 /* IGNORED PRAGMA */';
    }

    // 2. Replace SQLite types/functions with Postgres equivalents
    let converted = sql
        .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY')
        .replace(/BOOLEAN DEFAULT 0/gi, 'BOOLEAN DEFAULT FALSE')
        .replace(/BOOLEAN DEFAULT 1/gi, 'BOOLEAN DEFAULT TRUE')
        .replace(/hospital_emergency INTEGER DEFAULT 0/gi, 'hospital_emergency BOOLEAN DEFAULT FALSE')
        .replace(/hospital_pharmacy INTEGER DEFAULT 0/gi, 'hospital_pharmacy BOOLEAN DEFAULT FALSE')
        .replace(/hospital_laboratory INTEGER DEFAULT 0/gi, 'hospital_laboratory BOOLEAN DEFAULT FALSE')
        .replace(/DEFAULT CURRENT_TIMESTAMP/gi, 'DEFAULT CURRENT_TIMESTAMP')
        .replace(/\bLIKE\b/gi, 'ILIKE')
        .replace(/date\('now'\)/gi, 'CURRENT_DATE')
        .replace(/date\(([^)]+)\)/gi, 'CAST($1 AS date)');

    // 3. Convert sqlite parameter placeholders (?) to pg ($1, $2, ...)
    let index = 1;
    converted = converted.replace(/\?/g, () => `$${index++}`);

    // 4. For INSERT statements, append RETURNING * if it's not already present
    if (converted.trim().toUpperCase().startsWith('INSERT') && !converted.toUpperCase().includes('RETURNING')) {
        converted += ' RETURNING *';
    }

    return converted;
}

class Database {
    constructor(filename, callback) {
        // Filename is ignored since we connect to PostgreSQL
        if (callback) {
            pool.connect((err, client, release) => {
                if (err) {
                    callback(err);
                } else {
                    release();
                    callback(null);
                }
            });
        }
    }

    serialize(callback) {
        if (callback) callback();
    }

    run(sql, params, callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        params = params || [];

        const pgSql = convertSql(sql);

        pool.query(pgSql, params, (err, result) => {
            if (err) {
                if (callback) callback(err);
                return;
            }

            const context = {
                changes: result.rowCount || 0,
                lastID: null
            };

            if (result.rows && result.rows.length > 0) {
                const row = result.rows[0];
                const insertMatch = sql.match(/insert\s+into\s+(\w+)/i);
                if (insertMatch) {
                    const tableName = insertMatch[1].toLowerCase();
                    const pkField = PRIMARY_KEYS[tableName];
                    if (pkField && row[pkField] !== undefined) {
                        context.lastID = row[pkField];
                    } else {
                        const pkKey = Object.keys(row).find(k => k === 'id' || k.endsWith('_id'));
                        if (pkKey) {
                            context.lastID = row[pkKey];
                        }
                    }
                }
            }

            if (callback) {
                callback.call(context, null);
            }
        });
    }

    get(sql, params, callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        params = params || [];

        const pgSql = convertSql(sql);

        pool.query(pgSql, params, (err, result) => {
            if (err) {
                if (callback) callback(err);
                return;
            }
            const row = result.rows[0];
            if (callback) {
                callback(null, row);
            }
        });
    }

    all(sql, params, callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        params = params || [];

        const pgSql = convertSql(sql);

        pool.query(pgSql, params, (err, result) => {
            if (err) {
                if (callback) callback(err);
                return;
            }
            if (callback) {
                callback(null, result.rows || []);
            }
        });
    }

    close(callback) {
        pool.end((err) => {
            if (callback) callback(err);
        });
    }
}

module.exports = {
    Database,
    verbose: function() {
        return this;
    }
};
