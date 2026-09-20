import { CalendarIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "../ui/button";
import { Calendar } from "../ui/calendar";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
} from "../ui/combobox";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import {
  joinAutomationTime,
  selectedOptionLabel,
  splitAutomationTime,
  supportedTimeZones,
} from "./automationEditor.logic";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour.toString().padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, minute) => minute.toString().padStart(2, "0"));

export function StyledSelect<T extends string>({
  value,
  options,
  ariaLabel,
  disabled,
  onChange,
}: {
  readonly value: T;
  readonly options: ReadonlyArray<{ readonly value: T; readonly label: string }>;
  readonly ariaLabel: string;
  readonly disabled?: boolean;
  readonly onChange: (value: T) => void;
}) {
  const selectedLabel = selectedOptionLabel(options, value, `Select ${ariaLabel.toLowerCase()}`);
  return (
    <Select value={value} disabled={disabled} onValueChange={(next) => onChange(next as T)}>
      <SelectTrigger aria-label={ariaLabel}>
        <SelectValue>{selectedLabel}</SelectValue>
      </SelectTrigger>
      <SelectPopup>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

export function AutomationDatePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = new Date(`${value}T12:00:00`);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button type="button" variant="outline" className="w-full justify-between font-normal" />
        }
      >
        {selected.toLocaleDateString(undefined, { dateStyle: "medium" })}
        <CalendarIcon className="size-4 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverPopup align="start" aria-label="Choose automation date">
        <Calendar
          mode="single"
          required
          selected={selected}
          defaultMonth={selected}
          onSelect={(date) => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, "0");
            const day = String(date.getDate()).padStart(2, "0");
            onChange(`${year}-${month}-${day}`);
            setOpen(false);
          }}
        />
      </PopoverPopup>
    </Popover>
  );
}

export function AutomationTimePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { hour, minute } = splitAutomationTime(value);
  return (
    <div className="grid grid-cols-2 gap-2">
      <StyledSelect
        value={hour}
        ariaLabel="Hour"
        options={HOURS.map((option) => ({ value: option, label: option }))}
        onChange={(next) => onChange(joinAutomationTime(next, minute))}
      />
      <StyledSelect
        value={minute}
        ariaLabel="Minute"
        options={MINUTES.map((option) => ({ value: option, label: option }))}
        onChange={(next) => onChange(joinAutomationTime(hour, next))}
      />
    </div>
  );
}

export function TimeZonePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const zones = useMemo(() => {
    const intl = Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] };
    return supportedTimeZones(intl.supportedValuesOf?.("timeZone"), value);
  }, [value]);
  return (
    <Combobox value={value} items={zones} onValueChange={(next) => next && onChange(next)}>
      <ComboboxInput aria-label="Time zone" placeholder="Choose a time zone" />
      <ComboboxPopup>
        <ComboboxEmpty>No matching time zone.</ComboboxEmpty>
        <ComboboxList className="max-h-72">
          {(zone: string) => (
            <ComboboxItem key={zone} value={zone}>
              {zone.replaceAll("_", " ")}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}
