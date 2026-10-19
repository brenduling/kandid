import { useEffect, useMemo, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import KandidImage from "../../components/KandidImage";
import SuperAdminPageHeader from "../../components/SuperAdminPageHeader";
import { KandidInlineLoader } from "../../components/KandidLoader";
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
import "./SearchPage.css";

function ResultRow({ result, selected, onOpen }) {
  return (
    <button
      type="button"
      className={`kandid-search-result-row${selected ? " is-selected" : ""}`}
      onClick={() => onOpen(result)}
      aria-pressed={selected}
      aria-label={`View details for ${result.type}: ${result.title}`}
    >
      <span className="kandid-search-result-copy">
        <span className="kandid-search-result-type">{result.type}</span>
        <strong>{result.title}</strong>
        {result.subtitle ? <span className="kandid-search-result-subtitle">{result.subtitle}</span> : null}
        {result.meta ? <span className="kandid-search-result-meta">{result.meta}</span> : null}
      </span>
      <span className="kandid-search-result-action">View details <ArrowRight size={15} aria-hidden="true" /></span>
    </button>
  );
}

function DetailPanel({ result, onClose, onRelated }) {
  if (!result) return null;
  const visibleFields = (result.fields || []).filter(([, value]) => value !== null && value !== undefined && value !== "");
  const sections = (result.sections || [])
    .map((section) => ({
      ...section,
      fields: (section.fields || []).filter(([, value]) => value !== null && value !== undefined && value !== ""),
    }))
    .filter((section) => section.fields.length > 0);

  return (
    <aside className="kandid-search-detail" aria-label={`Selected ${result.type} details`}>
      <div className="kandid-search-detail-heading">
        <span className="kandid-search-detail-kicker">Selected result / {result.type}</span>
        <button type="button" onClick={onClose} aria-label="Close result details">
          <X size={16} aria-hidden="true" />
          <span>Close details</span>
        </button>
      </div>

      <div className="kandid-search-detail-identity">
        {result.image ? (
          <KandidImage
            src={result.image}
            alt={result.title}
            label={result.title}
            className="kandid-search-detail-image"
            fit={result.imageFit || "cover"}
          />
        ) : null}
        <div>
          <h2>{result.title}</h2>
          {result.subtitle ? <p>{result.subtitle}</p> : null}
          {result.meta ? <p className="kandid-search-detail-meta">{result.meta}</p> : null}
        </div>
      </div>

      {sections.length > 0 ? (
        <div className="kandid-search-detail-sections">
          {sections.map((section) => (
            <section key={section.title}>
              <h3>{section.title}</h3>
              <dl className="kandid-search-detail-list">
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
        <dl className="kandid-search-detail-list">
          {visibleFields.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="kandid-search-detail-note">No additional public details are available for this result.</p>
      )}

      {result.related?.length ? (
        <nav className="kandid-search-detail-related" aria-label="Related destinations">
          <h3>Go to</h3>
          {result.related.map((item) => (
            <button key={item.href} type="button" onClick={() => onRelated(item.href)}>
              {item.label}
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          ))}
        </nav>
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
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let active = true;

    if (query.length < SEARCH_MIN_LENGTH) {
      return undefined;
    }

    // Keep the existing loading transition immediate while this effect starts its async request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
  }, [activeUser, query, retryCount, year]);

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
  const roleContext = activeUser?.role === "electoral_board"
    ? "Electoral Board / Search"
    : activeUser?.role === "super_admin"
      ? "Super Admin / Search"
      : activeUser?.role === "student"
        ? "Student / Search"
        : "Kandid / Search";
  const failedCategories = new Set((searchData?.errors || []).map((item) => item.category));
  const resultCount = searchData?.all?.length || 0;

  return (
    <div className="kandid-search-page">
      {activeUser?.role === "super_admin" ? (
        <SuperAdminPageHeader
          section="System overview"
          title="Search"
          description={query.length >= SEARCH_MIN_LENGTH && searchData && !loading
            ? <>Results for <q>{q.trim()}</q></>
            : "Search records available to your Super Admin account."}
          actions={query.length >= SEARCH_MIN_LENGTH && searchData && !loading
            ? <span><strong>{resultCount}</strong> result{resultCount === 1 ? "" : "s"} shown</span>
            : null}
        />
      ) : (
      <header className="kandid-search-masthead">
        <div className="kandid-search-context">
          <span>{roleContext}</span>
          <span aria-hidden="true" />
        </div>
        <div className="kandid-search-title-row">
          <h1>Search</h1>
          {query.length >= SEARCH_MIN_LENGTH && searchData && !loading ? (
            <p aria-live="polite">
              <strong>{resultCount}</strong> result{resultCount === 1 ? "" : "s"} shown
            </p>
          ) : null}
        </div>
        <p className="kandid-search-standfirst">
          {query.length >= SEARCH_MIN_LENGTH
            ? <>Results for <q>{q.trim()}</q></>
            : "Use the search in the page header to find Kandid records."}
        </p>
      </header>
      )}

      {query.length >= SEARCH_MIN_LENGTH && searchData && !loading ? (
        <section className="kandid-search-controls" aria-label="Search result filters">
          <p className="kandid-search-section-label">Filter results</p>
          <nav className="kandid-search-categories" aria-label="Search categories">
            <button type="button" className={activeType === "all" ? "is-active" : ""} aria-pressed={activeType === "all"} onClick={() => setCategory("all")}>
              <span>All</span><small>{counts.all}</small>
            </button>
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                className={activeType === category ? "is-active" : ""}
                aria-pressed={activeType === category}
                onClick={() => setCategory(category)}
              >
                <span>{searchCategoryMeta[category]?.label || category}</span>
                <small aria-label={failedCategories.has(category) ? "Unavailable" : `${counts[category] || 0} results`}>
                  {failedCategories.has(category) ? "—" : counts[category] || 0}
                </small>
              </button>
            ))}
          </nav>
          {showYearFilter ? (
            <div className="kandid-search-year-filter">
              <label htmlFor="officer-year-options-input">Officer year / term</label>
              <input
                id="officer-year-options-input"
                list="officer-year-options"
                value={year}
                onChange={(event) => setOfficerYear(event.target.value)}
                placeholder="Type a year or term"
              />
              <datalist id="officer-year-options">
                {officerYearOptions.map((option) => <option key={option} value={option} />)}
              </datalist>
              {year ? <button type="button" onClick={() => setOfficerYear("")}>Clear year</button> : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {error && searchData && !loading ? (
        <p className="kandid-search-partial-error" role="status">Some result categories could not be loaded.</p>
      ) : null}

      <div className={`kandid-search-workspace${selectedResult ? " has-selection" : ""}`}>
        <main className="kandid-search-index" aria-label="Search results" aria-busy={loading}>
          {query.length < SEARCH_MIN_LENGTH ? (
            <section className="kandid-search-state" aria-live="polite">
              <p className="kandid-search-section-label">Keep typing</p>
              <h2>Enter at least 2 characters to search Kandid.</h2>
            </section>
          ) : loading ? (
            <div className="kandid-search-loading" role="status" aria-live="polite">
              <KandidInlineLoader message="Searching Kandid..." />
            </div>
          ) : error && !searchData ? (
            <section className="kandid-search-state" role="alert">
              <p className="kandid-search-section-label">Search unavailable</p>
              <h2>Search results could not be loaded.</h2>
              <p>Try again in a moment.</p>
              <button type="button" onClick={() => setRetryCount((current) => current + 1)}>Retry search</button>
            </section>
          ) : error && searchData && (activeType === "all" ? displayedGroups.length === 0 : failedCategories.has(activeType)) ? (
            <section className="kandid-search-state" role="status">
              <p className="kandid-search-section-label">Results unavailable</p>
              <h2>Kandid could not search every result category.</h2>
              <p>Try the search again to check for matching records.</p>
              <button type="button" onClick={() => setRetryCount((current) => current + 1)}>Retry search</button>
            </section>
          ) : displayedGroups.length === 0 ? (
            <section className="kandid-search-state" aria-live="polite">
              <p className="kandid-search-section-label">No results</p>
              <h2>Nothing matched <q>{q.trim()}</q>.</h2>
              <p>Try another name, election, position, or keyword.</p>
            </section>
          ) : (
            displayedGroups.map((group) => (
              <section key={group.category} className="kandid-search-group" aria-labelledby={`search-group-${group.category}`}>
                <div className="kandid-search-group-head">
                  <h2 id={`search-group-${group.category}`}>{group.label}</h2>
                  <span>{failedCategories.has(group.category) ? "Unavailable" : `${counts[group.category] || 0} shown`}</span>
                  {activeType === "all" && counts[group.category] > group.items.length ? (
                    <button type="button" onClick={() => setCategory(group.category)}>
                      View all {group.label.toLowerCase()} <ArrowRight size={14} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
                <div className="kandid-search-result-list">
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

        <DetailPanel result={selectedResult} onClose={clearSelectedResult} onRelated={(href) => navigate(href)} />
      </div>
    </div>
  );
}

export default SearchPage;
