'use client';

import * as Popover from '@radix-ui/react-popover';
import { memo, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { LABEL_OPTIONS } from '@/lib/address-label-index';
import { truncateAddress } from '@/lib/format-utils';

const MAX_SUGGESTIONS = 8;

interface AddressAutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  onEnter: () => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}

function AddressAutocompleteInputInner(props: AddressAutocompleteInputProps) {
  const {
    value,
    onChange,
    onEnter,
    disabled = false,
    placeholder = 'NQ42 XXXX XXXX ... or address-book label',
    ariaLabel = 'Address input',
  } = props;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const filteredOptions = useMemo(() => {
    const query = value.trim().toLowerCase();
    const base = query
      ? LABEL_OPTIONS.filter((entry) => entry.label.toLowerCase().includes(query))
      : [];
    return base.slice(0, MAX_SUGGESTIONS);
  }, [value]);

  useEffect(() => {
    if (!open || filteredOptions.length === 0) {
      setActiveIndex(-1);
      return;
    }

    setActiveIndex((current) => {
      if (current < 0 || current >= filteredOptions.length) return 0;
      return current;
    });
  }, [open, filteredOptions.length]);

  const selectOption = (label: string) => {
    onChange(label);
    setOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      if (filteredOptions.length === 0) return;
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(0);
        return;
      }
      setActiveIndex((current) => (current + 1) % filteredOptions.length);
      return;
    }

    if (event.key === 'ArrowUp') {
      if (filteredOptions.length === 0) return;
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(filteredOptions.length - 1);
        return;
      }
      setActiveIndex((current) => (current <= 0 ? filteredOptions.length - 1 : current - 1));
      return;
    }

    if (event.key === 'Enter') {
      if (open && activeIndex >= 0 && filteredOptions[activeIndex]) {
        event.preventDefault();
        selectOption(filteredOptions[activeIndex].label);
        return;
      }
      onEnter();
      return;
    }

    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  const showSuggestions = open && filteredOptions.length > 0;
  const shouldRenderPopover = showSuggestions;

  return (
    <Popover.Root modal={false} open={open} onOpenChange={(next) => !disabled && setOpen(next)}>
      <Popover.Anchor asChild>
        <input
          type="text"
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            if (!disabled) setOpen(true);
          }}
          onFocus={() => {
            if (!disabled) setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="nq-input text-sm font-mono"
          disabled={disabled}
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-haspopup="listbox"
          autoComplete="off"
        />
      </Popover.Anchor>

      {shouldRenderPopover && (
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={6}
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
            style={{ width: 'var(--radix-popover-trigger-width)' }}
            className="z-50 rounded-xl border-2 border-nq-black bg-nq-white p-1 shadow-[4px_4px_0_0_#000]"
          >
            <div className="max-h-64 overflow-y-auto">
              {filteredOptions.map((entry, index) => {
                const active = index === activeIndex;
                const compactAddress = truncateAddress(entry.address.replace(/\s/g, ''));
                return (
                  <button
                    key={`${entry.label}-${entry.address}`}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectOption(entry.label)}
                    className={`w-full rounded-lg px-2 py-1 text-left transition-colors ${
                      active ? 'bg-nq-periwinkle text-nq-black' : 'hover:bg-nq-cream'
                    }`}
                  >
                    <div className="text-xs font-bold uppercase tracking-wide">{entry.label}</div>
                    <div className="text-[10px] font-mono opacity-70">{compactAddress}</div>
                  </button>
                );
              })}
            </div>
          </Popover.Content>
        </Popover.Portal>
      )}
    </Popover.Root>
  );
}

export const AddressAutocompleteInput = memo(AddressAutocompleteInputInner);
