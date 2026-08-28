import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Search } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { KandidInlineLoader, KandidSkeleton } from "../../components/KandidLoader";
import {
  findSearchResult,
  getOfficerYearOptions,
  getRoleSearchCategories,
  normalizeSearchInput,
  saveSearchHistory,
  SEARCH_MIN_LENGTH,
  searchCategoryMeta,
  searchKandid,
} from "../../utils/globalSearch";

function SearchAvatar({ result }) {
  const Icon = searchCategoryMeta[result.category]?.icon || Search;
  const initials = String(result.title || "K")
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  if (result.image) {
    return (
      <span className="search-result-avatar">
        <img src={result.image} alt="" />
      </span>
    );
  }

  return (
    <span className="search-result-avatar">
      <Icon size={20} />
      <small>{initials}</small>
    </span>
  );
}

function ResultRow({ result, selected, onOpen }) {
  return (
    <button
      type="button"
      className={`search-result-row ${selected ? "is-selected" : ""}`}
      onClick={() => onOpen(result)}
    >
      <SearchAvatar result={result} />
      <span className="search-result-row-copy">
        <strong>{result.title}</strong>
        <small>{result.subtitle || result.meta}</small>
        {result.meta ? <em>{result.meta}</em> : null}
      </span>
      <ArrowRight size={18} />
    </button>
  );
}

function DetailPanel({ result, onBack, onRelated }) {
  if (!result) {
    return (
      <aside className="search-detail-panel is-empty">
        <Search size={24} />
        <p>Select a result to view safe details for that record.</p>
      </aside>
    );
  }

  const visibleFields = (result.fields || []).filter(([, value]) => value !== null && value !== undefined && value !== "");
  const sections = (result.sections || [])
    .map((section) => ({
      ...section,
      fields: (section.fields || []).filter(([, value]) => value !== null && value !== undefined && value !== ""),
    }))
    .filter((section) => section.fields.length > 0);

  return (
    <aside className="search-detail-panel">
      <button type="button" className="search-back-button" onClick={onBack}>
        <ArrowLeft size={16} />
        Back to Search
      </button>

      <div className="search-detail-hero">
        <SearchAvatar result={result} />
        <div>
          <span>{result.type}</span>
          <h2>{result.title}</h2>
          <p>{result.subtitle}</p>
        </div>
      </div>

      {sections.length > 0 ? (
        <div className="search-detail-sections">
          {sections.map((section) => (
            <section key={section.title}>
              <h3>{section.title}</h3>
              <dl className="search-detail-list">
                {section.fields.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      ) : visibleFields.length > 0 ? (
        <dl className="search-detail-list">
          {visibleFields.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="search-detail-note">No additional public details are available for this result.</p>
      )}

      {result.related?.length ? (
        <div className="search-detail-related">
          <h3>Related</h3>
          {result.related.map((item) => (
            <button
              key={item.href}
              type="button"
              onClick={() => onRelated(item.href)}
            >
              {item.label}
              <ArrowRight size={15} />
            </button>
          ))}
        </div>
      ) : null}
    </aside>
  );
}

function SearchPage({ user }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeUser = useMemo(
    () => user || JSON.parse(localStorage.getItem("user") || "null") || {},
    [user],
  );
  const q = searchParams.get("q") || "";
  const type = searchParams.get("type") || "all";
  const selectedId = searchParams.get("id") || "";
  const year = searchParams.get("year") || "";
  const query = normalizeSearchInput(q);
  const categories = getRoleSearchCategories(activeUser?.role);
  const activeType = type === "all" || categories.includes(type) ? type : "all";
  const [searchData, setSearchData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    if (query.length < SEARCH_MIN_LENGTH) {
      setSearchData(null);
      setLoading(false);
      setError("");
      return undefined;
    }

    setLoading(true);
    setError("");

    searchKandid(activeUser, query, { perCategoryLimit: 24, year })
      .then((data) => {
        if (!active) return;
        setSearchData(data);
        setError(data.errors?.length ? "Some result categories could not be loaded." : "");
      })
      .catch((searchError) => {
        if (!active) return;
        setSearchData(null);
        setError(searchError?.message || "Unable to load search results.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [activeUser, query, year]);

  useEffect(() => {
    if (query.length >= SEARCH_MIN_LENGTH) {
      saveSearchHistory(activeUser?.role, q.trim(), activeType);
    }
  }, [activeType, activeUser?.role, q, query.length]);

  const selectedResult = useMemo(
    () => findSearchResult(searchData, activeType === "all" ? searchParams.get("type") : activeType, selectedId),
    [activeType, searchData, searchParams, selectedId],
  );

  const counts = useMemo(() => {
    const nextCounts = { all: searchData?.all?.length || 0 };
    categories.forEach((category) => {
      nextCounts[category] = searchData?.groups?.[category]?.length || 0;
    });
    return nextCounts;
  }, [categories, searchData]);

  const displayedGroups = useMemo(() => {
    if (!searchData) return [];
    if (activeType !== "all") {
      return [
        {
          category: activeType,
          label: searchCategoryMeta[activeType]?.label || activeType,
          items: searchData.groups?.[activeType] || [],
        },
      ];
    }

    return categories
      .map((category) => ({
        category,
        label: searchCategoryMeta[category]?.label || category,
        items: (searchData.groups?.[category] || []).slice(0, 8),
      }))
      .filter((group) => group.items.length > 0);
  }, [activeType, categories, searchData]);

  function setCategory(category) {
    const params = new URLSearchParams(searchParams);
    if (category === "all") {
      params.delete("type");
    } else {
      params.set("type", category);
    }
    params.delete("id");
    setSearchParams(params);
  }

  function setOfficerYear(nextYear) {
    const params = new URLSearchParams(searchParams);
    const cleanedYear = nextYear.trim();
    if (cleanedYear) {
      params.set("year", cleanedYear);
      params.set("type", "officers");
    } else {
      params.delete("year");
    }
    params.delete("id");
    setSearchParams(params);
  }

  function openResult(result) {
    const params = new URLSearchParams(searchParams);
    params.set("type", result.category);
    params.set("id", result.id);
    setSearchParams(params);
  }

  function clearSelectedResult() {
    const params = new URLSearchParams(searchParams);
    params.delete("id");
    if (activeType === "all") params.delete("type");
    setSearchParams(params);
  }

  const officerYearOptions = getOfficerYearOptions(searchData);
  const showYearFilter = activeType === "officers" || normalizeSearchInput(q).includes("officer");

  return (
    <div className="search-page">
      <div className="page-head search-page-head">
        <div>
          <div className="page-kicker">Smart Search</div>
          <h1 className="page-title">Search results</h1>
          <p className="page-subtitle">
            {q ? `Results for "${q.trim()}"` : "Search across connected KANDID records."}
          </p>
        </div>
        <button type="button" className="secondary-btn" onClick={() => navigate(-1)}>
          <ArrowLeft size={17} />
          Back
        </button>
      </div>

      <div className="search-filter-tabs" role="tablist" aria-label="Search result categories">
        <button
          type="button"
          className={activeType === "all" ? "is-active" : ""}
          onClick={() => setCategory("all")}
        >
          All <span>{counts.all}</span>
        </button>
        {categories.map((category) => (
          <button
            key={category}
            type="button"
            className={activeType === category ? "is-active" : ""}
            onClick={() => setCategory(category)}
          >
            {searchCategoryMeta[category]?.label || category}
            <span>{counts[category] || 0}</span>
          </button>
        ))}
      </div>

      {showYearFilter ? (
        <div className="search-year-filter">
          <label>
            <span>Officer Year / Term</span>
            <input
              list="officer-year-options"
              value={year}
              onChange={(event) => setOfficerYear(event.target.value)}
              placeholder="Type 2025 or 2025-2026"
            />
            <datalist id="officer-year-options">
              {officerYearOptions.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          </label>
          {year ? (
            <button type="button" onClick={() => setOfficerYear("")}>
              Clear Year
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="search-workspace">
        <main className="search-results-panel">
          {query.length < SEARCH_MIN_LENGTH ? (
            <div className="search-state-card">
              <Search size={24} />
              <p>Type at least 2 characters in the header search bar to start searching.</p>
            </div>
          ) : loading ? (
            <div className="search-loading-card">
              <KandidInlineLoader message="Loading search results..." />
              <KandidSkeleton rows={5} />
            </div>
          ) : error && !searchData ? (
            <div className="search-state-card">
              <p>Unable to load search results.</p>
              <button type="button" className="secondary-btn" onClick={() => setSearchParams(searchParams)}>
                Retry
              </button>
            </div>
          ) : displayedGroups.length === 0 ? (
            <div className="search-state-card">
              <Search size={24} />
              <p>No results for "{q.trim()}". Try checking the spelling or searching another term.</p>
            </div>
          ) : (
            displayedGroups.map((group) => (
              <section key={group.category} className="search-result-group">
                <div className="search-result-group-head">
                  <h2>{group.label}</h2>
                  {activeType === "all" && counts[group.category] > group.items.length ? (
                    <button type="button" onClick={() => setCategory(group.category)}>
                      See all {group.label.toLowerCase()}
                    </button>
                  ) : null}
                </div>
                <div className="search-result-list">
                  {group.items.map((result) => (
                    <ResultRow
                      key={`${result.category}-${result.id}`}
                      result={result}
                      selected={selectedResult?.category === result.category && selectedResult?.id === result.id}
                      onOpen={openResult}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </main>

        <DetailPanel
          result={selectedResult}
          onBack={clearSelectedResult}
          onRelated={(href) => navigate(href)}
        />
      </div>
    </div>
  );
}

export default SearchPage;
