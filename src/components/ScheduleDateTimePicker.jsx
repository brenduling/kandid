import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

const SCHEDULE_PICKER_OPEN_EVENT = "kandid:schedule-picker-open";

export function currentDateTimeInputValue() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60 * 1000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 16);
}

function clampDateTimeValue(value, min, max) {
  if (min && value < min) return min;
  if (max && value > max) return max;
  return value;
}

function toDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function datePart(value) {
  return String(value || "").slice(0, 10);
}

function timePart(value) {
  return String(value || "").slice(11, 16);
}

function monthStartFrom(value) {
  const source = value ? new Date(`${datePart(value)}T00:00`) : new Date();
  return new Date(source.getFullYear(), source.getMonth(), 1);
}

function sameMonth(first, second) {
  return first.getFullYear() === second.getFullYear() && first.getMonth() === second.getMonth();
}

function buildCalendarDays(monthDate) {
  const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const gridStart = new Date(firstDay);
  gridStart.setDate(firstDay.getDate() - firstDay.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });
}

function formatDateTime(value) {
  if (!value) return "Select date and time";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Select date and time";

  return new Intl.DateTimeFormat("en-PH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function ScheduleDateTimePicker({
  label,
  value,
  onChange,
  required = false,
  min = "",
  max = "",
}) {
  const pickerId = useId();
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => monthStartFrom(value || min));
  const selectedDate = datePart(value);
  const selectedTime = timePart(value) || "08:00";
  const minDate = datePart(min);
  const maxDate = datePart(max);
  const minTime = selectedDate && minDate === selectedDate ? timePart(min) : "";
  const maxTime = selectedDate && maxDate === selectedDate ? timePart(max) : "";
  const calendarDays = useMemo(() => buildCalendarDays(visibleMonth), [visibleMonth]);
  const previousMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1);
  const nextMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1);
  const previousDisabled = minDate && toDateInputValue(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 0)) < minDate;
  const nextDisabled = maxDate && toDateInputValue(nextMonth) > maxDate.slice(0, 7) + "-31";

  function commit(dateValue, timeValue = selectedTime) {
    if (!dateValue) return;
    onChange(clampDateTimeValue(`${dateValue}T${timeValue}`, min, max));
  }

  function toggleOpen() {
    setOpen((current) => {
      const nextOpen = !current;

      if (nextOpen) {
        document.dispatchEvent(
          new CustomEvent(SCHEDULE_PICKER_OPEN_EVENT, {
            detail: { pickerId },
          }),
        );
      }

      return nextOpen;
    });
  }

  useEffect(() => {
    function closeWhenOtherPickerOpens(event) {
      if (event.detail?.pickerId !== pickerId) {
        setOpen(false);
      }
    }

    document.addEventListener(SCHEDULE_PICKER_OPEN_EVENT, closeWhenOtherPickerOpens);

    return () => {
      document.removeEventListener(SCHEDULE_PICKER_OPEN_EVENT, closeWhenOtherPickerOpens);
    };
  }, [pickerId]);

  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <label className="field-label">{label}</label>
      <button
        type="button"
        className="field-shell flex min-h-[3.25rem] w-full items-center justify-between gap-3 text-left"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggleOpen}
      >
        <span className={value ? "truncate" : "truncate text-gray-400"}>
          {formatDateTime(value)}
        </span>
        <CalendarDays size={18} className="shrink-0 text-[#f4511e]" />
      </button>

      {open ? (
        <div className="absolute left-0 right-0 z-50 mt-2 rounded-2xl border border-[rgba(24,54,49,0.1)] bg-white p-4 shadow-2xl">
          <div className="flex items-center justify-between">
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={previousDisabled}
              onClick={() => setVisibleMonth(previousMonth)}
            >
              <ChevronLeft size={18} />
            </button>
            <strong className="text-sm text-[#182033]">
              {new Intl.DateTimeFormat("en-PH", {
                month: "long",
                year: "numeric",
              }).format(visibleMonth)}
            </strong>
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={nextDisabled}
              onClick={() => setVisibleMonth(nextMonth)}
            >
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[10px] font-black uppercase tracking-[0.12em] text-gray-400">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>

          <div className="mt-2 grid grid-cols-7 gap-1">
            {calendarDays.map((date) => {
              const dateValue = toDateInputValue(date);
              const outsideMonth = !sameMonth(date, visibleMonth);
              const disabled = (minDate && dateValue < minDate) || (maxDate && dateValue > maxDate);
              const selected = selectedDate === dateValue;

              return (
                <button
                  key={dateValue}
                  type="button"
                  disabled={disabled}
                  className={`h-9 rounded-xl text-sm font-bold transition ${
                    selected
                      ? "bg-[#f4511e] text-white shadow-lg shadow-orange-200"
                      : outsideMonth
                        ? "text-gray-300 hover:bg-orange-50"
                        : "text-[#182033] hover:bg-orange-50"
                  } disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-300 disabled:shadow-none`}
                  onClick={() => commit(dateValue)}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex items-center gap-3 rounded-2xl bg-orange-50/70 p-3">
            <CalendarDays size={17} className="text-[#f4511e]" />
            <input
              type="time"
              required={required}
              value={selectedTime}
              min={minTime || undefined}
              max={maxTime || undefined}
              onChange={(event) => {
                const dateValue = selectedDate || minDate || toDateInputValue(new Date());
                commit(dateValue, event.target.value);
              }}
              className="min-w-0 flex-1 bg-transparent text-sm font-bold text-[#182033] outline-none"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default ScheduleDateTimePicker;
