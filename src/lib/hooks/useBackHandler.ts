'use client'

import { useEffect } from 'react'

/**
 * Перехватывает кнопку «Назад» Android (и браузерный history.back())
 * пока модалка открыта — закрывает её вместо перехода назад.
 *
 * Только для fullscreen мобильных модалок. Не подключать к desktop-дропдаунам.
 */
export function useBackHandler(isOpen: boolean, onClose: () => void) {
  useEffect(() => {
    if (!isOpen) return

    const stateKey = `modal-${Date.now()}`
    window.history.pushState({ key: stateKey }, '')

    const onPopState = () => {
      onClose()
    }

    window.addEventListener('popstate', onPopState)

    return () => {
      window.removeEventListener('popstate', onPopState)
      // Если модалка закрыта программно (не через back) — убираем
      // добавленный entry из истории, чтобы не оставлять «пустой» шаг.
      if (window.history.state?.key === stateKey) {
        window.history.back()
      }
    }
  }, [isOpen, onClose])
}
