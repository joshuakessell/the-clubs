import { Spinner, useAuthStore } from '@the-clubs/ui';
import { useRegisterStore } from '../stores/useRegisterStore';
import { PanelHeader } from '../views/PanelHeader';
import { PanelShell } from '../views/PanelShell';

const inputStyle: React.CSSProperties = {
  backgroundColor: 'var(--color-surface-input)',
  borderColor: 'var(--color-border-default)',
  color: 'var(--color-text-primary)',
};

export function SearchPanel() {
  const {
    customerSearch,
    setCustomerSearch,
    customerSearchLoading,
    customerSuggestions,
    setCustomerSuggestions,
    openCustomerAccount,
    isSubmitting,
  } = useRegisterStore();
  const authToken = useAuthStore((s) => s.session?.sessionToken ?? null);

  return (
    <PanelShell align= "top" scroll = "hidden" >
      <PanelHeader
        layout="inline"
  spacing = "sm"
  title = {< label htmlFor = "customer-search" > Search Customer </label>
}
subtitle = "(type at least 3 letters)"
  />

  {/* Search input */ }
  < input
id = "customer-search"
type = "text"
className = "mt-3 h-11 w-full rounded-lg border px-4 text-xs"
style = { inputStyle }
value = { customerSearch }
onChange = {(e) => setCustomerSearch(e.target.value, authToken)}
placeholder = "Start typing name…"
disabled = { isSubmitting }
autoComplete = "off"
  />

  {/* Loading indicator */ }
{
  customerSearchLoading && (
    <div className="mt-2 flex items-center gap-2 text-sm" style = {{ color: 'var(--color-text-muted)' }
}>
  <Spinner size="sm" />
    Searching…
</div>
      )}

{/* Results list */ }
{
  customerSuggestions.length > 0 && (
    <div className="mt-3 flex-1 overflow-y-auto rounded-lg border" style = {{ borderColor: 'var(--color-border-default)' }
}>
{
  customerSuggestions.map((s) => {
    const label = `${s.lastName}, ${s.firstName}`;
    return (
      <button
                key= { s.id }
    type = "button"
    className = "flex w-full items-center justify-between gap-3 border-b px-4 py-3 text-left transition"
    style = {{ borderColor: 'var(--color-border-subtle)' }
  }
                onMouseEnter = {(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface-overlay)';
}}
onMouseLeave = {(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
onClick = {() => {
  openCustomerAccount(s.id, label, {
    autoStart: true,
    authToken,
    summary: {
      name: `${s.firstName} ${s.lastName}`.trim(),
      dobMonthDay: s.dobMonthDay,
      membershipNumber: s.membershipNumber,
    },
  });
  setCustomerSearch('');
  setCustomerSuggestions([]);
}}
              >
  <span className="text-sm font-semibold" style = {{ color: 'var(--color-text-primary)' }}>
    { label }
    </span>
    < span className = "flex flex-wrap gap-3 text-xs" style = {{ color: 'var(--color-text-muted)' }}>
      { s.dobMonthDay && <span>DOB: { s.dobMonthDay } </span>}
{ s.membershipNumber && <span>Membership: { s.membershipNumber } </span> }
</span>
  </button>
            );
          })}
</div>
      )}
</PanelShell>
  );
}
