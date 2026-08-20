import { useState } from "react";
import { nearestPostcode, searchPlaces, type PlaceResult } from "../lib/placeSearch";

interface PostcodeLookupProps {
  defaultQuery: string;
  onSelect: (postcode: string) => void;
}

export function PostcodeLookup({ defaultQuery, onSelect }: PostcodeLookupProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(defaultQuery);
  const [results, setResults] = useState<PlaceResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    setOpen((prev) => !prev);
    setResults(null);
    setError(null);
    setQuery(defaultQuery);
  }

  async function search() {
    setLoading(true);
    setError(null);
    try {
      const places = await searchPlaces(query);
      setResults(places);
      if (places.length === 0) setError("No matches found");
    } catch {
      setError("Search failed");
    } finally {
      setLoading(false);
    }
  }

  async function pick(place: PlaceResult) {
    setLoading(true);
    setError(null);
    try {
      const postcode = await nearestPostcode(place.lat, place.lng);
      onSelect(postcode);
      setOpen(false);
      setResults(null);
    } catch {
      setError("Could not find a postcode near that location");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="postcode-lookup">
      <button type="button" onClick={toggle} className="postcode-lookup-toggle">
        {open ? "Cancel" : "Find postcode…"}
      </button>
      {open && (
        <div className="postcode-lookup-panel">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Hospital or place name"
            onKeyDown={(e) => e.key === "Enter" && search()}
          />
          <button type="button" onClick={search} disabled={loading}>
            {loading ? "Searching…" : "Search"}
          </button>
          {error && <p className="text-error">{error}</p>}
          {results && results.length > 0 && (
            <ul className="postcode-lookup-results">
              {results.map((r, i) => (
                <li key={i}>
                  <button type="button" onClick={() => pick(r)} disabled={loading}>
                    {r.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
