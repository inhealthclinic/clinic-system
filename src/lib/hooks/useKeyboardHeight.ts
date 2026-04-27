'use client'

import { useEffect, useState } from 'react'

export function useKeyboardHeight() {
  const [keyboardHeight, setKeyboardHeight] = useState(0)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return

    const vv = window.visualViewport

    const onResize = () => {
      const height = window.innerHeight - vv.height - vv.offsetTop
      const h = Math.max(0, height)
      setKeyboardHeight(h)
      document.documentElement.style.setProperty('--keyboard-h', `${h}px`)
    }

    vv.addEventListener('resize', onResize)
    vv.addEventListener('scroll', onResize)
    onResize()

    return () => {
      vv.removeEventListener('resize', onResize)
      vv.removeEventListener('scroll', onResize)
      document.documentElement.style.removeProperty('--keyboard-h')
    }
  }, [])

  return keyboardHeight
}
