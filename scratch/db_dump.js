const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./queue.db');

db.serialize(() => {
    db.all("SELECT * FROM users", (err, rows) => {
        console.log("=== USERS ===");
        console.table(rows);
    });
    db.all("SELECT * FROM doctors", (err, rows) => {
        console.log("=== DOCTORS ===");
        console.table(rows);
    });
    db.all("SELECT * FROM queue", (err, rows) => {
        console.log("=== QUEUE ===");
        console.table(rows);
    });
});
