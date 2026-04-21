import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables for local testing
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Error: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const TABLES = ['meals', 'meal_items', 'foods'];

async function backup() {
  const dateStr = new Date().toISOString().split('T')[0];
  const backupDir = path.join(process.cwd(), 'backups', dateStr);

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  console.log(`Starting backup for ${dateStr}...`);

  for (const table of TABLES) {
    console.log(`Backing up table: ${table}...`);
    const { data, error } = await supabase.from(table).select('*');

    if (error) {
      console.error(`Error fetching table ${table}:`, error.message);
      continue;
    }

    const filePath = path.join(backupDir, `${table}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`Saved ${data.length} records to ${filePath}`);
  }

  console.log('Backup process completed.');
}

backup().catch(err => {
  console.error('Unhandled backup error:', err);
  process.exit(1);
});
