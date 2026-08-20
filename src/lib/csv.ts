import Papa from "papaparse";
import type { Category, Placement, Student, Year } from "../types";

export interface ImportResult<T> {
  rows: T[];
  errors: string[];
}

const POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

function parseCsv(file: File): Promise<Record<string, string>[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase(),
      complete: (result) => resolve(result.data),
      error: reject,
    });
  });
}

export async function importStudentsCsv(file: File): Promise<ImportResult<Student>> {
  const raw = await parseCsv(file);
  const rows: Student[] = [];
  const errors: string[] = [];

  raw.forEach((row, i) => {
    const line = i + 2; // header is line 1
    const name = row.name?.trim();
    const postcode = row.postcode?.trim();
    const year = Number(row.year) as Year;
    const isDriver = /^(true|yes|y|1)$/i.test(row.isdriver?.trim() ?? "");

    if (!name) return void errors.push(`Line ${line}: missing name`);
    if (!postcode || !POSTCODE_RE.test(postcode))
      return void errors.push(`Line ${line}: invalid postcode "${row.postcode}"`);
    if (![1, 2, 3].includes(year))
      return void errors.push(`Line ${line}: year must be 1, 2 or 3`);

    rows.push({ id: crypto.randomUUID(), name, postcode, year, isDriver });
  });

  return { rows, errors };
}

export async function importPlacementsCsv(file: File): Promise<ImportResult<Placement>> {
  const raw = await parseCsv(file);
  const rows: Placement[] = [];
  const errors: string[] = [];

  raw.forEach((row, i) => {
    const line = i + 2;
    const name = row.name?.trim();
    const postcode = row.postcode?.trim();
    const category = row.category?.trim().toLowerCase() as Category;
    const yearsOffered = (row.yearsoffered ?? "")
      .split(/[;,]/)
      .map((y) => Number(y.trim()))
      .filter((y): y is Year => [1, 2, 3].includes(y));
    const requiresDriver = /^(true|yes|y|1)$/i.test(row.requiresdriver?.trim() ?? "");
    const capacity = row.capacity?.trim() ? Number(row.capacity.trim()) : null;

    if (!name) return void errors.push(`Line ${line}: missing name`);
    if (!postcode || !POSTCODE_RE.test(postcode))
      return void errors.push(`Line ${line}: invalid postcode "${row.postcode}"`);
    if (category !== "paediatric" && category !== "adult")
      return void errors.push(`Line ${line}: category must be "paediatric" or "adult"`);
    if (yearsOffered.length === 0)
      return void errors.push(`Line ${line}: yearsOffered must include at least one of 1, 2, 3`);

    rows.push({
      id: crypto.randomUUID(),
      name,
      postcode,
      category,
      yearsOffered,
      requiresDriver,
      capacity: capacity != null && !Number.isNaN(capacity) ? capacity : null,
    });
  });

  return { rows, errors };
}
