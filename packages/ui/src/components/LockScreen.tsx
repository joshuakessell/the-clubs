import { useState, useEffect, useRef, useCallback, type FormEvent } from 'react';
import { useAuthStore, type StaffSession } from '../stores/authStore';

const API_BASE = (import.meta as any).env?.VITE_API_URL || '/api';

interface StaffMember {
  id: string;
  name: string;
  role: string;
}

interface LockScreenProps {
  appTitle?: string;
  onLogin?: (session: StaffSession) => void;
}

export function LockScreen({ appTitle = 'Operations', onLogin }: LockScreenProps) {
  const { deviceId, setSession } = useAuthStore();
  const [staffLookup, setStaffLookup] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Staff autocomplete state
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [filteredStaff, setFilteredStaff] = useState<StaffMember[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null);
  const [isLoadingStaff, setIsLoadingStaff] = useState(true);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pinRef = useRef<HTMLInputElement>(null);

  // Fetch staff list on mount
  useEffect(() => {
    const fetchStaff = async () => {
      try {
        const res = await fetch(`${API_BASE}/v1/auth/staff`);
        if (res.ok) {
          const data: { staff: StaffMember[] } = await res.json();
          setStaffList(data.staff);
          setFilteredStaff(data.staff);
        }
      } catch {
        // Silently fail — user can still type manually
      } finally {
        setIsLoadingStaff(false);
      }
    };
    void fetchStaff();
  }, []);

  // Filter staff when input changes
  useEffect(() => {
    if (!staffLookup.trim()) {
      setFilteredStaff(staffList);
      return;
    }
    const q = staffLookup.toLowerCase();
    setFilteredStaff(
      staffList.filter(
        (s) => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)
      )
    );
    setHighlightedIndex(-1);
  }, [staffLookup, staffList]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selectStaff = useCallback(
    (staff: StaffMember) => {
      setSelectedStaff(staff);
      setStaffLookup(staff.name);
      setIsDropdownOpen(false);
      setError(null);
      // Focus the PIN input
      setTimeout(() => pinRef.current?.focus(), 50);
    },
    []
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isDropdownOpen || filteredStaff.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev < filteredStaff.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : filteredStaff.length - 1));
    } else if (e.key === 'Enter' && highlightedIndex >= 0) {
      e.preventDefault();
      selectStaff(filteredStaff[highlightedIndex]!);
    } else if (e.key === 'Escape') {
      setIsDropdownOpen(false);
    }
  };

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex < 0) return;
    const el = document.getElementById(`staff-option-${highlightedIndex}`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex]);

  const handlePinSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    const lookup = selectedStaff ? selectedStaff.name : staffLookup.trim();
    if (!lookup || !pin.trim()) {
      setError('Please select a staff member and enter your PIN');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/v1/auth/login-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          staffLookup: lookup,
          deviceId,
          pin: pin.trim(),
        }),
      });

      if (!response.ok) {
        const payload: any = await response.json().catch(() => null);
        throw new Error(payload?.error || payload?.message || 'Login failed');
      }

      const data: any = await response.json();
      const session: StaffSession = {
        staffId: data.staffId,
        name: data.name,
        role: data.role,
        sessionToken: data.sessionToken,
        mustChangePin: data.mustChangePin,
      };

      setSession(session);
      onLogin?.(session);
      setPin('');
      setStaffLookup('');
      setSelectedStaff(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid credentials');
      setPin('');
    } finally {
      setIsLoading(false);
    }
  };

  const roleLabel = (role: string) => {
    const labels: Record<string, string> = {
      admin: 'Admin',
      manager: 'Manager',
      staff: 'Staff',
      trainee: 'Trainee',
    };
    return labels[role.toLowerCase()] || role;
  };

  const roleColor = (role: string) => {
    const r = role.toLowerCase();
    if (r === 'admin') return 'var(--color-status-error)';
    if (r === 'manager') return 'var(--color-accent-primary)';
    return 'var(--color-text-muted)';
  };

  return (
    <div className="fixed inset-0 z-[9999] flex" style={{ backgroundColor: 'var(--color-surface-base)' }}>
      {/* Left: Login Form */}
      <div className="flex flex-1 flex-col items-center justify-center px-8 py-12">
        <div className="w-full max-w-sm">
          {/* Logo + Title */}
          <div className="mb-10">
            <div className="mb-4 flex items-center gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center"
              >
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
              </div>
              <span className="text-xl font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
                The Clubs
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
              Staff Login
            </h1>
            <p className="mt-1 text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Sign in to {appTitle}
            </p>
          </div>

          {/* Error */}
          {error && (
            <div
              className="mb-4 rounded-lg border px-4 py-3 text-sm"
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.08)',
                borderColor: 'rgba(239, 68, 68, 0.2)',
                color: 'var(--color-status-error)',
              }}
            >
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={(e) => void handlePinSubmit(e)} className="flex flex-col gap-4">
            {/* Staff Autocomplete */}
            <div ref={dropdownRef} className="relative">
              <label
                htmlFor="staff-lookup"
                className="mb-1.5 block text-xs font-medium uppercase tracking-wider"
                style={{ color: 'var(--color-text-muted)' }}
              >
                Staff Member
              </label>
              <div className="relative">
                <input
                  ref={inputRef}
                  id="staff-lookup"
                  type="text"
                  autoComplete="off"
                  value={staffLookup}
                  onChange={(e) => {
                    setStaffLookup(e.target.value);
                    setSelectedStaff(null);
                    setIsDropdownOpen(true);
                  }}
                  onFocus={() => setIsDropdownOpen(true)}
                  onKeyDown={handleKeyDown}
                  disabled={isLoading}
                  placeholder={isLoadingStaff ? 'Loading staff…' : 'Search or select staff…'}
                  className="h-11 w-full rounded-lg border px-4 pr-10 text-sm transition-all duration-200"
                  style={{
                    backgroundColor: 'var(--color-surface-input)',
                    borderColor: isDropdownOpen ? 'var(--color-accent-primary)' : 'var(--color-border-default)',
                    color: 'var(--color-text-primary)',
                    boxShadow: isDropdownOpen ? '0 0 0 2px var(--color-accent-glow)' : 'none',
                  }}
                  role="combobox"
                  aria-expanded={isDropdownOpen}
                  aria-autocomplete="list"
                  aria-controls="staff-listbox"
                  aria-activedescendant={highlightedIndex >= 0 ? `staff-option-${highlightedIndex}` : undefined}
                />
                {/* Chevron icon */}
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => {
                    setIsDropdownOpen(!isDropdownOpen);
                    inputRef.current?.focus();
                  }}
                  className="absolute right-0 top-0 flex h-11 w-10 items-center justify-center"
                  style={{ color: 'var(--color-text-muted)' }}
                  aria-label="Toggle staff list"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    style={{ transform: isDropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
              </div>

              {/* Dropdown */}
              {isDropdownOpen && !isLoadingStaff && (
                <div
                  id="staff-listbox"
                  role="listbox"
                  className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border shadow-xl"
                  style={{
                    backgroundColor: 'var(--color-surface-raised)',
                    borderColor: 'var(--color-border-default)',
                    maxHeight: '240px',
                    overflowY: 'auto',
                  }}
                >
                  {filteredStaff.length === 0 ? (
                    <div className="px-4 py-3 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                      No staff found
                    </div>
                  ) : (
                    filteredStaff.map((staff, i) => (
                      <button
                        key={staff.id}
                        id={`staff-option-${i}`}
                        type="button"
                        role="option"
                        aria-selected={highlightedIndex === i}
                        onClick={() => selectStaff(staff)}
                        onMouseEnter={() => setHighlightedIndex(i)}
                        className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm transition-colors duration-100"
                        style={{
                          backgroundColor:
                            selectedStaff?.id === staff.id
                              ? 'var(--color-accent-glow)'
                              : highlightedIndex === i
                              ? 'var(--color-surface-hover)'
                              : 'transparent',
                          color: 'var(--color-text-primary)',
                          borderBottom: i < filteredStaff.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
                        }}
                      >
                        <div className="flex items-center gap-3">
                          {/* Avatar circle */}
                          <div
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold uppercase"
                            style={{
                              backgroundColor: 'var(--color-accent-glow)',
                              color: 'var(--color-accent-primary)',
                              border: '1px solid var(--color-border-accent)',
                            }}
                          >
                            {staff.name.charAt(0)}
                          </div>
                          <span className="font-medium">{staff.name}</span>
                        </div>
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                          style={{
                            color: roleColor(staff.role),
                            backgroundColor: `color-mix(in srgb, ${roleColor(staff.role)} 10%, transparent)`,
                          }}
                        >
                          {roleLabel(staff.role)}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            <div>
              <label
                htmlFor="pin-input"
                className="mb-1.5 block text-xs font-medium uppercase tracking-wider"
                style={{ color: 'var(--color-text-muted)' }}
              >
                PIN
              </label>
              <input
                ref={pinRef}
                id="pin-input"
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                disabled={isLoading}
                placeholder="••••••"
                className="h-11 w-full rounded-lg border px-4 text-sm tracking-[0.3em] transition-all duration-200"
                style={{
                  backgroundColor: 'var(--color-surface-input)',
                  borderColor: 'var(--color-border-default)',
                  color: 'var(--color-text-primary)',
                  fontFamily: 'var(--font-display)',
                }}
              />
            </div>

            <button
              type="submit"
              disabled={isLoading || (!selectedStaff && !staffLookup.trim()) || pin.length < 4}
              className="mt-2 h-11 w-full rounded-lg text-sm font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                backgroundColor: 'var(--color-accent-primary)',
                color: 'var(--color-text-inverse)',
              }}
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
                  </svg>
                  Signing in…
                </span>
              ) : (
                'Sign In'
              )}
            </button>
          </form>
        </div>
      </div>

      {/* Right: Branding Panel */}
      <div
        className="relative hidden w-[45%] items-center justify-center overflow-hidden lg:flex"
        style={{ backgroundColor: 'var(--color-surface-raised)' }}
      >
        {/* Grid pattern background */}
        <div className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `
              linear-gradient(var(--color-accent-primary) 1px, transparent 1px),
              linear-gradient(90deg, var(--color-accent-primary) 1px, transparent 1px)
            `,
            backgroundSize: '40px 40px',
          }}
        />

        {/* Glow effect */}
        <div
          className="absolute left-1/2 top-1/2 h-[400px] w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[120px]"
          style={{ backgroundColor: 'var(--color-accent-glow)' }}
        />

        {/* Content */}
        <div className="relative z-10 flex flex-col items-center gap-8 px-12 text-center">
          <div
            className="flex h-24 w-24 items-center justify-center rounded-2xl"
            style={{
              backgroundColor: 'rgba(0, 212, 255, 0.05)',
              border: '1px solid var(--color-border-accent)',
              boxShadow: '0 0 40px var(--color-accent-glow)',
            }}
          >
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>

          <div>
            <h2
              className="text-3xl font-extrabold tracking-tight"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}
            >
              The Clubs
            </h2>
            <p className="mt-2 text-base" style={{ color: 'var(--color-text-muted)' }}>
              {appTitle}
            </p>
          </div>

          <div className="h-px w-20" style={{ background: 'linear-gradient(to right, transparent, var(--color-border-strong), transparent)' }} />

          <p className="max-w-[280px] text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
            Manage check-ins, rentals, upgrades, and customer accounts — all from one place.
          </p>
        </div>
      </div>
    </div>
  );
}
