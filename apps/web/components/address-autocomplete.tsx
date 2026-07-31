'use client';

import { Icon } from '@/components/icons';
import { api, queryString } from '@/lib/api';
import type { AddressSuggestion } from '@/lib/types';
import {
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

interface AddressAutocompleteProps {
  label: string;
  value: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  selected?: boolean;
  onValueChange: (value: string) => void;
  onSelect: (suggestion: AddressSuggestion) => void;
}

export function AddressAutocomplete({
  label,
  value,
  placeholder,
  required,
  disabled,
  selected = false,
  onValueChange,
  onSelect,
}: AddressAutocompleteProps) {
  const inputId = useId();
  const listboxId = `${inputId}-listbox`;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const focusedRef = useRef(false);
  const lastSelectedValueRef = useRef('');
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    function closeOnOutsideClick(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        focusedRef.current = false;
        setOpen(false);
      }
    }

    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, []);

  useEffect(() => {
    const query = value.trim().replace(/\s+/g, ' ');
    if (
      disabled ||
      query.length < 3 ||
      query === lastSelectedValueRef.current
    ) {
      setSuggestions([]);
      setLoading(false);
      setActiveIndex(-1);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const result = await api<AddressSuggestion[]>(
          `/maps/address-suggestions${queryString({ query, limit: 6 })}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setSuggestions(result);
        setActiveIndex(result.length > 0 ? 0 : -1);
        setOpen(focusedRef.current && result.length > 0);
      } catch {
        if (controller.signal.aborted) return;
        // A missão continua podendo ser cadastrada manualmente.
        // Não exibimos uma mensagem de erro técnico ao usuário.
        setSuggestions([]);
        setActiveIndex(-1);
        setOpen(false);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 550);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [disabled, value]);

  function changeValue(nextValue: string) {
    if (nextValue !== lastSelectedValueRef.current) {
      lastSelectedValueRef.current = '';
    }
    onValueChange(nextValue);
    setOpen(nextValue.trim().length >= 3 && suggestions.length > 0);
  }

  function chooseSuggestion(suggestion: AddressSuggestion) {
    lastSelectedValueRef.current = suggestion.label;
    onSelect(suggestion);
    setSuggestions([]);
    setActiveIndex(-1);
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) {
      if (event.key === 'ArrowDown' && suggestions.length > 0) setOpen(true);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) =>
        current <= 0 ? suggestions.length - 1 : current - 1,
      );
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      const selectedSuggestion = suggestions[activeIndex];
      if (selectedSuggestion) chooseSuggestion(selectedSuggestion);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  const showPanel = open && suggestions.length > 0;

  return (
    <div className="field address-autocomplete" ref={wrapperRef}>
      <label htmlFor={inputId}>{label}</label>
      <div className={`address-autocomplete-control${selected ? ' is-selected' : ''}`}>
        <Icon name="pin" />
        <input
          id={inputId}
          type="text"
          autoComplete="off"
          spellCheck={false}
          required={required}
          disabled={disabled}
          value={value}
          placeholder={placeholder}
          role="combobox"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={showPanel}
          aria-activedescendant={
            activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
          }
          onFocus={() => {
            focusedRef.current = true;
            if (suggestions.length > 0) setOpen(true);
          }}
          onBlur={() => {
            window.setTimeout(() => {
              if (!wrapperRef.current?.contains(document.activeElement)) {
                focusedRef.current = false;
                setOpen(false);
              }
            }, 0);
          }}
          onChange={(event) => changeValue(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        {loading ? <span className="spinner small address-autocomplete-spinner" /> : null}
        {!loading && selected ? (
          <span className="address-selected-icon" title="Endereço localizado">
            <Icon name="check" />
          </span>
        ) : null}
      </div>

      {selected ? (
        <span className="address-selected-text"><Icon name="check" />Endereço localizado</span>
      ) : (
        <span className="field-help">Digite rua e número. Se não aparecer sugestão, continue manualmente.</span>
      )}

      {showPanel ? (
        <div className="address-suggestions" role="presentation">
          <div id={listboxId} role="listbox" aria-label={`Sugestões para ${label}`}>
            {suggestions.map((suggestion, index) => (
              <button
                id={`${listboxId}-option-${index}`}
                key={suggestion.id}
                type="button"
                role="option"
                aria-selected={activeIndex === index}
                className={`address-suggestion${activeIndex === index ? ' is-active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => chooseSuggestion(suggestion)}
              >
                <span className="address-suggestion-pin"><Icon name="pin" /></span>
                <span className="address-suggestion-copy">
                  <strong>{suggestion.primaryText}</strong>
                  {suggestion.secondaryText ? <small>{suggestion.secondaryText}</small> : null}
                </span>
                {suggestion.source === 'HISTORY' ? (
                  <span className="address-suggestion-source">Já usado</span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
