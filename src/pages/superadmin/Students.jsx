import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Plus, Pencil, Trash2, X, Search } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import PopupOverlay from "../../components/PopupOverlay";
import { OrganizationLogo, StudentAvatar } from "../../components/KandidImage";
import { supabase } from "../../lib/supabaseClient";
import { readImageFileAsCompressedDataUrl } from "../../utils/files";
import {
  getPrograms,
  syncStudentOrganizationMemberships,
} from "../../utils/organizationAccess";
import { usePrompt } from "../../context/PromptContext";
import { logAuditEvent } from "../../utils/auditLog";
import { analyzeDeleteDependencies, dependencyMessage } from "../../utils/deleteGuards";
import { formatAcademicTerm, getCurrentAcademicTerm } from "../../utils/academicTerms";
import { isSupabaseAdminAuthMode } from "../../utils/auth";
import {
  enrollExistingSuperAdminStudent,
  registerNewSuperAdminStudent,
  resolveSuperAdminStudentForTerm,
} from "../../utils/superAdminManualEnrollment";
import "./Students.css";

const PAGE_SIZE = 10;
const STUDENT_DIRECTORY_SELECT = `
  id,
  student_number,
  first_name,
  last_name,
  email,
  program,
  year_level,
  precinct_code,
  batch_code,
  is_shs,
  status,
  created_at
`;
const ORGANIZATION_CATALOG_SELECT = "id, name, description, organization_type";
const EMPTY_STUDENT_FORM = {
  student_number: "",
  first_name: "",
  last_name: "",
  email: "",
  photo_url: "",
  program: "",
  year_level: 1,
  organization_id: "",
  precinct_code: "",
  batch_code: "",
  status: "pending",
};

function studentDisplayName(student) {
  return [student?.first_name, student?.last_name].filter(Boolean).join(" ") || "Student";
}

function yearLevelLabel(value) {
  const year = Number(value);
  if (!Number.isInteger(year)) return "Year level not recorded";
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

const sortOptions = {
  name_asc: { label: "Name: A-Z", column: "last_name", ascending: true },
  name_desc: { label: "Name: Z-A", column: "last_name", ascending: false },
  newest: { label: "Newest Added", column: "created_at", ascending: false },
  oldest: { label: "Oldest Added", column: "created_at", ascending: true },
  id_asc: { label: "Student ID: Low-High", column: "student_number", ascending: true },
  id_desc: { label: "Student ID: High-Low", column: "student_number", ascending: false },
};

function Students() {
  const prompt = usePrompt();
  const [searchParams] = useSearchParams();
  const searchParamValue = searchParams.get("q") || "";

  const [students, setStudents] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [programs, setPrograms] = useState([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState(null);

  const [search, setSearch] = useState(searchParamValue);
  const [debouncedSearch, setDebouncedSearch] = useState(searchParamValue.trim());
  const [organizationFilter, setOrganizationFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("newest");
  const [page, setPage] = useState(1);
  const [totalStudents, setTotalStudents] = useState(0);
  const [studentPhotos, setStudentPhotos] = useState({});
  const [organizationLogos, setOrganizationLogos] = useState({});
  const [loadingStudents, setLoadingStudents] = useState(true);
  const [studentsError, setStudentsError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [activeTerm, setActiveTerm] = useState(null);
  const [activeTermLoading, setActiveTermLoading] = useState(false);
  const [activeTermError, setActiveTermError] = useState("");
  const [registrationStep, setRegistrationStep] = useState("student-id");
  const [registrationResolution, setRegistrationResolution] = useState(null);
  const [registrationResult, setRegistrationResult] = useState(null);
  const [registrationError, setRegistrationError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [resolvingStudent, setResolvingStudent] = useState(false);
  const latestPhotoFetchId = useRef(0);
  const latestOrganizationLogoFetchId = useRef(0);
  const studentPhotoCache = useRef(new Map());
  const organizationLogoCache = useRef(new Map());
  const organizationCatalogRequest = useRef(null);

  const [form, setForm] = useState(EMPTY_STUDENT_FORM);

  useEffect(() => {
    fetchOrganizations();
    getPrograms().then((data) => setPrograms(data || []));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 250);

    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchParamValue);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [searchParamValue]);

  useEffect(() => {
    fetchStudents();
  }, [debouncedSearch, organizationFilter, statusFilter, sortBy, page]);

  useEffect(() => {
    if (!formOpen || editingStudent) return;

    let active = true;
    async function loadActiveTerm() {
      setActiveTermLoading(true);
      setActiveTermError("");

      const { data, error, unavailable } = await getCurrentAcademicTerm({ force: true });
      if (!active) return;

      setActiveTerm(data || null);
      if (unavailable) {
        setActiveTermError("Academic term setup is not available yet.");
      } else if (error) {
        setActiveTermError(error.message || "Unable to load the active academic term.");
      } else if (!data) {
        setActiveTermError("No active academic term. Activate a term before adding students.");
      }
      setActiveTermLoading(false);
    }

    loadActiveTerm();

    return () => {
      active = false;
    };
  }, [formOpen, editingStudent]);

  useEffect(() => {
    const visibleIds = students.map((student) => student.id).filter(Boolean);
    if (visibleIds.length === 0) return;

    const cachedPhotos = {};
    const missingIds = [];

    visibleIds.forEach((id) => {
      const key = String(id);
      if (studentPhotoCache.current.has(key)) {
        cachedPhotos[key] = studentPhotoCache.current.get(key);
      } else {
        missingIds.push(id);
      }
    });

    if (Object.keys(cachedPhotos).length > 0) {
      setStudentPhotos((current) => ({ ...current, ...cachedPhotos }));
    }

    if (missingIds.length === 0) return;

    let active = true;
    const fetchId = latestPhotoFetchId.current + 1;
    latestPhotoFetchId.current = fetchId;

    async function loadVisiblePhotos() {
      const { data, error } = await supabase
        .from("students")
        .select("id, photo_url")
        .in("id", missingIds);

      if (!active || latestPhotoFetchId.current !== fetchId) return;

      if (error) {
        console.warn("Failed to load visible student photos:", error.message);
        return;
      }

      const nextPhotos = {};
      (data || []).forEach((student) => {
        const key = String(student.id);
        const value = student.photo_url || "";
        studentPhotoCache.current.set(key, value);
        nextPhotos[key] = value;
      });

      if (Object.keys(nextPhotos).length > 0) {
        setStudentPhotos((current) => ({ ...current, ...nextPhotos }));
      }
    }

    loadVisiblePhotos();

    return () => {
      active = false;
    };
  }, [students]);

  useEffect(() => {
    const visibleOrganizationIds = [
      ...new Set(
        students
          .flatMap((student) => student.student_organizations || [])
          .map((membership) => membership.organizations?.id || membership.organization_id)
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id) && id > 0),
      ),
    ];

    if (visibleOrganizationIds.length === 0) return;

    const cachedLogos = {};
    const missingIds = [];

    visibleOrganizationIds.forEach((id) => {
      const key = String(id);
      if (organizationLogoCache.current.has(key)) {
        cachedLogos[key] = organizationLogoCache.current.get(key);
      } else {
        missingIds.push(id);
      }
    });

    if (Object.keys(cachedLogos).length > 0) {
      setOrganizationLogos((current) => ({ ...current, ...cachedLogos }));
    }

    if (missingIds.length === 0) return;

    let active = true;
    const fetchId = latestOrganizationLogoFetchId.current + 1;
    latestOrganizationLogoFetchId.current = fetchId;

    async function loadVisibleOrganizationLogos() {
      const { data, error } = await supabase
        .from("organizations")
        .select("id, logo_url")
        .in("id", missingIds);

      if (!active || latestOrganizationLogoFetchId.current !== fetchId) return;

      if (error) {
        console.warn("Failed to load visible organization logos:", error.message);
        return;
      }

      const nextLogos = {};
      (data || []).forEach((organization) => {
        const key = String(organization.id);
        const value = organization.logo_url || "";
        organizationLogoCache.current.set(key, value);
        nextLogos[key] = value;
      });

      if (Object.keys(nextLogos).length > 0) {
        setOrganizationLogos((current) => ({ ...current, ...nextLogos }));
      }
    }

    loadVisibleOrganizationLogos();

    return () => {
      active = false;
    };
  }, [students]);

  async function loadOrganizationCatalog() {
    if (organizations.length > 0) {
      return { data: organizations, error: null };
    }

    if (organizationCatalogRequest.current) {
      return organizationCatalogRequest.current;
    }

    organizationCatalogRequest.current = supabase
      .from("organizations")
      .select(ORGANIZATION_CATALOG_SELECT)
      .order("name", { ascending: true })
      .then(({ data, error }) => {
        if (!error) {
          setOrganizations(data || []);
        }

        return { data: data || [], error };
      })
      .finally(() => {
        organizationCatalogRequest.current = null;
      });

    return organizationCatalogRequest.current;
  }

  async function attachVisibleStudentOrganizations(studentRows = []) {
    const studentIds = [
      ...new Set(
        studentRows
          .map((student) => Number(student.id))
          .filter((id) => Number.isFinite(id) && id > 0),
      ),
    ];

    if (studentIds.length === 0) {
      return { data: studentRows, error: null };
    }

    let organizationRows = organizations;
    if (organizationRows.length === 0) {
      const { data: organizationData, error: organizationError } =
        await loadOrganizationCatalog();

      if (organizationError) {
        return { data: [], error: organizationError };
      }

      organizationRows = organizationData || [];
      setOrganizations(organizationRows);
    }

    const { data, error } = await supabase
      .from("student_organizations")
      .select("student_id, organization_id, role")
      .in("student_id", studentIds);

    if (error) {
      return { data: [], error };
    }

    const organizationById = new Map(
      organizationRows.map((organization) => [Number(organization.id), organization]),
    );
    const membershipsByStudentId = new Map();
    (data || []).forEach((membership) => {
      const key = Number(membership.student_id);
      if (!membershipsByStudentId.has(key)) {
        membershipsByStudentId.set(key, []);
      }
      membershipsByStudentId.get(key).push({
        organization_id: membership.organization_id,
        role: membership.role,
        organizations: organizationById.get(Number(membership.organization_id)) || null,
      });
    });

    return {
      data: studentRows.map((student) => ({
        ...student,
        student_organizations: membershipsByStudentId.get(Number(student.id)) || [],
      })),
      error: null,
    };
  }

  async function fetchStudents() {
    setLoadingStudents(true);
    setStudentsError("");

    let allowedStudentIds = null;

    if (organizationFilter !== "all") {
      const { data: membershipData, error: membershipError } = await supabase
        .from("student_organizations")
        .select("student_id")
        .eq("organization_id", Number(organizationFilter));

      if (membershipError) {
        console.error("Failed to load organization memberships:", membershipError);
        setStudents([]);
        setTotalStudents(0);
        setStudentsError("Unable to load students for the selected organization.");
        setLoadingStudents(false);
        return;
      }

      allowedStudentIds = [...new Set((membershipData || []).map((item) => item.student_id).filter(Boolean))];

      if (allowedStudentIds.length === 0) {
        setStudents([]);
        setTotalStudents(0);
        setLoadingStudents(false);
        return;
      }
    }

    const sort = sortOptions[sortBy] || sortOptions.name_asc;
    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from("students")
      .select(STUDENT_DIRECTORY_SELECT, { count: "exact" });

    if (allowedStudentIds) {
      query = query.in("id", allowedStudentIds);
    }

    if (statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }

    if (debouncedSearch) {
      const term = debouncedSearch.replaceAll("%", "\\%").replaceAll(",", " ");
      query = query.or(
        `student_number.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%,email.ilike.%${term}%`,
      );
    }

    const { data, error, count } = await query
      .order(sort.column, { ascending: sort.ascending, nullsFirst: false })
      .order("first_name", { ascending: sort.ascending, nullsFirst: false })
      .order("id", { ascending: true })
      .range(from, to);

    if (error) {
      console.error("Failed to load students:", error);
      setStudents([]);
      setTotalStudents(0);
      setStudentsError("Unable to load the student directory. Please try again.");
      setLoadingStudents(false);
      return;
    }

    const {
      data: studentsWithOrganizations,
      error: organizationError,
    } = await attachVisibleStudentOrganizations(data || []);

    if (organizationError) {
      console.error("Failed to load visible student organizations:", organizationError);
      setStudents([]);
      setTotalStudents(0);
      setStudentsError(
        organizationError.message ||
          "Unable to load student organization assignments. Please try again."
      );
      setLoadingStudents(false);
      return;
    }

    setStudents(studentsWithOrganizations || []);
    setTotalStudents(count || 0);
    setLoadingStudents(false);
  }

  async function fetchOrganizations() {
    const { error } = await loadOrganizationCatalog();

    if (error) {
      console.error(
        "Failed to load organizations:",
        error
      );

      prompt.error(
        error.message ||
        "Failed to load organizations."
      );

      return;
    }
  }

  function openCreateForm() {
    setEditingStudent(null);
    setActiveTerm(null);
    setActiveTermError("");
    setRegistrationStep("student-id");
    setRegistrationResolution(null);
    setRegistrationResult(null);
    setRegistrationError("");
    setFieldErrors({});
    setResolvingStudent(false);
    setSubmitting(false);
    setForm({ ...EMPTY_STUDENT_FORM });

    setFormOpen(true);
  }

  function closeStudentForm() {
    setFormOpen(false);
    setRegistrationStep("student-id");
    setRegistrationResolution(null);
    setRegistrationResult(null);
    setRegistrationError("");
    setFieldErrors({});
    setResolvingStudent(false);
    setSubmitting(false);
  }

  async function openEditForm(student) {
    setEditingStudent(student);
    setActiveTerm(null);
    setActiveTermError("");

    let photoUrl = studentPhotos[String(student.id)] || "";

    if (!photoUrl && student.id) {
      const { data, error } = await supabase
        .from("students")
        .select("id, photo_url")
        .eq("id", student.id)
        .maybeSingle();

      if (!error && data) {
        photoUrl = data.photo_url || "";
        studentPhotoCache.current.set(String(student.id), photoUrl);
        setStudentPhotos((current) => ({
          ...current,
          [String(student.id)]: photoUrl,
        }));
      }
    }

    const existingOrganizations =
      student.student_organizations || [];

    const specificOrganization =
      existingOrganizations.find(
        (item) =>
          item.organizations?.organization_type !==
          "non_departmental"
      );

    setForm({
      student_number:
        student.student_number || "",
      first_name:
        student.first_name || "",
      last_name:
        student.last_name || "",
      email:
        student.email || "",
      photo_url:
        photoUrl,
      program:
        student.program || "",
      year_level:
        student.year_level || 1,
      organization_id:
        specificOrganization?.organization_id || "",
      precinct_code:
        student.precinct_code || "",
      batch_code:
        student.batch_code || "",
      status:
        student.status || "pending",
    });

    setFormOpen(true);
  }

  async function handlePhotoUpload(file) {
    if (!file) return;

    const dataUrl = await readImageFileAsCompressedDataUrl(file);

    setForm((previous) => ({
      ...previous,
      photo_url: dataUrl,
    }));
  }

  function handleStudentNumberChange(value) {
    setForm({ ...EMPTY_STUDENT_FORM, student_number: value });
    setRegistrationResolution(null);
    setRegistrationResult(null);
    setRegistrationError("");
    setFieldErrors({});
  }

  function registrationOutcomeMessage(outcome, fallback = "We could not complete this request. Please try again.") {
    const messages = {
      INVALID_FORMAT: "New Student IDs must contain exactly five digits.",
      INVALID_INPUT: "Review the required student details and try again.",
      INVALID_TERM: "No active academic term is available for registration.",
      IDENTITY_RECONCILIATION_REQUIRED: "This Student ID needs identity review before registration can continue.",
      IDENTITY_RECHECK_REQUIRED: "The student record changed while you were working. Check the Student ID again.",
      CLIENT_STATUS_NOT_ALLOWED: "Account status is managed separately from term registration.",
      RESTORATION_REQUIRED: "The term enrollment was saved, but organization participation requires administrative review.",
    };
    return messages[outcome] || fallback;
  }

  function validateRegistrationDetails() {
    const errors = {};
    const isNewStudent = registrationResolution?.outcome === "NEW_STUDENT";
    const yearLevel = Number(form.year_level);

    if (isNewStudent && !form.first_name.trim()) errors.first_name = "Enter the student's first name.";
    if (isNewStudent && !form.last_name.trim()) errors.last_name = "Enter the student's last name.";
    if (isNewStudent && form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      errors.email = "Enter a valid email address.";
    }
    if (!form.program.trim()) errors.program = "Enter the student's program.";
    if (!Number.isInteger(yearLevel) || yearLevel < 1 || yearLevel > 6) {
      errors.year_level = "Choose a year level from 1 to 6.";
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleStudentIdCheck(event) {
    event.preventDefault();
    if (resolvingStudent || submitting) return;

    const studentNumber = form.student_number.trim();
    if (!studentNumber) {
      setFieldErrors({ student_number: "Enter a Student ID." });
      return;
    }
    if (!isSupabaseAdminAuthMode()) {
      setRegistrationError("Student registration requires the secure Supabase Auth Super Admin flow.");
      return;
    }

    setResolvingStudent(true);
    setRegistrationError("");
    setFieldErrors({});

    const { data, error } = await resolveSuperAdminStudentForTerm(studentNumber);
    setResolvingStudent(false);

    if (!data?.outcome) {
      setRegistrationError(error ? "Unable to check this Student ID. Try again." : "No registration result was returned.");
      return;
    }

    if (data.outcome === "INVALID_FORMAT") {
      setFieldErrors({ student_number: "Student ID must contain exactly 5 digits for a new record." });
      return;
    }

    if (["INVALID_TERM", "IDENTITY_RECONCILIATION_REQUIRED"].includes(data.outcome)) {
      setRegistrationError(registrationOutcomeMessage(data.outcome));
      return;
    }

    setActiveTerm(data.academic_term || activeTerm);
    setRegistrationResolution(data);

    if (data.outcome === "NEW_STUDENT") {
      setForm((current) => ({ ...EMPTY_STUDENT_FORM, student_number: data.student_number || current.student_number.trim() }));
      setRegistrationStep("details");
      return;
    }

    const resolvedStudent = data.student || {};
    setForm((current) => ({
      ...EMPTY_STUDENT_FORM,
      student_number: resolvedStudent.student_number || current.student_number.trim(),
      first_name: resolvedStudent.first_name || "",
      last_name: resolvedStudent.last_name || "",
      program: resolvedStudent.program || "",
      year_level: resolvedStudent.year_level || 1,
      status: resolvedStudent.status || "pending",
    }));

    if (data.outcome === "ALREADY_ENROLLED_CURRENT_TERM") {
      setRegistrationResult({ ...data, outcome: data.outcome });
      setRegistrationStep("complete");
    } else {
      setRegistrationStep("existing");
    }
  }

  function continueToReview(event) {
    event.preventDefault();
    if (!validateRegistrationDetails()) return;
    setRegistrationError("");
    setRegistrationStep("review");
  }

  function returnToStudentId() {
    setRegistrationStep("student-id");
    setRegistrationResolution(null);
    setRegistrationResult(null);
    setRegistrationError("");
    setFieldErrors({});
  }

  async function submitRegistration(event) {
    event.preventDefault();
    if (submitting || !validateRegistrationDetails()) return;

    const isNewStudent = registrationResolution?.outcome === "NEW_STUDENT";
    const payload = isNewStudent
      ? {
          student_number: form.student_number.trim(),
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
          email: form.email.trim() || null,
          photo_url: form.photo_url || null,
          program: form.program.trim(),
          year_level: Number(form.year_level),
          organization_id: form.organization_id || null,
          precinct_code: form.precinct_code.trim() || null,
          batch_code: form.batch_code.trim() || null,
        }
      : {
          student_number: form.student_number,
          program: form.program.trim(),
          year_level: Number(form.year_level),
          organization_id: form.organization_id || null,
        };

    setSubmitting(true);
    setRegistrationError("");
    const result = isNewStudent
      ? await registerNewSuperAdminStudent(payload)
      : await enrollExistingSuperAdminStudent(payload);
    setSubmitting(false);

    const outcome = result.data?.outcome;
    if (result.data?.organization_outcome === "RESTORATION_REQUIRED") {
      setRegistrationResult({
        ...result.data,
        student: registrationResolution?.student || form,
        requiresOrganizationReview: true,
      });
      setRegistrationStep("complete");
      fetchStudents();
      return;
    }

    if (outcome === "ALREADY_ENROLLED_CURRENT_TERM") {
      setRegistrationResult({ ...result.data, student: registrationResolution?.student });
      setRegistrationStep("complete");
      fetchStudents();
      return;
    }

    if (!["NEW_STUDENT_CREATED", "EXISTING_STUDENT_ENROLLED", "EXISTING_STUDENT_TERM_RESTORED"].includes(outcome)) {
      if (outcome === "IDENTITY_RECHECK_REQUIRED") {
        returnToStudentId();
      }
      setRegistrationError(registrationOutcomeMessage(result.data?.organization_outcome || outcome));
      return;
    }

    setRegistrationResult({
      ...result.data,
      student: registrationResolution?.student || {
        student_number: form.student_number,
        first_name: form.first_name,
        last_name: form.last_name,
        program: form.program,
        year_level: form.year_level,
        status: "pending",
      },
    });
    setRegistrationStep("complete");

    await logAuditEvent({
      action: isNewStudent ? "student_created" : "student_term_enrolled",
      entityType: "student",
      entityLabel: studentDisplayName(form),
      organizationId: form.organization_id || null,
      organizationName: organizations.find((org) => String(org.id) === String(form.organization_id))?.name || null,
      status: "completed",
      metadata: {
        program: form.program,
        year_level: Number(form.year_level),
        student_status: result.data?.student_status || (isNewStudent ? "pending" : form.status),
        registration_outcome: outcome,
      },
    });

    fetchStudents();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting || !editingStudent) return;

    setSubmitting(true);

    const payload = {
      student_number: form.student_number,
      first_name: form.first_name,
      last_name: form.last_name,
      email: form.email,
      photo_url: form.photo_url || null,
      program: form.program,
      year_level: Number(form.year_level),
      precinct_code: form.precinct_code || null,
      batch_code: form.batch_code || null,
      status: form.status,
    };
    const savedStudentId = editingStudent.id;
    const { error } = await supabase
      .from("students")
      .update(payload)
      .eq("id", savedStudentId);

    if (error) {
      console.error("Student save failed:", error);
      prompt.error(error.message || "Failed to save student.");
      setSubmitting(false);
      return;
    }
    const {
      error: syncError,
      createdOrganizationIds = [],
      existingOrganizationIds = [],
    } = await syncStudentOrganizationMemberships({
      studentId: savedStudentId,
      program: form.program,
      explicitOrganizationIds: form.organization_id ? [form.organization_id] : [],
    });

    if (syncError) {
      console.error("Student organization sync failed:", syncError);
      prompt.error(syncError.message || "Failed to link student to organizations.");
      setSubmitting(false);
      return;
    }

    prompt.success("Student record updated.");

    await logAuditEvent({
      action: "student_updated",
      entityType: "student",
      entityId: savedStudentId,
      entityLabel: `${form.first_name} ${form.last_name}`.trim() || form.student_number,
      organizationId: form.organization_id || null,
      organizationName:
        organizations.find((org) => String(org.id) === String(form.organization_id))?.name ||
        null,
      status: "completed",
      metadata: {
        program: form.program,
        year_level: Number(form.year_level),
        student_status: form.status,
        linked_organizations: createdOrganizationIds,
        existing_organizations: existingOrganizationIds,
      },
    });

    studentPhotoCache.current.set(String(savedStudentId), form.photo_url || "");
    setStudentPhotos((current) => ({
      ...current,
      [String(savedStudentId)]: form.photo_url || "",
    }));

    closeStudentForm();
    setSubmitting(false);

    fetchStudents();
  }

  async function handleDelete(id) {
    const student = students.find((item) => item.id === id) || {};
    const label =
      `${student.first_name || ""} ${student.last_name || ""}`.trim() ||
      student.student_number ||
      "Student";
    const analysis = await analyzeDeleteDependencies("student", { id });

    if (analysis.blocked) {
      await logAuditEvent({
        action: "student_delete_blocked",
        entityType: "student",
        entityId: id,
        entityLabel: label,
        status: "requires_action",
        metadata: { dependencies: analysis.dependencies },
      });

      await prompt.alert({
        title: "Student Cannot Be Deleted Yet",
        message: dependencyMessage(label, analysis),
        type: "warning",
        confirmText: "Review Related Records",
      });
      return;
    }

    const confirmDelete =
      await prompt.confirm({
        title: "Delete Student?",
        message: dependencyMessage(label, analysis),
        type: "danger",
        confirmText: "Delete Student",
      });

    if (!confirmDelete) return;

    // Remove organization memberships first
    const {
      error: orgError,
    } = await supabase
      .from("student_organizations")
      .delete()
      .eq("student_id", id);

    if (orgError) {
      prompt.error(
        orgError.message ||
        "Failed to remove student organization memberships."
      );

      return;
    }

    // Delete student
    const { error } = await supabase
      .from("students")
      .delete()
      .eq("id", id);

    if (error) {
      prompt.error(
        error.message ||
        "Failed to delete student."
      );

      return;
    }

    prompt.success("Student deleted.");

    await logAuditEvent({
      action: "student_deleted",
      entityType: "student",
      entityId: id,
      entityLabel: label,
      status: "completed",
      metadata: { removed_memberships: analysis.dependencies },
    });

    fetchStudents();
  }

  function getStudentOrganizations(student) {
    return (
      student.student_organizations || []
    )
      .map(
        (item) => {
          const organization = item.organizations;
          if (!organization) return null;

          return {
            ...organization,
            logo_url: organizationLogos[String(organization.id)] || "",
          };
        }
      )
      .filter(Boolean)
      .sort((a, b) => {
        const typeDelta =
          (a.organization_type === "non_departmental" ? 1 : 0) -
          (b.organization_type === "non_departmental" ? 1 : 0);
        if (typeDelta !== 0) return typeDelta;
        return String(a.name || "").localeCompare(String(b.name || ""));
      });
  }

  const totalPages = Math.max(1, Math.ceil(totalStudents / PAGE_SIZE));
  const visibleStatusCounts = students.reduce(
    (counts, student) => ({
      ...counts,
      [student.status || "pending"]: (counts[student.status || "pending"] || 0) + 1,
    }),
    { active: 0, pending: 0, disabled: 0 },
  );
  const pageStart = totalStudents === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(page * PAGE_SIZE, totalStudents);
  const statusOptions = [
    { value: "all", label: "All" },
    { value: "active", label: "Active" },
    { value: "pending", label: "Pending" },
    { value: "disabled", label: "Disabled" },
  ];

  function renderRegistrationProgress() {
    const stage = registrationStep === "student-id" ? 1 : registrationStep === "details" || registrationStep === "existing" ? 2 : 3;
    const labels = registrationResolution?.outcome === "NEW_STUDENT"
      ? ["Student ID", "Details", "Review"]
      : ["Student ID", "Term details", "Review"];

    return (
      <ol className="sa-registration-progress" aria-label="Registration progress">
        {labels.map((label, index) => (
          <li key={label} className={stage === index + 1 ? "is-current" : stage > index + 1 ? "is-complete" : ""}>
            <span>{String(index + 1).padStart(2, "0")} /</span>
            <strong>{label}</strong>
          </li>
        ))}
      </ol>
    );
  }

  function renderIdentitySummary(student, label = "Existing student") {
    return (
      <section className="sa-registration-identity" aria-label="Resolved student">
        <p>{label}</p>
        <strong>{student?.student_number || form.student_number}</strong>
        <h3>{studentDisplayName(student || form)}</h3>
        <span>
          {[student?.program, student?.year_level ? yearLevelLabel(student.year_level) : null]
            .filter(Boolean)
            .join(" / ") || "Academic details not recorded"}
        </span>
      </section>
    );
  }

  function renderTermFields() {
    return (
      <div className="sa-registration-fields is-compact">
        <div className="sa-registration-field">
          <label htmlFor="registration-program">Program</label>
          <input
            id="registration-program"
            list="registration-program-options"
            value={form.program}
            onChange={(event) => setForm((current) => ({ ...current, program: event.target.value }))}
            aria-describedby={fieldErrors.program ? "registration-program-error" : undefined}
          />
          <datalist id="registration-program-options">
            {programs.map((program) => (
              <option key={program.id || program.code} value={program.code || program.name}>
                {program.name || program.code}
              </option>
            ))}
          </datalist>
          {fieldErrors.program ? <small id="registration-program-error" className="sa-registration-field-error">{fieldErrors.program}</small> : null}
        </div>
        <div className="sa-registration-field">
          <label htmlFor="registration-year">Year level</label>
          <select
            id="registration-year"
            value={form.year_level}
            onChange={(event) => setForm((current) => ({ ...current, year_level: event.target.value }))}
            aria-describedby={fieldErrors.year_level ? "registration-year-error" : undefined}
          >
            {[1, 2, 3, 4, 5, 6].map((year) => <option key={year} value={year}>{yearLevelLabel(year)}</option>)}
          </select>
          {fieldErrors.year_level ? <small id="registration-year-error" className="sa-registration-field-error">{fieldErrors.year_level}</small> : null}
        </div>
        <div className="sa-registration-field is-wide">
          <label htmlFor="registration-organization">Additional organization</label>
          <select
            id="registration-organization"
            value={form.organization_id}
            onChange={(event) => setForm((current) => ({ ...current, organization_id: event.target.value }))}
          >
            <option value="">No additional organization</option>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>{organization.name}</option>
            ))}
          </select>
          <small>Departmental memberships follow existing program coverage rules.</small>
        </div>
      </div>
    );
  }

  function renderAddStudentFlow() {
    const resolvedStudent = registrationResolution?.student;
    const isNewStudent = registrationResolution?.outcome === "NEW_STUDENT";
    const selectedOrganization = organizations.find((organization) => String(organization.id) === String(form.organization_id));
    const resultOutcome = registrationResult?.outcome;
    const trimmedStudentNumber = form.student_number.trim();
    const hasNewStudentIdFormat = /^\d{5}$/.test(trimmedStudentNumber);
    const studentNumberHelp = fieldErrors.student_number
      || (trimmedStudentNumber && !hasNewStudentIdFormat
        ? "New Student IDs must contain exactly 5 digits. Existing historical IDs can still be checked."
        : "Student IDs are stored as entered; outer spaces are removed when checked.");

    if (registrationStep === "student-id") {
      return (
        <form className="sa-registration-workspace" onSubmit={handleStudentIdCheck}>
          {renderRegistrationProgress()}
          <div className="sa-registration-focus">
            <h3>Who is the student?</h3>
            <p>Enter the student's ID number to check the current term and existing record.</p>
            <div className="sa-registration-field">
              <label htmlFor="registration-student-id">Student ID</label>
              <input
                id="registration-student-id"
                value={form.student_number}
                onChange={(event) => handleStudentNumberChange(event.target.value)}
                inputMode="numeric"
                autoComplete="off"
                placeholder="59537"
                aria-invalid={fieldErrors.student_number ? "true" : undefined}
                aria-describedby="registration-student-id-help"
              />
              <small
                id="registration-student-id-help"
                className={fieldErrors.student_number ? "sa-registration-field-error" : "sa-registration-field-help"}
              >
                {studentNumberHelp}
              </small>
            </div>
          </div>
          {registrationError ? <p className="sa-registration-error" role="alert">{registrationError}</p> : null}
          <div className="sa-registration-actions">
            <button type="button" className="secondary-btn" onClick={closeStudentForm}>Cancel</button>
            <button type="submit" className="primary-btn" disabled={resolvingStudent || activeTermLoading || !trimmedStudentNumber}>
              {resolvingStudent ? "Checking..." : "Check Student ID"}
              {!resolvingStudent ? <ArrowRight size={16} aria-hidden="true" /> : null}
            </button>
          </div>
        </form>
      );
    }

    if (registrationStep === "details") {
      return (
        <form className="sa-registration-workspace" onSubmit={continueToReview}>
          {renderRegistrationProgress()}
          <div className="sa-registration-heading">
            <div><h3>Student details</h3></div>
            <div><span>{form.student_number}</span><strong>New student</strong></div>
          </div>
          <div className="sa-registration-fields">
            <div className="sa-registration-field">
              <label htmlFor="registration-first-name">First name</label>
              <input id="registration-first-name" value={form.first_name} onChange={(event) => setForm((current) => ({ ...current, first_name: event.target.value }))} />
              {fieldErrors.first_name ? <small className="sa-registration-field-error">{fieldErrors.first_name}</small> : null}
            </div>
            <div className="sa-registration-field">
              <label htmlFor="registration-last-name">Last name</label>
              <input id="registration-last-name" value={form.last_name} onChange={(event) => setForm((current) => ({ ...current, last_name: event.target.value }))} />
              {fieldErrors.last_name ? <small className="sa-registration-field-error">{fieldErrors.last_name}</small> : null}
            </div>
            <div className="sa-registration-field is-wide">
              <label htmlFor="registration-email">Email <span>Optional</span></label>
              <input id="registration-email" type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
              {fieldErrors.email ? <small className="sa-registration-field-error">{fieldErrors.email}</small> : null}
            </div>
            {renderTermFields()}
            <div className="sa-registration-field">
              <label htmlFor="registration-precinct">Precinct code <span>Optional</span></label>
              <input id="registration-precinct" value={form.precinct_code} onChange={(event) => setForm((current) => ({ ...current, precinct_code: event.target.value }))} />
            </div>
            <div className="sa-registration-field">
              <label htmlFor="registration-batch">Batch code <span>Optional</span></label>
              <input id="registration-batch" value={form.batch_code} onChange={(event) => setForm((current) => ({ ...current, batch_code: event.target.value }))} />
            </div>
            <div className="sa-registration-field is-wide">
              <label htmlFor="registration-photo">Student photo <span>Optional</span></label>
              <input id="registration-photo" type="file" accept="image/*" onChange={(event) => handlePhotoUpload(event.target.files?.[0])} />
            </div>
          </div>
          <aside className="sa-registration-status"><span>Account status</span><strong>Pending</strong><p>New student records begin as Pending. Status can be managed later from the Students Registry.</p></aside>
          {registrationError ? <p className="sa-registration-error" role="alert">{registrationError}</p> : null}
          <div className="sa-registration-actions">
            <button type="button" className="secondary-btn" onClick={returnToStudentId}><ArrowLeft size={16} aria-hidden="true" />Student ID</button>
            <button type="submit" className="primary-btn">Review registration<ArrowRight size={16} aria-hidden="true" /></button>
          </div>
        </form>
      );
    }

    if (registrationStep === "existing") {
      const restoring = registrationResolution?.outcome === "EXISTING_STUDENT_NOT_IN_MASTERLIST";
      return (
        <form className="sa-registration-workspace" onSubmit={continueToReview}>
          {renderRegistrationProgress()}
          {renderIdentitySummary(resolvedStudent)}
          <div className="sa-registration-note">
            <strong>{restoring ? "Register for the current term" : "Not yet enrolled for this term"}</strong>
            <p>{restoring ? "This student was not included in the current term's finalized masterlist. Registration can be restored without replacing the existing account." : "This student already has a Kandid record. Confirm the current-term academic details before enrollment."}</p>
          </div>
          {renderTermFields()}
          <aside className="sa-registration-status"><span>Current account status</span><strong>{resolvedStudent?.status || "Not recorded"}</strong><p>Term registration will not change this account status.</p></aside>
          {registrationError ? <p className="sa-registration-error" role="alert">{registrationError}</p> : null}
          <div className="sa-registration-actions">
            <button type="button" className="secondary-btn" onClick={returnToStudentId}><ArrowLeft size={16} aria-hidden="true" />Student ID</button>
            <button type="submit" className="primary-btn">Review term enrollment<ArrowRight size={16} aria-hidden="true" /></button>
          </div>
        </form>
      );
    }

    if (registrationStep === "review") {
      return (
        <form className="sa-registration-workspace" onSubmit={submitRegistration}>
          {renderRegistrationProgress()}
          <div className="sa-registration-heading"><div><h3>{isNewStudent ? "Register student" : "Confirm term enrollment"}</h3></div></div>
          <div className="sa-registration-review">
            <section><span>Student</span><strong>{form.student_number}</strong><p>{studentDisplayName(form)}</p>{isNewStudent && form.email ? <small>{form.email}</small> : null}</section>
            <section><span>Academic</span><strong>{form.program}</strong><p>{yearLevelLabel(form.year_level)}</p><small>{formatAcademicTerm(activeTerm)}</small>{selectedOrganization ? <small>{selectedOrganization.name}</small> : null}</section>
            <section><span>Account</span><strong>{isNewStudent ? "Pending" : form.status}</strong><p>{isNewStudent ? "New student records begin as Pending." : "The existing account status will not be changed."}</p></section>
          </div>
          {registrationResolution?.outcome === "EXISTING_STUDENT_NOT_IN_MASTERLIST" ? <p className="sa-registration-note">Registration will restore this student's enrollment for the current term while preserving the existing Kandid account.</p> : null}
          {registrationError ? <p className="sa-registration-error" role="alert">{registrationError}</p> : null}
          <div className="sa-registration-actions">
            <button type="button" className="secondary-btn" onClick={() => setRegistrationStep(isNewStudent ? "details" : "existing")}><ArrowLeft size={16} aria-hidden="true" />{isNewStudent ? "Edit details" : "Back"}</button>
            <button type="submit" className="primary-btn" disabled={submitting}>{submitting ? (isNewStudent ? "Registering student..." : "Enrolling student...") : (isNewStudent ? "Register student" : "Enroll for current term")}</button>
          </div>
        </form>
      );
    }

    const alreadyEnrolled = resultOutcome === "ALREADY_ENROLLED_CURRENT_TERM";
    const requiresOrganizationReview = registrationResult?.requiresOrganizationReview === true;
    const resultStudent = registrationResult?.student || resolvedStudent || form;
    const resultStatus = registrationResult?.student_status || resultStudent?.status || (resultOutcome === "NEW_STUDENT_CREATED" ? "pending" : "Not recorded");
    return (
      <div className="sa-registration-workspace sa-registration-complete" role="status">
        {renderRegistrationProgress()}
        <Check size={24} aria-hidden="true" />
        <p className="sa-registration-kicker">{requiresOrganizationReview ? "Registration needs review" : alreadyEnrolled ? "Already registered" : resultOutcome === "NEW_STUDENT_CREATED" ? "Student registered" : resultOutcome === "EXISTING_STUDENT_TERM_RESTORED" ? "Term registration restored" : "Term registration complete"}</p>
        <h3>{studentDisplayName(resultStudent)}</h3>
        <strong>{resultStudent?.student_number || form.student_number}</strong>
        <p>{requiresOrganizationReview ? "The term enrollment was saved, but organization participation requires administrative review." : alreadyEnrolled ? "This student is already enrolled for the current academic term." : resultOutcome === "NEW_STUDENT_CREATED" ? "The student was added for the current academic term." : "The existing student is now enrolled for the current academic term."}</p>
        <div className="sa-registration-complete-status"><span>Account status</span><strong>{resultStatus}</strong></div>
        <div className="sa-registration-actions">
          <button type="button" className="secondary-btn" onClick={closeStudentForm}>Back to Students</button>
          {!alreadyEnrolled && !requiresOrganizationReview ? <button type="button" className="primary-btn" onClick={openCreateForm}>Add another student<Plus size={16} aria-hidden="true" /></button> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="sa-students">
      <header className="sa-students-masthead">
        <div className="sa-students-masthead-copy">
          <p className="sa-students-brandline">
            <span>Kandid</span>
            <span>/</span>
            <span>Super Admin</span>
          </p>
          <p className="sa-students-eyebrow">Student registry</p>
          <h1>Students</h1>
          <p className="sa-students-deck">
            Review student identity, academic records, organization membership,
            and administrative access across Kandid.
          </p>
        </div>

        <div className="sa-students-masthead-aside">
          <span>Registry desk</span>
          <strong>
            {loadingStudents ? "Reading student records" : `${totalStudents} matching records`}
          </strong>
          <button className="sa-students-add" type="button" onClick={openCreateForm}>
            <Plus size={16} aria-hidden="true" />
            Add student
          </button>
        </div>
      </header>

      {!loadingStudents && !studentsError ? (
        <section className="sa-students-summary" aria-label="Current registry summary">
          <div className="sa-students-summary-item is-primary">
            <span>Matching records</span>
            <strong>{totalStudents}</strong>
            <small>Current search and filters</small>
          </div>
          <div className="sa-students-summary-item">
            <span>Active on page</span>
            <strong>{visibleStatusCounts.active}</strong>
            <small>Active access state</small>
          </div>
          <div className="sa-students-summary-item is-pending">
            <span>Pending on page</span>
            <strong>{visibleStatusCounts.pending}</strong>
            <small>Awaiting administrative review</small>
          </div>
          <div className="sa-students-summary-item is-disabled">
            <span>Disabled on page</span>
            <strong>{visibleStatusCounts.disabled}</strong>
            <small>Restricted access state</small>
          </div>
        </section>
      ) : null}

      <section className="sa-students-registry" aria-labelledby="student-registry-heading">
        <div className="sa-students-registry-head">
          <div>
            <p className="sa-students-eyebrow">Directory / 01</p>
            <h2 id="student-registry-heading">Student records</h2>
          </div>
          <p>
            {loadingStudents
              ? "Loading the administrative register"
              : `Page ${page} of ${totalPages}`}
          </p>
        </div>

        <div className="sa-students-toolbar">
          <label className="sa-students-search">
            <span>Search records</span>
            <div>
              <Search size={17} aria-hidden="true" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Student number, name, or email"
                type="search"
              />
            </div>
          </label>

          <label className="sa-students-control">
            <span>Organization</span>
            <select
              value={organizationFilter}
              onChange={(event) => {
                setOrganizationFilter(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">All organizations</option>
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </label>

          <label className="sa-students-control">
            <span>Order</span>
            <select
              value={sortBy}
              onChange={(event) => {
                setSortBy(event.target.value);
                setPage(1);
              }}
            >
              {Object.entries(sortOptions).map(([value, option]) => (
                <option key={value} value={value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="sa-students-status-filter" aria-label="Filter by student status">
          <span>Status</span>
          <div>
            {statusOptions.map((option) => (
              <button
                key={option.value}
                className={statusFilter === option.value ? "is-active" : ""}
                type="button"
                aria-pressed={statusFilter === option.value}
                onClick={() => {
                  setStatusFilter(option.value);
                  setPage(1);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {loadingStudents ? (
          <div className="sa-students-loading" role="status">
            <p className="sa-students-eyebrow">Registry loading</p>
            <strong>Reading student records</strong>
            <div className="sa-students-loading-lines" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </div>
        ) : studentsError ? (
          <div className="sa-students-error" role="alert">
            <p className="sa-students-eyebrow">Registry unavailable</p>
            <h3>Student records could not be loaded.</h3>
            <p>{studentsError}</p>
            <button type="button" onClick={fetchStudents} className="sa-students-retry">
              Retry directory
            </button>
          </div>
        ) : students.length === 0 ? (
          <div className="sa-students-empty">
            <span aria-hidden="true">00</span>
            <div>
              <h3>No matching student records</h3>
              <p>Adjust the current search or filters, or add a student record.</p>
            </div>
            <button type="button" onClick={openCreateForm} className="sa-students-text-action">
              Add student
            </button>
          </div>
        ) : (
          <>
            <div className="sa-students-table-wrap">
              <table className="sa-students-table">
                <caption className="sr-only">Student registry records</caption>
                <thead>
                  <tr>
                    <th scope="col">Index</th>
                    <th scope="col">Student</th>
                    <th scope="col">Academic record</th>
                    <th scope="col">Membership</th>
                    <th scope="col">Access state</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((student, index) => {
                    const studentOrganizations = getStudentOrganizations(student);
                    const studentStatus = student.status || "pending";
                    const studentName = [student.first_name, student.last_name]
                      .filter(Boolean)
                      .join(" ") || "Unnamed Student";

                    return (
                      <tr key={student.id} className={`is-${studentStatus}`}>
                        <td className="sa-students-index" data-label="Index">
                          {String((page - 1) * PAGE_SIZE + index + 1).padStart(2, "0")}
                        </td>
                        <td className="sa-students-identity" data-label="Student">
                          <div className="sa-students-identity-content">
                            <StudentAvatar
                              student={{
                                ...student,
                                photo_url: studentPhotos[String(student.id)] || "",
                              }}
                              className="sa-students-avatar"
                              loading="lazy"
                            />
                            <div>
                              <strong>{studentName}</strong>
                              <span className="sa-students-number">
                                Student no. {student.student_number || "Not recorded"}
                              </span>
                              {student.email ? <small>{student.email}</small> : null}
                            </div>
                          </div>
                        </td>
                        <td className="sa-students-academic" data-label="Academic record">
                          <div className="sa-students-academic-content">
                            <strong>{student.program || "Program not recorded"}</strong>
                            <span>
                              {student.year_level ? `Year ${student.year_level}` : "Year not recorded"}
                            </span>
                          </div>
                        </td>
                        <td className="sa-students-membership" data-label="Membership">
                          {studentOrganizations.length > 0 ? (
                            <div className="sa-students-membership-list">
                              <div className="sa-students-org-marks" aria-hidden="true">
                                {studentOrganizations.slice(0, 3).map((organization) => (
                                  <OrganizationLogo
                                    key={organization.id}
                                    organization={organization}
                                    className="sa-students-org-logo"
                                  />
                                ))}
                              </div>
                              <div>
                                <strong>{studentOrganizations[0].name}</strong>
                                <span>
                                  {studentOrganizations.length > 1
                                    ? `+${studentOrganizations.length - 1} more membership${studentOrganizations.length > 2 ? "s" : ""}`
                                    : "Organization member"}
                                </span>
                              </div>
                            </div>
                          ) : (
                            <span className="sa-students-unassigned">No organization</span>
                          )}
                        </td>
                        <td className="sa-students-state" data-label="Access state">
                          <div className="sa-students-state-content">
                            <span className={`sa-students-state-mark is-${studentStatus}`} aria-hidden="true" />
                            <div>
                              <strong>{studentStatus}</strong>
                              <span>
                                {studentStatus === "active"
                                  ? "Access enabled"
                                  : studentStatus === "disabled"
                                    ? "Access restricted"
                                    : "Review pending"}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="sa-students-actions" data-label="Actions">
                          <div className="sa-students-action-list">
                            <button
                              onClick={() => openEditForm(student)}
                              type="button"
                              aria-label={`Edit ${studentName}`}
                            >
                              <Pencil size={15} aria-hidden="true" />
                              Edit
                            </button>
                            <button
                              onClick={() => handleDelete(student.id)}
                              className="sa-students-delete"
                              type="button"
                              aria-label={`Delete ${studentName}`}
                            >
                              <Trash2 size={15} aria-hidden="true" />
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <nav className="sa-students-pager" aria-label="Student directory pagination">
              <p>
                Showing {pageStart}-{pageEnd} of {totalStudents} students
              </p>
              <div>
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Previous
                </button>
                <span aria-current="page">{String(page).padStart(2, "0")}</span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                >
                  Next
                </button>
              </div>
            </nav>
          </>
        )}
      </section>

      {/* ========================================================
          CREATE / EDIT FORM
      ======================================================== */}

      {formOpen && (
        <PopupOverlay>
          <div className={`popup-sheet popup-sheet-wide sa-students-modal max-h-[90vh] overflow-hidden ${editingStudent ? "is-editing" : `is-registration is-${registrationStep}`}`} role="dialog" aria-modal="true" aria-labelledby="student-form-title">
            <div className="popup-header">
              <div className="popup-header-copy">
                {editingStudent ? <p className="field-label !mb-3">Student Directory</p> : null}

                <h2 id="student-form-title" className="surface-title text-[2rem] font-black tracking-tight">
                  {editingStudent
                    ? "Edit Student"
                    : "Add Student"}
                </h2>

                <p className="surface-copy mt-2 text-sm leading-6">
                  {editingStudent
                    ? "Update the central student record and organization membership."
                    : activeTermLoading
                      ? "Checking the current academic term..."
                      : activeTerm
                        ? `Registration for ${formatAcademicTerm(activeTerm)}`
                        : activeTermError || "A current academic term is required."}
                </p>
              </div>

              <button
                onClick={closeStudentForm}
                className="popup-close"
                type="button"
                aria-label="Close student form"
              >
                <X size={20} />
              </button>
            </div>

            {editingStudent ? (
            <form
              onSubmit={handleSubmit}
              className="popup-content overflow-y-auto"
            >
              <div className="popup-form-grid">
                <div className="space-y-4">
                  {/* STUDENT NUMBER */}
                  <div>
                    <label className="field-label">
                      Student Number
                    </label>

                    <input
                      required
                      value={
                        form.student_number
                      }
                      onChange={(e) =>
                        setForm({
                          ...form,
                          student_number:
                            e.target.value,
                        })
                      }
                      className="field-shell w-full"
                      placeholder="Student Number"
                    />
                  </div>

                  {/* FIRST NAME */}
                  <div>
                    <label className="field-label">
                      First Name
                    </label>

                    <input
                      required
                      value={
                        form.first_name
                      }
                      onChange={(e) =>
                        setForm({
                          ...form,
                          first_name:
                            e.target.value,
                        })
                      }
                      className="field-shell w-full"
                      placeholder="First Name"
                    />
                  </div>

                  {/* LAST NAME */}
                  <div>
                    <label className="field-label">
                      Last Name
                    </label>

                    <input
                      required
                      value={
                        form.last_name
                      }
                      onChange={(e) =>
                        setForm({
                          ...form,
                          last_name:
                            e.target.value,
                        })
                      }
                      className="field-shell w-full"
                      placeholder="Last Name"
                    />
                  </div>

                  {/* EMAIL */}
                  <div>
                    <label className="field-label">
                      Email
                    </label>

                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          email:
                            e.target.value,
                        })
                      }
                      className="field-shell w-full"
                      placeholder="Email"
                    />
                  </div>

                  {/* PROGRAM */}
                  <div>
                    <label className="field-label">
                      Program
                    </label>

                    <input
                      required
                      value={
                        form.program
                      }
                      onChange={(e) =>
                        setForm({
                          ...form,
                          program:
                            e.target.value,
                        })
                      }
                      className="field-shell w-full"
                      placeholder="e.g. BSIT"
                    />

                    <p className="mt-2 text-xs text-gray-500">
                      Departmental memberships are synced from covered programs.
                    </p>
                  </div>

                  {/* YEAR */}
                  <div>
                    <label className="field-label">
                      Year Level
                    </label>

                    <input
                      type="number"
                      min="1"
                      value={
                        form.year_level
                      }
                      onChange={(e) =>
                        setForm({
                          ...form,
                          year_level:
                            e.target.value,
                        })
                      }
                      className="field-shell w-full"
                    />
                  </div>
                </div>

                <div className="popup-side-panel">
                  {/* PHOTO */}
                  <div>
                    <label className="field-label">
                      Student Photo
                    </label>

                    <div className="flex items-center gap-4">
                      {form.photo_url ? (
                        <img
                          src={
                            form.photo_url
                          }
                          alt="Student preview"
                          className="h-16 w-16 rounded-2xl object-cover"
                        />
                      ) : (
                        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100 text-xs font-black text-gray-400">
                          PHOTO
                        </div>
                      )}

                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) =>
                          handlePhotoUpload(
                            e.target.files?.[0]
                          )
                        }
                        className="text-sm text-[#5a5548]"
                      />
                    </div>
                  </div>

                  {/* SPECIFIC ORGANIZATION */}
                  <div className="mt-6">
                    <label className="field-label">
                      Specific Organization
                    </label>

                    <select
                      value={
                        form.organization_id
                      }
                      onChange={(e) =>
                        setForm({
                          ...form,
                          organization_id:
                            e.target.value,
                        })
                      }
                      className="field-shell w-full"
                    >
                      <option value="">
                        No additional organization
                      </option>

                      {organizations.map((org) => (
                          <option
                            key={org.id}
                            value={org.id}
                          >
                            {org.name}
                          </option>
                        ))}
                    </select>

                    <div className="mt-3 rounded-xl bg-blue-50 p-3 text-xs leading-5 text-blue-700">
                      Departmental organizations are synced from their covered
                      programs. Non-departmental organizations require an
                      explicit membership assignment.
                      <br />
                      <strong>
                        Specific Organization:
                      </strong>{" "}
                      Optional additional
                      membership.
                    </div>
                  </div>

                  {/* PRECINCT */}
                  <div className="mt-6">
                    <label className="field-label">
                      Precinct Code
                    </label>

                    <input
                      value={
                        form.precinct_code
                      }
                      onChange={(e) =>
                        setForm({
                          ...form,
                          precinct_code:
                            e.target.value,
                        })
                      }
                      className="field-shell w-full"
                      placeholder="Precinct Code"
                    />
                  </div>

                  {/* BATCH */}
                  <div className="mt-4">
                    <label className="field-label">
                      Batch Code
                    </label>

                    <input
                      value={
                        form.batch_code
                      }
                      onChange={(e) =>
                        setForm({
                          ...form,
                          batch_code:
                            e.target.value,
                        })
                      }
                      className="field-shell w-full"
                      placeholder="Batch Code"
                    />
                  </div>

                  {/* STATUS */}
                  <div className="mt-4">
                    <label className="field-label">
                      Status
                    </label>

                    <select
                      value={form.status}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          status:
                            e.target.value,
                        })
                      }
                      className="field-shell w-full"
                    >
                      <option value="pending">
                        Pending
                      </option>

                      <option value="active">
                        Active
                      </option>

                      <option value="disabled">
                        Disabled
                      </option>
                    </select>
                  </div>
                </div>
              </div>

              {/* FORM ACTIONS */}
              <div className="popup-actions">
                <button
                  type="button"
                  onClick={closeStudentForm}
                  className="secondary-btn"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="primary-btn min-w-52"
                  disabled={submitting}
                >
                  {submitting
                    ? "Saving..."
                    : "Save Changes"}
                </button>
              </div>
            </form>
            ) : (
              <div className="popup-content overflow-y-auto">
                {renderAddStudentFlow()}
              </div>
            )}
          </div>
        </PopupOverlay>
      )}
    </div>
  );
}

export default Students;

