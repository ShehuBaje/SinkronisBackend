import "dotenv/config";
import mysql from "mysql2/promise";

async function testConnection() {
  console.log("Starting database connection check...");

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not configured");
    }

    const connection = await mysql.createConnection(process.env.DATABASE_URL);
    console.log("Database connected successfully");
    await connection.end();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.log("Database connection failed:", message);
    process.exitCode = 1;
  }
}

void testConnection();
