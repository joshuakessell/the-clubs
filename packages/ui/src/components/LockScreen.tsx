import { useState, useEffect, useRef, useCallback, type FormEvent, type KeyboardEvent, type ClipboardEvent } from 'react';
import { useAuthStore, type StaffSession } from '../stores/authStore';
import { getApiUrl } from '@the-clubs/shared';

interface StaffMember {
  id: string;
  name: string;
  role: string;
}

interface LockScreenProps {
  appTitle?: string;
  onLogin?: (session: StaffSession) => void;
}

/** Light themes use the black logo; dark themes use the white logo. */
const LIGHT_THEMES = new Set(['theme-arctic-bloom', 'theme-solar-flare']);

export function LockScreen({ appTitle = 'Operations', onLogin }: LockScreenProps) {
  const { deviceId, setSession } = useAuthStore();
  const [pinDigits, setPinDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Staff picker state (select-only, no search)
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null);
  const [isLoadingStaff, setIsLoadingStaff] = useState(true);

  // Theme detection for logo
  const [isLightTheme, setIsLightTheme] = useState(() =>
    LIGHT_THEMES.has(document.documentElement.getAttribute('data-theme') ?? '')
  );

  const dropdownRef = useRef<HTMLDivElement>(null);
  const pinRefs = useRef<(HTMLInputElement | null)[]>([]);

  const PIN_LENGTH = 6;

  // Watch for theme changes
  useEffect(() => {
    const update = () =>
      setIsLightTheme(LIGHT_THEMES.has(document.documentElement.getAttribute('data-theme') ?? ''));
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  // Fetch staff list on mount
  useEffect(() => {
    const fetchStaff = async () => {
      try {
        const res = await fetch(getApiUrl('/api/v1/auth/staff'));
        if (res.ok) {
          const data: { staff: StaffMember[] } = await res.json();
          setStaffList(data.staff);
        }
      } catch {
        // Silently fail
      } finally {
        setIsLoadingStaff(false);
      }
    };
    void fetchStaff();
  }, []);

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

  const selectStaff = useCallback((staff: StaffMember) => {
    setSelectedStaff(staff);
    setIsDropdownOpen(false);
    setError(null);
    // Focus the first PIN digit
    setTimeout(() => pinRefs.current[0]?.focus(), 50);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isDropdownOpen || staffList.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev < staffList.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : staffList.length - 1));
    } else if (e.key === 'Enter' && highlightedIndex >= 0) {
      e.preventDefault();
      selectStaff(staffList[highlightedIndex]!);
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

  // --- PIN digit handlers ---
  const clearPin = useCallback(() => {
    setPinDigits(['', '', '', '', '', '']);
    setTimeout(() => pinRefs.current[0]?.focus(), 30);
  }, []);

  const submitRef = useRef<(pin: string) => void>(() => { });

  const handleDigitChange = useCallback((index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    setPinDigits((prev) => {
      const next = [...prev];
      next[index] = digit;
      if (digit && index === PIN_LENGTH - 1 && next.every((d) => d !== '')) {
        setTimeout(() => submitRef.current(next.join('')), 0);
      }
      return next;
    });
    if (digit && index < PIN_LENGTH - 1) {
      pinRefs.current[index + 1]?.focus();
    }
  }, []);

  const handleDigitKeyDown = useCallback((index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      setPinDigits((prev) => {
        const next = [...prev];
        if (next[index]) {
          next[index] = '';
        } else if (index > 0) {
          next[index - 1] = '';
          setTimeout(() => pinRefs.current[index - 1]?.focus(), 0);
        }
        return next;
      });
    } else if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault();
      pinRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < PIN_LENGTH - 1) {
      e.preventDefault();
      pinRefs.current[index + 1]?.focus();
    }
  }, []);

  const handlePaste = useCallback((e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, PIN_LENGTH);
    if (!pasted) return;
    const next = ['', '', '', '', '', ''];
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i]!;
    setPinDigits(next);
    const focusIdx = Math.min(pasted.length, PIN_LENGTH - 1);
    setTimeout(() => pinRefs.current[focusIdx]?.focus(), 0);
    if (pasted.length === PIN_LENGTH) {
      setTimeout(() => submitRef.current(pasted), 0);
    }
  }, []);

  const handlePinSubmit = async (e?: FormEvent, pinOverride?: string) => {
    e?.preventDefault();
    const lookup = selectedStaff?.name;
    const pinValue = pinOverride ?? pinDigits.join('');
    if (!lookup || pinValue.length < PIN_LENGTH) {
      setError('Please select a staff member and enter your PIN');
      return;
    }

    // Module-level guard: React StrictMode double-mounts in dev, causing two
    // concurrent login calls before isLoading state can update synchronously.
    if (isLoading) return;
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(getApiUrl('/api/v1/auth/login-pin'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffLookup: lookup, deviceId, pin: pinValue }),
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
      clearPin();
      setSelectedStaff(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid credentials');
      clearPin();
    } finally {
      setIsLoading(false);
    }
  };

  submitRef.current = (pin: string) => void handlePinSubmit(undefined, pin);

  const roleLabel = (role: string) => {
    const labels: Record<string, string> = { admin: 'Admin', manager: 'Manager', staff: 'Staff', trainee: 'Trainee' };
    return labels[role.toLowerCase()] || role;
  };

  const roleColor = (role: string) => {
    const r = role.toLowerCase();
    if (r === 'admin') return 'var(--color-status-error)';
    if (r === 'manager') return 'var(--color-accent-primary)';
    return 'var(--color-text-muted)';
  };

  const logoSrc = isLightTheme ? '/club-dallas-logo-black.svg' : '/club-dallas-logo.svg';

  return (
    <div className= "fixed inset-0 z-[9999] flex" style = {{ backgroundColor: 'var(--color-surface-base)' }
}>
  {/* Left: Login Form */ }
  < div className = "flex flex-1 flex-col items-center justify-center px-8 py-12" >
    <div className="w-full max-w-sm" >
      {/* Title */ }
      < div className = "mb-10" >
        <h1
className = "text-2xl font-bold tracking-tight"
style = {{ fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}
            >
  Staff Login
    </h1>
    < p className = "mt-1 text-sm" style = {{ color: 'var(--color-text-muted)' }}>
      Sign in to { appTitle }
</p>
  </div>

{/* Error */ }
{
  error && (
    <div
              className="mb-4 rounded-lg border px-4 py-3 text-sm"
  style = {{
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
      borderColor: 'rgba(239, 68, 68, 0.2)',
        color: 'var(--color-status-error)',
              }
}
            >
  { error }
  </div>
          )}

{/* Form */ }
<form onSubmit={ (e) => void handlePinSubmit(e) } className = "flex flex-col gap-4" >
  {/* Staff Select Dropdown (no search) */ }
  < div ref = { dropdownRef } className = "relative" >
    <label
                className="mb-1.5 block text-xs font-medium uppercase tracking-wider"
style = {{ color: 'var(--color-text-muted)' }}
              >
  Staff Member
    </label>
    < button
type = "button"
onClick = {() => setIsDropdownOpen(!isDropdownOpen)}
onKeyDown = { handleKeyDown }
disabled = { isLoading || isLoadingStaff}
className = "flex h-11 w-full items-center justify-between rounded-lg border px-4 text-sm transition-all duration-200"
style = {{
  backgroundColor: 'var(--color-surface-input)',
    borderColor: isDropdownOpen ? 'var(--color-accent-primary)' : 'var(--color-border-default)',
      color: selectedStaff ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
        boxShadow: isDropdownOpen ? '0 0 0 2px var(--color-accent-glow)' : 'none',
                }}
role = "combobox"
aria-expanded={ isDropdownOpen }
aria-controls="staff-listbox"
aria-haspopup="listbox"
  >
  <span>{ isLoadingStaff? 'Loading staff…': selectedStaff ? selectedStaff.name : 'Select staff member…' } </span>
  < svg
width = "16" height = "16" viewBox = "0 0 24 24" fill = "none" stroke = "currentColor"
strokeWidth = "2" strokeLinecap = "round" strokeLinejoin = "round"
style = {{ transform: isDropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}
                >
  <path d="M6 9l6 6 6-6" />
    </svg>
    </button>

{/* Dropdown list */ }
{
  isDropdownOpen && !isLoadingStaff && (
    <div
                  id="staff-listbox"
  role = "listbox"
  className = "absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border shadow-xl"
  style = {{
    backgroundColor: 'var(--color-surface-raised)',
      borderColor: 'var(--color-border-default)',
        maxHeight: '240px',
          overflowY: 'auto',
                  }
}
                >
{
  staffList.length === 0 ? (
    <div className= "px-4 py-3 text-sm" style={{ color: 'var(--color-text-muted)' }}>
      No staff found
        </div>
                  ) : (
  staffList.map((staff, i) => (
    <button
                        key= { staff.id }
                        id = {`staff-option-${i}`}
    type = "button"
                        role = "option"
                        aria-selected={ selectedStaff?.id === staff.id}
    onClick = {() => selectStaff(staff)}
    onMouseEnter = {() => setHighlightedIndex(i)}
    className = "flex w-full items-center justify-between px-4 py-2.5 text-left text-sm transition-colors duration-100"
                        style = {{
    backgroundColor:
      selectedStaff?.id === staff.id
        ? 'var(--color-accent-glow)'
        : highlightedIndex === i
          ? 'var(--color-surface-hover)'
          : 'transparent',
    color: 'var(--color-text-primary)',
    borderBottom: i < staffList.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
  }}
                      >
    <div className="flex items-center gap-3" >
  <div
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold uppercase"
                            style = {{
    backgroundColor: 'var(--color-accent-glow)',
    color: 'var(--color-accent-primary)',
    border: '1px solid var(--color-border-accent)',
  }}
                          >
    { staff.name.charAt(0) }
    </div>
    < span className = "font-medium" > { staff.name } </span>
    </div>
    < span
                          className = "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                          style = {{
    color: roleColor(staff.role),
    backgroundColor: `color-mix(in srgb, ${roleColor(staff.role)} 10%, transparent)`,
  }}
                        >
    { roleLabel(staff.role)}
</span>
  </button>
                    ))
                  )}
</div>
              )}
</div>

{/* PIN — 6 individual digit boxes */ }
<div>
  <label
                className="mb-1.5 block text-xs font-medium uppercase tracking-wider"
style = {{ color: 'var(--color-text-muted)' }}
              >
  PIN
  </label>
  < div className = "flex items-center justify-between gap-2" >
  {
    pinDigits.map((digit, i) => (
      <input
                    key= { i }
                    ref = {(el) => { pinRefs.current[i] = el; }}
type = "text"
inputMode = "numeric"
autoComplete = "off"
maxLength = { 1}
value = { digit }
onChange = {(e) => handleDigitChange(i, e.target.value)}
onKeyDown = {(e) => handleDigitKeyDown(i, e)}
onPaste = { i === 0 ? handlePaste : undefined}
onFocus = {(e) => e.target.select()}
disabled = { isLoading }
aria-label={ `PIN digit ${i + 1}` }
className = "h-12 w-12 rounded-lg border text-center text-lg font-bold transition-all duration-200 outline-none"
style = {{
  backgroundColor: 'var(--color-surface-input)',
    borderColor: digit ? 'var(--color-accent-primary)' : 'var(--color-border-default)',
      color: 'var(--color-text-primary)',
        fontFamily: 'var(--font-display)',
            boxShadow: digit ? '0 0 0 1px var(--color-accent-glow)' : 'none',
              caretColor: 'transparent',
              ...({ WebkitTextSecurity: 'disc' } as React.CSSProperties),
                    }}
                  />
                ))}
</div>
  </div>

{/* Loading indicator */ }
{
  isLoading && (
    <div className="mt-2 flex items-center justify-center gap-2" >
      <svg className="h-4 w-4 animate-spin" viewBox = "0 0 24 24" fill = "none" >
        <circle className="opacity-25" cx = "12" cy = "12" r = "10" stroke = "currentColor" strokeWidth = "4" />
          <path className="opacity-75" fill = "currentColor" d = "M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
            </svg>
            < span className = "text-sm" style = {{ color: 'var(--color-text-muted)' }
}> Signing in…</span>
  </div>
            )}
</form>
  </div>
  </div>

{/* Right: Branding Panel — matches Kiosk idle screen */}
<div
        className="relative hidden w-[45%] items-center justify-center overflow-hidden lg:flex"
style={{ backgroundColor: 'var(--color-surface-raised)' }}
      >
  {/* Content */}
  <div className="relative z-10 flex flex-col items-center gap-12 text-center p-12">
    {/* Animated glow ring + logo */}
    <div className="relative">
      <div
            className="absolute inset-6 rounded-full animate-pulse"
style={{
  boxShadow: '0 0 80px 30px var(--color-accent-glow)',
    opacity: 0.5,
            }}
          />
      <div className="relative flex items-center justify-center">
        <img
              src={logoSrc}
alt="Club Dallas"
width="200"
height="200"
style={{ width: 240, height: 240, objectFit: 'contain', filter: 'drop-shadow(0 0 20px var(--color-accent-glow))' }}
            />
      </div>
    </div>

    {/* Brand */}
    <div>
      <h2
            className="text-3xl font-extrabold tracking-tight uppercase"
style={{ fontFamily: 'var(--font-brand)', color: 'var(--color-text-primary)' }}
          >
        Club Dallas
          </h2>
          <p className="mt-4 text-xl" style={{ color: 'var(--color-text-secondary)' }}>
            {appTitle}
          </p>
    </div>

    {/* Status indicator */}
    <div
          className="flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-medium"
style={{
  backgroundColor: 'var(--color-surface-overlay)',
    color: 'var(--color-text-muted)',
      border: '1px solid var(--color-border-subtle)',
          }}
        >
      <div
            className="h-2 w-2 rounded-full animate-pulse"
style={{ backgroundColor: 'var(--color-status-success)' }}
          />
      Ready for Sign-in
    </div>
  </div>
</div>
      </div>
  );
}
