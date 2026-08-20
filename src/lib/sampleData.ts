import { db } from "../db";
import type { Placement, Student } from "../types";

export const SAMPLE_STUDENTS: Omit<Student, "id">[] = [
  { name: "Amelia Wright", postcode: "SW1A 1AA", year: 2, isDriver: true },
  { name: "Noah Kelly", postcode: "SW1A 2AA", year: 1, isDriver: false },
  { name: "Sophie Turner", postcode: "M1 1AE", year: 2, isDriver: false },
  { name: "Jack Osei", postcode: "M2 5DB", year: 3, isDriver: true },
  { name: "Isla Robertson", postcode: "B2 4QA", year: 2, isDriver: true },
  { name: "Harry Nguyen", postcode: "LS1 4DY", year: 1, isDriver: false },
  { name: "Freya Ahmed", postcode: "BS1 4DJ", year: 3, isDriver: false },
  { name: "Leo Fitzgerald", postcode: "L1 8JQ", year: 2, isDriver: true },
];

export const SAMPLE_PLACEMENTS: Omit<Placement, "id">[] = [
  {
    name: "Westminster Community Paediatrics",
    postcode: "SW1A 2AA",
    category: "paediatric",
    yearsOffered: [1, 2, 3],
    requiresDriver: true,
    capacity: 1,
  },
  {
    name: "St Thomas Adult Day Unit",
    postcode: "SW1A 1AA",
    category: "adult",
    yearsOffered: [1, 2, 3],
    requiresDriver: false,
    capacity: 2,
  },
  {
    name: "Manchester Royal Paediatrics",
    postcode: "M2 5DB",
    category: "paediatric",
    yearsOffered: [2, 3],
    requiresDriver: false,
    capacity: 2,
  },
  {
    name: "Salford Adult Rehab",
    postcode: "M1 1AE",
    category: "adult",
    yearsOffered: [1, 2, 3],
    requiresDriver: false,
    capacity: null,
  },
  {
    name: "Birmingham Children's Outreach",
    postcode: "B4 7XG",
    category: "paediatric",
    yearsOffered: [1, 2, 3],
    requiresDriver: true,
    capacity: 1,
  },
  {
    name: "Leeds Adult Community Team",
    postcode: "LS2 3AD",
    category: "adult",
    yearsOffered: [2, 3],
    requiresDriver: true,
    capacity: 1,
  },
  {
    name: "Bristol Paediatric Clinic",
    postcode: "BS1 5TR",
    category: "paediatric",
    yearsOffered: [1, 2, 3],
    requiresDriver: false,
    capacity: 2,
  },
  {
    name: "Liverpool Adult Ward",
    postcode: "L7 8XP",
    category: "adult",
    yearsOffered: [1, 2, 3],
    requiresDriver: false,
    capacity: 2,
  },
];

export async function loadSampleData(): Promise<void> {
  await db.students.bulkAdd(SAMPLE_STUDENTS.map((s) => ({ ...s, id: crypto.randomUUID() })));
  await db.placements.bulkAdd(SAMPLE_PLACEMENTS.map((p) => ({ ...p, id: crypto.randomUUID() })));
}
