import Papa from 'papaparse';
import { Food } from '../types';

// Example public Google Sheet CSV export URL
// The user should replace this with their own sheet ID
const DEFAULT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT-X_Y_Z_Z_Z_Z_Z_Z_Z_Z_Z_Z_Z_Z_Z_Z_Z_Z_Z_Z_Z_Z_Z_Z_Z_Z_Z_Z_Z_Z_Z_Z/pub?output=csv';

export async function fetchFoodsFromSheets(url: string = DEFAULT_SHEET_URL): Promise<Food[]> {
  try {
    const response = await fetch(url);
    const csvText = await response.text();

    return new Promise((resolve, reject) => {
      Papa.parse(csvText, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: (results) => {
          const foods: Food[] = results.data.map((row: any, index: number) => ({
            id: `sheet-${index}`,
            name_hu: row.name || 'Unknown Food',
            name_en: '',
            calories: Number(row.calories) || 0,
            carbs: Number(row.carbs) || 0,
            protein: Number(row.protein) || 0,
            fat: Number(row.fat) || 0,
            soluble_fiber: Number(row.soluble_fiber) || 0,
            insoluble_fiber: Number(row.insoluble_fiber) || 0,
            total_fiber: Number(row.total_fiber) || 0,
            source: 'sheets',
          }));
          resolve(foods);
        },
        error: (error) => {
          reject(error);
        },
      });
    });
  } catch (error) {
    console.error('Error fetching foods from sheets:', error);
    return [];
  }
}
