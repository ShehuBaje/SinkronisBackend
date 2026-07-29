import mysql from "mysql2/promise";

async function testConnection() {
  console.log("🚀 Starting DB connection...");

  try {
    const connection = await mysql.createConnection({
      host: "localhost",
      user: "root",
      password: "Shehu@4199",
      database: "sinkronis_db",
    });

    console.log("✅ MySQL connected successfully!");

    await connection.end();
  } catch (err: any) {
    console.log("❌ DB connection failed:", err.message);
  }
}

testConnection();