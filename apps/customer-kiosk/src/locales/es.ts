// Customer Kiosk locale (Spanish)
//
// Keep keys aligned with `en.ts`. If a key is missing here at runtime, the app will fall back to EN.
import { en } from './en';
import { AGREEMENT_LEGAL_BODY_HTML_BY_LANG } from '@the-clubs/shared';

export const es: Record<keyof typeof en, string> = {
  // Brand / a11y
  'brand.clubName': 'Club Dallas',
  'a11y.welcomeDialog': 'Bienvenido',
  'a11y.signatureDialog': 'Firma',

  // Welcome
  welcome: 'Bienvenido',
  'selection.welcomeWithName': 'Bienvenido, {name}',

  // Language selection
  selectLanguage: 'Elige idioma / Select Language',
  english: 'English',
  spanish: 'Español',

  // Lane selection
  'lane.selectTitle': 'Selecciona carril',
  'lane.selectSubtitle': 'Elige tu registro para comenzar.',
  'lane.lane1': 'Carril 1',
  'lane.lane2': 'Carril 2',
  'lane.register1': 'Registro 1',
  'lane.register2': 'Registro 2',

  // Orientation
  'orientation.title': 'Pon la pantalla vertical',
  'orientation.body': 'Gira la pantalla para seguir.',

  // Common
  'common.ok': 'OK',
  'common.cancel': 'Cancelar',
  'common.accept': 'Aceptar',
  'common.decline': 'No acepto',
  'common.you': 'Tú',
  'common.staff': 'Staff',
  'idScan.expired.title': 'ID vencida',
  'idScan.expired.body': 'Esta identificación está vencida. Presenta una identificación vigente.',
  'idScan.underage.title': 'Menor de 18',
  'idScan.underage.body':
    'El cliente es menor de 18 años. Presenta una identificación que muestre que tiene 18 o más.',
  'kiosk.locked.title': 'Ve con el empleado',
  'kiosk.locked.body': 'Este carril sigue en proceso. Ve con el empleado para terminar.',

  // Past due
  pastDueBlocked: 'Pasa a caja para arreglar tu saldo.',

  // Payment
  paymentPending: 'Paga con el empleado',
  'payment.charges': 'Cargos',
  totalDue: 'Total',
  paymentIssueSeeAttendant: 'Problema con el pago — ve con el empleado',

  // Agreement
  agreementTitle: 'Acuerdo del Club',
  agreementPlaceholder: 'Aquí va el acuerdo.',
  scrollRequired: 'Desliza hasta el final para seguir.',
  iAgree: 'Acepto',
  signatureRequired: 'Firma para continuar',
  'agreement.readAndScrollToContinue': 'Lee el acuerdo y baja hasta el final para continuar…',
  'agreement.pleaseCheckToContinue': 'Marca la casilla para continuar',
  'agreement.tapToSign': 'Toca para firmar',
  'agreement.signed': 'Firmado',
  'agreement.sign': 'Firmar',
  'agreement.legalBodyHtml': AGREEMENT_LEGAL_BODY_HTML_BY_LANG.ES,
  clear: 'Limpiar',
  submit: 'Enviar',
  submitting: 'Enviando…',

  // Assignment / completion
  thankYou: '¡Gracias!',
  assignmentComplete: 'Estamos procesando tu entrada…',
  room: 'Cuarto',
  checkoutAt: 'Hora de salida',

  // Selection state
  proposed: 'Propuesto',
  selected: 'Seleccionado',
  confirmSelection: 'Confirmar',
  confirming: 'Confirmando...',
  acknowledge: 'Entendido',
  acknowledging: 'Entendido…',
  staffHasLocked: 'El staff ya bloqueó esta opción. Toca Entendido para seguir.',
  'selection.staffSuggestionHint': 'Sugerencia del staff — toca la opción marcada para aceptar',
  'selection.yourSelectionWaiting': 'Tu elección — esperando confirmación del staff',
  'guidance.pleaseSelectOne': 'Elige una opción',
  'selection.pendingApproval': 'Esperando approbación',

  // Membership section
  'membership.level': 'Nivel de membresía:',
  'membership.member': 'Miembro',
  'membership.nonMember': 'Sin membresía',
  'membership.expired': 'Vencida',
  'membership.purchase6Month': 'Membresía 6 meses',
  'membership.renewMembership': 'Renovar membresía',
  'membership.ctaSeeStaffPurchase': 'Pasa con el empleado para comprarla.',
  'membership.ctaSeeStaffRenew': 'Pasa con el empleado para renovarla.',
  'membership.pending': 'Membresía pendiente',
  'membership.modal.title': 'Membresía',
  'membership.modal.body.purchase':
    'Ahorra en la membresía por día con la membresía de 6 meses. Pregunta al empleado el precio actual de la membresía de 6 meses.',
  'membership.modal.body.renew':
    'Ahorra en la membresía por día con la renovación de 6 meses. Pregunta al empleado el precio actual de la renovación de 6 meses.',
  'common.continue': 'Continuar',

  // Purchase cards (Selection)
  'membership.pleaseSelectOne': 'Elige una',
  'membership.oneTimeOption': 'Membresía por día',
  'membership.sixMonthOption': 'Membresía 6 meses',
  'membership.thankYouMember': 'Gracias por ser miembro.',
  'membership.expiresOn': 'Vence el {date}.',
  'rental.title': 'Renta',

  // Experience section
  'experience.choose': 'Elige tu opción:',

  // Availability
  limitedAvailability: 'Quedan {count}',
  unavailable: 'No hay por ahora — toca para lista de espera',
  'availability.onlyAvailable': 'Solo {count} disponibles',
  'availability.unavailable': 'No disponible',
  'availability.joinWaitlist': 'Únete a la lista de espera',

  // Rental types (display)
  locker: 'Casillero',
  regularRoom: 'Habitación Regular',
  doubleRoom: 'Habitación Doble',
  specialRoom: 'Habitación Especial',
  gymLocker: 'Casillero del Gimnasio',
  'rental.standardDisplay': 'Vestidor privado',
  'rental.doubleDisplay': 'Vestidor deluxe',
  'rental.specialDisplay': 'Vestidor especial',

  // Waitlist
  'waitlist.modalTitle': 'No hay — ¿lista de espera?',
  'waitlist.currentlyUnavailable': 'No hay {rental} ahorita.',
  'waitlist.infoTitle': 'Datos de la lista:',
  'waitlist.position': 'Lugar',
  'waitlist.estimatedReady': 'Aprox. listo',
  'waitlist.unknown': 'Sin dato',
  'waitlist.upgradeFee': 'Costo de mejora',
  'waitlist.instructions': 'Para anotarte, elige una opción de respaldo disponible.',
  'waitlist.noteChargedBackup':
    'Se cobra el respaldo. Si sale una mejora, puedes aceptarla (aplica costo).',
  'waitlist.joinButton': 'Unirse a la lista de espera',
  'waitlist.selectDesired': 'Elige tipos de cuarto para esperar',
  'waitlist.requestSpecific': 'O solicita un número específico de cuarto/casillero',
  'waitlist.requestSpecificPlaceholder': 'Selecciona un número específico (opcional)',
  'waitlist.nextToBackup': 'Siguiente: elegir respaldo',
  'waitlist.backToPreferences': 'Atrás',
  'waitlist.selectBackup': 'Elige respaldo:',
  'waitlist.unavailableSuffix': '(No hay)',

  // Upgrade disclaimer
  'upgrade.title': 'Aviso de mejora',
  'upgrade.bullet.feesApplyToRemaining':
    'Las tarifas de mejora aplican solo al tiempo que te queda de tu visita.',
  'upgrade.bullet.noExtension':
    'Las mejoras no extienden tu visita. Tu hora de salida sigue igual.',
  'upgrade.bullet.noRefunds': 'No hay reembolsos bajo ninguna circunstancia.',
  'upgrade.bullet.chargedWhenAccepted':
    'Las tarifas de mejora se cobran solo cuando haya una mejora disponible y tú decidas aceptarla.',

  // Staff selection confirmation
  'confirmDifferent.title': 'El staff eligió otra opción',
  'confirmDifferent.youRequested': 'Tú pediste:',
  'confirmDifferent.staffSelected': 'El staff eligió:',
  'confirmDifferent.question': '¿Aceptas esta selección?',

  // Renewal disclaimer
  'renewal.title': 'Aviso de renovación',
  'renewal.bullet.extendsStay':
    'Esta renovación extiende tu visita 6 horas desde tu hora de salida actual.',
  'renewal.currentCheckout': '(Salida actual: {time})',
  'renewal.bullet.approachingMax':
    '⚠️ Te estás acercando al máximo de 14 horas de visita.',
  'renewal.bullet.finalExtension':
    'Al final de esta renovación de 6 horas, puedes extender una última vez por 2 horas más (aplica tarifa).',
  'renewal.bullet.feeNotChargedNow':
    'La tarifa no se cobra ahora; solo aplica si eliges la extensión final de 2 horas después.',

  // Errors
  'error.loadAgreement': 'No se pudo cargar el acuerdo. Intenta de nuevo.',
  'error.noActiveSession': 'No hay sesión activa. Espera a que el staff inicie una sesión.',
  'error.processSelection': 'No se pudo procesar. Intenta de nuevo.',
  'error.process': 'No se pudo procesar. Intenta de nuevo.',
  'error.rentalNotAvailable': 'No está disponible. Elige una opción disponible.',
  'error.noUnavailableForWaitlist': 'No hay opciones no disponibles en este momento.',
  'error.waitlistNeedsDesired':
    'Elige al menos un tipo de cuarto deseado o un número específico.',
  'error.signAgreement': 'No se pudo firmar. Intenta de nuevo.',
  'error.setLanguage': 'No se pudo cambiar el idioma. Intenta de nuevo.',
  'error.confirmSelection': 'No se pudo confirmar. Intenta de nuevo.',

  // Payment line item descriptions (client-side mapping)
  'lineItem.locker': 'Casillero',
  'lineItem.gymLocker': 'Casillero del Gimnasio',
  'lineItem.gymLockerNoCost': 'Casillero del Gimnasio (sin costo)',
  'lineItem.standardRoom': 'Habitación Estándar',
  'lineItem.doubleRoom': 'Habitación Doble',
  'lineItem.specialRoom': 'Habitación Especial',
  'lineItem.membershipFee': 'Tarifa de membresía',
  'lineItem.sixMonthMembership': 'Membresía de 6 meses',
  'lineItem.cardPayment': 'Pago con tarjeta',

  // Idle screen
  'idle.presentId': 'Presenta una identificación válida',
  'idle.readyForCheckin': 'Listo para el registro',

  // Add-ons screen
  'addons.title': 'Extras',
  'addons.subtitle': '¿Quieres agregar algo a tu visita?',
  'addons.noneAvailable': 'No hay extras disponibles en este momento.',
  'addons.total': 'Total de extras',
  'addons.noThanks': 'No, gracias',
  'addons.adding': 'Agregando…',
  'addons.addAndContinue': 'Agregar y continuar',

  // Payment screen extras
  'payment.yourCharges': 'Tus cargos',
  'payment.insertOrTapCard': 'Inserta o acerca la tarjeta a la terminal',
  'payment.waitingForPayment': 'Esperando pago...',
  'payment.processing': 'Procesando…',
  'payment.demoPayCard': 'Demo: Pagar con tarjeta',
  'payment.splitPayment': 'Pago dividido',
  'payment.demoPayCash': 'Demo: Pagar en efectivo',
  'payment.splitCardSubtitle': 'Pon la parte de tarjeta — el resto se cobra en efectivo.',
  'payment.cardAmount': 'Monto de tarjeta',
  'payment.cashRemaining': 'Efectivo restante',
  'payment.payCardPortion': 'Pagar porción con tarjeta',

  // Agreement screen extras
  'agreement.facilityAgreement': 'Acuerdo de instalación',
  'agreement.submitAgreement': 'Enviar acuerdo',
  'agreement.signBelow': 'Firma aquí',
  'agreement.confirmSignature': 'Confirmar firma',

  // Complete screen
  'complete.allSet': '¡Todo listo!',
  'complete.allSetWithName': '¡Todo listo, {name}!',
  'complete.yourRoom': 'Tu cuarto',
  'complete.yourLocker': 'Tu casillero',
  'complete.checkoutBy': 'Hora de salida',
  'complete.today': 'Hoy',

  // Selection screen extras
  'selection.selectYourOption': 'Selecciona tu opción',
  'selection.onlyLeft': 'Solo quedan {count}',
  'waitlist.joinUpgradeWaitlist': 'Únete a la lista de mejoras',
  'waitlist.selectRoomTypes': 'Selecciona qué tipo(s) de habitación te gustaría si se hacen disponibles.',
  'waitlist.upgradeOptions': 'Opciones de mejora',
  'waitlist.selectOptionForNow': 'Seleccionar opción temporal',
  'waitlist.notifiedWhenAvailable': 'Se te notificará cuando tu mejora esté disponible.',
  'waitlist.availableOptions': 'Opciones disponibles',
  'waitlist.available': 'disponible',
  'waitlist.disclaimer': 'Para unirse a la lista de espera, debe alquilar un casillero. Nota: Cuando haya una mejora disponible, puede aceptarla (se aplican tarifas de mejora y se pagan en ese momento).',

  // General
  membership: 'Membresía',
  noOptionsAvailable: 'No hay opciones disponibles',
};
