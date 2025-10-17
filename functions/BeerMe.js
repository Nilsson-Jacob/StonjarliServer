import axios from "axios";
import pool from "../db/db.js";

export default async function BeerMe() {
  // Make sure sentiments table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS Beers (
      id SERIAL PRIMARY KEY,
      beerCount NUMBER NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}
