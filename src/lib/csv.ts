import Papa from "papaparse";
import { isValidPostcode } from "./geocode";
import { SAMPLE_LECTURERS, SAMPLE_PLACEMENTS, SAMPLE_STUDENTS } from "./sampleData";
import type { Category, Lecturer, Placement, Student, Year } from "../types";

export interface ImportResult<T> {
  rows: T[];
  errors: string[];
}

/** Accepts the spellings people actually type in a spreadsheet. */
function parseCategory(value: string | undefined): Category | null {
  const normalised = value?.trim().toLowerCase();
  if (normalised === "paediatric" || normalised === "paediatrics" || normalised === "paeds") return "paediatric";
  if (normalised === "adult" || normalised === "adults") return "adult";
  return null;
}

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
    const requiredRaw = row.requiredcategory?.trim();
    const requiredCategory = parseCategory(requiredRaw);

    if (!name) return void errors.push(`Line ${line}: missing name`);
    if (!postcode || !isValidPostcode(postcode))
      return void errors.push(`Line ${line}: invalid postcode "${row.postcode}"`);
    if (![1, 2, 3].includes(year))
      return void errors.push(`Line ${line}: year must be 1, 2 or 3`);
    if (requiredRaw && !requiredCategory)
      return void errors.push(
        `Line ${line}: requiredCategory must be "paediatric", "adult", or left blank for either`,
      );

    rows.push({ id: crypto.randomUUID(), name, postcode, year, isDriver, requiredCategory });
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
    const category = parseCategory(row.category);
    const yearsOffered = (row.yearsoffered ?? "")
      .split(/[;,]/)
      .map((y) => Number(y.trim()))
      .filter((y): y is Year => [1, 2, 3].includes(y));
    const requiresDriver = /^(true|yes|y|1)$/i.test(row.requiresdriver?.trim() ?? "");
    const capacity = row.capacity?.trim() ? Number(row.capacity.trim()) : null;

    if (!name) return void errors.push(`Line ${line}: missing name`);
    if (!postcode || !isValidPostcode(postcode))
      return void errors.push(`Line ${line}: invalid postcode "${row.postcode}"`);
    if (!category) return void errors.push(`Line ${line}: category must be "paediatric" or "adult"`);
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

export async function importLecturersCsv(file: File): Promise<ImportResult<Lecturer>> {
  const raw = await parseCsv(file);
  const rows: Lecturer[] = [];
  const errors: string[] = [];

  raw.forEach((row, i) => {
    const line = i + 2;
    const name = row.name?.trim();
    const postcode = row.postcode?.trim();

    if (!name) return void errors.push(`Line ${line}: missing name`);
    if (!postcode || !isValidPostcode(postcode))
      return void errors.push(`Line ${line}: invalid postcode "${row.postcode}"`);

    rows.push({ id: crypto.randomUUID(), name, postcode });
  });

  return { rows, errors };
}

function downloadCsv(filename: string, rows: Record<string, string | number | boolean>[]) {
  const csv = Papa.unparse(rows);
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadSampleStudentsCsv() {
  downloadCsv(
    "students-sample.csv",
    SAMPLE_STUDENTS.map((s) => ({
      name: s.name,
      postcode: s.postcode,
      year: s.year,
      isDriver: s.isDriver,
      requiredCategory: s.requiredCategory ?? "",
    })),
  );
}

export function downloadSamplePlacementsCsv() {
  downloadCsv(
    "placements-sample.csv",
    SAMPLE_PLACEMENTS.map((p) => ({
      name: p.name,
      postcode: p.postcode,
      category: p.category,
      yearsOffered: p.yearsOffered.join(";"),
      requiresDriver: p.requiresDriver,
      capacity: p.capacity ?? "",
    })),
  );
}

export function downloadSampleLecturersCsv() {
  downloadCsv(
    "lecturers-sample.csv",
    SAMPLE_LECTURERS.map((l) => ({ name: l.name, postcode: l.postcode })),
  );
}
