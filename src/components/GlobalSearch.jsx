import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  Building2,
  FileText,
  Search,
  ShieldCheck,
  X,
  UserCheck,
  Users,
  Vote,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { KandidInlineLoader } from "./KandidLoader";
import {
  getRoleSearchCategories,
  getRoleSearchPath,
  getSearchHistory,
  clearSearchHistory,
  normalizeSearchInput,
  removeSearchHistoryItem,
  saveSearchHistory,
  SEARCH_MIN_LENGTH,
  searchCategoryMeta,
  searchKandid,
} from "../utils/globalSearch";

const roleQuickActions = {
  student: [
    { label: "Programs", type: "programs", icon: Building2 },
    { label: "Elections", type: "elections", icon: Vote },
    { label: "Organizations", type: "organizations", icon: Building2 },
    { label: "People", type: "officers", icon: Users },
    { label: "Results", type: "results", icon: BarChart3 },
    { label: "Receipts", path: "/student/receipt", icon: FileText },
  ],
  electoral_board: [
    { label: "Programs", type: "programs", icon: Building2 },
    { label: "Elections", type: "elections", icon: Vote },
    { label: "Students", type: "students", icon: Users },
    { label: "Candidates", type: "candidates", icon: UserCheck },
    { label: "Results", type: "results", icon: BarChart3 },
    { label: "Reports", type: "reports", icon: FileText },
  ],
  super_admin: [
    { label: "Programs", type: "programs", icon: Building2 },
    { label: "Elections", type: "elections", icon: Vote },
    { label: "Organizations", type: "organizations", icon: Building2 },
    { label: "Students", type: "students", icon: Users },
    { label: "Candidates", type: "candidates", icon: UserCheck },
    { label: "Audit", type: "audit_logs", icon: ShieldCheck },
  ],
};

function getResultIcon(category) {
  return searchCategoryMeta[category]?.icon || Search;
}

function buildSearchHref(role, query, category = "all") {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (category && category !== "all") params.set("type", category);
  return `${getRoleSearchPath(role)}?${params.toString()}`;
}

function GlobalSearch({
  user,
  className = "shell-search",
  placeholder = "Search users, organizations, elections, logs...",
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchData, setSearchData] = useState(null);
  const [history, setHistory] = useState(() => getSearchHistory(user?.role));
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapperRef = useRef(null);

  const cleanedQuery = normalizeSearchInput(query);
  const quickActions = roleQuickActions[user?.role] || [];
  const roleCategories = getRoleSearchCategories(user?.role);

  useEffect(() => {
    setHistory(getSearchHistory(user?.role));

    function handleHistoryUpdated(event) {
      if (!event.detail?.role || event.detail.role === user?.role) {
        setHistory(getSearchHistory(user?.role));
      }
    }

    window.addEventListener("kandid-search-history-updated", handleHistoryUpdated);

    return () => {
      window.removeEventListener("kandid-search-history-updated", handleHistoryUpdated);
    };
  }, [user?.role]);

  useEffect(() => {
    function handlePointerDown(event) {
      if (!wrapperRef.current?.contains(event.target)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, []);

  useEffect(() => {
    let active = true;

    if (cleanedQuery.length < SEARCH_MIN_LENGTH) {
      setSearchData(null);
      setLoading(false);
      setError("");
      setActiveIndex(-1);
      return undefined;
    }

    setLoading(true);
    setError("");

    const timer = window.setTimeout(async () => {
      try {
        const data = await searchKandid(user, cleanedQuery, { perCategoryLimit: 4 });
        if (!active) return;
        setSearchData(data);
        setError(data.errors?.length ? "Some categories could not be loaded." : "");
      } catch (searchError) {
        if (!active) return;
        setSearchData(null);
        setError(searchError?.message || "Unable to load search suggestions.");
      } finally {
        if (active) setLoading(false);
      }
    }, 320);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [cleanedQuery, user]);

  const previewGroups = useMemo(() => {
    if (!searchData?.groups) return [];

    return roleCategories
      .map((category) => ({
        category,
        label: searchCategoryMeta[category]?.label || category,
        items: searchData.groups[category] || [],
      }))
      .filter((group) => group.items.length > 0)
      .slice(0, 4);
  }, [roleCategories, searchData]);

  const flatSuggestions = useMemo(
    () => previewGroups.flatMap((group) => group.items.slice(0, 3)),
    [previewGroups],
  );

  function goToSearch(category = "all") {
    const trimmed = query.trim();
    if (!trimmed) {
      setOpen(true);
      return;
    }
    saveSearchHistory(user?.role, trimmed, category);
    setOpen(false);
    navigate(buildSearchHref(user?.role, trimmed, category));
  }

  function openResult(result) {
    if (query.trim()) {
      saveSearchHistory(user?.role, query.trim(), result.category);
    }
    setOpen(false);
    navigate(result.href);
  }

  function replayHistory(item) {
    setQuery(item.query);
    saveSearchHistory(user?.role, item.query, item.category || "all");
    setOpen(false);
    navigate(buildSearchHref(user?.role, item.query, item.category || "all"));
  }

  function removeHistory(event, item) {
    event.stopPropagation();
    removeSearchHistoryItem(user?.role, item.query, item.category || "all");
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (activeIndex >= 0 && flatSuggestions[activeIndex]) {
      openResult(flatSuggestions[activeIndex]);
      return;
    }
    goToSearch();
  }

  function handleKeyDown(event) {
    if (!open && ["ArrowDown", "ArrowUp"].includes(event.key)) {
      setOpen(true);
    }

    if (event.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }

    if (flatSuggestions.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % flatSuggestions.length);
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) =>
        current <= 0 ? flatSuggestions.length - 1 : current - 1,
      );
    }
  }

  return (
    <div ref={wrapperRef} className="global-search-wrap">
      <form className={`${className} global-search-form`} role="search" onSubmit={handleSubmit}>
        <Search size={18} className="global-search-icon" />

        <input
          type="search"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label="Search KANDID"
          aria-expanded={open}
        />

        <button type="submit" className="global-search-button">
          Search
        </button>
      </form>

      {open ? (
        <div className="global-search-popover">
          <div className="global-search-section">
            <p>Search by</p>
            <div className="global-search-chips">
              {quickActions.map((action) => {
                const Icon = action.icon;

                return (
                  <button
                    key={action.path || action.type}
                    type="button"
                    onClick={() =>
                      action.path ? navigate(action.path) : goToSearch(action.type)
                    }
                  >
                    <Icon size={15} />
                    {action.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="global-search-section">
            <p>{cleanedQuery ? "Live suggestions" : "Recent Searches"}</p>

            {cleanedQuery.length < SEARCH_MIN_LENGTH ? (
              history.length > 0 ? (
                <div className="global-search-history">
                  <div className="global-search-history-head">
                    <span>Recent Searches</span>
                    <button type="button" onClick={() => clearSearchHistory(user?.role)}>
                      Clear all
                    </button>
                  </div>
                  {history.map((item) => (
                    <div
                      key={`${item.query}-${item.category || "all"}`}
                      className="global-search-history-item"
                    >
                      <button type="button" onClick={() => replayHistory(item)}>
                        <Search size={14} />
                        <strong>{item.query}</strong>
                        <small>{searchCategoryMeta[item.category]?.label || "All"}</small>
                      </button>
                      <button
                        type="button"
                        className="global-search-history-remove"
                        aria-label={`Remove ${item.query} from recent searches`}
                        onClick={(event) => removeHistory(event, item)}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="global-search-empty">
                  No search history yet. Search organizations, programs, elections, people, candidates, results, and reports allowed for your account.
                </div>
              )
            ) : loading ? (
              <KandidInlineLoader message="Searching..." />
            ) : error && !searchData ? (
              <div className="global-search-empty">{error}</div>
            ) : previewGroups.length === 0 ? (
              <div className="global-search-empty">
                No suggestions for "{query.trim()}". Try a different term.
              </div>
            ) : (
              <div className="global-search-suggestions">
                {previewGroups.map((group) => (
                  <div key={group.category} className="global-search-group">
                    <span>{group.label}</span>
                    <div className="global-search-results">
                      {group.items.slice(0, 3).map((result) => {
                        const Icon = getResultIcon(result.category);
                        const itemIndex = flatSuggestions.findIndex(
                          (item) => item.category === result.category && item.id === result.id,
                        );

                        return (
                          <button
                            key={`${result.category}-${result.id}`}
                            type="button"
                            className={activeIndex === itemIndex ? "is-active" : ""}
                            onMouseEnter={() => setActiveIndex(itemIndex)}
                            onClick={() => openResult(result)}
                          >
                            <span className="global-result-icon">
                              <Icon size={16} />
                            </span>
                            <span className="global-result-copy">
                              <strong>{result.title}</strong>
                              <small>{result.subtitle || result.meta}</small>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  className="global-search-see-all"
                  onClick={() => goToSearch()}
                >
                  See all results for "{query.trim()}"
                  <ArrowRight size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default GlobalSearch;
