import flatpickr from 'flatpickr';
import { Thai } from 'flatpickr/dist/l10n/th.js';
import 'flatpickr/dist/flatpickr.min.css';
import { useEffect, useRef } from 'react';
import { BE_OFFSET, formatThaiDate, fromIsoDate, parseThaiDate, toIsoDate } from '../lib/thaiDate';

interface Props {
  value: string;
  onChange: (iso: string) => void;
  onBlur?: () => void;
  /** Latest selectable date, ISO; also the newest year in the year list. */
  maxDate?: string;
  /** Oldest year in the year list, Christian era. */
  minYear?: number;
  id?: string;
  className?: string;
  invalid?: boolean;
  placeholder?: string;
}

/**
 * A flatpickr calendar in Thai with Buddhist-era years. The value stays ISO (ค.ศ.); the field shows
 * "12 เมษายน 2528" and accepts typed dates such as 12/04/2528. Years are picked from a list,
 * because stepping back decades one year at a time is slow for birth dates.
 */
export function ThaiDatePicker({ value, onChange, onBlur, maxDate, minYear = 1900, id, className, invalid, placeholder = 'วว/ดด/ปปปป (พ.ศ.)' }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<flatpickr.Instance | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!inputRef.current) return undefined;
    const latest = maxDate ? fromIsoDate(maxDate) : null;
    const newestYear = (latest ?? new Date()).getFullYear();
    let yearSelect: HTMLSelectElement | null = null;
    const syncYear = (instance: flatpickr.Instance) => { if (yearSelect) yearSelect.value = String(instance.currentYear); };

    const instance = flatpickr(inputRef.current, {
      locale: Thai,
      allowInput: true,
      // Always the flatpickr calendar: the phone's native picker would show ค.ศ. years.
      disableMobile: true,
      dateFormat: 'Y-m-d',
      formatDate: (date) => formatThaiDate(date),
      parseDate: (text) => fromIsoDate(text) ?? parseThaiDate(text) ?? (undefined as unknown as Date),
      onChange: (dates) => onChangeRef.current(dates[0] ? toIsoDate(dates[0]) : ''),
      onReady: (_dates, _text, picker) => {
        yearSelect = document.createElement('select');
        yearSelect.className = 'flatpickr-be-year';
        yearSelect.setAttribute('aria-label', 'ปี พ.ศ.');
        for (let year = newestYear; year >= minYear; year -= 1) yearSelect.add(new Option(String(year + BE_OFFSET), String(year)));
        yearSelect.addEventListener('change', () => picker.changeYear(Number(yearSelect!.value)));
        const native = picker.currentYearElement.parentElement;
        native?.parentElement?.insertBefore(yearSelect, native);
        if (native) native.style.display = 'none';
        syncYear(picker);
      },
      onOpen: (_dates, _text, picker) => syncYear(picker),
      onYearChange: (_dates, _text, picker) => syncYear(picker),
      onMonthChange: (_dates, _text, picker) => syncYear(picker),
      ...(latest ? { maxDate: latest } : {})
    });
    const initial = fromIsoDate(value);
    if (initial) instance.setDate(initial, false);
    pickerRef.current = instance;
    return () => { instance.destroy(); pickerRef.current = null; };
  }, [maxDate, minYear]);

  // Follow value changes from outside, such as a form reset or loading a saved record.
  useEffect(() => {
    const picker = pickerRef.current;
    if (!picker) return;
    const current = picker.selectedDates[0] ? toIsoDate(picker.selectedDates[0]) : '';
    if (current === value) return;
    const date = fromIsoDate(value);
    if (date) picker.setDate(date, false);
    else picker.clear(false);
  }, [value]);

  return <input ref={inputRef} id={id} type="text" autoComplete="off" placeholder={placeholder} aria-invalid={invalid || undefined}
    onBlur={onBlur} className={className}/>;
}
