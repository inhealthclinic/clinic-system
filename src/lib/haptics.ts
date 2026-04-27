/**
 * Тактильный отклик (vibration) для мобильных Android.
 * iOS отключил navigator.vibrate — не упадёт, просто ничего не произойдёт.
 *
 * Использование:
 *   haptic(20)           — лёгкое касание (отправка, подтверждение)
 *   haptic([10, 50, 10]) — двойной импульс (ошибка, отмена)
 */
export function haptic(pattern: number | number[]) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(pattern)
    } catch {
      // silently ignore — old browsers, iOS
    }
  }
}
