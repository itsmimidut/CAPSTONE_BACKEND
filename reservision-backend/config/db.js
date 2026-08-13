import mysql from "mysql2/promise";
import 'dotenv/config';

const db = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "eduardos",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

export { db };
export default db;
