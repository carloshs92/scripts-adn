import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderProgreso } from '../src/cli/interactive.js';

/**
 * La barra de progreso usaba `chalk` sin importarlo. El error no aparecía al
 * arrancar ni en ninguna prueba: recién estallaba en la primera llamada al
 * modelo de una corrida larga —"chalk is not defined"— y se perdía todo el
 * trabajo de esa corrida. Basta con ejecutarla una vez para que no vuelva.
 */
describe('renderProgreso()', () => {
  const escrito = [];
  const original = process.stdout.write;

  afterEach(() => {
    process.stdout.write = original;
    escrito.length = 0;
  });

  const capturar = () => {
    process.stdout.write = (texto) => {
      escrito.push(String(texto));
      return true;
    };
  };

  it('se ejecuta sin romperse y dibuja la barra', () => {
    capturar();
    renderProgreso({
      fileName: 'Intercorp Conecta Impulso.pdf',
      fileIndex: 0,
      totalFiles: 3,
      chunk: 2,
      totalChunks: 8,
      milestones: 41,
      chars: 120000,
    });
    process.stdout.write = original;

    const salida = escrito.join('');
    expect(salida).toContain('█');
    expect(salida).toContain('1/3');
    expect(salida).toContain('41');
  });

  it('cierra la línea cuando el documento termina', () => {
    capturar();
    renderProgreso({
      fileName: 'corto.pdf',
      fileIndex: 2,
      totalFiles: 3,
      chunk: 4,
      totalChunks: 4,
      milestones: 7,
      chars: 1000,
    });
    process.stdout.write = original;
    expect(escrito.join('')).toContain('\n');
  });
});
