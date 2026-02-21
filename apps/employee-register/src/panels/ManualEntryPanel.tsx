import { Button } from '@the-clubs/ui';
import { useRegisterStore } from '../stores/useRegisterStore';
import { PanelHeader } from '../views/PanelHeader';
import { PanelShell } from '../views/PanelShell';

/* Reusable dark tech input styles */
const inputStyle: React.CSSProperties = {
  backgroundColor: 'var(--color-surface-input)',
  borderColor: 'var(--color-border-default)',
  color: 'var(--color-text-primary)',
};

const labelClass = 'mb-1.5 block text-sm font-medium';
const labelStyle: React.CSSProperties = { color: 'var(--color-text-secondary)' };
const requiredStyle: React.CSSProperties = { color: 'var(--color-status-error)' };

/* DOB helpers (from original utils) */
function extractDobDigits(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 8);
}

function formatDobMmDdYyyy(digits: string): string {
  if (!digits) return '';
  let formatted = digits.slice(0, 2);
  if (digits.length > 2) formatted += '/' + digits.slice(2, 4);
  if (digits.length > 4) formatted += '/' + digits.slice(4, 8);
  return formatted;
}

export function ManualEntryPanel() {
  const {
    handleManualSubmit,
    manualFirstName, setManualFirstName,
    manualLastName, setManualLastName,
    manualDobDigits, setManualDobDigits,
    manualDobIso,
    manualIdExpirationDigits, setManualIdExpirationDigits,
    manualIdExpirationIso,
    manualIdType, setManualIdType,
    manualIdTypeOther, setManualIdTypeOther,
    manualIdNumber, setManualIdNumber,
    isSubmitting, manualEntrySubmitting,
    setManualEntry, selectNavTab,
  } = useRegisterStore();

  const submitDisabled =
    isSubmitting ||
    manualEntrySubmitting ||
    !manualFirstName.trim() ||
    !manualLastName.trim() ||
    !manualDobIso ||
    !manualIdExpirationIso ||
    !manualIdType ||
    (manualIdType === 'OTHER' && !manualIdTypeOther.trim());

  return (
    <PanelShell as="form" align="top" onSubmit={(e: React.FormEvent) => void handleManualSubmit(e)}>
      <PanelHeader
        title="First Time Customer"
        subtitle="Enter customer details from alternate ID."
      />

      <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4">
        {/* First Name */}
        <div>
          <label htmlFor="manualFirstName" className={labelClass} style={labelStyle}>
            First Name <span style={requiredStyle}>*</span>
          </label>
          <input id="manualFirstName" type="text" className="h-11 w-full rounded-lg border px-4 text-sm" style={inputStyle}
            value={manualFirstName} onChange={(e) => setManualFirstName(e.target.value)}
            placeholder="Enter first name" disabled={isSubmitting} required autoComplete="given-name"
          />
        </div>

        {/* Last Name */}
        <div>
          <label htmlFor="manualLastName" className={labelClass} style={labelStyle}>
            Last Name <span style={requiredStyle}>*</span>
          </label>
          <input id="manualLastName" type="text" className="h-11 w-full rounded-lg border px-4 text-sm" style={inputStyle}
            value={manualLastName} onChange={(e) => setManualLastName(e.target.value)}
            placeholder="Enter last name" disabled={isSubmitting} required autoComplete="family-name"
          />
        </div>

        {/* DOB */}
        <div>
          <label htmlFor="manualDob" className={labelClass} style={labelStyle}>
            Date of Birth <span style={requiredStyle}>*</span>
          </label>
          <input id="manualDob" type="text" inputMode="numeric" className="h-11 w-full rounded-lg border px-4 text-sm" style={inputStyle}
            value={formatDobMmDdYyyy(manualDobDigits)}
            onChange={(e) => setManualDobDigits(extractDobDigits(e.target.value))}
            placeholder="MM/DD/YYYY" disabled={isSubmitting} required autoComplete="bday"
          />
        </div>

        {/* ID Type */}
        <div>
          <label htmlFor="manualIdType" className={labelClass} style={labelStyle}>
            ID Type <span style={requiredStyle}>*</span>
          </label>
          <select id="manualIdType" className="h-11 w-full appearance-none rounded-lg border px-4 text-sm" style={inputStyle}
            value={manualIdType}
            onChange={(e) => {
              const next = e.target.value;
              setManualIdType(next);
              if (next !== 'OTHER') setManualIdTypeOther('');
            }}
            disabled={isSubmitting} required
          >
            <option value="" disabled>Select ID type</option>
            <option value="STATE_ID">State ID</option>
            <option value="DRIVERS_LICENSE">Drivers License</option>
            <option value="PASSPORT">Passport</option>
            <option value="OTHER">Other</option>
          </select>
        </div>

        {/* ID Type Other */}
        {manualIdType === 'OTHER' ? (
          <div className="col-span-2">
            <label htmlFor="manualIdTypeOther" className={labelClass} style={labelStyle}>
              Specify ID Type <span style={requiredStyle}>*</span>
            </label>
            <input id="manualIdTypeOther" type="text" className="h-11 w-full rounded-lg border px-4 text-sm" style={inputStyle}
              value={manualIdTypeOther} onChange={(e) => setManualIdTypeOther(e.target.value)}
              placeholder="Enter ID type" disabled={isSubmitting} required
            />
          </div>
        ) : null}

        {/* ID Number */}
        <div>
          <label htmlFor="manualIdNumber" className={labelClass} style={labelStyle}>
            License / ID Number
          </label>
          <input id="manualIdNumber" type="text" className="h-11 w-full rounded-lg border px-4 text-sm" style={inputStyle}
            value={manualIdNumber} onChange={(e) => setManualIdNumber(e.target.value)}
            placeholder="Enter license or ID number" disabled={isSubmitting}
          />
        </div>

        {/* ID Expiration */}
        <div>
          <label htmlFor="manualIdExpiration" className={labelClass} style={labelStyle}>
            ID Expiration Date <span style={requiredStyle}>*</span>
          </label>
          <input id="manualIdExpiration" type="text" inputMode="numeric" className="h-11 w-full rounded-lg border px-4 text-sm" style={inputStyle}
            value={formatDobMmDdYyyy(manualIdExpirationDigits)}
            onChange={(e) => setManualIdExpirationDigits(extractDobDigits(e.target.value))}
            placeholder="MM/DD/YYYY" disabled={isSubmitting} required
          />
        </div>
      </div>

      {/* Actions */}
      <div className="mt-6 flex justify-end gap-3">
        <Button type="submit" disabled={submitDisabled}>
          {isSubmitting || manualEntrySubmitting ? 'Submitting…' : 'Add Customer'}
        </Button>
        <Button variant="danger" disabled={isSubmitting || manualEntrySubmitting}
          onClick={() => {
            setManualEntry(false);
            setManualFirstName(''); setManualLastName('');
            setManualDobDigits(''); setManualIdExpirationDigits('');
            setManualIdType(''); setManualIdTypeOther('');
            setManualIdNumber(''); selectNavTab('scan');
          }}
        >
          Cancel
        </Button>
      </div>
    </PanelShell>
  );
}
