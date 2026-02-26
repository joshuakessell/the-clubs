import { Spinner } from '@the-clubs/ui';

/**
 * Centered loading spinner for dashboard views.
 * Replaces 13 duplicate inline spinner `<div>` elements (Vercel rule 6.3).
 */
export function ViewSpinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <Spinner />
    </div>
  );
}
