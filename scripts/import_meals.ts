import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
let TARGET_USER_ID = process.env.TARGET_USER_ID;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Error: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

interface CsvRow {
  date: string;
  time: string;
  meal_name: string;
  food_name: string;
  grams: string;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

async function run() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: npx tsx scripts/import_meals.ts <path-to-csv>');
    process.exit(1);
  }

  // 1. Resolve User
  if (!TARGET_USER_ID) {
    console.log('No TARGET_USER_ID provided. Fetching first user from Auth...');
    const { data: { users }, error: userError } = await supabase.auth.admin.listUsers();
    if (userError || !users || users.length === 0) {
      console.error('Error fetching users:', userError?.message || 'No users found');
      process.exit(1);
    }
    TARGET_USER_ID = users[0].id;
    console.log(`Using target user: ${users[0].email} (${TARGET_USER_ID})`);
  }

  // 2. Fetch Foods for matching
  console.log('Fetching foods for matching...');
  const { data: foods, error: foodsError } = await supabase
    .from('foods')
    .select('id, name_hu');
  
  if (foodsError) {
    console.error('Error fetching foods:', foodsError.message);
    process.exit(1);
  }

  const foodMap = new Map<string, string>();
  foods.forEach(f => {
    if (f.name_hu) {
      foodMap.set(normalize(f.name_hu), f.id);
    }
  });

  // 3. Fetch Existing Meals for duplicate detection
  console.log('Fetching existing meals for duplicate detection...');
  const { data: existingMeals, error: existingError } = await supabase
    .from('meals')
    .select('created_at')
    .eq('user_id', TARGET_USER_ID);
  
  if (existingError) {
    console.error('Error fetching existing meals:', existingError.message);
    process.exit(1);
  }

  const existingTimestamps = new Set(existingMeals.map(m => new Date(m.created_at).toISOString()));

  // 4. Parse CSV
  console.log(`Reading CSV: ${filePath}`);
  const csvContent = fs.readFileSync(path.resolve(filePath), 'utf-8');
  const parsed = Papa.parse<CsvRow>(csvContent, {
    header: true,
    skipEmptyLines: true
  });

  if (parsed.errors.length > 0) {
    console.warn('CSV Parsing warnings:', parsed.errors);
  }

  const rows = parsed.data;
  
  // 5. Group Rows by Meal
  const mealGroups: Record<string, { name: string, time: string, rows: CsvRow[] }> = {};
  
  rows.forEach(row => {
    // Treat CSV time as UTC to avoid local timezone issues during import.
    // This ensures consistency between parsing and database storage.
    const createdAt = `${row.date}T${row.time}:00Z`;
    let isoTimestamp;
    try {
      isoTimestamp = new Date(createdAt).toISOString();
    } catch (e) {
      console.error(`Invalid date/time format: ${row.date} ${row.time}`);
      return;
    }

    const key = `${TARGET_USER_ID}_${isoTimestamp}`;
    if (!mealGroups[key]) {
      mealGroups[key] = {
        name: row.meal_name,
        time: row.time,
        rows: []
      };
    }
    mealGroups[key].rows.push(row);
  });

  // 6. Process Groups
  const mealsToInsert: any[] = [];
  const itemsToInsert: any[] = [];
  const unmatchedFoods = new Set<string>();
  
  let mealsSkipped = 0;
  let itemsSkipped = 0;

  for (const [key, group] of Object.entries(mealGroups)) {
    const [userId, isoTimestamp] = key.split('_');

    if (existingTimestamps.has(isoTimestamp)) {
      mealsSkipped++;
      continue;
    }

    // Check if meal has valid items
    const validItems: { food_id: string, grams: number }[] = [];
    group.rows.forEach(row => {
      const normalizedName = normalize(row.food_name);
      const foodId = foodMap.get(normalizedName);
      
      if (foodId) {
        validItems.push({
          food_id: foodId,
          grams: parseFloat(row.grams) || 0
        });
      } else {
        unmatchedFoods.add(row.food_name);
        itemsSkipped++;
      }
    });

    if (validItems.length > 0) {
      mealsToInsert.push({
        user_id: TARGET_USER_ID,
        name: group.name,
        time: group.time,
        created_at: isoTimestamp,
        // The table schema in App.tsx suggests 'items' jsonb might also be needed for some versions,
        // but it explicitly uses meal_items table now. We'll stick to meal_items.
      });
      // Store items temporarily to insert after we get meal IDs
      (mealsToInsert[mealsToInsert.length - 1] as any)._items = validItems;
    }
  }

  // 7. Insert Meals and Items
  console.log(`Processing ${mealsToInsert.length} new meals...`);
  if (mealsToInsert.length === 0) {
    console.log('No new meals to insert.');
  } else {
    let mealsCount = 0;
    let itemsCount = 0;

    for (const meal of mealsToInsert) {
      const { _items, ...mealData } = meal;
      
      const { data: insertedMeal, error: insertError } = await supabase
        .from('meals')
        .insert(mealData)
        .select()
        .single();

      if (insertError) {
        console.error(`Error inserting meal "${meal.name}" at ${meal.created_at}:`, insertError.message);
        continue;
      }

      mealsCount++;

      const itemsWithId = _items.map((item: any) => ({
        meal_id: insertedMeal.id,
        food_id: item.food_id,
        grams: item.grams
      }));

      const { error: itemsError } = await supabase
        .from('meal_items')
        .insert(itemsWithId);

      if (itemsError) {
        console.error(`Error inserting items for meal ID ${insertedMeal.id}:`, itemsError.message);
      } else {
        itemsCount += itemsWithId.length;
      }
    }

    // 9. Final Report
    console.log('\n--- IMPORT COMPLETE ---');
    console.log(`Meals inserted:     ${mealsCount}`);
    console.log(`Meal items inserted: ${itemsCount}`);
    console.log(`Meals skipped:      ${mealsSkipped} (duplicates)`);
    console.log(`Items skipped:      ${itemsSkipped} (unmatched food)`);
  }
  
  if (unmatchedFoods.size > 0) {
    console.log('\nUNMATCHED FOODS:');
    Array.from(unmatchedFoods).sort().forEach(f => console.log(`- ${f}`));
  }
  console.log('------------------------\n');
}

run().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
