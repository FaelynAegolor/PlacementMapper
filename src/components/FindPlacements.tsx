import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { db } from "../db";
import { categoryLabel } from "../lib/assignments";
import { isValidPostcode, normalisePostcode } from "../lib/geocode";
import { findOpportunities, type OpportunitySearch } from "../lib/opportunities";
import {
  KIND_ORDER,
  normaliseName,
  OPPORTUNITY_KINDS,
  type Opportunity,
  type OpportunityKind,
} from "../lib/opportunityMatching";
import { nearestPostcode } from "../lib/placeSearch";
import { formatDistance } from "../lib/routing";
import { useStickyState } from "../lib/stickyState";
import { toast } from "../lib/toast";
import type { Category } from "../types";
import { kindColor } from "./mapIcons";
import { OpportunityMap } from "./OpportunityMap";

/** Wide enough for a rural search, where the nearest hospital can be an
 * hour away. */
const RADIUS_OPTIONS = [2, 5, 10, 15, 25, 50];
/** Enough to work through without the table becoming a phone book. */
const MAX_ROWS = 150;

const DEFAULT_KINDS = KIND_ORDER.filter((kind) => OPPORTUNITY_KINDS[kind].defaultOn);

export function FindPlacements() {
  const students = useLiveQuery(() => db.students.orderBy("name").toArray(), []) ?? [];
  const placements = useLiveQuery(() => db.placements.toArray(), []) ?? [];

  const [postcode, setPostcode] = useStickyState("find.postcode", "");
  const [radiusMiles, setRadiusMiles] = useStickyState("find.radius", 5);
  const [kinds, setKinds] = useStickyState<OpportunityKind[]>("find.kinds", DEFAULT_KINDS);
  const [result, setResult] = useStickyState<OpportunitySearch | null>("find.result", null);
  const [groupChoices, setGroupChoices] = useStickyState<Record<string, Category>>("find.groups", {});
  const [selectedId, setSelectedId] = useStickyState<string | null>("find.selected", null);
  const [sortBy, setSortBy] = useStickyState<"distance" | "fit">("find.sort", "distance");

  const [searching, setSearching] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function search() {
    if (!isValidPostcode(postcode)) {
      setError("Enter a full postcode or an outward code such as SE9");
      return;
    }
    setSearching(true);
    setError(null);
    setSelectedId(null);
    try {
      const found = await findOpportunities(postcode, radiusMiles, setProgress);
      setResult(found);
      toast(
        `Found ${found.opportunities.length} possible site${found.opportunities.length === 1 ? "" : "s"} within ${radiusMiles} miles of ${found.postcode}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setResult(null);
    } finally {
      setSearching(false);
      setProgress("");
    }
  }

  /** A site is already on the books if a placement shares its name, or sits
   * at the same postcode under a name that normalises the same way. */
  const existingKey = new Set(
    placements.flatMap((p) => [normaliseName(p.name), `${normaliseName(p.name)}@${normalisePostcode(p.postcode)}`]),
  );
  const alreadyAdded = (o: Opportunity) => existingKey.has(normaliseName(o.name));

  const groupFor = (o: Opportunity): Category =>
    groupChoices[o.id] ?? (o.clientGroup === "both" ? "adult" : o.clientGroup);

  async function addToPlacements(o: Opportunity) {
    try {
      const sitePostcode = o.postcode ?? (await nearestPostcode(o.point.lat, o.point.lng));
      await db.placements.add({
        id: crypto.randomUUID(),
        name: o.name,
        postcode: sitePostcode,
        category: groupFor(o),
        yearsOffered: [1, 2, 3],
        requiresDriver: false,
        capacity: null,
      });
      toast(`Added ${o.name} — set its years and capacity on the Placements tab`);
    } catch {
      toast(`Could not work out a postcode for ${o.name}`, "error");
    }
  }

  function toggleKind(kind: OpportunityKind) {
    setKinds((prev) => (prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]));
  }

  const countsByKind = new Map<OpportunityKind, number>();
  for (const o of result?.opportunities ?? []) {
    countsByKind.set(o.kind, (countsByKind.get(o.kind) ?? 0) + 1);
  }
  const visible = (result?.opportunities ?? [])
    .filter((o) => kinds.includes(o.kind))
    // "Best fit" floats anything whose name mentions speech, language or a
    // related client group above the rest, still nearest-first within each.
    .sort((a, b) =>
      sortBy === "distance"
        ? a.distanceMeters - b.distanceMeters
        : (b.sltSignals.length > 0 ? 1 : 0) - (a.sltSignals.length > 0 ? 1 : 0) ||
          a.distanceMeters - b.distanceMeters,
    );
  const shown = visible.slice(0, MAX_ROWS);
  const withSignals = visible.filter((o) => o.sltSignals.length > 0).length;

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Find New Placements</h2>
      </div>
      <p className="hint">
        Looks for places near a student that could take a speech and language therapy student — hospitals, NHS
        community services, clinics, special schools and language units, nurseries, care homes and rehab. Two
        open sources are searched: OpenStreetMap for what's on the ground, and the NHS organisation register,
        which knows about community teams and registered care the map doesn't. Pharmacies, dentists, opticians, GP
        surgeries and clinics in unrelated specialties are left out. It works anywhere in the UK, though the NHS
        register is thin outside England. This is a prospecting list, not an approved one — every site still needs
        checking and an agreement before a student goes there.
      </p>

      <div className="filter-row">
        <label>
          Student:
          <select
            value=""
            onChange={(e) => {
              const student = students.find((s) => s.id === e.target.value);
              if (student) setPostcode(student.postcode);
            }}
          >
            <option value="">Pick a student…</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.postcode || "no postcode"})
              </option>
            ))}
          </select>
        </label>
        <label>
          Postcode:
          <input
            value={postcode}
            onChange={(e) => setPostcode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !searching && search()}
            placeholder="e.g. SE9 2UG"
            style={{ width: "8rem" }}
          />
        </label>
        <label>
          Within:
          <select value={radiusMiles} onChange={(e) => setRadiusMiles(Number(e.target.value))}>
            {RADIUS_OPTIONS.map((miles) => (
              <option key={miles} value={miles}>
                {miles} miles
              </option>
            ))}
          </select>
        </label>
        <button onClick={search} disabled={searching || !postcode.trim()}>
          {searching ? "Searching…" : "Search"}
        </button>
        {radiusMiles >= 25 && (
          <span className="hint">Wide searches take a while, and can time out in a big city.</span>
        )}
      </div>
      {searching && progress && <p className="hint">{progress}</p>}
      {error && <p className="text-error">{error}</p>}

      {result && (
        <>
          {result.notes.map((note, i) => (
            <p className="hint" key={i}>
              {note}
            </p>
          ))}
          {result.warnings.length > 0 && (
            <div className="error-box">
              {result.warnings.map((warning, i) => (
                <div key={i}>{warning} — these results are partial.</div>
              ))}
            </div>
          )}

          <div className="stat-row">
            <div className="stat-tile">
              <div className="stat-value">{result.opportunities.length}</div>
              <div className="stat-label">Sites found near {result.postcode}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-value">{visible.length}</div>
              <div className="stat-label">Matching your filters</div>
            </div>
            <div className="stat-tile">
              <div className="stat-value">{withSignals}</div>
              <div className="stat-label">Mentioning speech, language or related work</div>
            </div>
            <div className="stat-tile">
              <div className="stat-value">{visible.filter((o) => !alreadyAdded(o)).length}</div>
              <div className="stat-label">Not yet on your placements list</div>
            </div>
          </div>

          <div className="filter-row">
            <label>
              Order:
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as "distance" | "fit")}>
                <option value="distance">Closest first</option>
                <option value="fit">Best fit first</option>
              </select>
            </label>
          </div>

          <div className="filter-row">
            {KIND_ORDER.map((kind) => (
              <label key={kind} title={OPPORTUNITY_KINDS[kind].blurb}>
                <input type="checkbox" checked={kinds.includes(kind)} onChange={() => toggleKind(kind)} />
                <i
                  style={{
                    background: kindColor(kind),
                    display: "inline-block",
                    width: 9,
                    height: 9,
                    borderRadius: "50%",
                    margin: "0 0.35rem 0 0.1rem",
                  }}
                />
                {OPPORTUNITY_KINDS[kind].label} ({countsByKind.get(kind) ?? 0})
              </label>
            ))}
          </div>

          {visible.length > 0 && (
            <OpportunityMap
              origin={result.origin}
              originLabel={result.postcode}
              opportunities={shown}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          )}

          <table>
            <thead>
              <tr>
                <th>Site</th>
                <th>What it is</th>
                <th>Who you'd see</th>
                <th>Distance</th>
                <th>Postcode</th>
                <th>Source</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((o) => {
                const added = alreadyAdded(o);
                return (
                  <tr
                    key={o.id}
                    className={o.id === selectedId ? "selected-row" : ""}
                    onClick={() => setSelectedId(o.id)}
                    style={{ cursor: "pointer" }}
                  >
                    <td>
                      {o.name}
                      {o.sltSignals.map((signal) => (
                        <span key={signal} className="badge">
                          {signal}
                        </span>
                      ))}
                    </td>
                    <td>{o.detail}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <select
                        value={groupFor(o)}
                        onChange={(e) =>
                          setGroupChoices((prev) => ({ ...prev, [o.id]: e.target.value as Category }))
                        }
                      >
                        <option value="paediatric">{categoryLabel("paediatric")}</option>
                        <option value="adult">{categoryLabel("adult")}</option>
                      </select>
                      {o.clientGroup === "both" && <div className="hint">could be either</div>}
                    </td>
                    <td>{formatDistance(o.distanceMeters)}</td>
                    <td>{o.postcode ?? <span className="hint">looked up on adding</span>}</td>
                    <td>
                      <span className="hint">{o.sources.map((s) => (s === "nhs" ? "NHS" : "OSM")).join(" + ")}</span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button disabled={added} onClick={() => addToPlacements(o)}>
                        {added ? "Added" : "Add to placements"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {visible.length === 0 && (
            <p className="hint">
              {result.opportunities.length === 0
                ? "Nothing found in range — try a wider radius."
                : "Nothing matches the types you've ticked."}
            </p>
          )}
          {visible.length > shown.length && (
            <p className="hint">
              Showing the {MAX_ROWS} closest of {visible.length}. Narrow the types or the radius to see the rest.
            </p>
          )}
          {result.notLocated > 0 && (
            <p className="hint">
              {result.notLocated} NHS record{result.notLocated === 1 ? "" : "s"} had a postcode that no longer
              resolves, so {result.notLocated === 1 ? "it isn't" : "they aren't"} shown.
            </p>
          )}
        </>
      )}
    </div>
  );
}
