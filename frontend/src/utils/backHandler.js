/**
 * Botón "Atrás" de Android para hojas y menús que no cambian de ruta.
 * Cada hoja abierta apila su función de cierre; el handler global de App.jsx
 * cierra primero la última abierta antes de retroceder o salir de la app.
 */
import { useEffect, useRef } from 'react';

const stack = [];

/** Cierra la última hoja abierta. Devuelve true si había alguna. */
export function handleBack() {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.current?.();
  return true;
}

/** Mientras `active` sea true, el botón Atrás llama a `onBack` en vez de retroceder. */
export function useBackClose(active, onBack) {
  const ref = useRef(onBack);
  ref.current = onBack;
  useEffect(() => {
    if (!active) return undefined;
    stack.push(ref);
    return () => {
      const i = stack.lastIndexOf(ref);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [active]);
}
