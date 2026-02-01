import mysql from "mysql2/promise";

const db = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "",
  database: "eduardos",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

export { db };
export default db;
