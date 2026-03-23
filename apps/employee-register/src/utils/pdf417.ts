export function parseAAMVAPdf417(data: string): Record<string, string> | null {
  if (!data.includes('ANSI')) return null;

  const extract = (code: string) => {
    // The code is 3 letters (e.g., DAC). AAMVA separates lines with CR or LF.
    const regex = new RegExp(String.raw`[\r\n]+${code}([^\r\n]+)`);
    const match = regex.exec(data);
    // fallback if no robust newline prefix exists in partial read
    if (!match) {
        const fallbackRegex = new RegExp(String.raw`${code}([^\r\n]+)`);
        const fallbackMatch = fallbackRegex.exec(data);
        return fallbackMatch ? fallbackMatch[1].trim() : undefined;
    }
    return match ? match[1].trim() : undefined;
  };

  const firstName = extract('DAC') || extract('DCT');
  const lastName = extract('DCS') || extract('DCA');
  const dobRaw = extract('DBB');
  const address = extract('DAG');
  const city = extract('DAI');
  const state = extract('DAJ');
  const zip = extract('DAK');
  const idNumber = extract('DAQ');
  const expRaw = extract('DBA');

  // Dates might arrive as MMDDYYYY or YYYYMMDD without delimiters.
  const formatDate = (raw?: string) => {
    if (!raw) return undefined;
    raw = raw.replaceAll(/\D/g, ''); // strip non-digits
    if (raw.length === 8) {
       // if it starts with 19 or 20, assume YYYYMMDD
       if (raw.startsWith('19') || raw.startsWith('20')) {
           return `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
       } else {
           // MMDDYYYY -> YYYY-MM-DD
           return `${raw.slice(4,8)}-${raw.slice(0,2)}-${raw.slice(2,4)}`;
       }
    }
    return raw;
  }

  const dob = formatDate(dobRaw);
  const exp = formatDate(expRaw);
  
  if (!firstName && !lastName && !idNumber) return null;

  return {
    ...(firstName && { firstName }),
    ...(lastName && { lastName }),
    ...(dob && { dob }),
    ...(address && { address }),
    ...(city && { city }),
    ...(state && { state }),
    ...(zip && { zip }),
    ...(idNumber && { idNumber }),
    ...(exp && { idExpirationDate: exp })
  };
}
