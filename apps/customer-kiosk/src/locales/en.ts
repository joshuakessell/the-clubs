// Customer Kiosk locale (English)
//
// Add new UI strings here first, then add the same key to `es.ts`.
// Key convention:
// - `common.*` for shared/common UI
// - `a11y.*` for accessibility labels
// - `orientation.*`, `membership.*`, `selection.*`, `waitlist.*`, `upgrade.*`, `renewal.*`, `payment.*`
//
// Prefer sentence keys with simple `{param}` placeholders.
import { AGREEMENT_LEGAL_BODY_HTML_BY_LANG } from '@the-clubs/shared';

export const en = {
  // Brand / a11y
  'brand.clubName': 'Club Dallas',
  'a11y.welcomeDialog': 'Welcome',
  'a11y.signatureDialog': 'Signature',

  // Welcome
  welcome: 'Welcome',
  'selection.welcomeWithName': 'Welcome, {name}',

  // Language selection
  selectLanguage: 'Select Language / Seleccione Idioma',
  english: 'English',
  spanish: 'Español',

  // Lane selection
  'lane.selectTitle': 'Select Lane',
  'lane.selectSubtitle': 'Choose your register to begin.',
  'lane.lane1': 'Lane 1',
  'lane.lane2': 'Lane 2',
  'lane.register1': 'Register 1',
  'lane.register2': 'Register 2',

  // Orientation
  'orientation.title': 'Portrait mode required',
  'orientation.body': 'Please rotate the device to portrait to continue.',

  // Common
  'common.ok': 'OK',
  'common.cancel': 'Cancel',
  'common.accept': 'Accept',
  'common.decline': 'Decline',
  'common.you': 'You',
  'common.staff': 'Staff',
  'idScan.expired.title': 'ID Expired',
  'idScan.expired.body': 'This ID is expired. Please provide an unexpired ID.',
  'idScan.underage.title': 'Under 18',
  'idScan.underage.body':
    'Customer is under 18. Please provide an ID showing they are 18 or older.',
  'kiosk.locked.title': 'Please see attendant',
  'kiosk.locked.body':
    'This lane is still being completed. Please see attendant to finish checkout.',

  // Past due
  pastDueBlocked: 'Please see the front desk to resolve your balance.',

  // Payment
  paymentPending: 'Please provide cash or card to the employee to process your payment.',
  'payment.charges': 'Charges',
  totalDue: 'Total Due',
  paymentIssueSeeAttendant: 'Payment issue — please see attendant',

  // Agreement
  agreementTitle: 'Club Agreement',
  agreementPlaceholder: 'Agreement content will be displayed here.',
  scrollRequired: 'Please scroll to the bottom of the agreement to continue.',
  iAgree: 'I agree',
  signatureRequired: 'Signature required to continue',
  'agreement.readAndScrollToContinue':
    'Read the agreement, and scroll to the bottom to continue...',
  'agreement.pleaseCheckToContinue': 'Please check to continue',
  'agreement.tapToSign': 'Tap to Sign',
  'agreement.signed': 'Signed',
  'agreement.sign': 'Sign',
  'agreement.legalBodyHtml': AGREEMENT_LEGAL_BODY_HTML_BY_LANG.EN,
  clear: 'Clear',
  submit: 'Submit',
  submitting: 'Submitting...',

  // Assignment / completion
  thankYou: 'Thank you!',
  assignmentComplete: 'Your check-in is being processed...',
  room: 'Room',
  checkoutAt: 'Checkout Time',

  // Selection state
  proposed: 'Proposed',
  selected: 'Selected',
  confirmSelection: 'Confirm Selection',
  confirming: 'Confirming...',
  acknowledge: 'Acknowledge',
  acknowledging: 'Acknowledging...',
  staffHasLocked: 'Staff has locked this selection. Please acknowledge to continue.',
  'selection.staffSuggestionHint': 'Staff suggestion — tap the highlighted option to accept',
  'selection.yourSelectionWaiting': 'Your selection — waiting for staff to confirm',
  'guidance.pleaseSelectOne': 'Please select one',
  'selection.pendingApproval': 'Waiting for approval',

  // Membership section
  'membership.level': 'Membership Level:',
  'membership.member': 'Member',
  'membership.nonMember': 'Non-Member',
  'membership.expired': 'Expired',
  'membership.purchase6Month': 'Purchase 6 Month Membership',
  'membership.renewMembership': 'Renew Membership',
  'membership.ctaSeeStaffPurchase': 'Please see the employee to purchase membership.',
  'membership.ctaSeeStaffRenew': 'Please see the employee to renew membership.',
  'membership.pending': 'Pending Membership',
  'membership.modal.title': 'Membership',
  'membership.modal.body.purchase':
    'Save on daily membership fees with a 6-month membership. Ask the employee about current 6-month membership pricing.',
  'membership.modal.body.renew':
    'Save on daily membership fees with a 6-month membership. Ask the employee about current 6-month membership renewal pricing.',
  'common.continue': 'Continue',

  // Purchase cards (Selection)
  'membership.pleaseSelectOne': 'Please select one',
  'membership.oneTimeOption': 'One-time Membership',
  'membership.sixMonthOption': '6-Month Membership',
  'membership.thankYouMember': 'Thank you for being a member.',
  'membership.expiresOn': 'Your membership expires on {date}.',
  'rental.title': 'Rental',

  // Experience section
  'experience.choose': 'Choose your experience:',

  // Availability
  limitedAvailability: 'Limited: only {count} left',
  unavailable: 'Currently unavailable - Tap to join waitlist',
  'availability.onlyAvailable': 'Only {count} available',
  'availability.unavailable': 'Unavailable',
  'availability.joinWaitlist': 'Join the waiting list',

  // Rental types (display)
  locker: 'Locker',
  regularRoom: 'Regular Room',
  doubleRoom: 'Double Room',
  specialRoom: 'Special Room',
  gymLocker: 'Gym Locker',
  'rental.standardDisplay': 'Private Dressing Room',
  'rental.doubleDisplay': 'Double Dressing Room',
  'rental.specialDisplay': 'Special Dressing Room',

  // Waitlist
  'waitlist.modalTitle': 'None Available - Join Waiting List?',
  'waitlist.currentlyUnavailable': '{rental} is currently unavailable.',
  'waitlist.infoTitle': 'Waitlist Information:',
  'waitlist.position': 'Position',
  'waitlist.estimatedReady': 'Estimated Ready',
  'waitlist.unknown': 'Unknown',
  'waitlist.upgradeFee': 'Upgrade Fee',
  'waitlist.instructions':
    'To join the waitlist, please select a backup rental that is available now.',
  'waitlist.noteChargedBackup':
    'You will be charged for the backup rental. If an upgrade becomes available, you may accept it (upgrade fees apply).',
  'waitlist.joinButton': 'Join the Waiting List',
  'waitlist.selectDesired': 'Choose room types to wait for',
  'waitlist.requestSpecific': 'Or request a specific room/locker number',
  'waitlist.requestSpecificPlaceholder': 'Select a specific number (optional)',
  'waitlist.nextToBackup': 'Next: choose backup rental',
  'waitlist.backToPreferences': 'Back',
  'waitlist.selectBackup': 'Select backup rental:',
  'waitlist.unavailableSuffix': '(Unavailable)',

  // Upgrade disclaimer
  'upgrade.title': 'Upgrade Disclaimer',
  'upgrade.bullet.feesApplyToRemaining':
    'Upgrade fees apply only to remaining time in your current stay.',
  'upgrade.bullet.noExtension':
    'Upgrades do not extend your stay. Your checkout time remains the same.',
  'upgrade.bullet.noRefunds': 'No refunds under any circumstances.',
  'upgrade.bullet.chargedWhenAccepted':
    'Upgrade fees are charged only when an upgrade becomes available and you choose to accept it.',

  // Staff selection confirmation
  'confirmDifferent.title': 'Staff Selected Different Option',
  'confirmDifferent.youRequested': 'You requested:',
  'confirmDifferent.staffSelected': 'Staff selected:',
  'confirmDifferent.question': 'Do you accept this selection?',

  // Renewal disclaimer
  'renewal.title': 'Renewal Notice',
  'renewal.bullet.extendsStay':
    'This renewal extends your stay for 6 hours from your current checkout time.',
  'renewal.currentCheckout': '(Current checkout: {time})',
  'renewal.bullet.approachingMax':
    '⚠️ You are approaching the 14-hour maximum stay for a single visit.',
  'renewal.bullet.finalExtension':
    'At the end of this 6-hour renewal, you may extend one final time for 2 additional hours (fee applies).',
  'renewal.bullet.feeNotChargedNow':
    'The fee is not charged now; it applies only if you choose the final 2-hour extension later.',

  // Errors (customer-friendly, generic)
  'error.loadAgreement': 'Failed to load agreement. Please try again.',
  'error.noActiveSession': 'No active session. Please wait for staff to start a session.',
  'error.processSelection': 'Failed to process selection. Please try again.',
  'error.process': 'Failed to process. Please try again.',
  'error.rentalNotAvailable':
    'This rental type is not available. Please select an available option.',
  'error.noUnavailableForWaitlist': 'No unavailable options right now.',
  'error.waitlistNeedsDesired': 'Choose at least one desired room type or a specific number.',
  'error.signAgreement': 'Failed to sign agreement. Please try again.',
  'error.setLanguage': 'Failed to set language. Please try again.',
  'error.confirmSelection': 'Failed to confirm selection. Please try again.',

  // Payment line item descriptions (client-side mapping for kiosk display)
  'lineItem.locker': 'Locker',
  'lineItem.gymLocker': 'Gym Locker',
  'lineItem.gymLockerNoCost': 'Gym Locker (no cost)',
  'lineItem.standardRoom': 'Standard Room',
  'lineItem.doubleRoom': 'Double Room',
  'lineItem.specialRoom': 'Special Room',
  'lineItem.membershipFee': 'Membership Fee',
  'lineItem.sixMonthMembership': '6 Month Membership',
  'lineItem.cardPayment': 'Card Payment',

  // Idle screen
  'idle.presentId': 'Please present a valid form of ID',
  'idle.readyForCheckin': 'Ready for check-in',

  // Add-ons screen
  'addons.title': 'Add-Ons',
  'addons.subtitle': 'Would you like to add anything to your visit?',
  'addons.noneAvailable': 'No add-ons available right now.',
  'addons.total': 'Add-on total',
  'addons.noThanks': 'No Thanks',
  'addons.adding': 'Adding…',
  'addons.addAndContinue': 'Add & Continue',

  // Payment screen extras
  'payment.yourCharges': 'Your Charges',
  'payment.insertOrTapCard': 'Insert or tap card on terminal',
  'payment.waitingForPayment': 'Waiting for payment...',
  'payment.processing': 'Processing…',
  'payment.demoPayCard': 'Demo: Pay Card',
  'payment.splitPayment': 'Split Payment',
  'payment.demoPayCash': 'Demo: Pay Cash',
  'payment.splitCardSubtitle': 'Enter card portion — the rest will be collected as cash.',
  'payment.cardAmount': 'Card Amount',
  'payment.cashRemaining': 'Cash remaining',
  'payment.payCardPortion': 'Pay Card Portion',

  // Agreement screen extras
  'agreement.facilityAgreement': 'Facility Agreement',
  'agreement.submitAgreement': 'Submit Agreement',
  'agreement.signBelow': 'Sign Below',
  'agreement.confirmSignature': 'Confirm Signature',

  // Complete screen
  'complete.allSet': "You're All Set!",
  'complete.allSetWithName': "You're All Set, {name}!",
  'complete.yourRoom': 'Your Room',
  'complete.yourLocker': 'Your Locker',
  'complete.checkoutBy': 'Checkout By',
  'complete.today': 'Today',

  // Selection screen extras
  'selection.selectYourOption': 'Select Your Option',
  'selection.onlyLeft': 'Only {count} left',
  'waitlist.joinUpgradeWaitlist': 'Join Upgrade Waitlist',
  'waitlist.selectRoomTypes': "Select which room type(s) you'd like if they become available.",
  'waitlist.upgradeOptions': 'Upgrade Options',
  'waitlist.selectOptionForNow': 'Select Your Option for Now',
  'waitlist.notifiedWhenAvailable': "You'll be notified when your upgrade becomes available.",
  'waitlist.availableOptions': 'Available Options',
  'waitlist.available': 'available',
  'waitlist.disclaimer': 'To join the waitlist, you must rent a locker. Note: When an upgrade becomes available, you may accept it (upgrade fees apply, and are due at that time).',

  // General
  membership: 'Membership',
  noOptionsAvailable: 'No options available',
} as const;
